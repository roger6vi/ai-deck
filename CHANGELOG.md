# Changelog

## v0.1.0

### Summary

AI Deck provides a local-only Stream Deck view of coding-agent session status so users can see when work is active, complete, or needs attention without sending prompts, transcripts, commands, files, or secrets off the Mac.

### Features

- Shows up to five Codex, OpenCode, and Claude sessions as color-coded Stream Deck keys.
- Navigates safely back to the exact Ghostty tmux pane only when pane identity can be verified.
- Persists assignments and unread state across plugin restarts, then reconciles them against live tmux panes when reliable evidence is available.
- Includes adapters for OpenCode, Claude Code, and Codex, with a standalone OpenCode adapter asset for installation without a source checkout.

### Changes

- Establishes the first public Stream Deck identity as `io.github.roger6vi.ai-deck`, authored by Roger Vallverdú.
- Pre-release installations using legacy identity `com.gentleman.ai-deck` must be removed before v0.1.0; their local slot state is intentionally not migrated and will be recreated.

### Fixes

- Preserves session keys when tmux pane enumeration is malformed, incomplete, or unavailable instead of treating uncertain output as proof that a pane disappeared.
- Represents an OpenCode pane with one stable entry across root and child sessions, preventing duplicate, stale, or prematurely completed keys.
- Converges older OpenCode session identities and preserves correct event ordering across rapid lifecycle changes and adapter restarts.

### Validation Caveat

The work-Mac acceptance procedure with Claude enabled was not previously executed or passed. The Claude adapter is included, but that environment-specific installation and rollback check remains deferred.
