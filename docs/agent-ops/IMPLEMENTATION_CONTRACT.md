# YatraBuddy local agent workflow

Run all examples from the workspace root. Python 3.11 or newer is sufficient.

```powershell
python -m agent_ops.workflow goal "Improve the planning review screen" --preview
python -m agent_ops.workflow status
python -m agent_ops.workflow claim Agent_PM pm-worker
python -m agent_ops.workflow checkpoint TASK_ID LEASE "Audited the default route and the failed preview"
python -m agent_ops.workflow finish TASK_ID LEASE pass docs/agent-ops/evidence.json
```

Use the actual task ID and lease returned by `claim`. The lease grants access to that assignment and should stay with the worker. Status omits active lease values. Claims run in a SQLite transaction, expired leases release on the next claim or status, and the next worker receives the prior checkpoint. Append `--seconds 1800` to a checkpoint command to renew a lease. Pass `--db data/alternate-queue.sqlite3` before the subcommand to isolate a run.

The fixed dependency graph is audit → design → implement → verify → changelog. The stages are owned by Agent_PM, Agent_Design, Agent_Dev, Agent_QA, and Agent_PM, respectively. Each claim enforces role and dependency order. Only one implementation task can be active in a database. QA must use a worker identity distinct from the builder's. This catches same-identity certification. Worker identity comes from the trusted local host, so the CLI does not authenticate humans or prove separate models ran.

Submit an existing workspace JSON file, with the fields below. The queue copies the evidence into its event history and records the source file's SHA-256. Keep command output, observed browser behavior, and relevant source links in the evidence. The queue validates the evidence shape and acceptance conditions. The independent worker is responsible for observing and reporting the facts.

- Audit pass requires `priorities` with exactly three concrete strings.
- Design pass requires `brief` and `acceptance`.
- Implementation pass requires `changes` and `checks`.
- QA pass requires `acceptance` and `observation`. For goals created with `--preview`, include integer `http_status` from 200 to 299 and boolean `page_check: true`. Include the actual browser route in the observation.
- Changelog pass requires `changelog`, `next_actions` with exactly three entries, and `learning`.
- A failure requires `finding` and `reproduction`. A QA failure reopens implementation for up to two correction rounds. The third failure blocks QA. Other failures block their own stage.

Status reports ready and active work under `now`, dependent work under `next`, stopped work under `blocked`, and recorded learnings under `improve`. The `recurring` lane stays empty in this milestone. Per-goal metrics include completed stages, verification, retries, and elapsed time after completion. Task and event records are durable in `data/agent-ops.sqlite3`. The host holds execution authority. The CLI performs local bookkeeping and runs no worker commands.

## Runtime capabilities

- **Python and SQLite** run locally and require no package install. SQLite uses WAL for concurrent access and atomic claims.
- **Coding** uses the host agent and filesystem tools. Assign non-overlapping file scopes and serialize mutations in this workspace.
- **Browser QA and research** use the host's browser and research tools. The CLI captures supplied outcomes. It can verify evidence structure, while the host verifies the rendered page and validates sources.
- **Git isolation** is unavailable because the current workspace lacks repository metadata.
- **Scheduled or remote execution** is outside the local first milestone. The reusable prompt can be run again in an authorized host session, using the stored checkpoints.

## Milestones

1. **Local verified loop.** Persist goals, claim role-scoped tasks, capture evidence, exercise the correction loop, and preserve a reusable lesson. See [the regression fixture](LEARNING.md).
2. **Host adapters.** Record host worker identifiers and browser evidence automatically with a consistent handoff format.
3. **Workflow evaluation.** Add a repeat-run dashboard for time, failures, retries, evidence quality, and learning reuse. Treat unobserved costs and verification as unknown.
4. **Controlled concurrency.** Add real worker authentication and isolated checkouts when the repository and runtime support them.

## Verification

```powershell
python -m unittest agent_ops.test_workflow -v
python -m agent_ops.demo
```

The demo writes its own database and evidence beneath `data/agent-ops-demo`. The target page responses in that run are controlled fixtures. Use a distinct live QA worker to verify real application behavior.
