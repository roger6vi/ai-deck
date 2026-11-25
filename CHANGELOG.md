# Changelog

## v0.2.0

### Summary

AI Deck now shows when Gentle Shell is working or has an unread response, and keeps tmux session titles readable and up to date.

### Features

- Install the optional Gentle Shell extension to turn a key amber on start and blue when the agent is ready for input again (#44).
- Discover live tmux panes even without an agent extension, and navigate back to their Ghostty terminal.

### Fixes

- Preserve accented tmux names, distinguish duplicate titles, and refresh renamed windows on discovery.
- Keep unread responses unread when navigation fails.

### Breaking changes

- The Stream Deck plugin ID is now `roger6vi.ai-deck`. Export and back up existing profiles, migrate them with `npm run migrate:profile`, then install the new plugin and import the migrated profiles. See the README for the full procedure.
- The OpenCode adapter and its standalone download have been removed (#45). Existing entries can still appear as live tmux panes, but no longer receive OpenCode lifecycle updates.

### Installation

Open `roger6vi.ai-deck.streamDeckPlugin` from the release assets. To enable Gentle Shell status, follow the README instructions to install `pi-extension/ai-deck.ts` and reload Gentle Shell inside tmux.

## Unreleased

### Changes

- Pins the SDK utilities' Zod dependency to 4.6.6 for GHSA-mrhx-c7xc-m3w5 while keeping Stream Deck SDK 2.1.0; public RPC validation and SDK compatibility are regression-tested.
- Discovers live tmux panes at startup and every five seconds, showing idle presence without requiring a particular terminal agent.
- Keeps keys and unread state unchanged when navigation does not succeed, and uses printable tmux fields without weakening malformed-output validation.
- Focuses the navigated Ghostty terminal by tty; older Ghostty versions only fall back when exactly one terminal exists.
- Adds three-line pane names in the property inspector while preserving visible session choices, unassigned sessions, and literal window-name fallbacks.
- Darkens green and amber key backgrounds for readable white titles.
- Uses the owner's canonical Stream Deck identity `roger6vi.ai-deck` (action `roger6vi.ai-deck.session-slot`) and the `roger6vi.ai-deck.sdPlugin` directory. This replaces the published `io.github.roger6vi.ai-deck` identity and the pre-release `com.gentleman.ai-deck` identity; the visible product name remains AI Deck.
- Adds `npm run migrate:profile` to migrate explicitly supplied exported `.streamDeckProfile` archives from either previous identity. It never edits the source export, installs or imports a profile, or touches Stream Deck application-support data.

### Installation

Install only the new identity. Export and back up the profiles you want to keep, migrate each one with `npm run migrate:profile`, uninstall the previous plugin identity, install the new archive, and import the migrated profiles. Runtime slot state is not migrated automatically.

## v0.1.0

### Summary

AI Deck brings private, local coding-agent session status to Stream Deck, with safe navigation back to the exact Ghostty tmux pane and no cloud relay or work-content collection.

### Features

- Shows up to five active Codex, OpenCode, and Claude sessions as color-coded keys.
- Preserves slot assignments and unread status through plugin restarts and recovers against trustworthy live tmux state.
- Ships OpenCode, Claude Code, and Codex adapters.
- Provides a standalone `ai-deck-opencode.js` adapter that can be installed on another Mac without cloning this repository.

### Changes

- Uses the public Stream Deck identity `io.github.roger6vi.ai-deck`, authored by Roger Vallverdú.
- Stream Deck navigation verifies the target pane before focusing Ghostty and selecting the tmux target.
- OpenCode root and child sessions in the same pane share one stable Stream Deck entry.

### Fixes

- Unreliable tmux enumeration no longer makes a live session key disappear.
- Older OpenCode identities converge into the pane-scoped identity without stale duplicates.
- Rapid busy/idle events retain their intended ordering, including after adapter restarts.

### Installation

Download both assets from the GitHub release:

- `io.github.roger6vi.ai-deck.streamDeckPlugin`: open it and approve installation in the Stream Deck app.
- `ai-deck-opencode.js`: if this Mac uses OpenCode, install it as `~/.config/opencode/plugins/ai-deck.js` using the README instructions.

If a pre-release build is installed under the legacy `com.gentleman.ai-deck` identity, uninstall or unlink it before installing v0.1.0. Its local slot state is not migrated and will be recreated by the new plugin identity.

### Requirements

- macOS 12 or later and Stream Deck app 7.1 or later.
- The Stream Deck CLI for source build, validation, and development workflows.
- Node.js 24.x for source workflows; release installation does not require a source checkout.
- Ghostty and tmux, with coding-agent sessions running inside tmux.
- A Stream Deck with at least five keys.

### Validation Caveat

The work-Mac acceptance procedure with Claude enabled was not previously executed or passed. The Claude adapter is included, but that environment-specific installation and rollback check remains deferred.
