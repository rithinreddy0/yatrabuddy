"""Run the complete workflow on an isolated preview regression fixture."""

import json
from pathlib import Path
import tempfile

from .workflow import Queue, ROOT, WorkflowError


def run(root):
    root.mkdir(parents=True, exist_ok=True)
    queue = Queue(root / "queue.sqlite3", root)
    observations = []

    def finish(task, evidence, verdict="pass"):
        path = root / f"{task['stage']}-{task['attempts']}-{verdict}.json"
        path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        return queue.finish(task["id"], task["lease"], verdict, path.name)

    try:
        goal = queue.create_goal("Require positive evidence for the YatraBuddy chat preview", preview_required=True)
        audit = queue.claim("Agent_PM", "pm", 120)
        finish(audit, {"priorities": ["Confirm target page status", "Check rendered composer", "Record replay steps"]})
        design = queue.claim("Agent_Design", "design", 120)
        finish(design, {"brief": "Check both HTTP status and expected content before approval.",
                        "acceptance": "Reject 404 even if a screenshot was captured."})
        build = queue.claim("Agent_Dev", "builder", 120)
        queue.checkpoint(build["id"], build["lease"], "Built preview evidence validator.")
        finish(build, {"changes": "Added a preview evidence gate.",
                       "checks": "Ran validator with controlled status and content fixtures."})
        assert queue.claim("Agent_QA", "builder", 120) is None
        review = queue.claim("Agent_QA", "qa", 120)
        false_positive = {"acceptance": "Preview loaded", "observation": "Captured error page screenshot",
                          "http_status": 404, "page_check": False}
        try:
            finish(review, false_positive)
        except WorkflowError as error:
            observations.append(str(error))
        else:
            raise AssertionError("404 evidence bypassed the preview gate")
        finish(review, {"finding": "Preview returned 404.",
                        "reproduction": "Open the fixture's missing page and inspect the response."}, "fail")
        build = queue.claim("Agent_Dev", "builder", 120)
        assert build["checkpoint"] == "Preview returned 404."
        finish(build, {"changes": "Fixed the test fixture route.",
                       "checks": "The fixture now returns the expected status and content."})
        review = queue.claim("Agent_QA", "qa", 120)
        finish(review, {"acceptance": "Expected page loads", "observation": "Fixture showed the expected composer",
                        "http_status": 200, "page_check": True})
        changelog = queue.claim("Agent_PM", "pm", 120)
        finish(changelog, {"changelog": "Preview evidence gate caught the false positive.",
                           "next_actions": ["Capture browser status automatically",
                                            "Assert the target composer appears",
                                            "Track repeat-run stability"],
                           "learning": "A screenshot is insufficient. Require a successful response and expected page content."})
        return {"fixture": True, "evidence_directory": str(root), "rejections": observations,
                "result": queue.status(goal)[0]}
    finally:
        queue.close()


if __name__ == "__main__":
    parent = ROOT / "data" / "agent-ops-demo"
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="run-", dir=parent))
    print(json.dumps(run(directory), indent=2))
