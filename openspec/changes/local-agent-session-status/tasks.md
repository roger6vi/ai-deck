# Tasks: Local Agent Session Status

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | single-pr-default (maintainer-approved) |
| Size exception cap | 1,600 changed lines |

Decision needed before apply: No
Chained PRs recommended: Yes; maintainer approved one remaining PR.
Delivery decision: roger6vi approved `single-pr-default` with `size:exception` capped at 1,600 changed lines.
400-line budget risk: High
Actual C2 pre-PR remediation candidate: 1,580 changed lines (1,527 additions, 53 deletions), within the approved 1,600-line cap.

## Phase 1: Foundation / Scaffold

- [x] 1.1 PR 1A: Node 24 package, strict TypeScript/Rollup/Vitest scaffold, CI, minimal plugin/action compilation, and focused tooling tests.
- [x] 1.2 PR 1B–1G: Functional packaging/recovery/runtime smoke now includes the official CategoryIcon contract. README local setup/recovery documentation is deliberately deferred to task 4.1.
- [x] 1.3 Define const-object/flat contracts in `src/core/types.ts`, `src/core/events.ts`, and a privacy allowlist; accept only lowercase UUID v4 event/session IDs, tmux internal IDs, and Ghostty's stable bundle ID; reject prompts, transcripts, output, commands, files, secrets, and unknown fields.

## Phase 2: Core Status (RED → GREEN → REFACTOR)

- [x] 2.1 RED: Add reducer tests for stable five-key assignment, capacity, colors, acknowledgement, dedupe, stale events, and pane release.
- [x] 2.2 GREEN: Implement injected-clock reducer/colors; preserve work, ignore stale/duplicate events, and release absent panes.
- [x] 2.3 REFACTOR: Keep ordering/dedupe deterministic and state/logs free of work data.

## Phase 3: Integration and Local Boundaries

- [x] 3.1 RED: Privacy, duplicate, timeout, recovery, and fail-open scenarios across adapters, CLI, IPC, persistence, navigation, and hydration. Reconciled complete 2026-08-04 against current tests.
- [x] 3.2 GREEN: Navigation, persistence, reconciliation, hydration, production wiring, shared CLI, installers, and safe commands implemented. Reconciled complete 2026-08-04.
- [x] 3.3 GREEN: Optional Codex/OpenCode/Claude adapters and installers emit only normalized metadata and fail under 200ms; standalone bundled `adapter-emit` ships in the package allowlist. Reconciled complete 2026-08-04.
- [x] 3.4 REFACTOR: Ambiguity safety, pane release, redaction, and green/read recovery verified. Reconciled complete 2026-08-04.

## Phase 4: Acceptance and Documentation

- [x] 4.1 Export/import checks and local setup/cleanup/rollback documentation without runtime data or secrets. Reconciled complete 2026-08-04 against README, package allowlist, and profile validation.
- [x] 4.2 Maintainer-approved Virtual Stream Deck acceptance with two OpenCode panes (replaces the original physical-hardware test; physical acceptance explicitly waived/replaced by maintainer decision, not passed). Settled complete 2026-08-04 with evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888`.

## Deferred environment validation (non-blocking follow-up, excluded from the implementation task count)

> Maintainer decision (explicit, 2026-08-04): the former task 4.3 is deferred to post-merge environment validation outside the scope of this PR, so the change can advance to verify/Judgment Day/PR without blocking on the physical work-Mac environment.
>
> Rationale: the item requires maintainer-owned physical hardware (work Mac) and is environment validation, not implementation work. All implementation, test, and virtual acceptance evidence for the in-scope work is already settled.
>
> Status: NOT executed — not passed, not failed. It MUST NOT be claimed as passed by verify, Judgment Day, or the PR.
>
> Tracking note: this follow-up is intentionally recorded as a plain bullet, NOT a `- [ ]` checkbox, so checkbox-based tooling counts exactly the 12 implementation tasks (all `[x]`) and zero pending.

- **D.1 (former 4.3)** — NOT executed, deferred: Install on work Mac with Claude enabled and record rollback evidence. Deferred by explicit maintainer decision (2026-08-04) to post-merge environment validation outside this PR; not passed, not failed; excluded from the 12/12 implementation count.

## State

- Implementation tasks: 12/12 complete (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2). The deferred work-Mac validation (D.1, former 4.3) is excluded from this count and remains visible and traceable above as a non-blocking follow-up.
- Scope acceptance: current scope is complete based on the maintainer-approved Virtual Stream Deck acceptance (task 4.2, evidence revision `sha256:8285e0955516e1958bb934363f81f67a233328cb3392fce6f8b01c97580c4888`) plus all previously recorded implementation/test evidence. Physical hardware acceptance for 4.2 was waived/replaced by maintainer decision — recorded as waived, not passed.
- Next action: sdd-verify. No archive claim.
