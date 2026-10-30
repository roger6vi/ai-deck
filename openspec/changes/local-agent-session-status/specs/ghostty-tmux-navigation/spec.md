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

### Requirement: Keyboard focus on the navigated terminal
After a successful navigation the system MUST ask Ghostty to focus the terminal whose tty is the tmux client's tty, so the cursor is ready to type in the selected pane. The request MUST use Ghostty's scripting `focus` command with the tty passed as an argument, MUST NOT synthesize keyboard or mouse input, and MUST be best-effort: a failed or refused focus request MUST NOT change the navigation result or session state.

#### Scenario: Press assigned key
- GIVEN navigation succeeded and the tmux client runs in a Ghostty terminal
- WHEN the pane is selected
- THEN that terminal receives keyboard focus

#### Scenario: Focus refused
- GIVEN macOS Automation permission for Ghostty is denied
- WHEN the key is pressed
- THEN the window is still raised and the pane selected, and the key is acknowledged as before
