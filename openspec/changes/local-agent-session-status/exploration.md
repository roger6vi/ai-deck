# Exploration: local-agent-session-status

## Current State

- The initial project was an Engram-only SDD project with no application stack, no Git repository, and no test runner. Strict TDD was inactive until a scaffold added a test command.
- The target is an original 15-key Stream Deck (DeviceType 0), with a 5×3 layout and 72×72 / 144×144 key images.
- The plugin runtime supports Node 20 and 24; the project targets Node 24 and npm 11.
- Ghostty and tmux are local runtime dependencies. Exact OS-window targeting is not guaranteed when multiple Ghostty windows exist.

## Affected Areas

- Node/TypeScript Stream Deck plugin scaffold, manifest, profile, and deterministic test scripts.
- `src/core/**` for normalized event schema, session identity, state reducer, unread handling, stale-session policies, and privacy redaction.
- `src/plugin/**` for action registration, rendering, local event server, restart recovery, and key presses.
- Optional local adapters for Codex, Claude Code, and OpenCode.
- Ghostty/tmux navigation helpers, local installation/export helpers, and unit/contract/adapter/plugin tests.

## Approaches

1. **Official Stream Deck Node plugin with localhost HTTP ingest** — host a `127.0.0.1` endpoint on a dynamic port, store a restricted endpoint record and bearer token, and let adapters post normalized events with short timeouts.
2. **Unix domain socket ingest** — stronger local IPC posture, but less compatible with HTTP hook integrations and more operationally complex.
3. **Deep-link-only ingestion** — no local server, but payload limits and acknowledgement/backpressure constraints make it unsuitable as the primary transport.

## Recommendation

Use approach 1 for the MVP, with an abstract transport boundary so Unix-domain sockets remain a later hardening option.

Use an official Stream Deck Node plugin with SDK v2, Node 24, strict TypeScript, Rollup, and Vitest. Expose `POST /events` only on `127.0.0.1` with a per-run token in a user-local restricted endpoint file. Adapters normalize native events, use sub-200ms fail-open timeouts, and never block an agent CLI.

The normalized state model includes local session identity and target metadata only. Event types cover start, running, input/permission, completion, error, idle, end, and heartbeat. Display states are idle, thinking, needs-input, complete-unread, and error. Stale thinking becomes an advisory error; missing tmux panes are released; restart restoration is minimal and waits for fresh events.

Navigation only activates Ghostty and selects the captured tmux pane. It never approves, types, or synthesizes keystrokes. Multiple Ghostty windows or tmux clients must fail safely when targeting is ambiguous.

## Risks

- Local IPC requires token validation, restricted endpoint files, and redacted payloads.
- Tmux panes and endpoint records can become stale across restarts.
- Agent hooks must remain low-frequency, short-timeout, and fail open.
- Exact multi-window Ghostty targeting is outside the v1 guarantee.
- Payloads must never contain prompts, transcripts, tool output, secrets, or exported work data.

## Ready for Proposal

Yes — proceed with the localhost-HTTP MVP architecture, explicit local-only/privacy boundaries, and the normalized event model above.
