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

- [ ] 3.1 RED: Navigation sub-slice is complete; adapter, recovery, privacy, timeout, duplicate, and fail-open scenarios remain pending.
- [ ] 3.2 GREEN: Navigation sub-slice is complete; persistence, adapters, installers, and remaining safe commands remain pending.
- [ ] 3.3 GREEN: Implement optional Codex/OpenCode/Claude adapters and installers; emit only normalized metadata and fail under 200ms.
- [ ] 3.4 REFACTOR: Verify ambiguity safety, pane release, redaction, and green/read recovery.

## Phase 4: Acceptance and Documentation

- [ ] 4.1 Add export/import checks and local setup/cleanup/rollback documentation without runtime data or secrets.
- [ ] 4.2 Hardware-test two OpenCode sessions.
- [ ] 4.3 Install on work Mac with Claude enabled and record rollback evidence.
