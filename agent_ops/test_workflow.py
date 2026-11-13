import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from .demo import run
from .workflow import Queue, WorkflowError, validate_preview


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "queue.sqlite3"
        self.clock = datetime(2026, 11, 13, tzinfo=timezone.utc)
        self.queue = Queue(self.path, self.root, lambda: self.clock)
        self.addCleanup(self.queue.close)

    def test_claim_is_atomic_across_connections(self):
        self.queue.create_goal("Concurrent claim")
        def claim(worker):
            connection = Queue(self.path, self.root, lambda: self.clock)
            try:
                return connection.claim("Agent_PM", worker, 30)
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            assignments = list(pool.map(claim, ("first", "second")))
        self.assertEqual(sum(assignment is not None for assignment in assignments), 1)

    def test_resume_preserves_checkpoint_and_rejects_old_lease(self):
        goal = self.queue.create_goal("Recover work")
        self.assertIsNone(self.queue.claim("Agent_Dev", "builder", 30))
        first = self.queue.claim("Agent_PM", "first", 2)
        self.queue.checkpoint(first["id"], first["lease"], "Reviewed navigation", seconds=5)
        self.clock += timedelta(seconds=3)
        self.assertIsNone(self.queue.claim("Agent_PM", "second", 5))
        self.clock += timedelta(seconds=2)
        second = self.queue.claim("Agent_PM", "second", 5)
        self.assertEqual(second["checkpoint"], "Reviewed navigation")
        self.assertEqual(second["attempts"], 2)
        with self.assertRaises(WorkflowError):
            self.queue.checkpoint(first["id"], first["lease"], "Old worker")
        status = self.queue.status(goal)[0]
        self.assertNotIn("lease", status["tasks"][0])
        self.assertIn("lease_expired", {item["event"] for item in status["events"]})

    def test_invalid_evidence_does_not_advance(self):
        goal = self.queue.create_goal("Validate evidence")
        task = self.queue.claim("Agent_PM", "planner", 10)
        evidence = self.root / "audit.json"
        evidence.write_text(json.dumps({"priorities": ["Only one"]}), encoding="utf-8")
        with self.assertRaises(WorkflowError):
            self.queue.finish(task["id"], task["lease"], "pass", evidence.name)
        self.assertIsNone(self.queue.claim("Agent_Design", "designer", 10))
        self.assertEqual(self.queue.status(goal)[0]["tasks"][0]["state"], "running")

    def test_preview_requires_both_success_and_expected_content(self):
        for status, page_check in [(404, True), (200, False), (200, "true"), ("200", True)]:
            with self.subTest(status=status, page_check=page_check), self.assertRaises(WorkflowError):
                validate_preview(status, page_check)
        validate_preview(200, True)

    def test_repeated_qa_failures_block_handoff(self):
        goal = self.queue.create_goal("Bound retries")
        def finish(task, evidence, verdict="pass"):
            path = self.root / "evidence.json"
            path.write_text(json.dumps(evidence), encoding="utf-8")
            return self.queue.finish(task["id"], task["lease"], verdict, path.name)
        finish(self.queue.claim("Agent_PM", "planner", 5), {"priorities": ["one", "two", "three"]})
        finish(self.queue.claim("Agent_Design", "designer", 5), {"brief": "Design", "acceptance": "Pass"})
        for expected in ("pending", "pending", "blocked"):
            finish(self.queue.claim("Agent_Dev", "builder", 5), {"changes": "Change", "checks": "Result"})
            self.assertIsNone(self.queue.claim("Agent_QA", "BUILDER", 5))
            result = finish(self.queue.claim("Agent_QA", "reviewer", 5),
                            {"finding": "Test failed", "reproduction": "Repeat"}, "fail")
            self.assertEqual(result, expected)
        self.assertIsNone(self.queue.claim("Agent_PM", "planner", 5))
        self.assertEqual(len(self.queue.status(goal)[0]["lanes"]["blocked"]), 1)

    def test_full_fixture_records_learning(self):
        demo = run(self.root / "demo")
        self.assertTrue(demo["fixture"])
        self.assertTrue(all(task["state"] == "done" for task in demo["result"]["tasks"]))
        self.assertEqual(len(demo["result"]["lanes"]["improve"]), 1)
        self.assertEqual([task["attempts"] for task in demo["result"]["tasks"]], [1, 1, 2, 2, 1])
        self.assertTrue(any("HTTP 2xx" in finding for finding in demo["rejections"]))
