## Exploration: Next autonomous slice for local-agent-session-status

### Current State

Authenticated loopback events already flow through `startPluginRuntime` to the singleton `SessionSlotController`, then through the pure reducer and renderer. `SessionSlotActionBase.onKeyDown` currently calls `handlePhysicalKeyDown`, which immediately acknowledges a completed slot without checking or focusing its recorded target. Target metadata is already normalized and command-safe (`%pane`, `$session`, optional `@window`, fixed Ghostty bundle ID), but no `src/navigation`, `src/persistence`, `src/adapters`, or `install` implementation exists. Missing panes release only when an external `pane-disappeared` event arrives.

State is memory-only (`createSessionState()`), so restart begins all gray. Persistence has no snapshot schema, hydration action, secure atomic store, startup seam, or pane verifier. Adapter delivery also lacks an endpoint reader/stale-record validator, bounded HTTP client, native-event mapper, and installer. Tasks 3.1 and 3.2 therefore remain partially complete.

### Affected Areas

- `src/actions/session-slot-base.ts` — physical key entry already delegates to the controller; no change should be needed.
- `src/plugin/session-slot-controller.ts` — inject and invoke navigation before conditional acknowledgement or release; contain failures behind a fixed diagnostic.
- `src/core/reducer.ts` — add an identity-guarded missing-pane action so a delayed probe cannot release a reassigned slot and stale events remain retired.
- `src/navigation/ghostty-tmux.ts` — new argv-only, bounded, injectable pane/client probe and navigation boundary.
- `tests/navigation/ghostty-tmux.test.ts` — new command/outcome unit coverage without running Ghostty or tmux.
- `tests/actions/session-slot.integration.test.ts`, `tests/core/reducer.test.ts` — physical-press orchestration, rendering, and stale-result coverage.

### Approaches

1. **Ghostty/tmux assigned-key navigation first** — add exact pane/session/window validation, one-client navigation, and explicit missing/ambiguous/unavailable outcomes at the existing physical-key seam.
   - Pros: all required metadata and the press seam already exist; closes a concrete navigation scenario; supplies the pane-verification primitive that restart recovery needs; clean mocked rollback boundary.
   - Cons: tmux-client cardinality cannot guarantee exact Ghostty-window focus; async probe results require identity guards.
   - Effort: Medium, forecast 300–345 changed lines including focused tests and concise apply evidence.

2. **Local persistence/restart recovery first** — add a private atomic snapshot, reducer hydration, startup restore, and writes.
   - Pros: improves restart continuity directly.
   - Cons: recovery is not safe until panes can be verified; also requires schema/security/write-order/startup decisions and likely 350–500 changed lines. Building it first would duplicate or prematurely embed the navigation probe.
   - Effort: High.

3. **First optional OpenCode adapter and installer first** — add discovery consumption, fail-open posting, lifecycle mapping, and local installation.
   - Pros: starts native event delivery and is independently removable.
   - Cons: C2 publishes discovery but C3 reading/stale validation and the shared bounded client do not exist; native mapping and installer behavior add API/operational risk and likely exceed 400 lines. This primarily advances task 3.3 rather than closing the earliest 3.1/3.2 seam.
   - Effort: High.

### Recommendation

Implement exactly one PR slice: **safe assigned-key Ghostty/tmux navigation with conditional missing-pane release**.

Start boundary: an assigned physical key press reaches `SessionSlotController`. Finish boundary: an injected navigator returns a const-object outcome (`navigated`, `ambiguous`, `missing`, or `unavailable`), after which the controller applies an identity-guarded transition and renders. Verification uses only injected command doubles; rollback removes the navigation module/injection and reducer action without changing IPC or adapter behavior.

The navigator should use bounded `execFile`-style argv execution with no shell: inspect all panes and validate the exact recorded pane/session/window, inspect matching tmux clients, and navigate only when exactly one client is targetable by activating the recorded Ghostty bundle and selecting the recorded tmux target. A missing or reused/mismatched pane releases immediately to gray. Ambiguity executes no activation/selection and retains the assignment; because existence was proven and the press is physical, a completed blue slot is still acknowledged green. Failure before existence is proven retains the prior state and emits only a fixed content-free diagnostic. Every post-await transition must re-check slot/session/pane identity.

Non-goals: snapshots/hydration, adapters, endpoint consumption, installers, documentation, live Ghostty/tmux/Stream Deck execution, exact multi-window Ghostty guarantees, task-checkbox edits, and native-ledger changes.

Expected symbols: `NAVIGATION_OUTCOME`, `AssignedTargetNavigator`, `createGhosttyTmuxNavigator`, and production `ghosttyTmuxNavigator`; `SESSION_REDUCER_ACTION.PANE_MISSING` with session/pane identity; a navigator option and fixed navigation error in `SessionSlotController`.

Strict-TDD RED scenarios:
- unique existing target runs only argv-based probe/focus/select commands and changes completed blue to green;
- missing or pane-ID-reused target runs no focus/select command and conditionally releases to gray;
- zero/multiple matching clients are ambiguous, run no focus/select command, retain assignment, and physically acknowledge existing blue;
- probe/command failure is contained, logs no stdout/stderr/target data, and cannot release or acknowledge when existence was not proven;
- unassigned presses invoke no command;
- a delayed missing result cannot release a slot whose assignment or pane changed.

Targeted RED/GREEN command (not executed during exploration): `npx --yes -p node@24.18.0 -p npm@11.16.0 -c 'npm ci && npm test -- tests/navigation/ghostty-tmux.test.ts tests/actions/session-slot.integration.test.ts tests/core/reducer.test.ts && npm run typecheck'`. Final slice gate remains the repository's exact `npm run verify` under Node 24.18.0.

Proposed approved issue title: **Add safe assigned-key Ghostty/tmux navigation**. Body summary: the physical press currently acknowledges without validating or focusing its target. Add an injected, bounded, argv-only navigator; validate pane/session/window and one-client cardinality; focus/select only a unique target; release exact missing targets; contain ambiguous/unavailable outcomes without synthetic input or sensitive logs; guard delayed outcomes against reassignment. Cover the six RED scenarios above. Exclude persistence, adapters/installers, docs, and live-device work. Acceptance is focused tests/typecheck plus the full Node 24 verify gate. Rollback is deletion of the navigator seam and conditional reducer action.

Completing this slice changes no task checkbox: 3.1 still lacks adapter/recovery RED coverage, and 3.2 still lacks persistence, adapters, installers, and remaining safe commands; 3.3–4.3 also remain unchecked.

### Risks

- **Correctness:** tmux pane IDs can be reused; validate session/window and condition delayed transitions on current identity.
- **Ambiguity:** one tmux client is only a best-effort proxy for a focusable Ghostty target; exact multi-window focus stays out of scope.
- **Privacy/security:** never invoke a shell or log command output, target metadata, or thrown process errors; retain fixed diagnostics.
- **Platform:** macOS `open` and tmux availability can fail; fail closed without releasing unproven targets.
- **Review size:** stop or split before 350 changed lines; do not absorb persistence or adapter groundwork.

### Ready for Proposal

Yes — the active change is already proposed. The orchestrator can create the approved issue above and launch one strict-TDD apply slice for navigation only; no clarification or task-checkbox change is needed.
