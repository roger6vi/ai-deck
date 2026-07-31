# Apply Progress: Local Agent Session Status

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
- **Current verification**: Issue #33 navigation correction on Node 24.18.0 — focused 24/24 + typecheck and exact `npm run verify` **312/312**; no live navigation.

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

## Partial Task 3: Integration A + B1 + B2 + C1 + C2a + C2b + Remediation

- [ ] 3.1 remains open. Navigation, adapter transport (endpoint client), pure-restore persistence, and pane reconciliation are implemented; per-adapter observers and remaining integration scenarios are pending.
- [ ] 3.2 remains open. Navigation, adapter transport, persistence, and reconciliation are implemented; per-adapter observers, installers, and remaining safe commands are pending.

## Persistence Slice (pure restore)

- Added `src/persistence/session-state-store.ts`: `serializeSessionState` / `parseSessionState` pure helpers plus a `createSessionStateStore({ pluginRoot, fs, ownUid })` wrapper with `load()` and `save(state)`.
- Envelope schema version 1 with fields `schemaVersion`, `slots`, `retiredSessions` only. Slot allowlist mirrors `SessionSlot` exactly; unknown/prohibited fields (`prompt`, `raw`, etc.) reject parse. All UUIDs enforce lowercase RFC 4122 v4, tmux identifiers enforce `%\\d+`/`$\\d+`/`@\\d+`, Ghostty bundle id is fixed, enums are exhaustive.
- `load()` returns `createSessionState()` on missing file, corrupt contents, insecure ownership (`uid !== ownUid`), or group/world-readable mode. `save(state)` writes to a process-unique temp file with `0o600`, ensures the runtime directory exists with `0o700`, and atomically renames into place; on rename failure it unlinks the temp artifact and throws a fixed generic diagnostic.
- Recovery reconciliation (re-validating tmux pane existence at startup) is now implemented in `src/persistence/session-state-reconciler.ts`; the next authenticated event still corrects any stale slot naturally when reconciliation is skipped.
- New unit tests: `tests/persistence/session-state-store.test.ts` (17/17).

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

## State

- Six of thirteen tasks are complete; tasks 3.1–4.3 remain unchecked.
- Preserve the task checkbox state until the deferred integration work is actually complete.
- **Historical pre-ordinal-11 amendment statement**: The clarified occupancy contract was pending implementation before ordinal 11; it is superseded by the implemented and verified current status above.
- **Applied requirement amendment**: The clarified occupancy contract now renders semantic gray `#6B7280` for all unassigned slots, including startup/restart and immediate pane release; green remains assigned/read only. Tasks remain intentionally unchecked.
- **Review Workload Forecast: Approved.** Maintainer `roger6vi` approved one remaining `single-pr-default` with `size:exception` capped at 1,600 changed lines. Actual final Git count: 1,580 changed lines (1,527 additions, 53 deletions), including 1,067 code/tests and 513 OpenSpec lines.
- Historical pre-ordinal-11 Node 24.18.0 verification passed 298/298 tests, typecheck, production audit (0 vulnerabilities), package validation, and runtime smoke.
