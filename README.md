# AI Deck

A local-only Stream Deck plugin that surfaces the status of your active
coding-agent sessions (Codex, OpenCode, Claude) as color-coded keys on
the physical device.

- **Local per Mac.** No cloud relay, no cross-machine sync, no telemetry.
- **Content-free events.** Only status metadata and target identifiers
  cross the loopback boundary — never prompts, transcripts, tool output,
  commands, files, or secrets.
- **Privacy-safe by construction.** The event parser enforces a strict
  allowlist; unknown or prohibited fields are rejected before the
  reducer runs.

## Requirements

- macOS with the [Stream Deck](https://www.elgato.com/stream-deck) app
  installed and the `streamdeck` CLI on your `PATH`.
- Node.js **24.x** (the plugin runtime is built and verified against
  Node 24.18.0).
- [Ghostty](https://ghostty.org) terminal.
- `tmux` with your coding-agent sessions running inside it.
- A physical Stream Deck (5+ keys). The plugin uses row 0, columns 0–4.

## Install

From the repository root:

```bash
npm install
npm run build          # bundles src/plugin.ts to bin/plugin.js
npm run pack           # regenerates assets, validates, and packages
npm run restart:plugin # restarts the plugin in the Stream Deck app
```

After the restart, the plugin registers `com.gentleman.ai-deck` with the
Stream Deck host, publishes an authenticated `runtime/endpoint.json`
under the plugin root, and starts the local loopback server.

To import the bundled profile:

1. Open the Stream Deck app.
2. Right-click a profile → **Import Profile…**
3. Select `com.gentleman.ai-deck.sdPlugin/Profiles/Local Agent Status.streamDeckProfile`.

## Uninstall / rollback

```bash
npm run uninstall:plugin
```

This unlinks and deletes `com.gentleman.ai-deck` from the Stream Deck
app. To fully clean up:

```bash
rm -rf com.gentleman.ai-deck.sdPlugin/bin \
       com.gentleman.ai-deck.sdPlugin/runtime \
       dist
```

- `bin/` holds the current bundled runtime.
- `runtime/` holds the process-owned `endpoint.json` (0o600) and, when
  session persistence is active, `state.json` (0o600). Both live under a
  0o700 `runtime/` directory owned by the plugin's uid.
- `dist/` holds the packaged `.streamDeckPlugin` archive.

To roll back to a previously packaged plugin, restore the
`com.gentleman.ai-deck.sdPlugin` directory from your backup and run
`npm run restart:plugin`.

## Troubleshooting

**A key renders black.** The base64 SVG paint pipeline requires the
Stream Deck app to accept `data:image/svg+xml;base64,...` images with
named-color fills. Verify with `npm test tests/actions/session-slot`.

**Adapters cannot connect.** The plugin publishes
`runtime/endpoint.json` only after the loopback server is listening. A
missing, foreign-owned, or group/world-readable endpoint file causes
adapters to fail open. Restart the plugin with:

```bash
npm run restart:plugin
```

This creates a fresh bounded C1 server and a fresh
`runtime/endpoint.json` with a new port and token.

**Session slots show stale state after restart.** The plugin persists
its reducer state to `runtime/state.json` and reconciles against live
tmux panes at startup. If reconciliation cannot reach `tmux` (for
example because tmux is not running), the loaded state is preserved
as-is and the next authenticated event corrects any stale slot. To
force a clean start, delete `runtime/state.json` and restart the
plugin.

**Verify a clean local build.** Run the full gate:

```bash
npm run verify
```

This runs the vitest suite, `tsc --noEmit`, production-only
`npm audit`, plugin packaging and validation, and a bounded runtime
smoke test.

## Privacy boundary

The event contract lives in `src/core/types.ts` and `src/core/events.ts`.
Every incoming event is re-validated through `parseLocalAgentStatusEvent`
before it reaches the reducer or is emitted by an adapter. The parser
rejects any field outside the allowlist (schema version, event id,
source, session id, optional sequence, timestamp, lifecycle, target).
Rejected events never touch persisted state.

## Support scripts

| Script | Purpose |
|---|---|
| `npm run build` | Bundle `src/plugin.ts` to `bin/plugin.js`. |
| `npm run pack` | Build, regenerate assets/profile, validate, and package. |
| `npm run restart:plugin` | Restart the plugin in the Stream Deck app. |
| `npm run uninstall:plugin` | Unlink and delete the plugin from the Stream Deck app. |
| `npm run verify` | Full CI gate (tests + typecheck + audit + pack + smoke). |
| `npm test` | Vitest suite only. |
| `npm run typecheck` | Strict `tsc --noEmit`. |
