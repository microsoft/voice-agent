# Voice Agent portal local change log

This is the downstream port log, not the full upstream repository history.
Keep the upstream pin and intentional differences in every port entry.

## 2026-10-16 — Verify independent installation

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This is a Portal-only setup documentation and verification update.

- Verified the published PR from tracked source with new public-registry
  Python and npm installations, a fresh browser, and no ignored local state.
- Confirmed Python-only production startup, all four pages and Template cards,
  complete regression suites, and read-only access to a real Foundry Project.
- Corrected repository-root setup commands to `cd portal` and documented that
  the full repository supplies the shared helpers, samples, and guide.
- Recorded the evidence and the boundary between independent operation,
  required Azure/MCP configuration, and fixture-based versus live validation.

## 2026-10-16 — Clarify node component estimates

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This is a Portal-only copy and presentation change.

- Replaced the STT, Model, and Voice selector introductions in **Edit node**
  with a highlighted disclaimer: latency and pricing are estimates from
  internal experiments and vary with usage scenarios, sales discounts, prompt
  length, and other factors.
- Renamed the comparison columns to **Latency (estimated)** and **Cost
  (estimated)** without changing calculations, compatibility, or sorting.
- Added browser coverage for all three selectors in Realtime and cascaded
  pipelines and refreshed static asset cache versions.
- Made browser MCP fixtures self-contained so publication tests do not depend
  on ignored local Dev Tunnel configuration or bearer files.

## 2026-10-14 — Refresh Handoff MCP connections before publication

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This is a Portal-only reliability and UI correction.

- Separated input transcription from output voice in Studio and Handoff
  authoring. Model changes now retain compatible choices, disable incompatible
  STT/voice options with an explanation, and validate imported definitions
  against the Voice Live capability families. Handoff STT remains Agent-level
  and is restricted to the intersection supported by every node model.
- Replaced the Handoff right-side STT/model/voice card list with one sortable
  comparison table. Provider labels distinguish GPT native, Azure Realtime,
  and Azure Speech voice families; latency and cost use relative bars, latency
  ranges display and sort by their minimum, and missing component latency stays
  explicitly unavailable.
- Template-origin **Publish** and **Publish & run** now refresh the selected
  Project's managed MCP connection before creating the Agent version, so a
  restarted local Dev Tunnel or bearer does not leave the published graph
  pointing at stale connection state.
- Removed the Handoff Graph **Save draft** action. It was not part of the
  Portal's immutable release workflow; local edits remain available for export
  or release publication.
- Propagated backend HTTP and voice bridge failures to the active page with a
  request ID, while redacting credential-shaped values. Voice connection errors
  now remain visible after the WebSocket closes instead of reverting to the
  generic disconnected status.
- Replaced Live session's compact SVG-only runtime graph with the authoring
  editor's layered card and route visual language. Runtime cards now show
  cumulative active-node dwell time, completed user turns, visits, speech
  pipeline badges, MCP/tool counts, and outgoing route counts.
- Consolidated runtime numbers into one larger bottom strip. Dwell, 100%-based
  stage share, and turns refresh every two seconds with a flip transition.
  Clicking the strip reveals node-attributed observed latency statistics and
  the editor's shared STT/LLM/TTS cost and latency estimates.
- Strengthened completed-path styling with an emerald double frame, tinted
  surface, and explicit `VISITED` badge while retaining the animated `LIVE`
  treatment for the current node.
- Increased path contrast again: every untouched runtime node now has a full
  gray `NOT VISITED` veil, while visited nodes scale up with a thick emerald
  double frame and the active node receives the largest, brightest treatment.
- Added an accessible draggable divider between Agent Debug and Live
  conversation. The graph can grow beyond the former 620px cap while the
  conversation retains a protected minimum width; keyboard resize and
  double-click reset are supported.
- Consolidated Handoff authoring publication into one top-level **Publish &
  run** action. Its progress dialog shows validation, managed MCP refresh,
  version creation, readback verification, and Live session launch, and stops
  on the exact failed task while preserving the working copy.
- Kept spoken handoff transfer messages and the target Agent reply in one turn
  metric lifecycle. The transfer response no longer finalizes latency before
  the target response; an aborted handoff closes the pending transfer turn
  explicitly.
- Added route and browser coverage for the server-held connection refresh.

## 2026-10-13 — Add Handoff Graph authoring and runtime handoff view

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This ports the Dashboard's current Handoff Graph working tree as an explicitly
mapped Portal surface; it does not advance the accepted source commit.

- Added the standalone `/handoff/` graph editor with node, edge, runtime,
  validation, export, draft, and release publication controls.
- Added Portal navigation from Live session and Templates.
- Materialized the Portal Template catalog as editable definitions without
  exposing server-held MCP tokens. The three sample projects remain four cards
  because Example 1 has separate Realtime and Cascade Luna variants.
- Added release readback compatibility for Foundry endpoints that return a
  version object rather than a complete Agent resource.
- Made **Publish & run** open Live session with the runtime handoff graph
  expanded while preserving the Portal's explicit Connect action.
- Added Python, Node, and Playwright coverage plus `handoff_view` source-sync
  mappings.

## 2026-09-24 — Align the runtime layout and WebRTC name lookup

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
Reviewed Dashboard source range
`834b34c30c7197f2129e4992e9daa064ac246c81..2ce62f0e4cdec25e4c0bde1e713cc4dbb973c589`.
The accepted multi-root baseline remains
`88185887035f63a6b81114d7b38305532ebb6ad0`: the reviewed range also contains
Dashboard-only GPT Live, draft, camera, ICM, and outer-dashboard surfaces that
do not belong in this two-page Portal.

- Synchronized the compact Studio header, workspace spacing, Session Agent
  row, Agent metadata/settings/actions footer, and Conversation header so the
  running transcript receives more vertical space without removing controls.
- Kept the searchable paged Studio picker aligned with the Dashboard's compact
  **More** affordance and responsive behavior.
- Changed standalone WebRTC selection to an input with loaded-name suggestions.
  An exact name outside the current page now uses the single-Agent endpoint
  before opening a session, rather than requiring every earlier cursor page.
- Added layout and page-external WebRTC browser regressions and rebuilt both
  bundles.
- Preserved the Portal's top-level Templates header, managed Local Dev Tunnel
  connection flow, Project adapter, and public-policy tests. The Dashboard's
  `embedded=1` header hiding is intentionally not imported; the source mapping
  now records Template CSS and privacy coverage as adapted rather than exact.

## 2026-09-24 — Paginate large Voice Agent catalogs

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This is a portal-only performance change, not a new upstream import.

- Changed Studio and standalone WebRTC startup to request only the first 25
  Voice Agents instead of following every service cursor before rendering.
- Added explicit **Load more agents** controls that request one subsequent
  cursor page at a time, deduplicate results, preserve existing selections, and
  keep directly linked Agents selectable even when they are not on the first
  page.
- Replaced the Studio Session Agent select with a name-search field. Loaded
  Agents are offered as browser suggestions, and exact names outside the
  current page are resolved individually without scanning the full catalog.
  Session actions remain disabled while typed text is not a confirmed Agent.
- Added catalog unit coverage and a browser regression proving that startup
  stops after one bounded request and the next page is fetched only on demand.
- Rebuilt both browser bundles; the Foundry service remains the source of truth
  and all requests continue through the authenticated local proxy.

## 2026-09-17 — Add the local sample Templates tab

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This began as a local integration of the Finance sample UI. Shared behavior is
now owned by the source dashboard's `template_view`; portal owns only the
standalone/public adapters until the next source pin is recorded.

**Accepted multi-root sync baseline:** advanced from
`e713a37c4cdb3282157cbaf46b6d425bcd984c05` to
`88185887035f63a6b81114d7b38305532ebb6ad0` from PR 41103 after all 26
`voice_demo`, `template_view`, template-test, and Finance sample mappings were
reviewed. The PR's removal of unrelated UMW/demo media is outside the declared
portal sync roots.

- Kept the existing studio as the first **Live session** tab and added the
  Finance **Templates** page as the second tab.
- Integrated the Finance template HTML, JavaScript, graph renderer, and CSS.
  Graph and style assets are byte-identical to source; the app and HTML differ
  only for static paths, Project config, setup guidance, and return-to-studio.
- Added a portal-local allowlist that detects
  `example1_finance_with_handoff` and
  `example2_finance_with_OTP_and_Officer_Search`, while rejecting template
  source paths outside `VoiceAgent/samples/` and MCP paths outside
  `VoiceAgent/shared_mcp/`.
- Ported template reload/detail, MCP readiness checks, fixed project connection
  creation, Agent publication, and return-to-studio behavior. Tokens remain
  server-side, MCP probes reject private/reserved destinations, and the portal
  continues to use its single configured Foundry project.
- Added catalog/route/asset regression tests and a source-change tracker that
  maps both `voice_demo` and `template_view`, including current source
  working-tree changes. Added the public `azure-ai-projects` dependency used by
  the template publication path.
- The tracker also maps the source template allowlist and both Finance
  `agent.json` inputs to their portal/public-sample counterparts, and requires
  review of shared `docs/voice_agent/11_mcp_server` changes.
- Added the searchable Foundry Project picker and Resource Graph
  discovery. Project selection is scoped to a same-site, HttpOnly browser
  cookie and consistently controls Studio, Templates, Agent REST/WebSocket,
  traces, MCP tests, and publishing.
- Added the workflow MCP Test card, including three-state
  reachability, latency, server identity, allowed tools, and response scheduling.
- Added explicit credential mode, template config, data directory, bind-host,
  endpoint alias, and one-command runner support. Local session debug recording
  now defaults on with an explicit opt-out; a
  permission-restricted rotating server log captures redacted portal/bridge
  diagnostics while raw HTTP access logging remains disabled.
- Consolidated the former standalone Finance UI into portal while keeping
  source `template_view` as the shared browser/core source of truth.
- Preserved MCP server identity for duplicate tool names, enabled per-tool
  checks only against the newly published Agent, rejected private MCP targets
  on direct publish requests, and enforced the 63-character Agent-name limit.
- Renamed Template-published Agents from `gft-*` to `local-only-*` so their
  names disclose that the MCP connection depends on this machine's Dev Tunnel
  and native runtime.
- Added a shared `connection_mode` contract. The source dashboard uses
  one-time `user_provided` credentials to configure Envoy-backed Project
  connections without server-side token retention, while portal keeps the
  default `managed` Local Dev Tunnel connection workflow.

## 2026-09-16 — Public-release review fixes

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
These are local safety/publication changes, not a new import.

- Added complete third-party notices for the bundled js-yaml, React, React DOM,
  and Scheduler code. Build/watch commands preserve license comments and point
  both bundles to the shipped notice file.
- Replaced the private clone URL with the neutral `voice-agent-demo` source
  identifier, and removed internal implementation/PR/design references from
  comments. Source commit, branch, path, raw upstream hashes, and drift checking
  remain intact. Maintainers resolve the repository using private records.
- Redact known credential fields inside JSON-encoded tool arguments/results,
  including nested/double-encoded content. Omit malformed/oversized/deep JSON
  tool data safely; preserve ordinary text results and the original forwarded
  protocol frames.
- Added an explicit, default-off generated-session storage choice. Apply it
  through the existing session override, preserving generation/draft contracts
  and immutable versions rather than silently rewriting service resources.
  Existing-agent storage choices and manual overrides remain available.
- Replaced automatic latest-conversation fallback in both persisted viewers
  with an explicit recent-ID/known-ID picker. Captured IDs still open directly,
  and transcript, trace, audio playback/download, and New session remain available.
- Added release-artifact, redaction, generation-storage, and both-viewer browser
  regression tests. Clarified synthetic demo data and the WebRTC STUN dependency.
- Rebuilt both browser bundles and refreshed the local checksum baseline.
  This changes current files only; it does not rewrite already published Git
  history or establish the source owner's redistribution approval.

## 2026-09-16 — Require an Azure Foundry project

**Upstream pin unchanged:** `e713a37c4cdb3282157cbaf46b6d425bcd984c05`.
This is a local product-policy change, not a new upstream import.

- Removed the `--mode` option, the default offline fallback, and `offline.py`.
  Both CLI parsing and application construction now require a valid public-cloud
  Azure Foundry project endpoint. Missing configuration exits with setup guidance
  before opening a listener or requesting credentials.
- Removed backend switching/cookies and all offline-specific UI, media bypasses,
  mock chat, and template generation from the production application.
- Normal startup is `python demo_server.py` after configuring the project.
  `--port` remains optional (default `9527`, or `DEMO_PORT`).
- Agent auto-delete remains removed. Stopping the portal never deletes Azure
  agents; local protocol recording remains opt-in.
- Updated the parent VoiceAgent README, portal setup guide, environment example,
  porting policy, and browser bundles.
- Replaced offline-product tests with required-project/configuration/security
  checks and normal portal integration tests. Azure credential/transport
  substitutes exist only in `tests/serve_portal.py`, never as a production mode.
- Refreshed local hashes and validation results without changing upstream hashes.
  The initial import below is retained as historical context, not current setup
  guidance.

## 2026-09-16 — First standalone public-repository port

**Upstream:** `main` at `e713a37c4cdb3282157cbaf46b6d425bcd984c05`

**Previous upstream pin:** none (first import).

**Source:** `tests/voice-agent-tests/voice-agents-tests-dashboard/voice_demo`

**Destination:** `VoiceAgent/portal`

### Retained

- React studio, standalone WebRTC UI, YAML definition editor, agent catalog and
  version editing, managed/BYOM authoring, and guided-authoring review.
- Voice WebSocket/PCM, WebRTC and avatar signaling, transcripts, tool approvals,
  client functions, greetings, structured inputs, handoffs, and turn metrics.
- Service-shaped REST/conversation/audio proxies and persisted/session viewers.
- Upstream library and browser regression tests applicable to the standalone
  portal, and Microsoft/third-party copyright notices.

### Adapted for this repository

- Replaced internal `common.py` presets with explicit public-cloud Foundry
  endpoint configuration and lazy server-side `DefaultAzureCredential`.
  Environment names align with the adjacent VoiceAgent samples.
- Aligned manual voice/prompt creation with this repository's public REST/SDK
  contract: `POST /agents/{name}/versions`, with the name only in the URL, and
  flat `audio.output.voice` / `voice_type` fields (including session overrides).
  Normalize version-create responses for the catalog; continue reading older
  nested voice definitions. Do not reintroduce the upstream `POST /agents` path.
- Added a clearly labeled, bounded, in-memory offline text demo for credential-
  free local startup, agent CRUD/versioning, template authoring, WebSocket echo,
  and saved-text inspection. Offline mode never captures microphone/shared
  audio and does not claim to execute an AI model, tools, or media.
- Made new-agent Azure conversation storage opt-in; local session recording is
  separately opt-in. Removed shutdown deletion of created agents.
- Restricted local browser access with loopback/Host/Origin checks; forward
  only service headers and never follow credentialed HTTP/WebSocket redirects.
  Moved credential acquisition off the event loop, sanitized local proxy errors,
  and awaited bridge-task cancellation. Agent URL selection is retained but
  automatic URL-triggered sessions are removed; the operator must press Connect.
- Replaced deployment discovery with user-supplied BYOM names. MCP/IQ/Toolbox
  presets are empty unless configured by the user. Trace links use optional
  explicit project metadata and only the preview flight used by sibling samples.
- Removed the MCP probe UI's network action; the compatibility endpoint returns
  an explicit unsupported response without fetching URLs or connection secrets.
- Redacted common credential fields in optional local event logs. Added visible
  mode/navigation notices and fixed the session viewer's `#root` CSS collision.
- Sanitized upstream test fixture backend names. Rebuilt checked-in browser
  assets; pinned public frontend dependencies and raised esbuild from 0.24.2
  to 0.28.2 and Playwright from 1.54.2 to 1.63.0. React 18.3.1 and js-yaml
  5.2.3 are retained. Python dependencies now require modern aiohttp/WebSocket
  APIs and include python-dotenv.
- Added setup docs, source/local SHA-256 manifest tracking, a read-only upstream
  comparison tool, Python HTTP/WebSocket/security tests, and a browser test that
  runs against the actual local Python server. Browser suites have separate
  output directories. Portal text uses LF line endings so local checksums remain
  stable across Windows and POSIX checkouts.

### Intentionally omitted

- Internal backend/subscription/resource-group/account presets, local service
  route overrides, test subagent seeding, and APIM bypass authentication headers.
- Automatic ARM subscription/project/deployment discovery and server-side MCP
  connection-secret retrieval/probing.
- Telephony provisioning guides/screenshots, internal API/design guides and
  load-test reports. Exact omitted source files/reasons are in `UPSTREAM.json`.
- Parent test dashboard, matrix tests, template catalog, deployment scripts,
  and corporate-network infrastructure; these are not dependencies of the port.

### Validation boundary

Local setup, frontend builds, protocol/unit tests, browser regressions, and the
real offline browser workflow are validated without Azure or microphone access.
Live REST and bidirectional binary/text WebSocket proxy behavior is exercised
against an actual localhost upstream fixture with a fake token. This is **not**
proof of an Azure model response, real microphone speech, WebRTC media, avatar,
or service-side tool execution; those require the operator's enabled project.
