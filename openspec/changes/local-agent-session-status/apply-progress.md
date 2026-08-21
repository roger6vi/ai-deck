# Apply Progress: Local Agent Session Status

## Deferred Environment Validation: Former Task 4.3 Reclassified (2026-08-04)

- Maintainer decision (explicit, 2026-08-04): the former task 4.3 — install on work Mac with Claude enabled and record rollback evidence — is deferred to post-merge environment validation outside the scope of this PR, so the change can advance to verify/Judgment Day/PR without blocking on the physical work-Mac environment.
- Rationale: the item requires maintainer-owned physical hardware (work Mac) and is environment validation, not implementation work; all implementation, test, and virtual acceptance evidence for the in-scope work is already settled.
- Status of the deferred item: NOT executed — not passed, not failed. It MUST NOT be claimed as passed by verify, Judgment Day, or the PR. It remains visible and traceable as follow-up D.1 in `tasks.md` and in the Deferred Follow-Ups section below.
- Scope: documentary reclassification only — no tests, builds, installs, restarts, runtime, source/test edits, Git, or GitHub actions occurred in this slice.
- Implementation task count is now 12/12 complete. This supersedes all prior "12/13, only 4.3 remains open" and "Next: execute 4.3 …" statements in this artifact.
- Current scope is complete based on virtual acceptance (task 4.2, evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888`) plus all previously recorded implementation/test evidence. Next action: sdd-verify. No archive claim.

## Virtual Stream Deck Acceptance: Task 4.2 Complete (2026-08-04)

- Maintainer decision (explicit): further physical Stream Deck testing declined; the Virtual Stream Deck two-OpenCode-pane run is the acceptance authority for task 4.2. Physical hardware acceptance is waived/replaced by this decision — recorded as waived, not passed.
- Scope: documentary persistence of already-settled acceptance evidence only — no tests, builds, installs, restarts, runtime, source/test edits, Git, or GitHub actions occurred in this slice.
- Final native attempt settled `complete` with evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888`.
- Two OpenCode processes on panes `%6` (PID 38347) and `%11` (PID 93000), both started after the adapter install.
- Exactly two visible OpenCode entries, one canonical pane identity per pane; zero visible legacy/child entries — the pane-identity convergence contract holds on live state.
- Four total visible unique entries including Claude (`%13`) and Codex (`%10`); all preserved (convergence retired only legacy OpenCode duplicates).
- Sequence numbers and timestamps advanced after real prompts on both OpenCode panes.
- Seven INFO-level navigations recorded; zero MISSING, CLEAR_SLOT, pane disappearance, identity collision, stale-event rejection, or fresh errors.
- Stream Deck/plugin bundle hash and installed adapter hash matched the current bundles.
- Tasks now 12/13; only 4.3 (work-Mac Claude install + rollback evidence) remains open. This supersedes prior statements that 4.2 requires physical hardware and the "4.2/4.3 stay unchecked" lines below.

## Bounded Correction: One OpenCode Entry per tmux Pane (2026-08-04)

- Maintainer decision (explicit): one OpenCode deck entry per tmux pane. Live evidence had shown 12 visible OpenCode entries — 8 child/subagent native sessions of one root on pane `%6` plus prior root generations on `%6`/`%11` persisting across OpenCode restarts — because the adapter derived deck identity from every native `sessionID` and startup reconciliation retained every record while its pane existed.
- Canonical identity: `deriveOpenCodePaneSessionId(tmuxSession, tmuxPaneId)` in `src/adapters/adapter-environment.ts` hashes only tmux's internal identifiers (`opencode:$<session>:%<pane>`), scoped by the tmux session id so two tmux servers cannot collide on the same `%N`; never a native session id, title, or window text. Claude/Codex keep per-native-session identity unchanged.
- Aggregated lifecycle: `OpenCodeSessionTracker` now treats all native sessions of the pane as one workload — started when the pane goes idle→busy, running while any tracked native session is active, completed/error only when none remain. One child idling or erroring while the root works emits running, never a false completed/error.
- Convergence: `reduceEvent` converges persisted legacy OpenCode entries for the event's tmux session+pane (assigned or parked) into the single canonical entry, retiring only entries strictly older than the incoming event — a late stale legacy event can never destroy the canonical entry (caught RED by the stale-resurrection test). Other tools, other panes, and newer entries are preserved; dedupe is by identity, never title.
- Restart safety: the adapter's sequence counter is pane-level and resets on restart; the existing timestamp-first staleness semantics let the next (fresher-timestamp) event advance — regression-covered in `tests/core/reducer.test.ts`.
- Contract change note: the capacity test fixture now gives its sixth distinct session a distinct pane (`%8`); two OpenCode sessions on one pane legitimately converge under the new contract.
- Strict TDD: safety net 38/38; RED 9 failures across 4 files (aggregation, identity, plugin mapping/ordering, convergence); GREEN focused 47/47 + strict typecheck; full suite 506/506. Full exact Node 24.18.0 `npm run verify` passed (exit 0): 506/506 tests, strict typecheck, production audit 0 vulnerabilities, package validation, and bounded runtime smoke; the bundled `bin/opencode-plugin.js` artifact was refreshed through this normal build/pack flow and contains the canonical pane-identity derivation. No live OpenCode/Stream Deck restart, navigation, or device mutation occurred; loading the fix on live state requires the separately authorized plugin/adapter restart (4.2 hardware scope).
- Bounded work unit `opencode-pane-identity`: ~185 changed lines (code/tests/spec) across 8 files, inside the 250-line native budget. Tasks remain 11/13; 4.2/4.3 stay unchecked.

## Documentary Reconciliation: Tasks 3.1–4.1 Complete (2026-08-04)

- Scope: passive reconciliation only — no tests, builds, installers, runtime, commits, pushes, or device interaction were run. Task checkboxes were reconciled against current on-disk repository evidence and previously recorded verification.
- 3.1 verified complete: RED scenarios exist across `tests/adapters/` (privacy allowlist, prohibited-field rejection), `tests/cli/adapter-emit.test.ts` (rejection and exit-code mapping), `tests/ipc/` (timeout, capacity), `tests/persistence/` (recovery, fail-open on unreachable tmux), `tests/navigation/` (timeout, untrusted-enumeration fail-closed), and hydration tests (recovery fallback, duplicate suppression).
- 3.2 verified complete: navigation (`src/navigation/ghostty-tmux.ts`), persistence (`src/persistence/session-state-store.ts`), reconciliation (`src/persistence/session-state-reconciler.ts`), hydration (`src/plugin/runtime.ts`, `hydrateState`/`subscribeToStateChanges`), production wiring (`src/plugin.ts`), shared CLI (`src/cli/adapter-emit.ts`), installers (`scripts/install-opencode-adapter.mjs`, `claude-code-plugin/`, `codex-plugin/`), and bounded argv-only safe commands are all on disk with covering tests.
- 3.3 verified complete: OpenCode (`src/adapters/opencode-plugin.ts` + `npm run install:opencode`), Claude (`src/adapters/claude-hook.ts` + `claude-code-plugin/`), and Codex (`src/adapters/codex-hook.ts` + `codex-plugin/`) adapters/installers ship; the standalone bundled `bin/adapter-emit.js` is in the exact package allowlist (`scripts/check-package.mjs`) and documented in README.
- 3.4 verified complete: ambiguity (`NAVIGATION_OUTCOME.AMBIGUOUS` aborts before any command and never acknowledges), pane release (trusted-absence MISSING semantics plus the untrusted-enumeration correction), redaction (allowlist parser; no stderr leak of raw errors), and green/read recovery are implemented and tested.
- 4.1 verified complete: README documents install/setup, profile import, uninstall/cleanup/rollback, and troubleshooting; the package gate enforces an exact allowlist that excludes `runtime/` (endpoint/state, secrets); the profile is generated, allowlisted, and validated (`validate:profile`), guarded by `tests/readme.test.ts`, `tests/packaging.test.ts`, and `tests/profile-*.test.ts`.
- Evidence (time-scoped, previously recorded — not re-run): handoff verify **495/495** on branch `fix/unassigned-sessions` (Engram session summary, 2026-08-04 02:26); latest bounded false-MISSING apply verify **497/497** after the untrusted-enumeration correction (section below, 2026-08-04).
- Tasks 4.2 and 4.3 remain open: they require physical hardware (two live OpenCode sessions; work-Mac install with Claude enabled plus rollback evidence).
- Prior statements below that claim per-tool wrapper installers or standalone CLI bundling are pending are superseded by this section. Historical "(unchecked)" labels in the TDD table refer to checkbox state at the time each slice landed.
- Tasks are now 11/13; 4.2/4.3 intentionally unchecked.

## Bounded Correction: Untrusted Pane Enumeration Must Not Become MISSING (2026-08-04)

- Root cause: `exactPaneRow` silently skipped malformed rows, so a malformed or mixed `tmux list-panes` output made an existing pane look absent. Live evidence showed navigation returning `missing` for panes `%10` and `%11` while both still existed in the same tmux server, producing `CLEAR_SLOT`, unassigned sessions, and disappearing buttons. No `pane-disappeared` events had occurred.
- Introduced an explicit parse distinction: `PANE_ENUMERATION_STATUS` (`TRUSTED`/`UNTRUSTED`) with `parsePaneEnumeration`. Absence is concluded only from a complete enumeration in which every row has exactly three control-free fields with valid `%<id>`/`$<id>`/`@<id>` identifiers. Any malformed, truncated, mixed, or control-bearing row returns `UNAVAILABLE` — fail closed: no navigation, no absence claim, no slot clearing.
- Legitimate `MISSING` is preserved only for trustworthy complete enumerations that prove absence (empty enumeration, pane absent, pane in another session, pane in another window). `%12` genuinely absent still releases correctly.
- `handlePhysicalKeyDown` already keeps the current assignment for `UNAVAILABLE`/`AMBIGUOUS`; the new controller regression proves untrusted evidence never clears the slot, never unassigns the session, and never acknowledges an unread response.
- Logging cleanup: the permanent normal navigation outcome record moved from `logger.error` to `logger.info` (`SessionSlotLogger` gained `info`; production wires `streamDeck.logger.info`). Actual failures (`UNAVAILABLE`/`AMBIGUOUS`/rejected navigation) remain observable at error via `SESSION_SLOT_NAVIGATION_ERROR`.
- Strict TDD: safety net 15/15; RED — untrusted-enumeration test failed with `missing` instead of `unavailable`, and the info-level outcome assertion failed (error used instead); GREEN — focused 47/47 + strict typecheck; triangulation across 7 untrusted variants and 4 trustworthy-absence variants; no refactor needed.
- Full exact Node 24.18.0 `npm run verify` passed: 497/497 tests, typecheck, production audit, package validation, and bounded runtime smoke (exit 0). No live navigation, Stream Deck, plugin restart, or external session/device mutation occurred.
- Bounded work unit: 92 changed lines (77 additions, 15 deletions) across 8 files. Tasks remain 6/13; 3.1 and 3.2 remain intentionally unchecked because adapters, installers, and remaining integration work are incomplete.

## Approved Issue #33: Navigation correction — strict TDD RED same-value restart/resistant child; GREEN/refactor focused Node 24 24/24 + typecheck; argv-only hard-bounded TERM/KILL boundary, strict tmux parsing/has-session, immutable assignment ID, and exact ordered commands. Exact Node 24 verify passed 312/312; tasks remain 6/13 with 3.1/3.2 unchecked.

## Historical Native Ordinal 9 Rendering Remediation (pre-gray amendment)

- Historical physical evidence before the gray amendment: authenticated `started` returned HTTP 204, but slot 1 rendered black while then-idle slots 2–5 were green.
- Historical semantic colors were `green|amber|red|blue`; immutable SVG paint mapping used `#008000`, `#FFBF00`, `#FF0000`, and `#0000FF`.
- Renderer now emits documented `data:image/svg+xml;base64,...` SVG, never the unsupported percent-encoded form.
- Strict fake-host coverage decodes all paints, rejects percent-encoded images, and proves idle green / started amber; existing physical acknowledgement and scheduler tests remain.
- Historical ordinal 9 verification: Node 24.18.0 focused action/controller 19/19 + typecheck; exact `npm run verify` once, 299/299, audit clean, package validation, and runtime smoke.
- Ready for a separately authorized live restart/event only; none occurred. Tasks remain 6/13 and all unchecked tasks stay unchecked.
- Evidence revision: `sha256:f85bb5c8d2315a7871602a60b87f705747545b6f081e491442306762e2175923`.

## Native Ordinal 11 Unassigned-Slot Visual Contract

- Implemented the amended occupancy contract without changing assignments, scheduler behavior, retries, privacy boundaries, or physical-only acknowledgement semantics.
- Added `SESSION_SLOT_COLOR.GRAY` with the explicit immutable base64-SVG paint `#6B7280`. Unassigned slots are gray at initial render and after pane disappearance; assigned idle/read remains green.
- Action/controller integration proves all five slots initialize gray, three active sessions render three amber/two gray, physical acknowledgement changes an assigned blue slot to green without releasing it, and pane disappearance releases the assigned slot to gray.
- Strict TDD evidence: Node 24 focused safety baseline 27/27; the new contract test failed RED (expected gray but received green); targeted GREEN passed 1/1 after the minimum color mapping/reducer change; triangulation/refactor passed focused 28/28 plus typecheck.
- Exact Node 24.18.0 `npm run verify` ran once and passed 300/300 tests, strict typecheck, production audit (0 vulnerabilities), package validation, and bounded runtime smoke. No live Stream Deck/plugin/profile action occurred.
- Tasks remain 6/13. Tasks 3.1 and 3.2 remain intentionally unchecked because navigation, persistence, adapters, installers, recovery, and remaining integration work are incomplete.

## Current Status

- **Implemented and verified**: gray is free/unassigned/disabled; green is assigned idle/read or physically acknowledged and never free; amber, red, and blue remain unchanged.
- **Current verification**: Untrusted-enumeration correction on Node 24.18.0 — focused 47/47 + typecheck and exact `npm run verify` **497/497**; no live navigation.

## Native Ordinal 12 Physical Acceptance

- On `fcd24b1d7abb86aed33120df7d76af1b9695d5d5`, `npm run build` and `npm run restart:plugin` succeeded; a fresh live `127.0.0.1` endpoint validated with runtime `0700`, endpoint `0600`, and no secrets recorded.
- Tracked sessions `1111…`, `2222…`, and `3333…` each returned `204` for `started` and exact matching `pane-disappeared`, leaving zero assignments.
- User confirmed both three amber/two disabled gray and immediate release to all five physical slots gray.
- Fresh `StreamDeck.log` restart window `2026-07-31T10:26:13.740+02:00`–`10:26:13.920+02:00` had owner PID 149 live at evidence time and zero fixed startup/render/server error matches; no profile, relink, source, Git, or GitHub mutation occurred. Physical acceptance passed; tasks remain 6/13 and 3.1/3.2 remain unchecked.

## Native Ordinal 13 Generated Asset Determinism Remediation (Issue #32)

- Root cause: the gate compared PNG bytes, including `deflateSync`'s platform/zlib-dependent IDAT encoding, rather than the generated image contract; equivalent filtered scanline bytes could fail despite matching dimensions and valid checksums.
- Authoritative `check-generated` validates signature, exact IHDR/IDAT/IEND envelope, CRCs, IHDR, bounded complete inflation, and filtered scanline bytes; delivery only compares dimensions/IHDR-derived data and filtered scanline bytes, while profile remains byte-exact.
- Strict TDD: the same-filtered-scanlines/different-deflate test failed RED under explicit Node 24.18.0 and passed GREEN **13/13**; ordinal-13 retry adds bounded decompression plus complete-IDAT-consumption rejection while preserving filtered-scanline-drift rejection.
- Node 24.18.0 focused generated/delivery checks passed 19/19; typecheck passed; exact retry `npm run verify` passed 303/303, audit 0 vulnerabilities, packaging, and local runtime smoke. Verification left tracked assets/profile unchanged.
- No live Stream Deck, plugin, profile, native ledger, or GitHub action occurred. Tasks remain 6/13; 3.1/3.2 remain unchecked.

## Completed Tasks

- [x] 1.1 PR 1A: Node 24 package, strict TypeScript/Rollup/Vitest scaffold, CI, minimal plugin/action compilation, and focused tooling tests.
- [x] 1.2 PR 1B–1G: Functional packaging/recovery/runtime smoke, including the official CategoryIcon contract; README setup/recovery remains task 4.1.
- [x] 1.3 Define const-object/flat contracts in `src/core/types.ts`, `src/core/events.ts`, and a privacy allowlist.
- [x] 2.1 RED: Reducer tests cover allocation, capacity, colors, physical-only acknowledgement, ordering, pane loss, immutability, and bounds.
- [x] 2.2 GREEN: Pure five-slot reducer and injected-clock color derivation preserve work and release absent panes.
- [x] 2.3 REFACTOR: Duplicate/staleness checks and bounded retirement behavior remain deterministic.
- [x] 3.1 RED: Privacy, duplicate, timeout, recovery, and fail-open scenarios across adapters, CLI, IPC, persistence, navigation, and hydration (reconciled 2026-08-04).
- [x] 3.2 GREEN: Navigation, persistence, reconciliation, hydration, production wiring, shared CLI, installers, and safe commands (reconciled 2026-08-04).
- [x] 3.3 GREEN: OpenCode/Claude/Codex adapters and installers plus standalone bundled `adapter-emit` (reconciled 2026-08-04).
- [x] 3.4 REFACTOR: Ambiguity safety, pane release, redaction, and green/read recovery (reconciled 2026-08-04).
- [x] 4.1 Export/import checks and setup/cleanup/rollback documentation without runtime data or secrets (reconciled 2026-08-04).
- [x] 4.2 Maintainer-approved Virtual Stream Deck two-OpenCode-pane acceptance; physical hardware acceptance waived/replaced by maintainer decision (evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888`, settled complete 2026-08-04).

## Deferred Follow-Ups (non-blocking, excluded from the 12/12 implementation count; tracked as plain bullets, not checkboxes)

- **D.1 (former 4.3)** — NOT executed, deferred: Install on work Mac with Claude enabled and record rollback evidence. Deferred by explicit maintainer decision (2026-08-04) to post-merge environment validation outside this PR; not passed, not failed. Recorded as a plain bullet (not `- [ ]`) so checkbox-based tooling counts exactly the 12 completed implementation tasks.

## Partial Task 3: Integration A + B1 + B2 + C1 + C2a + C2b + Remediation

**Superseded 2026-08-04**: tasks 3.1 and 3.2 are reconciled complete — per-tool adapters/installers and the standalone bundled CLI shipped (see the reconciliation section above). The two statements below are historical.

- [ ] 3.1 remains open. Navigation, adapter transport (endpoint client), pure-restore persistence, pane reconciliation, controller hydration/subscription wiring, and the shared adapter-emit CLI helper are implemented; per-tool wrapper installers remain pending.
- [ ] 3.2 remains open. Navigation, adapter transport, persistence, reconciliation, production wiring in `src/plugin.ts`, README setup/rollback documentation, and the adapter-emit helper are implemented; per-tool wrapper installers and bundled distribution of the CLI remain pending.

## Persistence Slice (pure restore)

- Added `src/persistence/session-state-store.ts`: `serializeSessionState` / `parseSessionState` pure helpers plus a `createSessionStateStore({ pluginRoot, fs, ownUid })` wrapper with `load()` and `save(state)`.
- Envelope schema version 1 with fields `schemaVersion`, `slots`, `retiredSessions` only. Slot allowlist mirrors `SessionSlot` exactly; unknown/prohibited fields (`prompt`, `raw`, etc.) reject parse. All UUIDs enforce lowercase RFC 4122 v4, tmux identifiers enforce `%\\d+`/`$\\d+`/`@\\d+`, Ghostty bundle id is fixed, enums are exhaustive.
- `load()` returns `createSessionState()` on missing file, corrupt contents, insecure ownership (`uid !== ownUid`), or group/world-readable mode. `save(state)` writes to a process-unique temp file with `0o600`, ensures the runtime directory exists with `0o700`, and atomically renames into place; on rename failure it unlinks the temp artifact and throws a fixed generic diagnostic.
- Recovery reconciliation (re-validating tmux pane existence at startup) is now implemented in `src/persistence/session-state-reconciler.ts`; the next authenticated event still corrects any stale slot naturally when reconciliation is skipped.
- New unit tests: `tests/persistence/session-state-store.test.ts` (17/17).

## Adapter CLI Emit Slice

- Added `src/cli/adapter-emit.ts` with `parseAdapterEmitArgs` and `runAdapterEmit`. The helper accepts a strict flag allowlist (`--source`, `--session-id`, `--event-id`, `--lifecycle`, `--pane-id`, `--session`, `--window`, `--sequence`) and rejects any unknown flag or prohibited content field (`--prompt`, `--transcript`, `--secret`, `--command`, `--file-path`).
- Every candidate event is re-validated through `parseLocalAgentStatusEvent` before send, so an ill-formed source/lifecycle/UUID/tmux identifier short-circuits with exit code 2 and zero network activity.
- Exit codes map from the endpoint client outcome: 0 emitted, 2 rejected, 3 unavailable, 4 timed-out, 5 local error. Stderr never contains raw errors or stack traces.
- README documents the tsx invocation and exit code table; regression-guarded by `tests/readme.test.ts`. Standalone binary bundling is a documented follow-up.
- New tests: `tests/cli/adapter-emit.test.ts` (12/12). Full Node 24 verify: 380/380.

## Runtime Wiring and Documentation Slices

- Extended `SessionSlotController` with `hydrateState(state)` and `subscribeToStateChanges(subscriber)`; both `handleStatusEvent` and `handlePhysicalKeyDown` now notify the subscriber only when reduce actually changes state (dedupe), and subscriber rejections are logged (`SESSION_SLOT_PERSISTENCE_ERROR`) without propagating.
- Extended `PluginRuntimeController` with optional `hydrateState`/`subscribeToStateChanges`. `startPluginRuntime` accepts an optional `persistence: { load, save, reconcile? }`; when both hydration hooks and persistence are present it loads, optionally reconciles, hydrates before publishing the endpoint, wires save-on-change, and unsubscribes on stop. Load failure logs `PLUGIN_RUNTIME_LOG_MESSAGE.HYDRATION_FAILED` and continues with a fresh state.
- Wired the production `src/plugin.ts` to build a `PluginRuntimePersistence` from the file-backed session state store, the tmux pane enumerator, and the pure reconciler; persistence is skipped when `process.getuid` is unavailable.
- Added `README.md` with prerequisites, install/uninstall/rollback flows, troubleshooting for endpoint discovery and stale slots, and the privacy boundary. `tests/readme.test.ts` guards the documented commands and paths.
- New tests: `tests/plugin/session-hydration.test.ts` (7/7), `tests/plugin/runtime-hydration.test.ts` (5/5), `tests/readme.test.ts` (6/6). Full Node 24 verify: 367/367.

## Reconciliation Slice

- Added `src/persistence/session-state-reconciler.ts`: pure `reconcileSessionState(state, existingPaneIds)` that releases assigned slots whose tmux panes are absent (via the existing `PANE_MISSING` reducer action, preserving retirement/dedup semantics), plus `createTmuxPaneEnumerator({ process })` that shells `tmux list-panes -a -F '#{pane_id}'` through the bounded navigation process.
- The enumerator filters control characters and non-`%\\d+` rows; on any tmux error it returns `undefined`, and the reconciler treats `undefined` as "fail open, keep loaded state." Reconciliation is deterministic and idempotent.
- New unit tests: `tests/persistence/session-state-reconciler.test.ts` (10/10). The wiring into the plugin controller/runtime remains a follow-up slice.

## Adapter Transport Slice

- Added `src/adapters/endpoint-client.ts`: reads `<pluginRoot>/runtime/endpoint.json`, validates uid/mode (`0o600` exact), parses the allowlisted record (schemaVersion/address/port/token/pid only), and posts a normalized event with `Authorization: Bearer <token>` under a 200ms total budget.
- Fail-open outcomes: `emitted` (204), `rejected` (4xx or allowlist-violating input), `unavailable` (missing/malformed endpoint, insecure ownership, transport error, 5xx), `timed-out` (deadline elapsed at file read, stat, or HTTP), `local-error` reserved for future use.
- Input events are re-validated through `parseLocalAgentStatusEvent` before send; any prohibited/unknown field short-circuits to `rejected` locally with zero network activity.
- Deterministic filesystem/http/timer seams allow full coverage without network. New unit tests: `tests/adapters/endpoint-client.test.ts` (10/10).

## C2a Publication Gate

**Status**: Resolved and verified under Node 24.18.0. Trusted root publication is preserved while the misleading no-op cleanup API and callers are removed.

- The API now accepts a trusted `pluginRoot` and derives only its fixed `runtime/` child. It validates a canonical, current-user-owned, non-group/world-writable POSIX root before mutation; rejects root/runtime symlinks; repairs only the derived child to `0700`; and verifies canonical containment before publishing.
- The contract documents that malicious same-UID processes are outside the path-API threat model because they can already read `0600` files and inspect process state. This does not claim impossible same-UID TOCTOU immunity.
- Shutdown is intentionally endpoint-preserving. It performs no `readFile`/`unlink` operation on shared `endpoint.json`; stale discovery remains for next-startup replacement, so it cannot delete a newer publisher.
- Publication uses an exclusive process-unique temp file, write/chmod/sync, and same-directory rename. Deterministic filesystem seams prove write, chmod, sync, and rename failures remove only the temporary artifact and preserve a prior endpoint.

## C2b Plugin Bootstrap Gate

**Status**: Implemented and verified under Node 24.18.0 with strict behavior-first pre-PR remediation.

- `src/plugin/runtime.ts` derives the production root from bundled `bin/plugin.js`, starts C1 before atomically publishing C2a discovery, and routes normalized events to the production `sessionSlotController.handleStatusEvent(event, clock.now())` interface.
- The runtime handle exposes frozen non-secret metadata and a shared idempotent shutdown promise. Shutdown disposes controller work and closes C1 without unlinking C2a's stale endpoint; the next startup atomically replaces it.
- `src/plugin.ts` validates complete host argument values before runtime mutation, starts runtime before action registration and `connect()`, rolls back failed connect, and sets nonzero exit before best-effort fixed generic diagnostics. Logger throws cannot prevent failure handling.
- Injected SIGINT/SIGTERM lifecycle handlers deduplicate, unregister, await stop, catch rejection, and re-emit the original signal. Tests install no global signal handlers.
- One transaction owns stage, official pack, and archive validation; cleanup failures are surfaced with the primary error and recovery is local cleanup/re-run.
- C1 retains bounded capacity for unresolved callbacks after timeout, returns generic `503`, and recovers locally with `npm run restart:plugin` or host restart; no telemetry is added.
- C3/adapters remain responsible for stale-record validation. This slice adds no persistence, navigation, adapters, installers, documentation, or live device operations. Tasks 3.1 and 3.2 remain intentionally unchecked.

## Merged Prior Progress

- Reducer state is immutable/five-slot, first-free, capacity-bounded, stale/duplicate deterministic, and releases only on pane disappearance.
- Colors, physical acknowledgement, B1 advisory scheduling, and B2 bounded content-free rendering retry remain as previously completed.
- Core event parsing accepts approved metadata only and returns frozen null-prototype normalized values.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.3 | `tests/core/events.test.ts` | Unit | Focused baseline | Contract tests first | Passed | Identifiers/privacy/bounds | Allowlist |
| 2.1–2.3 | `tests/core/reducer.test.ts` | Unit | 8/8 | Acceptance tests first | Passed | Lifecycle/timing/capacity | Ordering |
| 3.1/3.2 C1 | `tests/ipc/local-event-server.test.ts` | Real loopback | 10/10 | Protocol/timeout/capacity failures | Passed | Auth/address/raw headers/sockets/callback limits | Bounded terminal guard/payload helpers |
| 3.1/3.2 C2a remediation | `tests/ipc/endpoint-discovery.test.ts` | Filesystem integration | 9/9 | No-op cleanup removal/atomic barrier coverage | Focused Node24 pass | Exact rename-barrier records, root/runtime symlinks, unsafe mode/owner seam, invalid boundaries, publication failures | Readable trusted-root contract |
| Historical 3.1/3.2 C2b remediation | `tests/plugin/runtime.test.ts`, `tests/scaffold.test.ts`, `tests/packaging.test.ts`, `tests/ipc/local-event-server.test.ts` | Loopback/plugin integration | 12/12 packaging baseline | Spawn error and startup-budget accounting were absent | Historical full Node24 `npm run verify` 298/298 | ENOENT child error cleanup, delayed READY, bounded no-READY | Once-only child settlement and phase-total deadline |
| Historical 3.1 rendering remediation (unchecked) | `tests/actions/session-slot.integration.test.ts`, `tests/plugin/session-slot-controller.scheduler.test.ts` | Action/controller integration | 18/18 before edits | Base64 paint/host-contract tests failed on percent-encoded named colors | Historical full Node24 verify 299/299 | Four semantic paints; idle/started; fake host rejects percent encoding | Immutable paint map and semantic scheduler assertions |
| Current 3.1 unassigned-slot visual contract (unchecked) | `tests/actions/session-slot.integration.test.ts`, `tests/core/reducer.test.ts` | Action/controller integration + unit | Node 24 focused 27/27 | New five-slot gray test failed: expected gray / received green | Targeted 1/1 passed after minimum mapping/reducer change | Focused 28/28 + typecheck: all-gray, three assigned/two gray, acknowledged green, pane-release gray, SVG paint | Current full Node24 verify 300/300 |
| Current 3.1 packaging remediation (unchecked) | `tests/generated-gate.test.ts`, `tests/delivery.test.ts` | Filesystem/generated-output integration | Node 24 baseline 16/16 | Same filtered scanlines with a valid alternate deflate IDAT failed raw-byte comparison | Authoritative validator passed 18/18 | Re-encoded identical scanlines accepted; scanline drift rejected | Validator: envelope/CRC/IHDR/bounded complete inflate; delivery: dimensions/IHDR-derived data/scanlines |
| Issue #33 navigation correction (unchecked) | `tests/navigation/ghostty-tmux.test.ts`, action/reducer tests | Unit + integration | 23/23 | Same-identity, hard-bound, parser RED | 24/24 + typecheck | Exact argv/window cases | Refactored; full verify 312/312 |
| Adapter transport slice (unchecked) | `tests/adapters/endpoint-client.test.ts` | Unit (deterministic seams) | Node 24 baseline 312/312 | Missing module → suite fails | 10/10 focused | Endpoint discovery, uid/mode, record allowlist, HTTP status mapping, transport error, budget-timeout at read/stat/HTTP | Full verify 322/322 |
| Persistence pure-restore slice (unchecked) | `tests/persistence/session-state-store.test.ts` | Unit (deterministic seams) | Node 24 baseline 322/322 | Missing module → suite fails | 17/17 focused | Envelope/slot/target/retired allowlist, UUID/tmux/enum guards, insecure ownership/mode, atomic temp+rename, temp cleanup on rename failure | Full verify 339/339 |
| Reconciliation slice (unchecked) | `tests/persistence/session-state-reconciler.test.ts` | Unit (deterministic seams) | Node 24 baseline 339/339 | Missing module → suite fails | 10/10 focused | Undefined pane set = no-op, all-present = no-op, missing = release/retire, all-missing, unassigned ignored, retired preserved, enumerator parses/filters/errors | Full verify 349/349 |
| Runtime hydration + subscription (unchecked) | `tests/plugin/session-hydration.test.ts`, `tests/plugin/runtime-hydration.test.ts` | Unit + runtime | Node 24 baseline 349/349 | Missing hydrateState/subscribeToStateChanges → 7 tests fail; runtime hydration mocks → 4 tests fail | 7/7 controller + 5/5 runtime | Hydration order before publish, reconcile-through-load, subscriber dedupe/unsubscribe/rejection containment, hydration failure fallback | Full verify 361/361 |
| Production wiring + README (unchecked) | `tests/scaffold.test.ts`, `tests/readme.test.ts` | Integration + docs | Node 24 baseline 361/361 | scaffold mock missing `derivePluginRootFromBundledModuleUrl`; missing README | Scaffold restored 5/5, README 6/6 | `src/plugin.ts` builds persistence when `process.getuid` is available, docs guard install/uninstall/rollback/privacy | Full verify 367/367 |
| Adapter emit CLI (unchecked) | `tests/cli/adapter-emit.test.ts`, `tests/readme.test.ts` | Unit + docs guard | Node 24 baseline 367/367 | Missing module → suite fails | 12/12 CLI + 7/7 README | Flag allowlist, prohibited-field rejection, event re-validation, exit code mapping, no stderr leak, README documents tsx form and exit codes | Full verify 380/380 |
| Untrusted-enumeration correction (unchecked) | `tests/navigation/ghostty-tmux.test.ts`, `tests/actions/session-slot.integration.test.ts` | Unit + action/controller integration | Node 24 baseline 15/15 | Untrusted/mixed enumeration returned `missing`; outcome record used error level | Focused 47/47 + typecheck | 7 untrusted variants fail closed as UNAVAILABLE; 4 trustworthy-absence variants stay MISSING; UNAVAILABLE keeps assignment/unread; outcomes at info, failures stay error | Full Node 24 verify 497/497 |
| OpenCode pane identity (this unit) | `tests/adapters/opencode-session.test.ts`, `tests/adapters/adapter-environment.test.ts`, `tests/adapters/opencode-plugin.test.ts`, `tests/core/reducer.test.ts` | Unit | Node 24 baseline 38/38 | 9 RED failures: child idle completed a busy pane, native-session identity, per-session sequencing, no convergence | Focused 47/47 + typecheck | child/root × busy/idle/error aggregation; pane/session identity scope; stale legacy event cannot destroy canonical entry; cross-tool/other-pane preservation; restart sequence reset advances via timestamp | Full suite 506/506; exact Node 24 verify below |
| Virtual Stream Deck acceptance (4.2) | Documentary acceptance — no code/tests run in this slice | N/A (acceptance evidence, not a TDD unit) | N/A | N/A | Settled `complete`, evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888` | Two canonical OpenCode entries on `%6`/`%11`, four unique entries total (Claude `%13`, Codex `%10` preserved), sequences/timestamps advanced, 7 INFO navigations, zero MISSING/CLEAR_SLOT/collision/stale rejection/errors; plugin and adapter hashes matched current bundles |

## State

- Implementation tasks are 12/12 complete after the 2026-08-04 deferred-validation reclassification; the former task 4.3 is now non-blocking deferred follow-up D.1 (work-Mac install with Claude enabled + rollback evidence), explicitly deferred by the maintainer to post-merge validation outside this PR. This supersedes the prior twelve-of-thirteen statements below and the "Next: execute 4.3" statement in the Virtual Stream Deck acceptance section.
- **Physical acceptance for 4.2**: waived/replaced by explicit maintainer decision in favor of Virtual Stream Deck acceptance — recorded as waived, not passed.
- **Historical pre-ordinal-11 amendment statement**: The clarified occupancy contract was pending implementation before ordinal 11; it is superseded by the implemented and verified current status above.
- **Applied requirement amendment**: The clarified occupancy contract now renders semantic gray `#6B7280` for all unassigned slots, including startup/restart and immediate pane release; green remains assigned/read only. Tasks remain intentionally unchecked.
- **Review Workload Forecast: Approved.** Maintainer `roger6vi` approved one remaining `single-pr-default` with `size:exception` capped at 1,600 changed lines. Actual final Git count: 1,580 changed lines (1,527 additions, 53 deletions), including 1,067 code/tests and 513 OpenSpec lines.
- Historical pre-ordinal-11 Node 24.18.0 verification passed 298/298 tests, typecheck, production audit (0 vulnerabilities), package validation, and runtime smoke.
- **Next action**: sdd-verify. No archive claim. Deferred follow-up D.1 (former 4.3) remains open as external post-merge environment validation and is not part of the verify scope.
