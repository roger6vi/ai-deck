# Design: Local Agent Session Status

## Technical Approach

The repository is a Node 24/npm 11 TypeScript Stream Deck SDK 2 plugin. It uses strict TypeScript, Rollup output in the plugin's `bin/` directory, and Vitest local-loopback/filesystem integration coverage. The plugin remains local-only and does not mutate a live Stream Deck during automated verification.

## Architecture Decisions

| Area | Alternatives / tradeoff | Decision |
|---|---|---|
| Package shape | Multiple packages add review/build overhead before any shared need exists. | Single npm package containing plugin, core, adapters, installers, and tests. |
| Device/profile | Dynamic layout is flexible but risks accidental extra instances. | Manifest `DeviceType: 0`; profile places exactly five `session-slot` action instances at row 0, columns 0-4. |
| State | SDK-coupled mutation is hard to test. | Pure deterministic reducer with injected clock and fixed five-slot array. |
| IPC | UDS is stronger but less portable across initial adapters. | HTTP on `127.0.0.1` with transport interface so UDS can replace it later. |
| Repository | `ai-deck` name is acceptable, but visibility is delivery policy. | Do not create repo in design; ask orchestrator/user after approval and before implementation. |

## Data Flow

Adapters -> normalized local event -> token HTTP server -> reducer -> renderer -> Stream Deck SVG/title
Physical key -> pane check/navigation -> reducer acknowledge/release -> render

## Core State and Event Contract

Use const-object types, flat interfaces, and no `any`. Events include only `schemaVersion`, `eventId`, `source` (`codex`, `opencode`, `claude`), stable `sessionId`, monotonic `sequence` when available, `timestamp`, lifecycle (`started`, `running`, `completed`, `error`, `pane-disappeared`), and target metadata (`tmuxPaneId`, `tmuxSession`, optional `tmuxWindow`, `ghosttyBundleId`). Reject or strip prompts, transcripts, tool output, command output, secrets, file contents, and unknown sensitive fields.

Reducer rules: first-free assignment; sixth session remains unassigned/capacity-full; slots stay stable while session and pane exist; duplicate `eventId` and stale `(timestamp, sequence)` are ignored; gray denotes free/unassigned/disabled, green denotes only an assigned idle/read or physically acknowledged session, amber denotes assigned started/running regardless of elapsed time, red denotes assigned error only, and blue denotes assigned completed unread until physical acknowledgement. Visibility/manual navigation never acknowledges; only Stream Deck `onKeyDown` for that assigned action can acknowledge. Missing pane releases immediately to gray. Assigned keys also render a title: the session's tmux window name, resolved locally via a bounded `tmux display-message -t <pane> -p '#{window_name}'` query (never through the event allowlist), stripped of control characters and truncated to a fixed bound; unresolved names render color-only. Duplicate window names among assigned slots keep the bare name on the lowest-index slot and append ` ·<paneId>` on the rest; titles are held in a controller-side map (never persisted) and re-resolved on hydration and on each event. The property inspector (`ui/session-slot.html`, self-contained SDPI page) lists assigned sessions via `streamDeck.ui` (`sessions` pushes on appear and on every state change) and sends `set-slot-session` selections; the controller validates the payload (UUID session id, known visible context) and applies a reducer `MOVE_SESSION` action that swaps assignment data between slots while each slot keeps its index and each session keeps its assignment identity.

## Transport, Adapters, Navigation, Persistence

Plugin startup in `src/plugin.ts` validates complete host arguments before mutation, then starts `src/plugin/runtime.ts`, registers the action, and connects the SDK. Fixed generic diagnostics and an exit code are set before any SDK logger call so logger failures cannot prevent failed startup/connection termination. The runtime derives a trusted production root from bundled `bin/plugin.js` (tests inject a trusted root), binds a dynamic `127.0.0.1` port through `src/ipc/local-event-server.ts`, creates a per-run bearer token, and publishes `{schemaVersion, address, port, token, pid}` only after listening through `src/ipc/endpoint-discovery.ts`.

The canonical current-user-owned root and derived runtime directory reject symlinks and unsafe permissions; runtime is `0700` and the atomically replaced endpoint file is `0600`. Startup rollback settles controller/server cleanup so secondary failures never mask fixed diagnostics. Runtime stop is shared and idempotent. It closes the server but intentionally does not unlink the shared endpoint record, leaving stale discovery for C3/adapters to validate and for the next startup to replace atomically. Signal handlers are injectable for tests; the first `SIGINT`/`SIGTERM` unregisters both handlers, awaits stop, catches rejection, then re-emits that signal through the process kill surface. C1 routes only authenticated normalized events to `sessionSlotController`, bounds callbacks, retains capacity for unresolved timed-out work, and returns generic `503`. Recovery is local through `npm run restart:plugin` or host restart; no cloud telemetry is emitted.

Packaging builds and validates an isolated stage within one `scripts/pack-plugin.mjs` transaction: it removes a prior archive before packing and aggregates cleanup failures with any primary pack/validation/staging failure. Local recovery removes `.package-stage` and failed archive then re-runs pack; no cloud logging. `scripts/prepare-package-stage.mjs` excludes runtime/private paths without touching source `runtime/endpoint.json`. Runtime smoke accepts an explicit test-only readiness marker while retaining bounded startup/termination timers.

Adapter boundaries: `install/codex/command-hook.*` emits from Codex command hooks; `install/claude/local-hook.*` emits Claude local hook events; `install/opencode/plugin.ts` is an OpenCode TS plugin template. Personal/work enablement is independent through local installer config.

Navigation uses command builders, not synthetic keystrokes: verify `tmux has-session/list-panes` for recorded pane, `open -a Ghostty`, then `tmux select-pane -t %pane` for the one-client happy path. Missing pane releases. Multiple Ghostty/window/client ambiguity fails safely, logs/renders ambiguity, and does not type or approve.

Persist only non-sensitive `state-snapshot.json` with slot targets and last read status. On restart, verify panes; restore as green/read or release, never as fresh blue unread. Live adapter events refresh state.

## File Changes

| Path | Action | Purpose |
|---|---|---|
| `package.json`, `.nvmrc`, `tsconfig.json`, `rollup.config.ts`, `vitest.config.ts` | Create | Node 24 strict TS package. |
| `com.gentleman.ai-deck.sdPlugin/manifest.json`, `Profiles/Local Agent Status.sdProfile`, `assets/*` | Create | SDK v2 plugin, original-device profile, assets. |
| `src/core/{types,events,reducer,colors}.ts` | Create | Deterministic state and privacy contract. |
| `src/plugin.ts`, `src/plugin/runtime.ts`, `src/plugin/session-slot-controller.ts` | Create | Entry validation, SDK lifecycle, runtime bootstrap, and normalized event routing. |
| `src/ipc/local-event-server.ts`, `src/ipc/endpoint-discovery.ts` | Create | Bounded authenticated loopback ingest and trusted atomic endpoint publication. |
| `src/adapters/{codex,claude,opencode}/` | Create | Adapter libraries/templates. |
| `src/navigation/{targets,commands}.ts`, `src/persistence/snapshot.ts` | Create | tmux/Ghostty and recovery. |
| `scripts/prepare-package-stage.mjs`, `scripts/pack-plugin.mjs`, `scripts/check-package.mjs` | Create | Isolated allowlisted staging, archive cleanup on failure, and exact archive validation. |
| `tests/ipc/{local-event-server,endpoint-discovery}.test.ts`, `tests/plugin/runtime.test.ts`, `tests/{scaffold,packaging}.test.ts` | Create | C1/C2 local-loopback, publication, lifecycle, entrypoint, and package-boundary tests. |

## Testing Strategy

Vitest strict TDD after scaffold: reducer transitions/capacity/dedupe/stale/pane loss; schema fixtures prove privacy rejection; adapter fail-open on missing endpoint/timeout; mocked plugin action rendering and physical key acknowledgement; navigation command-builder tests for one-client, missing pane, ambiguity; package validation for manifest/profile. Final manual acceptance: two OpenCode sessions on hardware, export/import to work Mac, enable only relevant adapter.

## Rollout / Rollback

After design approval, ask repository visibility, create repo if approved, implement locally, export plugin/profile from personal Mac, copy to work Mac, enable Claude adapter only. Rollback: disable adapters, quit/remove plugin, delete endpoint/snapshot; agents continue unaffected.

## Open Questions

- Repository visibility before implementation/repo creation: public or private? Not a design blocker.
