# YatraBuddy operating summary

The host agent runtime supplies workers and tools. A local Python CLI keeps goals, task dependencies, leases, checkpoints, and verification in SQLite. Markdown keeps the project contract and the reusable orchestrator prompt visible.

The first milestone is one recoverable YatraBuddy work loop, from a goal and audited priorities through worker dispatch, an independent review, and a recorded learning. Read this summary and the latest status before resuming.

The four roles are Agent_PM, Agent_Design, Agent_Dev, and Agent_QA. One writer owns each file scope. Verification requires evidence from a different worker. Scope ends with local development and authorized read-only research. No external publishing, scheduled work, secret retrieval, or arbitrary execution is needed for this milestone.

Python 3.11 and SQLite are available. The workspace has no Git checkout metadata. Browser and research work run in the host agent runtime. The queue can hand off and record their results. The CLI can run its own checks without dependencies.
