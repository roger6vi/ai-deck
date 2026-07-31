# Apply Progress: Local Agent Session Status

## Native Ordinal 9 Rendering Remediation

- Failed physical evidence: authenticated `started` returned HTTP 204, but slot 1 rendered black while idle slots 2–5 were green.
- Semantic reducer colors remain `green|amber|red|blue`; immutable SVG paint mapping uses `#008000`, `#FFBF00`, `#FF0000`, and `#0000FF`.
- Renderer now emits documented `data:image/svg+xml;base64,...` SVG, never the unsupported percent-encoded form.
- Strict fake-host coverage decodes all paints, rejects percent-encoded images, and proves idle green / started amber; existing physical acknowledgement and scheduler tests remain.
- Verified Node 24.18.0: focused action/controller 19/19 + typecheck; exact `npm run verify` once, 299/299, audit clean, package validation, and runtime smoke.
- Ready for a separately authorized live restart/event only; none occurred. Tasks remain 6/13 and all unchecked tasks stay unchecked.
- Evidence revision: `sha256:f85bb5c8d2315a7871602a60b87f705747545b6f081e491442306762e2175923`.

## Completed Tasks

- [x] 1.1 PR 1A: Node 24 package, strict TypeScript/Rollup/Vitest scaffold, CI, minimal plugin/action compilation, and focused tooling tests.
- [x] 1.2 PR 1B–1G: Functional packaging/recovery/runtime smoke, including the official CategoryIcon contract; README setup/recovery remains task 4.1.
- [x] 1.3 Define const-object/flat contracts in `src/core/types.ts`, `src/core/events.ts`, and a privacy allowlist.
- [x] 2.1 RED: Reducer tests cover allocation, capacity, colors, physical-only acknowledgement, ordering, pane loss, immutability, and bounds.
- [x] 2.2 GREEN: Pure five-slot reducer and injected-clock color derivation preserve work and release absent panes.
- [x] 2.3 REFACTOR: Duplicate/staleness checks and bounded retirement behavior remain deterministic.

## Partial Task 3: Integration A + B1 + B2 + C1 + C2a + C2b + Remediation

- [ ] 3.1 remains open. C1 real-loopback and C2a/C2b bootstrap plus pre-PR remediation are verified; navigation, adapter, recovery, and remaining integration scenarios are pending.
- [ ] 3.2 remains open. C1/C2a/C2b localhost bearer bootstrap and safe packaging/lifecycle remediation are complete; persistence, navigation, adapters, and installers are pending.

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
| 3.1/3.2 C2b remediation | `tests/plugin/runtime.test.ts`, `tests/scaffold.test.ts`, `tests/packaging.test.ts`, `tests/ipc/local-event-server.test.ts` | Loopback/plugin integration | 12/12 packaging baseline | Spawn error and startup-budget accounting were absent | 13/13 focused Node24 repeated 3x + typecheck; exact full Node24 `npm run verify` 298/298 | ENOENT child error cleanup, delayed READY, bounded no-READY | Once-only child settlement and phase-total deadline |
| 3.1 rendering remediation (unchecked) | `tests/actions/session-slot.integration.test.ts`, `tests/plugin/session-slot-controller.scheduler.test.ts` | Action/controller integration | 18/18 before edits | Base64 paint/host-contract tests failed on percent-encoded named colors | Focused 19/19 + typecheck; exact full Node24 verify 299/299 | Four semantic paints; idle/started; fake host rejects percent encoding | Immutable paint map and semantic scheduler assertions |

## State

- Six of thirteen tasks are complete; tasks 3.1–4.3 remain unchecked.
- Preserve the task checkbox state until the deferred integration work is actually complete.
- **Review Workload Forecast: Approved.** Maintainer `roger6vi` approved one remaining `single-pr-default` with `size:exception` capped at 1,600 changed lines. Actual final Git count: 1,580 changed lines (1,527 additions, 53 deletions), including 1,067 code/tests and 513 OpenSpec lines.
- Exact Node 24.18.0 `npm run verify` passed 298/298 tests, typecheck, production audit (0 vulnerabilities), package validation, and runtime smoke.
