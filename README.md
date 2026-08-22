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

- macOS 12 or later with the [Stream Deck](https://www.elgato.com/stream-deck)
  app 7.1 or later.
- [Ghostty](https://ghostty.org) terminal.
- `tmux` with your coding-agent sessions running inside it.
- A physical Stream Deck (5+ keys). The plugin uses row 0, columns 0–4.

Source builds and development also require Node.js **24.x** and the
`streamdeck` CLI provided by the repository's pinned dependencies.

## Install

### One-time migration from pre-release builds

Before installing v0.1.0, remove any pre-release plugin using the legacy
`com.gentleman.ai-deck` identity. Keeping both identities installed would show
duplicate AI Deck plugins in Stream Deck.

Uninstall AI Deck in the Stream Deck app. If the legacy copy was linked for
development, unlink and delete it first:

```bash
npm exec -- streamdeck unlink --delete com.gentleman.ai-deck
```

The new public identity is `io.github.roger6vi.ai-deck`. Pre-release local slot
state belongs to the legacy identity, is not migrated automatically, and will
be recreated as new agent events arrive.

### Published release

For a published release, open the matching version on the
[GitHub Releases page](https://github.com/roger6vi/ai-deck/releases), download
`io.github.roger6vi.ai-deck.streamDeckPlugin`, open it, and approve installation in
the Stream Deck app. The `v0.1.0` release is not available until its signed tag
and GitHub release have been created.

If this Mac uses OpenCode, also download `ai-deck-opencode.js` from the same
release and install it without a source checkout:

```bash
mkdir -p "$HOME/.config/opencode/plugins"
if [ -f "$HOME/.config/opencode/plugins/ai-deck.js" ]; then
  cp -p "$HOME/.config/opencode/plugins/ai-deck.js" \
    "$HOME/.config/opencode/plugins/ai-deck.js.backup"
fi
install -m 0644 "$HOME/Downloads/ai-deck-opencode.js" \
  "$HOME/.config/opencode/plugins/ai-deck.js"
```

Adjust the downloaded file path if your browser saved it elsewhere. The backup
keeps the previous adapter available for rollback.

To build the same installer and adapter from source instead:

```bash
npm install
npm run pack
npm run install:opencode
```

`npm run pack` creates `dist/io.github.roger6vi.ai-deck.streamDeckPlugin`; it does
not install the plugin. Open that file and approve it in the Stream Deck app.
`install:opencode` is only needed on a Mac that runs OpenCode.

For development, link the built `.sdPlugin` directory instead of installing
the packaged artifact:

```bash
npm install
npm run build
npm exec -- streamdeck link io.github.roger6vi.ai-deck.sdPlugin
npm run restart:plugin
npm run install:opencode # only when this Mac runs OpenCode
```

`restart:plugin` starts or restarts an existing installation or development
link; it is not a first-install command. Once running, the plugin registers
`io.github.roger6vi.ai-deck` with the Stream Deck host, publishes an authenticated
`runtime/endpoint.json` under the installed plugin root, and starts the local
loopback server.

To import the bundled profile:

1. Open the Stream Deck app.
2. Right-click a profile → **Import Profile…**
3. Select `io.github.roger6vi.ai-deck.sdPlugin/Profiles/Local Agent Status.streamDeckProfile`.

## Uninstall / rollback

```bash
npm run uninstall:plugin
```

This unlinks and deletes `io.github.roger6vi.ai-deck` from the Stream Deck
app. To fully clean up:

```bash
rm -rf io.github.roger6vi.ai-deck.sdPlugin/bin \
       io.github.roger6vi.ai-deck.sdPlugin/runtime \
       dist
```

- `bin/` holds the current bundled runtime.
- `runtime/` holds the process-owned `endpoint.json` (0o600) and, when
  session persistence is active, `state.json` (0o600). Both live under a
  0o700 `runtime/` directory owned by the plugin's uid.
- `dist/` holds the packaged `.streamDeckPlugin` archive.

To roll back to a previously packaged plugin, restore the
`io.github.roger6vi.ai-deck.sdPlugin` directory from your backup and run
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

## Incident log

### 2026-08-04: disappearing and duplicate OpenCode session keys

**Outcome.** The fix preserves a session key when tmux pane enumeration is not
trustworthy and represents each OpenCode tmux pane with one stable deck entry
across root and child sessions.

**Symptoms.** Sessions appeared on Stream Deck, but pressing a session key
could make the key and session disappear while Ghostty and tmux were still
alive. Multiple OpenCode root/child native sessions in one pane could also
produce duplicate or stale entries, and one child becoming idle or failing
could incorrectly complete or fail the pane.

**Root cause.** Active logs recorded false `missing` outcomes for panes `%11`
twice, `%12` once, and `%10` once; `%10` and `%11` still existed.
`exactPaneRow` treated malformed or incomplete `tmux list-panes` output like
trustworthy proof of absence. `handlePhysicalKeyDown` then converted
`MISSING` to `CLEAR_SLOT`, parking the session and making the key appear to
close. Separately, OpenCode identity and lifecycle were tracked per native
session instead of per tmux pane, so roots, children, and older generations
could compete for the same pane lifecycle.

**Fix.** Only a complete, fully valid pane enumeration can now prove
`MISSING`. Malformed, mixed, truncated, or otherwise untrusted output returns
`UNAVAILABLE`, preserving the assignment and unread state; normal navigation
outcomes are recorded at info level while actual failures remain errors.
OpenCode now derives one identity from the tmux session and pane, aggregates
all root/child activity, keeps the pane running while any native session is
active, and converges older per-native-session entries when the next canonical
pane event arrives.

**Verification.** Regression coverage includes malformed and mixed enumeration
preserving a slot, info/error logging, pane-scoped identity, aggregate
lifecycle, adapter-restart sequence reset, and legacy entry convergence.

**Installation note.** After merge, use the packaged new-Mac installation
above and install the matching adapter on that Mac. `npm run pack` creates the
installer but does not install it, and `restart:plugin` alone cannot install an
absent plugin.

The work-Mac acceptance step (install with Claude enabled and record rollback
evidence) was **not executed or passed** as part of this change. After merge,
run the packaged installation on the work Mac, enable Claude with the commands
below, verify the integration there, and record the rollback evidence.

## Adapter events (per-tool integration)

The plugin listens for authenticated `POST /v1/events` events on the
loopback endpoint published in `runtime/endpoint.json`. To emit an
event from any tool wrapper (Codex, OpenCode, Claude, or a custom
shell hook), use the `runAdapterEmit` helper in `src/cli/adapter-emit.ts`.

During development you can invoke it directly:

```bash
AI_DECK_PLUGIN_ROOT=/absolute/path/to/io.github.roger6vi.ai-deck.sdPlugin \
  npx tsx src/cli/adapter-emit.ts \
    --source codex \
    --session-id "$SESSION_UUID" \
    --lifecycle started \
    --pane-id "$(tmux display-message -p '#{pane_id}')" \
    --session "$(tmux display-message -p '#{session_id}')"
```

Exit codes distinguish outcomes: `0` (emitted), `2` (rejected — bad
args or allowlist violation), `3` (unavailable — no plugin running),
`4` (timed-out — 200 ms budget exceeded), `5` (local error).

The `runAdapterEmit` function re-validates every candidate event
through the same allowlist parser used by the plugin, so no prohibited
field can ever leave the wrapper process.

The CLI is also bundled as `bin/adapter-emit.js`, a self-contained
script any Node runtime can execute directly:

```bash
AI_DECK_PLUGIN_ROOT=/absolute/path/to/io.github.roger6vi.ai-deck.sdPlugin \
  node io.github.roger6vi.ai-deck.sdPlugin/bin/adapter-emit.js \
    --source opencode --session-id "$SESSION_UUID" \
    --lifecycle started --pane-id "%1" --session '$0'
```

### OpenCode adapter

The bundled OpenCode adapter maps host session events to one aggregate
lifecycle per tmux pane. Busy/retry activity becomes `started`/`running`
(amber); the pane becomes `completed` (blue) or `error` (red) only when no
tracked root or child session remains active. Its stable version-4 UUID is
derived from the tmux session and pane identifiers, so native root/child
sessions share one key and older per-native-session entries converge after
the next pane event.

Install it after building:

```bash
npm run build && npm run install:opencode
```

This copies `bin/opencode-plugin.js` to
`~/.config/opencode/plugins/ai-deck.js`. The adapter resolves its tmux
pane from the `TMUX_PANE` environment and emits nothing when OpenCode
runs outside tmux. Overrides: `AI_DECK_PLUGIN_ROOT` (plugin directory)
and `AI_DECK_NODE` (Node binary used to spawn the emit CLI).

### Claude Code adapter

Claude Code has no in-process plugin surface, so the bundled adapter uses
plugin-managed hooks: `UserPromptSubmit` becomes `started` (amber), `Stop`
becomes `completed` (blue), and `SessionEnd` becomes `pane-disappeared`, which
releases the key. A finished subagent (`SubagentStop`) is not a finished turn
and emits nothing.

Every hook runs as a fresh process, so no state survives between
invocations and each submitted prompt reports `started` — the deck paints
`started` and `running` the same amber. Native Claude Code session ids are
deterministically encoded as version-4 UUIDs, so a conversation keeps its
key across turns.

The hooks ship as a Claude Code plugin, so the same install works on any
Mac without editing `~/.claude/settings.json` by hand:

```
/plugin marketplace add roger6vi/ai-deck
/plugin install ai-deck-claude@ai-deck
```

The plugin lives in `claude-code-plugin/`, and its hook commands locate
the script through `${CLAUDE_PLUGIN_ROOT}` rather than an absolute path.
Its bundle `claude-code-plugin/hooks/claude-hook.mjs` is a build output
that is committed on purpose — the plugin is distributed by cloning this
repository, so an ignored build artifact would never reach the other
machine. `npm run build` rewrites it and `npm run check:generated` fails
on a stale copy.

The hook always exits `0`, and its command ends in `|| true` for the case
where `node` is missing from `PATH`. A non-zero hook exit code is a
control signal for Claude Code — on `UserPromptSubmit` it discards the
prompt — so a Stream Deck that is closed, unreachable, or slow can never
break a Claude Code session. It emits nothing when Claude Code runs
outside tmux, and it finds the Stream Deck plugin at its standard install
path unless `AI_DECK_PLUGIN_ROOT` overrides it.

### Codex adapter

Codex names every lifecycle event separately, so the adapter ships as a
Codex plugin whose hook entries each declare their own lifecycle:
`UserPromptSubmit` → `started` (amber), `Stop` → `completed` (blue),
`PermissionRequest` → `completed`, and `SessionEnd` → `pane-disappeared`.
The script never guesses a lifecycle from the payload; it validates the
one its hook entry passed against an allowlist and ignores anything else.

`PermissionRequest` is why Codex needs no message parsing: where Claude
Code raises one `Notification` for both a permission prompt and mere
idling, Codex raises a dedicated event.

```
codex plugin marketplace add roger6vi/ai-deck
codex plugin add ai-deck-codex@ai-deck
```

The plugin lives in `codex-plugin/`, published by
`.agents/plugins/marketplace.json`, and locates its hook through
`${PLUGIN_ROOT}` — Codex's variable, not Claude Code's
`${CLAUDE_PLUGIN_ROOT}`. Its bundle is committed for the same reason the
Claude Code one is.

This adapter deliberately does not use Codex's `notify` program: that
setting holds a single command, and taking it would silently displace
whatever the user already had there.

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
| `npm run release -- current` | Publish the prepared first release through the signed canonical flow. |

Maintainers should read [`docs/releasing.md`](docs/releasing.md) before
publishing or incrementing a release.
