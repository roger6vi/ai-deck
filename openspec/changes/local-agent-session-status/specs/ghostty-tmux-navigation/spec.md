# ghostty-tmux-navigation Delta Spec

## ADDED Requirements

### Requirement: Safe assigned-key navigation
The system MUST use a physical press on an assigned key to best-effort focus the recorded Ghostty/tmux target and acknowledge blue when the pane exists. Ambiguous targets MUST fail safely without synthetic input. Missing tmux panes MUST release their key immediately, including after restart/stale checks.

#### Scenario: Press assigned blue key
- GIVEN an assigned blue key has an existing recorded pane
- WHEN the physical key is pressed
- THEN navigation is attempted best-effort and the key becomes read/green

#### Scenario: Ambiguous or missing target
- GIVEN the target is ambiguous or the recorded pane is missing
- WHEN the key is pressed or state is checked
- THEN navigation fails safely; no synthetic input occurs; missing panes release immediately
