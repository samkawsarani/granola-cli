# Changelog

## [Unreleased]

## [1.1.0] - 2026-04-15

- Fix transcript speaker labels: `microphone` source now renders as `Me`, all other sources as `Them`.
- Add `--force` flag to `install-skill`: overwrites an existing SKILL.md instead of skipping.
- Document `--updated-after` flag in `granola` agent skill.

## [1.0.5] - 2026-04-09

- Fix `listAllNotes` to correctly forward `before` and `updatedAfter` filter options (were previously dropped).
- Fix `list-notes` CLI command to pass `--before` and `--updated-after` flags through to `listAllNotes`.
- Cap rate-limit retry wait at 120 seconds (was unbounded based on `Retry-After` header).
- Improve `loadSyncState` error message when `sync-state.json` is malformed JSON.
- Fix path traversal vulnerability in `syncNotes`: validate old file path stays inside notes directory before deleting.

## [1.0.4] - 2026-04-09
- CI: upgrade GitHub Actions to Node 24-compatible versions (checkout v5, setup-node v6).


## [1.0.3] - 2026-04-08

- Default `GRANOLA_NOTES_DIR` when unset is `./granola-notes` (cwd) instead of `~/granola-notes`.

## [1.0.2] - 2026-04-08
- fixed readme installation instructions for bun

## [1.0.1] - 2026-04-08

- Fix `extract-changelog.sh` regex parsing for bash `[[ =~ ]]` on CI.
- Publish workflow: delete existing GitHub release before create when re-tagging the same version.

## [1.0.0] - 2026-04-08

Initial release.
