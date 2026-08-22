# Publish a signed release

The canonical release command validates a clean repository, runs the project gates, synchronizes every version source, builds both downloadable assets, and publishes a signed commit, signed tag, and GitHub release.

## First release

Run this only after the release-preparation changes are reviewed and committed on `main`:

```bash
npm run release -- current
```

`current` publishes the existing package version as `v0.1.0`. It does not bump to `v0.1.1`.

## Later releases

Prepare a tracked notes file whose first line is exactly `## vX.Y.Z`, point `RELEASE_NOTES_FILE` at it, and select the increment:

```bash
RELEASE_NOTES_FILE=release-notes/v0.1.1.md ./scripts/release.sh patch
```

Use `minor` or `major` in the same way. Validate prerequisites without running tests or changing local or remote state:

```bash
RELEASE_NOTES_FILE=release-notes/v0.1.1.md ./scripts/release.sh --dry-run patch
```

## Required local setup

- Git must use SSH signing with `gpg.format=ssh` and a configured `user.signingkey`.
- GitHub CLI authentication must already be valid.
- Node.js 24, npm, and the repository dependencies must be available.
- The Stream Deck CLI must be available through the repository dependency.
- The working tree must be clean and contain commits not present in the latest local tag.

The script never prints signing keys or GitHub credentials, never force-pushes, and stops if the target tag exists locally or on `origin`. Running outside `main` requires explicit confirmation or `--yes`; the resulting release commit is still pushed to `main`.

## Release transaction

1. Validate notes, branch, worktree, signing, GitHub authentication, tag availability, releasable commits, and current version consistency.
2. Run tests, typecheck, and the production dependency audit before changing versions or building.
3. Synchronize package, lockfile, Stream Deck, Claude, Codex, and marketplace versions.
4. Update `CHANGELOG.md`, build, regenerate project assets, and run profile/plugin validation.
5. Package `dist/io.github.roger6vi.ai-deck.streamDeckPlugin`, validate its exact content allowlist, run the bounded runtime smoke gate, and copy the exact built OpenCode bundle to `dist/ai-deck-opencode.js`.
6. Stage and byte-check both assets, create the signed Conventional Commit and signed tag, push without force, and create the GitHub release with both assets.

If any command fails before the commit, inspect the working tree and generated output before retrying. Do not bypass a failed gate or move a published tag as part of the normal flow.
