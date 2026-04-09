# Changelog

## [Unreleased]
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
