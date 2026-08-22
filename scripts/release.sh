#!/usr/bin/env bash
# Canonical signed release flow, adapted from the github-release skill template.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: RELEASE_NOTES_FILE=<path> ./scripts/release.sh [--yes] [--dry-run] <current|patch|minor|major>

Options:
  --yes, -y   Confirm a non-main release and skip the final prompt
  --dry-run   Validate prerequisites and report the planned release without mutation
  --help, -h  Show this help

Use "current" only to publish the package's existing version, such as the first v0.1.0 release.
HELP
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command '$1'."
}

confirm() {
  local prompt="$1"
  if [[ "$AUTO_YES" == true ]]; then return 0; fi
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

AUTO_YES=false
DRY_RUN=false
INCREMENT=""
for argument in "$@"; do
  case "$argument" in
    --yes|-y) AUTO_YES=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage; exit 0 ;;
    current|patch|minor|major)
      [[ -z "$INCREMENT" ]] || fail "only one version increment may be specified."
      INCREMENT="$argument"
      ;;
    *) fail "unknown argument '$argument'." ;;
  esac
done
[[ -n "$INCREMENT" ]] || fail "specify current, patch, minor, or major."

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a Git repository."
cd "$ROOT"
RELEASE_NOTES_FILE="${RELEASE_NOTES_FILE:-}"
[[ -n "$RELEASE_NOTES_FILE" ]] || fail "RELEASE_NOTES_FILE is required."
[[ -f "$RELEASE_NOTES_FILE" && -r "$RELEASE_NOTES_FILE" && -s "$RELEASE_NOTES_FILE" ]] || fail "release notes must be a readable, non-empty file: $RELEASE_NOTES_FILE"

require_command git
require_command gh
require_command node
require_command npm

CURRENT_VERSION="$(node -p "require('./package.json').version")"
[[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "package.json contains an invalid version: $CURRENT_VERSION"
IFS=. read -r major minor patch <<< "$CURRENT_VERSION"
case "$INCREMENT" in
  current) ;;
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
esac
NEW_VERSION="${major}.${minor}.${patch}"
TAG="v${NEW_VERSION}"
BRANCH="$(git branch --show-current)"

[[ -z "$(git status --porcelain=v1)" ]] || fail "working tree is dirty; commit or remove all changes before releasing."
if [[ "$BRANCH" != "main" ]]; then
  confirm "Release $TAG from '$BRANCH' and push the resulting commit to main?" || fail "release cancelled because the current branch is not main."
fi

[[ "$(git config --get gpg.format || true)" == "ssh" ]] || fail "Git SSH signing is not configured (gpg.format must be ssh)."
SIGNING_KEY="$(git config --get user.signingkey || true)"
[[ -n "$SIGNING_KEY" ]] || fail "Git SSH signing is not configured (user.signingkey is missing)."
if [[ "$SIGNING_KEY" != key::* ]]; then
  SIGNING_KEY_PATH="${SIGNING_KEY/#\~\//$HOME/}"
  [[ -f "$SIGNING_KEY_PATH" ]] || fail "signing key file does not exist: $SIGNING_KEY"
fi
gh auth status >/dev/null 2>&1 || fail "GitHub CLI authentication is unavailable."

git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null && fail "local tag $TAG already exists."
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "remote tag $TAG already exists."
else
  REMOTE_TAG_STATUS=$?
  [[ "$REMOTE_TAG_STATUS" -eq 2 ]] || fail "could not verify tag availability on origin."
fi

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
  [[ -n "$(git log --oneline "${LAST_TAG}..HEAD")" ]] || fail "there are no releasable commits after $LAST_TAG."
else
  [[ -n "$(git log --oneline HEAD)" ]] || fail "there are no commits to release."
fi

node scripts/sync-release-version.mjs --check "$CURRENT_VERSION"
node scripts/update-changelog.mjs --check "$NEW_VERSION" "$RELEASE_NOTES_FILE"

printf 'Release plan: %s -> %s from %s\n' "$CURRENT_VERSION" "$TAG" "$BRANCH"
if [[ "$DRY_RUN" == true ]]; then
  printf 'Dry run complete: prerequisites are valid; no tests, files, refs, or remotes were changed.\n'
  exit 0
fi

confirm "Run the signed release for $TAG?" || fail "release cancelled."

# Quality gates run against the clean source tree before release files or build output change.
npm test
npm run typecheck
npm run audit:production

# Version metadata must be final before any distributable bytes are generated.
node scripts/sync-release-version.mjs "$NEW_VERSION"
node scripts/update-changelog.mjs "$NEW_VERSION" "$RELEASE_NOTES_FILE"
npm run build
npm run generate
npm run check:generated
npm run validate:profile
npm run validate:plugin
rm -rf io.github.roger6vi.ai-deck.sdPlugin/bin.previous io.github.roger6vi.ai-deck.sdPlugin/bin.next .package-stage
node scripts/pack-plugin.mjs
npm run check:package
npm run smoke:runtime

STREAM_DECK_ASSET="dist/io.github.roger6vi.ai-deck.streamDeckPlugin"
OPENCODE_ASSET="dist/ai-deck-opencode.js"
BUILT_OPENCODE_ADAPTER="io.github.roger6vi.ai-deck.sdPlugin/bin/opencode-plugin.js"
[[ -s "$STREAM_DECK_ASSET" ]] || fail "Stream Deck installer was not produced."
[[ -s "$BUILT_OPENCODE_ADAPTER" ]] || fail "built OpenCode adapter was not produced."
cp "$BUILT_OPENCODE_ADAPTER" "$OPENCODE_ASSET"
cmp --silent "$BUILT_OPENCODE_ADAPTER" "$OPENCODE_ASSET" || fail "standalone OpenCode adapter does not match the built bundle."

# The tree was clean at preflight, so tracked build changes are release-generated.
git add -u
git add -- package.json package-lock.json io.github.roger6vi.ai-deck.sdPlugin/manifest.json \
  claude-code-plugin/.claude-plugin/plugin.json codex-plugin/.codex-plugin/plugin.json \
  .claude-plugin/marketplace.json CHANGELOG.md
git add -f -- "$STREAM_DECK_ASSET" "$OPENCODE_ASSET"

for asset in "$STREAM_DECK_ASSET" "$OPENCODE_ASSET"; do
  [[ "$(git hash-object "$asset")" == "$(git rev-parse ":$asset")" ]] || fail "$asset is not staged byte-for-byte."
done
git diff --cached --check
[[ -n "$(git diff --cached --name-only)" ]] || fail "the release produced no staged changes."

git commit -S -m "chore(release): $TAG"
git tag -s "$TAG" -m "$TAG"
git push origin HEAD:main
git push origin "$TAG"
gh release create "$TAG" --title "$TAG" --notes-file "$RELEASE_NOTES_FILE" --latest \
  "$STREAM_DECK_ASSET" "$OPENCODE_ASSET"

printf 'Published %s with both installable assets.\n' "$TAG"
