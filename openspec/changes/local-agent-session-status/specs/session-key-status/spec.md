# session-key-status Delta Spec

## ADDED Requirements

### Requirement: Five-key state
The system MUST expose exactly five session keys, assign first-free, and keep each assignment stable while its session and recorded pane exist. Concurrent sessions MUST be independent. Colors MUST be green idle/free/read, amber running under five minutes, red error or running at/over five minutes, and blue completed unread. Five-minute red MUST be advisory and MUST NOT cancel work. Only physical press on the assigned key MUST acknowledge blue.

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
