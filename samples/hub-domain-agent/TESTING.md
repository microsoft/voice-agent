# Test procedure

Commands below run from `samples/hub-domain-agent` with its `.venv` active.
Offline tests do not need Azure credentials. **Deployment and text smoke make
real calls and incur charges**; run only in your authorized project. No test creates
infrastructure, grants roles, changes pools, or changes shared service configuration.

## 1. Offline application and SDK checks

```bash
python -m pytest tests -q
python -m ruff check .
python -m ruff format --check .
```

These exercise the real routing, streaming, snapshot hooks, SDK lifecycle
routes, OpenAI 3.55 stream parser, version serialization, cancellation and scoped
cleanup. Model/identity/Domain network boundaries are substituted. They do not
prove Azure IAM, container pull access, platform snapshot capture, or Voice Live.
Text smoke regressions substitute HTTP and credentials: they prove parent
readiness checks, version guards, ownership checkpointing and cleanup/error
handling, not deployed permissions.

The focused regressions cover interrupted writes at all seven deployment
checkpoints, fsync/replace failure and retry; lost/cancelled CREATEs followed by
repeated 404s, late visibility, version guards and failed/retried deletion; and
matching/mismatched tool names with cold and cached Domain sessions. They assert
that unresolved acquisition retries do not submit another CREATE, unrelated
resources are untouched, and invalid routing never commits customer history.
Explicit 400/401/403/404/429 rejection is paired with corrected later requests;
408/5xx, lost responses and cancellation retain unresolved ownership instead.

Optional local container health check (no Azure credentials or model calls):

```bash
docker build -f billing/Dockerfile -t billing-agent:local .
docker run --rm --name billing-agent-local \
  -p 127.0.0.1:8088:8088 \
  -e PROJECT_ENDPOINT=https://example.invalid/api/projects/example \
  -e MODEL_DEPLOYMENT=example-model \
  -e DOMAIN_MODEL_WARMUP=false billing-agent:local
```

In another terminal, `curl --fail http://127.0.0.1:8088/readiness` must return 200.
Use Ctrl+C in the container terminal to stop it. Do not expose the local SDK
server to an untrusted network; Azure platform authentication is not reproduced
by this localhost check.

Build Booking with `-f booking/Dockerfile` and its own tag; its entry point is
fixed to Booking. Build Hub with `-f hub/Dockerfile` and its own tag. A local Hub
also needs `BILLING_DOMAIN_AGENT`, `BILLING_DOMAIN_VERSION`, `BOOKING_DOMAIN_AGENT`
and `BOOKING_DOMAIN_VERSION`; placeholder references suffice for health-only
checks, but do not prove Domain connectivity. Do not pass `AGENT_ROLE`: it is
not a runtime switch in any image.

## 2. Capture and deployed two-turn smoke

Build/publish all three images and run `deploy.py` as described in README. Confirm all three
versions have `enable_memory_snapshot=true` and their respective image/model/protocol
and idle settings. Verify the identities' required permissions before business
testing; capture ACTIVE alone is insufficient.

```bash
python smoke.py --role billing --output results/billing-smoke.json
python smoke.py --role hub --output results/hub-billing-smoke.json
```

Each command creates **one new session**, sends the two distinct Billing text
questions, and attempts exact-owned cleanup even on failure. Each result
path must be new; never overwrite/retry a failed sample to manufacture a pass.
The planned parent ID is atomically persisted before CREATE. Hub cleanup first
runs inside the exact Hub session under its own Hosted identity, then the client
deletes the parent. The client never assumes a CLI 404 means a child was deleted.
If that Hub cannot be reached, retain the report and request explicit operator
recovery with verified cross-user session permissions as described in README.
After CREATE, the client checks the pinned parent version and waits for active/idle
under a separate 90-second readiness deadline. It polls only that exact ID every
one second; failed/version-mismatched sessions never receive business input.
Failure/cancellation preserves the ownership record and still attempts cleanup;
cleanup/report errors cannot replace an already recorded primary failure.
If CREATE timed out or was cancelled and cleanup only observed 404, require
`cleanup_complete=false` and retain `create_unresolved=true`. Do not rerun the
business smoke to replace that failure. Reconcile the original exact ID through
authorized operator cleanup; once the matching resource is visible, delete it
without submitting another CREATE. A wrong version must never be deleted.

Inspect result `turns[*].status`:

- `captured=true`, nonempty `restore_id`; the same restore/session ID across
  T1/T2 of the same customer.
- First completed turn has `history_messages=2`, then 4; a new customer starts
  from empty history, not another customer's history.
- Hub `last_route=billing`; one Billing session reused, no Booking session.
- Answers explain the synthetic increase: 15 excess calls × 2 yuan = 30 yuan,
  99→129 yuan. This is **not** a real account or refund operation.
- `cleanup_complete=true`. On cleanup failure, retain IDs/results and perform
  narrowly scoped operator cleanup rather than deleting by prefix.

In Foundry container log streams, correlate `SNAPSHOT_BEFORE`, `SNAPSHOT_AFTER`,
`INVOKE`, `HUB_ROUTE`, `DOMAIN_READY` and `DOMAIN_RESPONSE`. Check distinct restore
IDs between independent customers, the same capture boot ID per version, and
Domain restore IDs/history 0→2 across the two invocations. `status` reports history
*after* completion; invocation/response headers report it *before* that turn.
No customer text, token, or credentials are written to server application logs.

For snapshot failure, inspect platform/callback errors. Do not disable the flag
to hide the failure. For 401/403, verify the **Hosted caller identity**, not merely
the CLI user. Do not change global flags/RBAC/network settings as a test workaround.

## 3. Routing checks

Use fresh sessions and outputs for each case:

```bash
python smoke.py --role hub --turn1 "Hello!" --turn2 "What can you help me with?" \
  --output results/hub-self-smoke.json
python smoke.py --role hub \
  --turn1 "What is the status of the simulated reservation BK1001?" \
  --turn2 "What is the cancellation policy for that reservation?" \
  --output results/hub-booking-smoke.json
```

Expected: Hello→`self` with no Domain session; booking→`booking` with one reused
Booking session. Inspect actual route/status, not just plausible spoken text.
Cross-topic switches must re-evaluate the tools; follow-ups may use prior history.

## 4. Connect a separate Voice Live client

The sample does not include an audio generator, voice client, load driver, or
internal telemetry exporter. Use a Voice Live client that supports direct Hosted
Agent integration in your target environment, not a managed Voice Agent client
that expects an Agent of kind `voice`.

Select the returned Hosted Hub using these connection query parameters:

| Parameter | Value |
| --- | --- |
| `agent-name` | `deployment.json` → `agents.hub.name` |
| `agent-version` | `deployment.json` → `agents.hub.version` |
| `agent-project-name` | Project name from `project_endpoint` |

Use your resource's Voice Live endpoint, supported API version and authentication.
The client owns microphone/audio format, speech recognition/synthesis, input
turns, interruption, transport and session lifecycle. Configure those through
that client's supported interface; none of them is a Hub/Domain environment
variable. This sample neither grants Voice Live access nor changes its pools.

The deployed Hub still answers greetings itself and routes Billing/Booking
requests to the pinned Domains. The text checks above verify those agent paths;
they do not establish end-to-end voice behavior or TTFA.

## 5. Cleanup and readiness handoff

The text runner deletes only its exact owned sessions. Verify
`cleanup_complete=true` and retain the deployment manifest and result, including
on failure. Agents/images remain for reuse. After verifying ownership and no
other users, remove only the created sample agents via your organization's
normal lifecycle process; restore separately authorized pool changes first.

If the process is killed, use the result's recorded parent ID and pinned
deployment manifest to repeat the Hub cleanup action before deleting the parent.
If the Hub is unavailable, retain the IDs and request operator recovery as
described in README. A CLI 404 does not establish that the Hub's children are
gone. Never delete sessions by prefix.

A local ownership record is required when retrying the text client's cleanup
helper (`ownership=report`); it must match the role and exact session ID. Missing
outcome evidence is treated conservatively. Hub outcome flags do not survive
process loss: consult the README's operator-reconciliation limitation before
declaring cleanup complete after a crash. Repeated absence alone is not proof
that an outstanding remote CREATE has terminated.

Validation layers must stay distinct:

| Check | What it establishes |
| --- | --- |
| Offline tests | Application behavior and SDK wire/serialization boundaries with external I/O replaced. |
| Local container readiness | Packaging/startup/health only. |
| Capture ACTIVE | Platform accepted and initialized that version's snapshot. |
| Real text smoke | Target identity, model, route, protocol and restore functionality for those requests. |
| Separate Voice Live client check | End-to-end voice behavior only when actually run against the intended deployment. |

This sample provides the procedures and local tests; it does not assert a new
cloud deployment, live voice validation, or latency benchmark for these images.
