---
ai-usage: ai-assisted
---

# Snapshot-enabled Hub and Domain Hosted Agents

Connect **Voice Live directly to a Hosted Hub agent**. The Hub answers general
questions itself, or selects a Billing/Booking Domain agent whose answer streams
back through the Hub. This is application-owned routing, **not** a managed Voice
Agent subagent/handoff configuration. It does not create an Agent of kind `voice`.

```text
Voice Live (speech recognition/synthesis)
  └─ Hosted Hub (memory snapshot enabled)
       ├─ answers greetings/general questions
       ├─ Hosted Billing Domain (memory snapshot enabled)
       └─ Hosted Booking Domain (memory snapshot enabled)
```

Hub, Billing, and Booking have **separate implementations, prompts, entry
points, and Docker images**. All use HTTP Invocations `2.0.0`. Each
customer gets an exclusive Hub session. Domain sessions are created lazily,
version-pinned, and reused for that customer's later turns. Billing and Booking
are read-only simulations: no customer data, transactions, or external business
system. All agent instructions and example questions are English.

This sample contains the agents, their deployment script, and focused text/offline
tests. Audio recording/generation, voice clients, load tests, and service-internal
telemetry tooling are outside its scope.

## Separate implementations

| Directory | Responsibility | Entry point |
| --- | --- | --- |
| [`hub/`](hub/README.md) | Self-answer, tool selection, Domain prefetch/forwarding and owned-session cleanup. | `python -m hub.main` |
| [`billing/`](billing/README.md) | Read-only billing explanations and its own prompt. No Hub/Booking imports. | `python -m billing.main` |
| [`booking/`](booking/README.md) | Read-only reservation explanations and its own prompt. No Hub/Billing imports. | `python -m booking.main` |
| `common/` | Snapshot hooks, fresh clients, HTTP/SSE plumbing and bounded history. No business prompts or role switch. | Shared library only |

Each business directory has its own `agent.py`, `prompts.py`, `main.py` and
`Dockerfile`; Hub also owns `config.py` for pinned Domain references. There is
no combined top-level `agent.py`, prompt registry, or `AGENT_ROLE` dispatcher.
Each image copies only `common/` and its own business package.

## Behavior worth inspecting

- The Hub uses the Responses API with two strict, **empty-argument** function
  tools. It forwards the **original invocation input**, not model-rewritten text.
- On the first tool-name event, it starts acquiring the selected Domain session
  while continuing to read the model stream. It **does not send customer input**
  until the entire stream completes and exactly one registered empty-argument
  call has been validated. Invalid, mixed, truncated, or failed outputs fail.
  The announced and final tool names must match, even for an already-ready Domain.
- Domain output streams directly; there is no final Hub summarization LLM call.
  T2 reuses the Domain session but **still runs the Hub routing LLM**.
- Cancellation drains speculative tasks, closes streams, and does not commit an
  incomplete turn. An indeterminate CREATE remains in the exact owned-ID map
  for cleanup; a 404 does not resolve that CREATE or release its ID. Acquisition
  retries reconcile that same ID with GET instead of submitting another CREATE.
  Explicit CREATE rejections (400/401/403/404/429) do not leave a pending request;
  a later user request can try again after the underlying problem is corrected.
  A speculative but unused session can incur allocation cost.
- Completed turns are stored in a bounded **process-local** history. This is
  not durable conversation storage or a guarantee of context retention after
  sandbox reclamation/restart. Production persistence needs a separate design.

See the [OpenAI function-calling streaming guide](https://developers.openai.com/api/docs/guides/function-calling#streaming)
for tool-name versus completed-call events. SDK behavior is pinned here; the
sample uses OpenAI **3.55.0**, with no private parser/schema-cache monkeypatch.

## Prerequisites and deployment contract

1. Python **3.13**, Docker, Azure CLI sign-in (`az login`) or another
   `DefaultAzureCredential` identity.
2. An existing Foundry project supporting Hosted Agents, **memory snapshots**,
   HTTP Invocations, and direct Voice Live/Hosted integration in the intended
   subscription/region. Snapshot access can require separate preview enrollment;
   `allow_preview=True` sends headers but does **not** grant that access.
3. An existing Responses/function-calling text deployment, such as
   `gpt-5.4-mini`. Supply its deployment name. For EU processing, provision an
   eligible EU Data Zone deployment through your normal workflow; the sample
   does not create a model or change routing. Data Zone is not a single-region pin.
4. An existing container registry and platform image-pull access to it. The
   image must support `linux/amd64`. No registry, infrastructure, RBAC, network,
   quota, Cosmos, or service feature flag is provisioned by this sample.
5. Your operator identity needs Agent/session creation, read, invocation and
   scoped deletion permissions. The **Hosted identities**, not just your CLI
   identity, need model inference access; the Hub identity also needs permission
   to create/read/delete and invoke the two Domain sessions in this project.
   Ask the project administrator to grant the appropriate project-scoped roles.
   `deployment.json` records the returned identities. Treat authorization as a
   rollout dependency; an ACTIVE snapshot is not a successful business smoke.
6. To connect a separate voice client, you also need Voice Live access on the
   selected resource and the chosen speech/voice capabilities. Agent deployment,
   sessions, model calls, optional model warmup, and Voice Live usage incur charges;
   snapshot-specific billing must be confirmed with the platform owner. No
   separate Speech TTS resource is required by this sample.

The serving SDK owns health and snapshot lifecycle endpoints. Before capture,
the application cancels/drains its optional warmup and closes HTTP/model/project/
credential clients; it refuses a reusable snapshot with customer history or
Domain bindings. After restore it rebuilds clients and records boot/restore/
session IDs. These callbacks are necessary in addition to the definition flag.

## Setup

From this directory:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
az login
```

PowerShell: use `py -3.13 -m venv .venv`, `.venv\Scripts\Activate.ps1`, and
`Copy-Item .env.example .env`. Keep this environment separate from other samples.

Set `.env` to your project, model deployment, and three immutable image references.
Never put tokens, keys, or tenant-specific credentials in
source. The container receives only explicit application configuration, not
your local `.env`, CLI profile, or result files.

## Build and publish three images

Use your existing registry and a new tag:

```bash
az acr login --name <existing-registry>
docker build --platform linux/amd64 -f hub/Dockerfile -t <registry>.azurecr.io/hub-agent:<new-tag> .
docker build --platform linux/amd64 -f billing/Dockerfile -t <registry>.azurecr.io/billing-agent:<new-tag> .
docker build --platform linux/amd64 -f booking/Dockerfile -t <registry>.azurecr.io/booking-agent:<new-tag> .
docker push <registry>.azurecr.io/hub-agent:<new-tag>
docker push <registry>.azurecr.io/billing-agent:<new-tag>
docker push <registry>.azurecr.io/booking-agent:<new-tag>
docker buildx imagetools inspect <registry>.azurecr.io/hub-agent:<new-tag>
docker buildx imagetools inspect <registry>.azurecr.io/billing-agent:<new-tag>
docker buildx imagetools inspect <registry>.azurecr.io/booking-agent:<new-tag>
```

Set `HUB_AGENT_IMAGE`, `BILLING_AGENT_IMAGE`, and `BOOKING_AGENT_IMAGE` in `.env`
to the corresponding immutable `image@sha256:...` references. If a
tag points to an OCI index, select its **linux/amd64 runtime manifest**, not the
attestation manifest. The local build does not publish or deploy automatically.

## Create the agents

```bash
python deploy.py --output deployment.json
```

This creates uniquely named Billing, Booking, then Hub agents, waits for each
version's snapshot capture to become ACTIVE, reads back its own image/definition, and
pins the returned Domain versions in the Hub environment. Old Agents/versions
are never updated or deleted. If creation fails partway, keep the deployment
record: each checkpoint atomically replaces the previous valid JSON. If writing
an update fails, deployment stops and the last record still contains the planned
names and any previously saved versions. There are no automatic
business/deployment retries or silent snapshot-disable fallback.

The three images can also be supplied explicitly with `--hub-image`,
`--billing-image`, and `--booking-image`. `deployment.json` records them under
`images.hub`, `images.billing`, and `images.booking`. The selected image's entry
point determines the implementation; no environment setting switches the
container between Hub, Billing, and Booking.

The essential configuration in [`deploy.py`](deploy.py) is:

```python
definition = models.HostedAgentDefinition(
    cpu="1",
    memory="2Gi",
    enable_memory_snapshot=True,
    container_configuration=models.ContainerConfiguration(image=image),
    protocol_versions=[models.ProtocolVersionRecord(protocol="invocations", version="2.0.0")],
    session_configuration=models.SessionConfiguration(idle_timeout_seconds=120),
    environment_variables=environment,
)
project.agents.create_version(
    agent_name=name,
    definition=definition,
    metadata={
        "voiceLiveCompatible": "true",
        "voiceLiveInvocationState": "session_self_managed",
    },
)
```

Snapshot enablement belongs to the **Hosted definition**, not Voice Live session
settings or arbitrary metadata. This sample intentionally uses the supported
Projects SDK creation path; it does not invent an unverified `azure.yaml` property.
No per-customer snapshot registration is needed: new sessions of the enabled
version use the platform's captured initialization state.

Defaults: **1 vCPU / 2 GiB**, **120-second sandbox idle timeout**, Hub model warmup
off, Domain startup/after-restore best-effort model warmup on. Warmup never enters
customer history and is independent of readiness. Set `DOMAIN_MODEL_WARMUP=false`
*before creating versions* if you want to test without it; record that change.

## Validate and test

Follow **[TESTING.md](TESTING.md)** in order: offline tests, optional local health
check, authorized deployed text smoke, then routing checks. The guide also
describes how a separate Voice Live client selects the Hosted Hub. Do not equate
local hook tests with real platform capture/restore or IAM validation.

Files:

| File | Purpose |
| --- | --- |
| `hub/agent.py`, `hub/prompts.py` | Hub-only routing, prefetch/forwarding and self-answer instructions. |
| `billing/agent.py`, `billing/prompts.py` | Independent Billing specialist and simulated billing facts. |
| `booking/agent.py`, `booking/prompts.py` | Independent Booking specialist and simulated reservation facts. |
| `common/` | Shared infrastructure/lifecycle only; no specialist behavior or prompt registry. |
| `deploy.py` | Typed snapshot-enabled definitions, unique versions, and readback manifest. |
| `smoke.py` | Two text turns against a pinned role, lifecycle status, exact-ID cleanup. |
| `tests/` | Offline tests of real application/SDK boundaries with external services substituted. |

## Pools and cleanup

**Memory snapshots and standby pools are different features.** Standby keeps
allocated sandboxes ready; snapshots provide an initialized process image.
This sample enables snapshots but **does not configure platform standby** or
change Voice Live pool settings.

If separately authorized, configure platform standby on each Hosted Agent's
endpoint (`agent_endpoint.standby_pool.size`), wait for readiness, verify actual
claims, and restore the old capacities. A 403 saying standby is not enabled is an
environment enrollment blocker, not permission to change RBAC/service flags or
fall back to another region. No standby benchmark or free-warm-pool claim is
implied here.

The text smoke client attempts cleanup of only its exact owned test session and
keeps the deployed Agents/versions. For Hub runs, it checks the parent's pinned
version, invokes `{"action":"cleanup"}` on that exact Hub session, and deletes the
parent only after the Hub confirms its child bindings are empty. Child GET/DELETE
requests use the **Hub's Hosted identity**, not the CLI identity. Every child is
version-checked before deletion; mismatches remain recorded for explicit review.
The Hub reconstructs both deterministic child IDs before cleanup, including after
restore with an empty binding map. An unbound startup/capture process does not
issue child requests; repeated cleanup never creates sessions.
Normal cleanup does not require the operator to manage another identity's sessions.

Text smoke atomically saves the planned parent ID before CREATE. Keep its report
even on failure. Its initial `create_unresolved=true` is conservative: the CREATE
may be dispatched after that checkpoint. Cleanup clears it only after observing
the exact pinned resource; a 404 while unresolved leaves cleanup incomplete.
Explicit CREATE rejection also clears that flag. Pass the same ownership record
when retrying the text client's cleanup helper.
Never clear an unresolved outcome merely because repeated GETs return 404.
After a process kill, use the recorded parent ID
and the same pinned deployment manifest to repeat the Hub cleanup action before
deleting the parent. If the Hub is unavailable, the runner reports incomplete
cleanup: a CLI 404 is not proof that its children are gone. A project administrator
must verify cross-user `sessions/read` and `sessions/write` access before inspecting
the exact deterministic child IDs (`<role>_` + first 40 hex characters of the
SHA256 of the Hub session ID). Do not grant roles automatically or delete by prefix.
See [Hosted session permissions](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/manage-hosted-sessions#view-and-manage-sessions-across-users).
Idle reclaim is a fallback, not proof of successful cleanup. Deleting a Hub alone
need not delete its child sessions.

Hub CREATE-outcome tracking is process-local, not a durable transaction journal.
After losing a Hub process during CREATE, deterministic IDs recover the cleanup
targets but not proof that server-side work has finished. An operator must
reconcile outstanding platform operations before treating absence as final;
this sample does not provide crash-safe distributed CREATE/DELETE transactions.

When finished, inspect names/versions in `deployment.json`, verify no other
workload uses them and any standby target is zero, then remove **only those
sample Agents** through your normal Foundry lifecycle procedure. This removes
their versions/context; there is no automatic Agent deletion in this sample.

Do not treat historical latency figures from a different image, SDK, question,
model route, or warmup policy as a measured result for this portable sample.
