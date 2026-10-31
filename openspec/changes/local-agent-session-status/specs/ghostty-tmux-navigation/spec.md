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

### Requirement: Keyboard focus on the navigated terminal
After a successful navigation the system MUST ask Ghostty to focus the terminal whose tty is the tmux client's tty, so the cursor is ready to type in the selected pane. The request MUST use Ghostty's scripting `focus` command with the tty passed as an argument, MUST NOT synthesize keyboard or mouse input, and MUST be best-effort: a failed or refused focus request MUST NOT change the navigation result or session state.

#### Scenario: Press assigned key
- GIVEN navigation succeeded and the tmux client runs in a Ghostty terminal
- WHEN the pane is selected
- THEN that terminal receives keyboard focus

#### Scenario: Older Ghostty without terminal tty metadata
- GIVEN Ghostty does not expose the terminal tty property
- WHEN exactly one terminal exists
- THEN that sole terminal is focused; multiple terminals or other failures are left untouched

#### Scenario: Focus refused
- GIVEN macOS Automation permission for Ghostty is denied
- WHEN the key is pressed
- THEN the window is still raised and the pane selected, and the key is acknowledged as before
