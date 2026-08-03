# session-key-status Delta Spec

## ADDED Requirements

### Requirement: Five-key state
The system MUST expose exactly five session keys, assign first-free, and keep each assignment stable while its session and recorded pane exist. Concurrent sessions MUST be independent. With N assigned sessions (0..5), exactly N keys MUST show assigned-state colors and the remaining 5-N keys MUST render disabled gray. Green MUST denote an assigned session that is idle/read or has been physically acknowledged/read; it MUST NOT denote free capacity. Amber MUST denote an assigned session that is started/running, regardless of elapsed time. Red MUST denote an assigned session that has errored; red MUST be reserved for errors only and MUST NOT be derived from elapsed running time. Blue MUST denote an assigned session completed and unread; blue MUST persist until physical acknowledgement. Only physical press on the assigned key MUST acknowledge blue. Pane disappearance MUST immediately release the assignment and return that key to disabled gray.

Each assigned key MUST display the session's tmux window name as its title. The name MUST be resolved locally from tmux by the plugin (never transported in adapter events), MUST be stripped of control characters and length-bounded, and MUST fall back to a color-only key when tmux cannot provide it. When multiple assigned slots resolve to the same window name, the lowest-index slot MUST show the bare name and every other duplicate MUST append its pane identifier as a suffix. Releasing a slot MUST clear its title.

The OpenCode adapter MUST observe the host's session events and emit normalized lifecycle events through the adapter emit CLI: `session.status` busy or retry MUST emit `started` for the first observed activity of a native session and `running` afterwards, `session.idle` MUST emit `completed`, and `session.error` MUST emit `error`. Native session identifiers MUST be deterministically encoded as RFC 4122 version-4 UUIDs so a conversation keeps its slot across events and host restarts. The adapter MUST resolve its tmux pane from the process environment and MUST emit nothing when it is not running inside tmux.

Each key's property inspector MUST offer a dropdown of the currently assigned sessions, labeled with the resolved title, tool source, and lifecycle. Selecting a session MUST move it to that key's slot; when the slot is occupied, the two sessions MUST swap slots while each keeps its assignment identity. Selections MUST take effect immediately (re-render and persist through the normal state save) and the inspector MUST receive updated session lists on every state change while open. Malformed, unknown, or stale selections MUST be ignored without changing state.

#### Scenario: Two OpenCode sessions
- GIVEN two OpenCode sessions and five free keys
- WHEN both become active
- THEN keys 1 and 2 are assigned first-free and stay while panes exist

#### Scenario: Capacity full
- GIVEN five sessions occupy all keys
- WHEN a sixth session emits activity
- THEN existing assignments remain unchanged and the new session is capacity-full/unassigned

#### Scenario: Color transitions
- GIVEN an assigned session changes lifecycle
- WHEN it runs under five minutes, reaches five minutes, completes, errors, or is read
- THEN the key shows amber, red, blue, red, or green respectively, without cancelling work

#### Scenario: Visibility does not acknowledge
- GIVEN a key is blue
- WHEN Ghostty is focused, the pane is visible, or manual navigation occurs
- THEN the key remains blue

#### Scenario: Duplicate or stale event
- GIVEN duplicate or stale lifecycle events arrive
- WHEN they are processed
- THEN state remains deterministic and no false acknowledgement occurs

#### Scenario: Initial state after restart
- GIVEN the plugin starts or restarts with no session assignments
- WHEN the five keys render
- THEN all five keys are disabled gray and none is green for free capacity

#### Scenario: Partial capacity
- GIVEN three sessions are assigned and two keys are free
- WHEN the five keys render
- THEN exactly three keys show assigned-state colors and exactly two keys are disabled gray

#### Scenario: Acknowledged assigned session
- GIVEN an assigned session is completed and unread on a blue key and its pane exists
- WHEN the user physically presses that assigned key
- THEN the key becomes green as acknowledged/read and the assignment remains

#### Scenario: Pane disappearance releases a key
- GIVEN an assigned key has a recorded pane
- WHEN that pane disappears
- THEN the assignment is released immediately and the key becomes disabled gray
