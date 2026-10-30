# ghostty-tmux-navigation Delta Spec

## ADDED Requirements

### Requirement: Safe assigned-key navigation
The system MUST use a physical press on an assigned key to best-effort focus the recorded Ghostty/tmux target and acknowledge blue only after successful navigation. All non-success navigation outcomes MUST leave assignment and session state unchanged. Missing tmux panes MUST release their key only from authoritative pane-disappeared lifecycle events or startup reconciliation.

#### Scenario: Press assigned blue key
- GIVEN an assigned blue key has an existing recorded pane
- WHEN the physical key is pressed
- THEN navigation is attempted best-effort and the key becomes read/green

#### Scenario: Navigation does not succeed
- GIVEN navigation returns ambiguous, missing, or unavailable
- WHEN the assigned key is pressed
- THEN navigation fails safely; no synthetic input occurs; assignment, lifecycle, acknowledgement, retirement history, rendering, and persistence state remain unchanged

#### Scenario: Authoritative missing pane evidence
- GIVEN an explicit pane-disappeared lifecycle event arrives or startup reconciliation proves the recorded pane absent
- WHEN the evidence is applied
- THEN the missing pane's key is released
