# Runtime synchronization validation

## Independent PR installation validation

Validated on **October 16, 2026** against the published PR #37 runtime at
`f1f52b4624cf040c7b01ad5a9049953ae64d4a95`, on Linux with Python **3.12.3**,
Node.js **24.21.0**, and newly downloaded Playwright Chromium.

The source was exported from the GitHub PR ref, not copied from the developer's
working directory. The export contained no `.env`, generated MCP configuration,
virtual environment, `node_modules`, browser cache, Git metadata, or in-progress
hosted-playground files. No Git worktree or sibling repository was used.

| Check | Result |
| --- | --- |
| Fresh Portal dependencies | New venv, installed only `portal/requirements.txt` from public PyPI; resolved `azure-ai-projects 2.8.0` and `azure-identity 1.26.0`; `pip check` passed |
| Python-only production startup | Started `demo_server.py` from an unrelated empty directory with an isolated HOME and neither Node.js nor Azure CLI on PATH |
| Production pages and assets | Studio, Templates, Handoff Graph, and WebRTC returned HTTP 200; 11 referenced static assets loaded from the shipped files |
| Template catalog without local state | All four configured cards and their definitions loaded; MCP configuration remained explicitly required |
| Missing configuration and credentials | Missing Project stopped startup; missing MCP setup and Azure credentials returned explicit errors, not fabricated results |
| Owned imports | All Portal modules and `samples/voice_agent_definition.py` resolved inside the exported repository; third-party imports resolved inside the new venv |
| Fresh frontend tooling | `npm ci` used the public npm registry and lockfile; both bundles rebuilt with zero local hash drift |
| JavaScript unit suite | **238 passed** |
| Studio/privacy browser suite | **54 passed**, using a fresh browser installation |
| Real local Portal browser suite | **10 passed**, including creation, editing, Template publication/readback, runtime graph, WebSocket responses, and explicit microphone startup |
| Portal Python suite | **69 passed** |
| Sample SDK/definition suite | **11 passed** |
| Native shared MCP | New dedicated venv from `shared_mcp/requirements.txt`; **16 passed**, including Streamable HTTP and legacy SSE; `pip check` passed |
| Real Azure read-only check | The exported production Portal, using only the existing Azure CLI sign-in, listed Agents and read one existing Agent with HTTP 200; no Agent, connection, or voice session was created |

The clean checkout check also reproduced the old setup-directory error.
[README setup commands](README.md#set-up) now use `cd portal` from the repository
root, independent of the checkout folder's name.

This proves repository and dependency independence, not offline operation.
Use a complete checkout: the Portal uses the helpers and templates shipped in
`samples/` and the guide in `docs/`. A real Foundry Project, preview/model access,
and an authorized identity remain runtime prerequisites. Template publication
also requires the documented native MCP and Dev Tunnel setup.

The automated browser suites substitute Azure service boundaries. The separate
live check was read-only; this validation did not repeat a real microphone-to-
Azure voice conversation or publish a Template to Azure. Historical live
conversation checks below must not be confused with this clean-install run.

## Handoff MCP connection refresh validation

Validated on **October 14, 2026** on Linux with the live Portal, native MCP
runtime, Dev Tunnel, and the `voice-agent-india-tip` Foundry Project.

| Check | Result |
| --- | --- |
| Failed session diagnosis | `sess_EYkhjQc8iN9yGkyYveNHR` aborted twice at `entrypoint_to_open_call`; native MCP recorded matching `GET /mcp/elevator-service` requests returning HTTP 401 |
| Legacy MCP transport implementation | Current `shared_mcp` server and tests are byte-identical to the existing compatibility fix; 16 focused tests passed |
| Managed connection refresh | India Project connection target matched the current generated Dev Tunnel URL after refresh |
| Live control session | Existing Agent completed `entrypoint_to_open_call` and activated `open_call` |
| Live runtime graph | Existing Elevator Agent rendered 10 authoring-style cards; four visited stages showed shares totaling exactly 100%, the entrypoint displayed one attributed turn, and its expanded panel showed observed Average/P50/P95/latest latency plus STT/LLM/TTS estimates |
| Runtime metric unit coverage | Dwell accumulation, exact 100% shares, re-entry visits, per-node turns/latency samples, P50/P95 summaries, session stop, and compact duration formatting passed |
| Handoff/Templates Python suites | 15 passed |
| Portal JavaScript suite | 235 passed on Node 22 |
| Portal browser UI | 54 passed, including spoken transfer-message continuation, gray `NOT VISITED` veils, enlarged emerald visited/live cards, live node metrics, and desktop drag/keyboard resizing |
| Portal browser integration | 8 passed, including the consolidated Publish & run progress flow and a simulated publication failure that preserves the working copy |

## Handoff Graph authoring and runtime validation

Validated on **October 13, 2026** on Linux with Python **3.12.3**, Node
**24.21.0**, npm, and Playwright headless Chromium.

| Check | Result |
| --- | --- |
| `npm test` | **216 passed**, including 13 imported Handoff editor core tests |
| `npm run build:all` | Studio and standalone WebRTC bundles built |
| `npm run test:ui` | **48 passed** |
| `npm run test:local` | **7 passed**, including Template → editor → publish → runtime graph |
| Handoff-related Python suites | **52 passed** |
| Full Python discovery | **69 passed** |
| Live Portal on `127.0.0.1:9527` | Health, Templates, and Handoff returned HTTP 200 |
| Live Handoff smoke | Four runtime-variant cards; Finance Realtime rendered 14 nodes; no browser errors |

The checked-in browser dependency notices now identify the installed
`js-yaml 5.4.1` version, so the public-release artifact suite passes together
with Handoff routes, Templates materialization, proxy contracts, source-sync
manifest tests, and local security tests.

The live smoke loaded a local Template working copy but did not publish it.
The Playwright Foundry fixture covered publication, version-only readback,
navigation to `?view=handoff`, and the expanded runtime graph without modifying
a real Azure Project.

Validated on **September 24, 2026** on Linux with Python **3.12.3**, Node.js
**26.10.0**, npm **11.19.1**, and Playwright headless Chromium.

The immutable upstream pin remains
`e713a37c4cdb3282157cbaf46b6d425bcd984c05`. This synchronization reviewed
Dashboard source range
`834b34c30c7197f2129e4992e9daa064ac246c81..2ce62f0e4cdec25e4c0bde1e713cc4dbb973c589`
without advancing the accepted multi-root baseline past
`88185887035f63a6b81114d7b38305532ebb6ad0`; Dashboard-only GPT Live, drafts,
camera, ICM, and outer-shell files remain outside the Portal.

| Check | Result |
| --- | --- |
| `npm test` | **203 passed** |
| `npm run build:all` | Studio and standalone WebRTC bundles built |
| `npm run test:ui` | **48 passed** |
| `npm run test:local` | **6 passed** |
| `python -m unittest discover -s tests -v` | **62 passed** |
| Source synchronization audit | 126 source changes reported for review; **0 exact mapping drift**; **0 MCP source changes** |
| Live Portal on `127.0.0.1:18098` | Health, Studio, Templates, WebRTC, config, and four-template catalog returned HTTP 200 |
| Compact Studio measurement | Header 80 px, session controls 144 px, Agent input 257 px, transcript 761 px, no horizontal overflow |
| Templates policy | Standalone header visible, no `embedded` class, four configured cards |
| Standalone WebRTC | Exact-name input visible with five live suggestions; page-external lookup covered by deterministic browser regression |

**319 Portal tests passed.** Live verification selected an existing Agent for
read-only layout measurement but did not create an Agent, publish a Template,
start a voice session, or modify an Azure Project connection.

# Templates tab validation

Validated on **September 17, 2026** on Linux with Python **3.13**, Node.js
**22**, npm, and headless Chromium. The upstream pin remains
`e713a37c4cdb3282157cbaf46b6d425bcd984c05`; the Templates tab and Finance
workflow UI are now portal-owned.

| Check | Result |
| --- | --- |
| Portal Python environment, compilation, and `pip check` | Passed |
| `npm run build:all` | Studio and standalone WebRTC bundles built |
| `npm test` | **201 passed**, including the synchronized project-picker tests |
| `python -m unittest discover -s tests -v` | **53 passed**, including catalog, source-sync, Project switching, credential mode, and log-permission tests |
| `npm run test:ui` | **44 passed**, including Project search and workflow MCP probe coverage |
| `npm run test:local` | **6 passed**, including the two-tab and two-template browser regression |
| Actual portal on `127.0.0.1:9527` | Studio navigation, two template cards, selected detail, workflow graph, Project search/switch, Agent list, and all template endpoints verified |
| Real Azure Resource Graph / selected Project | **944 visible Projects**; isolated browser switch kept Studio, Templates, health, REST, and Agent listing on the same Project |
| Debug artifacts | Data directory mode `0700`, rotating `server.log` mode `0600`, session root ready |
| Portal-owned template assets | HTML, JavaScript, graph renderer, CSS, Project picker, and workflow MCP UI present and covered by tests |
| Template Agent naming | New names use `local-only-`; 63-character boundary and duplicate-prefix handling covered |
| Source synchronization | PR 41103 commit `8818588...` accepted; source changes `0`, exact mapping drift `0`, MCP source changes `0` |
| Consolidated setup workflow | Finance environments, portal Python/Node/build, portal `.env`, Azure CLI, and Dev Tunnel reported ready |
| Consolidated lifecycle workflow | Native Python MCP and portal started without Docker; both template probes passed with 18 and 8 tools respectively |
| Template discovery | Exactly `finance-example` and `finance-with-otp-and-officer-search`; no catalog errors |

**304 portal tests passed.** No template was published during live verification,
so no Azure Agent or project connection was created or modified. The MCP
probe was substituted at the browser boundary for deterministic UI validation;
live MCP readiness still depends on `VoiceAgent/shared_mcp/scripts/e2e-local.sh`.
The former standalone Finance UI directory was removed after setup, lifecycle,
debug tooling, documentation, and portal ownership were migrated.

> The current catalog supersedes this historical count by exposing Example 1
> as separate Realtime and Cascade Luna cards backed by one shared base.

# Public-release fixes validation

Validated on **September 16, 2026** after the public-release review fixes, on Windows with Python **3.12.10**, Node.js
**22.14.0**, npm **10.9.2**, and headless Microsoft Edge (`msedge`).

The source pin remains `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
Pinned source hashes and current local hashes were verified; these local-only
changes do not update the source revision.

| Check | Result |
| --- | --- |
| Portal Python environment and `pip check` | Passed |
| Clean `npm ci` using the public-URL lockfile | Passed |
| `npm run build:all` | Studio and standalone WebRTC bundles built |
| `npm test` | **194 passed** |
| Portal `python -m unittest discover -s tests -v` | **36 passed** |
| Playwright studio and privacy suites | **43 passed** (35 existing, 8 new) |
| `npm run test:local` / Foundry-only portal with test-only Azure boundaries | **5 passed** |
| Existing sibling VoiceAgent SDK sample tests | **19 passed**; existing files/dependencies left unchanged |
| Comment-only cleanup in 14 runtime files | Identical compiled output before/after, including voice transport, serializers, tools, and handoffs |
| Bundled third-party notices | Exact installed license texts and lockfile versions verified; served without Azure credential acquisition |
| JSON-encoded tool log data | Nested/double-encoded secrets redacted; malformed/oversized/deep data omitted; plain text and forwarded frames retained |
| Generated-session storage | Explicit off/on choice reaches the WebSocket; draft contract and stored versions remain unchanged |
| Persisted HTML and WebRTC viewers | Captured IDs open directly; missing IDs require explicit selection; historical viewing and recording controls retained |
| Python compilation | Passed |
| Missing endpoint / removed `--mode` / optional port | Startup requires a project; obsolete mode flags are rejected; default port remains `9527` |
| Public npm metadata for all 37 locked package records | URLs and integrity hashes verified; lockfile uses SHA-512 |
| Public npm advisory API, all locked frontend packages | No affected package names returned on the validation date |

**278 portal tests passed**, plus the 19 unchanged sibling SDK tests. Frontend
dependency versions are unchanged from the first port; public-registry metadata
and advisory results above are the dated first-port checks.

Portal Python packages installed for this validation:

- `azure-identity==1.25.3`
- `requests==2.34.2`
- `aiohttp==3.14.3`
- `websockets==15.0.1`
- `python-dotenv==1.2.3`

## What was exercised

The local browser suite runs the production Foundry-only portal with an
explicitly configured project endpoint. `tests/serve_portal.py` substitutes only
the Azure credential and upstream HTTP/WebSocket transports, not the portal
routes. It creates an agent, saves a YAML edit as version 2, connects through the
real proxy, opens the persisted-data viewer, and exercises microphone startup
using Playwright's synthetic device. It also checks guided-authoring response
handling, normal WebRTC agent selection, disabled recording, cross-origin
rejection, and non-automatic agent links.

Eight additional browser regressions cover the generated-storage choice
(default off, explicit opt-in, draft preservation, refresh/reselection and
editable overrides) and both historical viewers. They prove no transcript is
read before a missing conversation ID is explicitly selected, while captured
IDs, known-ID entry after list failure, audio controls, and New session still
work. These new WebRTC review tests also replace the peer connection with a
test-only boundary, so they do not claim to validate actual WebRTC media.

The live proxy tests run actual local HTTP and WebSocket servers with fake
credentials. They verify public request paths/bodies, auth and preview headers,
binary/audio forwarding, structured inputs, redirect rejection, sanitized
authentication errors, and the agent-completion close reason needed to drain
queued audio. Configuration tests verify that no server is started without a
Foundry project and that `--mode` cannot be accepted as an abbreviation of
`--model`. Shutdown tests prove no agent DELETE is sent after creation.

## Not verified

No real Azure model response, physical microphone conversation, WebRTC media, avatar,
telephony, hosted-agent execution, or service-side tool execution was attempted.
Those require the operator's own preview-enabled Azure project and permissions.
No Azure resources were created, modified, or deleted during these checks.
There is no user-facing offline/test mode and no production import of the test
service fixture. Only test helpers were started and they were stopped afterward.
No operational portal was started against a real project during this validation.

Source-owner redistribution approval is a separate release decision, not a test
result. Removing private metadata from current files does not remove it from
already published Git history.

These are dated validation results, not a guarantee of future dependency or
service compatibility. Follow [README.md](README.md) to rerun the checks and
[PORTING.md](PORTING.md) when changing the source pin or local port.
