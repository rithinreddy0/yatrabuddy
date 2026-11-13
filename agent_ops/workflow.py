"""Durable YatraBuddy work queue. Worker actions happen in the host runtime."""

import argparse
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone


ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (
    ("audit", "Agent_PM"),
    ("design", "Agent_Design"),
    ("implement", "Agent_Dev"),
    ("verify", "Agent_QA"),
    ("changelog", "Agent_PM"),
)
ROLES = tuple(dict.fromkeys(role for _, role in WORKFLOW))
MAX_REVIEW_ROUNDS = 3


class WorkflowError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def required_text(record, key):
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise WorkflowError(f"Evidence must include {key}.")
    return value.strip()


def triple(record, key):
    value = record.get(key)
    if not isinstance(value, list) or len(value) != 3 or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise WorkflowError(f"Evidence must include exactly three entries in {key}.")


def validate_preview(status, page_check):
    if type(status) is not int or not 200 <= status < 300 or page_check is not True:
        raise WorkflowError("Preview must return HTTP 2xx and pass the page-content check.")


def validate_evidence(stage, verdict, record, preview_required):
    if not isinstance(record, dict):
        raise WorkflowError("Evidence must be a JSON object.")
    if verdict == "fail":
        required_text(record, "finding")
        required_text(record, "reproduction")
        return
    if stage == "audit":
        triple(record, "priorities")
    elif stage == "design":
        required_text(record, "brief")
        required_text(record, "acceptance")
    elif stage == "implement":
        required_text(record, "changes")
        required_text(record, "checks")
    elif stage == "verify":
        required_text(record, "acceptance")
        required_text(record, "observation")
        if preview_required:
            validate_preview(record.get("http_status"), record.get("page_check"))
    else:
        required_text(record, "changelog")
        triple(record, "next_actions")
        required_text(record, "learning")


def read_evidence(filename, root):
    root = root.resolve()
    path = (root / filename).resolve()
    if not path.is_relative_to(root):
        raise WorkflowError("Evidence must be inside the workspace.")
    if path.suffix.lower() != ".json" or not path.is_file() or path.stat().st_size > 64_000:
        raise WorkflowError("Use an existing JSON evidence file of at most 64 KB.")
    payload = path.read_bytes()
    try:
        record = json.loads(payload.decode("utf-8-sig"))
    except (ValueError, UnicodeError) as error:
        raise WorkflowError("Evidence must be valid UTF-8 JSON.") from error
    return record, {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


class Queue:
    def __init__(self, path, root=ROOT, now=utc_now):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.root = root
        self.now = now
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, preview_required INTEGER NOT NULL,
            created TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY, goal INTEGER NOT NULL REFERENCES goals(id),
            stage TEXT NOT NULL, role TEXT NOT NULL, parent INTEGER REFERENCES tasks(id),
            state TEXT NOT NULL, worker TEXT, lease TEXT, expires TEXT, checkpoint TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            UNIQUE (goal, stage)
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, goal INTEGER NOT NULL REFERENCES goals(id),
            task INTEGER REFERENCES tasks(id), event TEXT NOT NULL, worker TEXT,
            at TEXT NOT NULL, detail TEXT NOT NULL
        );
        """)

    def close(self):
        self.db.close()

    def _atomic(self, action):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            result = action()
            self.db.commit()
            return result
        except BaseException:
            self.db.rollback()
            raise

    def _event(self, goal, task, event, worker=None, detail=None):
        self.db.execute("INSERT INTO events (goal, task, event, worker, at, detail) VALUES (?, ?, ?, ?, ?, ?)",
                        (goal, task, event, worker, self.now().isoformat(), json.dumps(detail or {})))

    def create_goal(self, title, preview_required=False):
        if not title.strip():
            raise WorkflowError("Provide a goal.")
        def create():
            goal = self.db.execute(
                "INSERT INTO goals (title, preview_required, created) VALUES (?, ?, ?)",
                (title.strip(), int(preview_required), self.now().isoformat()),
            ).lastrowid
            parent = None
            for stage, role in WORKFLOW:
                parent = self.db.execute(
                    "INSERT INTO tasks (goal, stage, role, parent, state) VALUES (?, ?, ?, ?, 'pending')",
                    (goal, stage, role, parent),
                ).lastrowid
            self._event(goal, None, "created", detail={"title": title})
            return goal
        return self._atomic(create)

    def _expire(self):
        expired = self.db.execute(
            "SELECT * FROM tasks WHERE state='running' AND expires<=?", (self.now().isoformat(),),
        ).fetchall()
        for task in expired:
            self.db.execute(
                "UPDATE tasks SET state='pending', worker=NULL, lease=NULL, expires=NULL WHERE id=?",
                (task["id"],),
            )
            self._event(task["goal"], task["id"], "lease_expired", task["worker"])

    def claim(self, role, worker, seconds):
        if role not in ROLES or not worker.strip() or not 1 <= seconds <= 86400:
            raise WorkflowError("Provide a supported role, worker name, and lease from 1 to 86400 seconds.")
        worker = worker.strip()
        def assign():
            self._expire()
            if role == "Agent_Dev" and self.db.execute(
                "SELECT 1 FROM tasks WHERE role=? AND state='running'", (role,),
            ).fetchone():
                return None
            candidates = self.db.execute("""
                SELECT task.* FROM tasks task LEFT JOIN tasks parent ON task.parent=parent.id
                WHERE task.role=? AND task.state='pending' AND (task.parent IS NULL OR parent.state='done')
                ORDER BY task.id
            """, (role,)).fetchall()
            for task in candidates:
                if task["stage"] == "verify":
                    builder = self.db.execute("SELECT worker FROM tasks WHERE id=?", (task["parent"],)).fetchone()
                    if builder["worker"].casefold() == worker.casefold():
                        continue
                lease = secrets.token_urlsafe(24)
                expiry = (self.now() + timedelta(seconds=seconds)).isoformat()
                self.db.execute("""
                    UPDATE tasks SET state='running', worker=?, lease=?, expires=?, attempts=attempts+1 WHERE id=?
                """, (worker, lease, expiry, task["id"]))
                self._event(task["goal"], task["id"], "claimed", worker, {"expires": expiry})
                return {**dict(task), "state": "running", "worker": worker, "lease": lease,
                        "expires": expiry, "attempts": task["attempts"] + 1}
            return None
        return self._atomic(assign)

    def _leased_task(self, task_id, lease):
        task = self.db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task or task["state"] != "running" or task["expires"] <= self.now().isoformat():
            raise WorkflowError("This task has no active lease. Claim it again.")
        if not secrets.compare_digest(task["lease"], lease):
            raise WorkflowError("The lease does not own this task.")
        return task

    def checkpoint(self, task_id, lease, note, seconds=None):
        if not note.strip():
            raise WorkflowError("Provide a checkpoint note.")
        if seconds is not None and not 1 <= seconds <= 86400:
            raise WorkflowError("Lease renewal must be from 1 to 86400 seconds.")
        def save():
            task = self._leased_task(task_id, lease)
            expires = (self.now() + timedelta(seconds=seconds)).isoformat() if seconds else task["expires"]
            self.db.execute("UPDATE tasks SET checkpoint=?, expires=? WHERE id=?", (note.strip(), expires, task_id))
            self._event(task["goal"], task_id, "checkpoint", task["worker"],
                        {"note": note.strip(), "expires": expires})
            return expires
        return self._atomic(save)

    def finish(self, task_id, lease, verdict, filename):
        if verdict not in ("pass", "fail"):
            raise WorkflowError("Verdict must be pass or fail.")
        evidence, reference = read_evidence(filename, self.root)
        def complete():
            task = self._leased_task(task_id, lease)
            goal = self.db.execute("SELECT * FROM goals WHERE id=?", (task["goal"],)).fetchone()
            validate_evidence(task["stage"], verdict, evidence, goal["preview_required"])
            state = "done" if verdict == "pass" else "blocked"
            if verdict == "fail" and task["stage"] == "verify":
                reviews = self.db.execute("SELECT COUNT(*) FROM events WHERE task=? AND event='fail'",
                                          (task_id,)).fetchone()[0]
                if reviews + 1 < MAX_REVIEW_ROUNDS:
                    state = "pending"
                    self.db.execute("""
                        UPDATE tasks SET state='pending', checkpoint=? WHERE id=?
                    """, (required_text(evidence, "finding"), task["parent"]))
            self.db.execute("UPDATE tasks SET state=?, lease=NULL, expires=NULL WHERE id=?", (state, task_id))
            self._event(task["goal"], task_id, verdict, task["worker"], {**reference, "evidence": evidence})
            return state
        return self._atomic(complete)

    def status(self, goal=None):
        def snapshot():
            self._expire()
            args = () if goal is None else (goal,)
            goals = self.db.execute("SELECT * FROM goals" + (" WHERE id=?" if args else "") + " ORDER BY id", args)
            result = []
            for record in goals.fetchall():
                tasks = [dict(row) for row in self.db.execute("""
                    SELECT id, stage, role, parent, state, worker, expires, checkpoint, attempts
                    FROM tasks WHERE goal=? ORDER BY id
                """, (record["id"],))]
                events = [dict(row) for row in self.db.execute("""
                    SELECT id, task, event, worker, at, detail FROM events WHERE goal=? ORDER BY id
                """, (record["id"],))]
                for event in events:
                    event["detail"] = json.loads(event["detail"])
                completed = {task["id"] for task in tasks if task["state"] == "done"}
                lanes = {"now": [], "next": [], "blocked": [], "improve": [], "recurring": []}
                for task in tasks:
                    if task["state"] == "blocked":
                        lanes["blocked"].append(task["id"])
                    elif task["state"] == "running" or (
                        task["state"] == "pending" and (task["parent"] is None or task["parent"] in completed)
                    ):
                        lanes["now"].append(task["id"])
                    elif task["state"] == "pending":
                        lanes["next"].append(task["id"])
                for event in events:
                    evidence = event["detail"].get("evidence", {})
                    if "learning" in evidence:
                        lanes["improve"].append(evidence["learning"])
                verification = next(task for task in tasks if task["stage"] == "verify")
                last = next((event for event in reversed(events) if event["event"] == "pass"), None)
                duration = None
                if last and len(completed) == len(tasks):
                    duration = (datetime.fromisoformat(last["at"]) -
                                datetime.fromisoformat(record["created"])).total_seconds()
                metrics = {"completed_tasks": len(completed), "verified": verification["state"] == "done",
                           "retries": sum(max(0, task["attempts"] - 1) for task in tasks),
                           "completion_seconds": duration}
                result.append({**dict(record), "tasks": tasks, "events": events, "lanes": lanes, "metrics": metrics})
            return result
        return self._atomic(snapshot)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "agent-ops.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    goal = commands.add_parser("goal")
    goal.add_argument("title")
    goal.add_argument("--preview", action="store_true")
    claim = commands.add_parser("claim")
    claim.add_argument("role", choices=ROLES)
    claim.add_argument("worker")
    claim.add_argument("--seconds", type=int, default=1800)
    checkpoint = commands.add_parser("checkpoint")
    checkpoint.add_argument("task", type=int)
    checkpoint.add_argument("lease")
    checkpoint.add_argument("note")
    checkpoint.add_argument("--seconds", type=int)
    finish = commands.add_parser("finish")
    finish.add_argument("task", type=int)
    finish.add_argument("lease")
    finish.add_argument("verdict", choices=("pass", "fail"))
    finish.add_argument("evidence")
    status = commands.add_parser("status")
    status.add_argument("goal", type=int, nargs="?")
    options = parser.parse_args(argv)
    queue = Queue(options.db)
    try:
        if options.command == "goal":
            result = {"goal": queue.create_goal(options.title, options.preview)}
        elif options.command == "claim":
            result = queue.claim(options.role, options.worker, options.seconds)
        elif options.command == "checkpoint":
            expires = queue.checkpoint(options.task, options.lease, options.note, options.seconds)
            result = {"task": options.task, "checkpointed": True, "expires": expires}
        elif options.command == "finish":
            result = {"task": options.task, "state": queue.finish(
                options.task, options.lease, options.verdict, options.evidence,
            )}
        else:
            result = queue.status(options.goal)
        print(json.dumps(result, indent=2))
    except WorkflowError as error:
        print(str(error), file=sys.stderr)
        return 2
    finally:
        queue.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
