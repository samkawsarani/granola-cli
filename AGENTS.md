# AGENTS.md 

## Package manager

Use Bun instead of Node.js (bun not node, bun install not npm install) for all operations:

```bash
bun install              # install dependencies
bun test                 # run tests
bun run build            # build dist/granola.js
bun run src/cli.ts       # run CLI locally without building
```

## Commands

```bash
granola init                                        # interactive setup
granola list-notes                                  # list 10 most recent notes (JSON)
granola list-notes --limit 25                       # list up to 25 notes
granola list-notes --after 2026-01-01               # notes created after date
granola list-notes --page-size 5                    # single page of 5
granola get-note --id not_1d3tmYTlCICgjy            # full note JSON
granola get-note --id not_1d3tmYTlCICgjy --transcript  # include transcript
granola sync-notes                                  # sync all notes to local files
granola sync-notes --after 2026-01-01               # sync notes created after date
granola sync-notes --format json                    # sync as JSON instead of Markdown
granola sync-notes --force                          # re-sync all (ignores cached state)
granola install-skill                               # install agent skill (local project)
granola install-skill --global                      # install agent skill (global)
granola install-skill --claude                      # also link .claude without prompting
```

## Configuration

Global config is stored at `~/.config/granola/.env` (written by `granola init`).
A local `.env` in the working directory overrides the global config.

| Variable | Default | Description |
|---|---|---|
| `GRANOLA_API_KEY` | — | Granola API key (required) |
| `GRANOLA_NOTES_DIR` | `./granola-notes` | Directory for synced notes |
| `GRANOLA_FILENAME_FORMAT` | `{date}-{title}` | Filename template |
| `GRANOLA_USE_FOLDERS` | `false` | Organize by folder subfolders |
| `GRANOLA_SYNC_CONTENT` | `transcript` | `transcript` / `summary` / `both` |

## Library usage

```typescript
import { listNotes, listAllNotes, getNote, syncNotes } from "@samkawsarani/granola-cli";

// Paginated list (single page)
const page = await listNotes({ pageSize: 10, createdAfter: "2026-01-01" });
const notes = page.notes;

// All notes (auto-paginates)
const allNotes = await listAllNotes({ after: "2026-01-01", limit: 100 });

// Single note with transcript
const note = await getNote("not_1d3tmYTlCICgjy", true);

// Sync to disk
const result = await syncNotes({
  notesDir: "./granola-notes",
  syncContent: "transcript",  // "transcript" | "summary" | "both"
  force: false,
});
console.log(result); // { synced: 5, skipped: 12, moved: 0 }
```

## Project structure

```
skills/
  granola/
    SKILL.md   # Agent skill source (copied to dist/skills/... at build)
src/
  client.ts    # GranolaClient, APIError, getClient(), loadConfig()
  granola.ts   # All business logic and sync engine
  skill-path.ts  # readPackagedSkillMarkdown() — resolve packaged SKILL.md
  cli.ts       # CLI entry point (commander)
  index.ts     # Public library API re-exports
dist/
  lib/         # Published library (tsc from tsconfig.build.json)
  granola.js   # CLI bundle (bun build)
  skills/granola/SKILL.md
tests/
  granola.test.ts   # Unit + mocked HTTP tests (bun:test)
scripts/
  build.sh           # tsc → dist/lib; bundle src/cli.ts → dist/granola.js
  release.sh         # Bump version, update CHANGELOG, commit + tag
  extract-changelog.sh  # Extract release notes for GitHub releases
.github/
  workflows/
    publish.yml     # Triggered on tag push: test, build, GitHub release, npm publish
```

## Sync workflow

`sync-notes` is idempotent:
- New notes are fetched and written
- Notes with a changed `updated_at` are re-fetched and overwritten
- Notes that moved folders (when `GRANOLA_USE_FOLDERS=true`) are written to the new path and the old file is deleted
- Unchanged notes are skipped

State is persisted in `{GRANOLA_NOTES_DIR}/sync-state.json`. Do not edit manually.

Use `--force` to re-sync everything, for example after changing `GRANOLA_SYNC_CONTENT` or the filename format.

## Versioning & releasing

1. Add changes under `## [Unreleased]` in `CHANGELOG.md`
2. Run `./scripts/release.sh patch` (or `minor` / `major`)
   - This bumps `package.json`, renames `[Unreleased]` in `CHANGELOG.md`, commits, and tags
3. Run `git push origin main --tags`
   - GitHub Actions runs tests, builds, creates a GitHub release, and publishes to npm

## Note ID format

`not_` followed by 14 alphanumeric characters, e.g. `not_1d3tmYTlCICgjy`
