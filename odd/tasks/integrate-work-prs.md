# Integrate work-machine PRs
Goal: validate and integrate PRs 39–43 together with the working local repair, without disturbing the installed development worktree.
Branch: integrate/work-prs | Delivery: existing PR/work-unit slices, then authorized main integration; no release | Checks: focused vitest, typecheck, npm run verify

## Specs
S1. User: «pues si esas PRs las has podido probar y funcionan bien, intégralas.»
S2. Scope choice: «Sí, PRs y reparación local (recomendado)». The approved choice says: «Main conservará lo que acabamos de dejar funcionando, además de las PR que superen las pruebas.»
S3. User execution constraint: «se atasco! no mandes subagentes. quiero que lo aga el orquestador».

## Tasks
T1 | S1-S3 | inline | in_progress | Merge PR43 into the repair integration branch and verify color behavior and previous idle/agent rendering. Risk: item 3 (shared color behavior). Commit: pending.
T2 | S1-S3 | inline | pending | Integrate PR41 printable tmux formats while preserving strict complete-enumeration guards and current native discovery. Risk: item 3 (navigation parser contract). Commit: pending.
T3 | S1-S3 | inline | pending | Integrate PR40 non-success navigation acknowledgement behavior, preserving current logging, assignments, parking and persistence. Risk: item 3 (state shared by other flows). Commit: pending.
T4 | S1-S3 | inline | pending | Integrate PR42 best-effort Ghostty terminal focus, preserve printable formats, navigation results and bounded processes. Risk: item 4 (process/timeouts). Commit: pending.
T5 | S1-S3 | inline | pending | Integrate PR39 custom pane naming on the canonical UI path; preserve current unassigned/discovery features and literal fallback window names. Verify real isolated tmux round trip without touching user panes. Risk: item 3 (shared title resolution), item 5 (plugin UI packaging). Commit: pending.
T6 | S1-S3 | inline/manual | pending | Full integrated verification, generated bundle/package refresh, native assessment per candidate without subagent launches, and working installation preservation. Risk: item 3 (integrated contracts), item 5 (delivery). Commit: pending.
T7 | S1-S3 | inline | pending | Publish verified integration to main, verify remote commit and PR states; no force push, no release, preserve installed worktree. Risk: item 5 (delivery). Commit: pending.

## Log
L1. Original current request verbatim: «pues si esas PRs las has podido probar y funcionan bien, intégralas.» Parent explained earlier tests covered local repair, not full PR heads; user selected «Sí, PRs y reparación local (recomendado)».
L2. Baseline main 3a97e7c07f06228faf392a6c72fdac44f70f1555. Working repair head 5cde923 kept checked out at /Users/roger/Documents/CODEProjects/ai-deck because Stream Deck development link points there. Integration isolated at .local/worktrees/work-prs, registered same-clone worktree, branch integrate/work-prs. Dependencies symlinked read-only to existing node_modules; never stage that symlink. First attempted fetch by origin branch names failed because all PRs are cross-repository from rogerWeekendesk; diagnosed and fetched GitHub refs/pull/N/head successfully instead. No remote branch edits or source changes from that failed fetch.
L3. Frozen input heads: PR39 2b7e44dec6881db402e614c706a58d6498149c71; PR40 619394960be901bd6a63a6e65cb4766c7e09a9d5; PR41 e1594bec0315b184ffeb58484d1f86620f94ecad; PR42 ac7004c2930d5ed1e3dc062e5b84160f2c56519a; PR43 440c6e6c83e55af2a37865090845cc7f623b85e5. GitHub main reports PR39/40/41 conflicting; PR42/43 mergeable; no status checks reported. Preserve PR head ancestry in integration so GitHub can identify incorporated changes. Only passing, verified integrated changes may reach main. No release publication or external profile/terminal mutation is authorized by this integration request.
L4. Previous local work is already unit-committed and manually verified (544 tests, package/CLI differential, two real panes/navigation). Native ASSESS previously unassessable due undeclared untracked files; no approval was claimed. User explicitly requires orchestrator/manual work and no subagents. Do not launch native reviewer model runs or other agents under a different name. No reset/recovery, force-push, changing review mode, or invented review verdict.
L5. Assumptions: merge the fetched immutable PR heads one at a time, retain current validation and the canonical roger6vi.ai-deck identity. Integration may fix candidate-caused regressions with tests/docs. Main publishing is authorized by S1-S2 after functional proof; avoid inventing new PRs or releases. Existing author PR branches need not be rewritten: merge commits preserve their history. If remote main advances, stop to reconcile normally, never overwrite it.
