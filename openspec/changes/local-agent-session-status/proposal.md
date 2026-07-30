# Proposal: Local Agent Session Status

## Intent

Build a local-only Stream Deck view that shows five terminal agent session states and lets the user return to the assigned tmux pane. This prevents missed completions and ambiguous agent state without exposing work data or faking approvals.

## Scope

### In Scope
- Five keys on the original 15-key Stream Deck, assigned first-free and stable while each session exists.
- Colors: green idle/free/read, amber running under five minutes, red error or running over five minutes, blue completed with unread response.
- Optional local adapters: Codex and OpenCode on the personal Mac; Claude Code on the work Mac.
- Pressing an assigned key activates Ghostty, selects the captured tmux pane, and acknowledges blue; missing panes release keys immediately.
- Plugin packaging/export and hardware acceptance using the existing two OpenCode sessions.
- Delivery setup: create the new GitHub repository after proposal/design acceptance and before implementation.

### Out of Scope
- Prompts, transcripts, tool outputs, secrets, cloud relay, cross-machine sync, or work-data export.
- Synthetic approvals or keystrokes.
- Guaranteed exact targeting across multiple Ghostty windows/clients.
- Marketplace/DRM release, Windows support, or full Codex Micro parity.

## Capabilities

### New Capabilities
- `session-key-status`: Five-key occupancy, color transitions, stale timeout, and physical-key-only acknowledgement.
- `local-agent-status-adapters`: Optional local Codex/OpenCode/Claude event ingestion with privacy-preserving payloads.
- `ghostty-tmux-navigation`: Best-effort Ghostty activation and tmux pane selection from assigned keys.
- `plugin-packaging-export`: Local Stream Deck plugin profile, packaging, and transfer workflow.

### Modified Capabilities
- None.

## Approach

Use an official Stream Deck Node plugin hosting token-authenticated `POST /events` on `127.0.0.1`, with a dynamic port stored in a chmod-restricted endpoint file. Adapters normalize native events and fail open with short timeouts. A core reducer owns assignment, color state, pane disappearance, and physical-key-only acknowledgement. Keep transport abstract so UDS can harden IPC later.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `package.json`, `tsconfig.json`, test config | New | Node 24 TypeScript plugin scaffold. |
| `com.gentleman.ai-deck.sdPlugin/manifest.json` | New | SDK v2, DeviceType 0, 5x3 profile. |
| `src/core/**`, `src/plugin/**` | New | State reducer, privacy boundary, rendering, HTTP ingest. |
| `src/adapters/{codex,opencode,claude}/**` | New | Optional local adapters per Mac. |
| `src/navigation/**`, `install/**` | New | Ghostty/tmux navigation and export helpers. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Local IPC spoofing | Med | Bearer token, localhost only, restricted endpoint file, no sensitive payloads. |
| Stale panes/restarts | Med | Verify tmux pane before navigation; age out and release keys. |
| Hook slowdown | Med | Low-frequency events, sub-200ms timeout, fail-open adapters. |
| Multi-window Ghostty ambiguity | High | Best effort only; alert/log when ambiguous. |

## Rollback Plan

Disable/remove adapters, stop the plugin, and delete the endpoint file/package. Agents keep running because adapters fail open and never approve or type.

## Dependencies

- Stream Deck 7.1+, original 15-key device, Node 24 SDK tooling, Ghostty, tmux, local Codex/OpenCode/Claude Code, and GitHub repository creation after design acceptance.

## Success Criteria

- [ ] Two existing OpenCode sessions occupy stable keys and show expected green/amber/blue/red transitions.
- [ ] Only physical assigned key press acknowledges unread blue and navigates to Ghostty/tmux.
- [ ] Missing pane releases key immediately.
- [ ] Plugin exports/imports locally without cloud or cross-machine sync.
- [ ] Event payloads never include prompts, transcripts, tool outputs, or secrets.
