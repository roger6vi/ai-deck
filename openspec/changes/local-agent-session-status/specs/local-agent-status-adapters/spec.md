# local-agent-status-adapters Delta Spec

## ADDED Requirements

### Requirement: OpenCode pane-scoped identity and aggregated lifecycle
The OpenCode adapter MUST derive the deck session identity from a privacy-safe canonical pane identity (the tmux session id scoping the tmux pane id, never a native session id, title, or window text), so one pane produces exactly one deck entry across root and child/subagent native sessions and across OpenCode restarts. It MUST aggregate lifecycle across all tracked native sessions of the pane: started/running while any native session is active, and completed or error only when no tracked native session remains active, so one child finishing or failing never corrupts pane state. Events MUST carry a pane-level monotonic sequence; after an adapter restart the sequence resets and the fresher event timestamp MUST still advance deck state. On each canonical OpenCode event the plugin MUST converge persisted legacy OpenCode entries for the same tmux session and pane — assigned or unassigned — into the single canonical entry by retiring only entries older than the event, and MUST preserve other tools, other panes, and newer entries. Claude and Codex identity and lifecycle semantics MUST remain unchanged.

#### Scenario: Child activity never completes a busy pane
- GIVEN an OpenCode root and a child native session active on one pane
- WHEN the child goes idle or errors while the root remains active
- THEN the pane's single deck entry stays running and only completes or errors when no tracked native session remains active

#### Scenario: Canonical event converges legacy generations
- GIVEN persisted legacy OpenCode entries from per-native-session identities on one pane
- WHEN the next canonical OpenCode event for that pane arrives
- THEN every older legacy entry for that pane is retired and only the single canonical entry remains, while Claude/Codex entries and other panes are untouched

#### Scenario: Adapter restart still advances
- GIVEN persisted state with a higher sequence and an adapter that restarted with a reset counter
- WHEN the next event arrives with a fresher timestamp
- THEN it advances deck state instead of being discarded as stale

### Requirement: Privacy-safe fail-open adapters
Codex, OpenCode, and Claude adapters SHOULD be optional and local per Mac. Enabled adapters MUST emit normalized lifecycle events only, fail open quickly on plugin unavailable, timeout, restart, duplicate event, or local error, and MUST NOT send prompts, transcripts, tool output, secrets, cloud relay, cross-machine sync, approvals, typing, or synthetic keystrokes.

#### Scenario: Privacy-safe event
- GIVEN an enabled local adapter observes lifecycle
- WHEN it emits status
- THEN it sends only status and target metadata locally, with no work data or secrets

#### Scenario: Plugin unavailable or timeout
- GIVEN the Stream Deck plugin is unavailable or slow
- WHEN an adapter reports status
- THEN it stops quickly without blocking the agent or generating approval/keystrokes

### Requirement: Trusted local runtime discovery and bootstrap
The plugin MUST publish an authenticated endpoint only after its C1 loopback server listens. It MUST derive the fixed `runtime/endpoint.json` path from a trusted plugin root; reject symlinked, foreign-owned, or group/world-writable roots; use a `0700` runtime directory; atomically replace a `0600` endpoint record; and leave a stale record for the next publisher or adapter validation rather than deleting a later publisher. Startup or publication failure MUST settle cleanup failures, close acquired server resources, dispose controller work even when server start fails, and expose only fixed diagnostics. Authenticated, normalized events MUST route to the production controller. Runtime stop MUST be idempotent.

#### Scenario: Trusted publication and stale replacement
- GIVEN a secure current-user plugin root and a listening loopback server
- WHEN the plugin starts
- THEN it atomically publishes the complete authenticated endpoint record at the fixed private path, and a later start replaces a stale record without either stop deleting it

#### Scenario: Startup rollback and normalized routing
- GIVEN local-server startup or endpoint publication fails, or an event is unauthenticated or malformed
- WHEN the runtime processes that condition
- THEN it rolls back acquired resources, reports only a fixed diagnostic, and does not route invalid input; an authenticated normalized event reaches the production controller

### Requirement: Bounded C1 callback containment and local recovery
The C1 loopback server MUST return a generic `503` when its bounded callback capacity is exhausted, rejected, or times out. It MUST NOT release callback capacity while a timed-out callback remains unresolved; no cloud telemetry is permitted. Concrete recovery is local: `npm run restart:plugin` or host/plugin restart creates a fresh bounded server.

#### Scenario: Hung callback remains contained
- GIVEN every callback slot is occupied by a callback that has exceeded its deadline but has not settled
- WHEN another authenticated event arrives
- THEN it receives a generic `503`, no additional callback is invoked, and capacity remains unavailable until the callback settles or the plugin is restarted

#### Scenario: Local restart recovery
- GIVEN a C1 circuit breaker remains unavailable because a callback is unresolved
- WHEN the maintainer runs `npm run restart:plugin` or restarts the host plugin
- THEN the replacement runtime has fresh bounded capacity without sending telemetry or work data elsewhere

### Requirement: Safe plugin launch and signal termination
The entrypoint MUST reject malformed host launch arguments before action registration, runtime startup, or SDK connection. A startup or connection failure MUST set a nonzero exit code even when SDK logging throws and MUST emit only fixed diagnostics. On `SIGINT` or `SIGTERM`, the lifecycle handler MUST deduplicate signals, unregister both handlers, await idempotent runtime stop, catch a stop rejection, and restore default process termination by re-emitting the original signal exactly once.

#### Scenario: Malformed or failed launch
- GIVEN host arguments are malformed or runtime startup rejects with a sensitive error
- WHEN the entrypoint runs
- THEN it performs no action registration or SDK connection for startup failure, sets a nonzero exit code, and reports only the fixed generic diagnostic even if the SDK logger throws

#### Scenario: Signal shutdown
- GIVEN an active runtime receives `SIGINT` or `SIGTERM`
- WHEN duplicate termination signals arrive
- THEN it stops exactly once, unregisters lifecycle handlers, and re-emits the first original signal after stop settles or rejects
