# AGENTS.md

## Package manager

Use Bun instead of Node.js (bun not node, bun install not npm install) for all operations:

```bash
bun install              # install dependencies
bun test                 # run tests
bun run build            # build dist/granola.js
bun run src/cli.ts       # run CLI locally without building
```

## Architecture

Three layers, top to bottom:

- **`cli.ts`** — parses flags, calls business logic, prints JSON/text. No API calls directly.
- **`granola.ts`** — all business logic: `listNotes`, `listAllNotes`, `getNote`, `syncNotes`, `noteToMarkdown`, `loadSyncState`, `saveSyncState`. This is where sync decisions are made.
- **`client.ts`** — `GranolaClient` wraps `fetch`. Handles auth header, rate-limit retries (capped at 120s), and error parsing. `getClient()` returns a singleton; `loadConfig()` reads env vars.

Config resolution order (highest priority first): local `.env` in cwd → `~/.config/granola/.env` → environment variables.

The sync engine flow (`syncNotes`):
1. Load `sync-state.json` (maps note ID → `{ file, updatedAt }`)
2. Fetch all notes via `listAllNotes` (auto-paginating)
3. For each note: compare `updated_at` against state — skip if unchanged, re-fetch full note if changed, fetch new notes
4. Write files (Markdown or JSON), update state entries
5. If a note moved folders, delete old file (path validated to stay inside `notesDir`)
6. Save updated `sync-state.json`

`index.ts` re-exports the public library API from `granola.ts` and `client.ts`. The CLI is a separate bundle and is not part of the library.

`dist/` is gitignored — do not commit built files manually.

## Testing

All tests are in `tests/granola.test.ts` and use `bun:test`.

**What's mocked:** HTTP — tests use `mockClient()` which injects a fake `GranolaClient` via `__setClient()`. No real network calls in tests.

**What's real:** The filesystem — sync tests write to a real temp directory (`fs.mkdtempSync`), which is cleaned up in `afterEach`.

```bash
bun test                          # run all tests
bun test --watch                  # re-run on file change
bun test -t "sync_notes force"    # run a single test by name
```

To add a test: use `mockClient(handler)` where `handler` receives `(urlPath, body)` and returns a mock response object. Call `__setClient(client)` before the test, it's reset automatically in `afterEach`.

## Local dev workflow

```bash
bun run src/cli.ts list-notes     # run CLI without building
bun run build                     # produce dist/granola.js
node dist/granola.js list-notes   # test the built bundle

# End-to-end against the real API:
# Set GRANOLA_API_KEY in ~/.config/granola/.env or a local .env, then:
bun run src/cli.ts sync-notes --after 2026-01-01
```

## What to avoid

- **Do not edit `sync-state.json` manually.** It is the source of truth for sync deduplication. Corruption will cause re-syncs or silent skips. Use `--force` to reset sync state behaviour.
- **Do not add breaking changes to the public library API** (`index.ts` exports) without a major version bump. Downstream agents and user scripts depend on `listNotes`, `listAllNotes`, `getNote`, `syncNotes` staying stable.
- **Do not use `__setClient`** outside of tests — it's test-internal infrastructure.
- **Do not call the Granola API directly** from `cli.ts` — keep API calls inside `granola.ts` or `client.ts`.
- **Always update `CHANGELOG.md`** under `## [Unreleased]` when making any code changes.

## Error handling

`GranolaClient` throws `APIError` on non-2xx responses:

```typescript
import { APIError } from "../src/client";

try {
  await getNote("not_abc");
} catch (e) {
  if (e instanceof APIError) {
    e.statusCode; // number, e.g. 401, 404, 429
    e.message;    // raw response body text
  }
}
```

401 means bad/missing API key. 429 is rate-limited (client retries automatically up to 3 times).

## Versioning & releasing

1. Add changes under `## [Unreleased]` in `CHANGELOG.md`
2. Run `./scripts/release.sh patch` (or `minor` / `major`)
   - This bumps `package.json`, renames `[Unreleased]` in `CHANGELOG.md`, commits, and tags
3. Run `git push origin main --tags`
   - GitHub Actions runs tests, builds, creates a GitHub release, and publishes to npm

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
dist/          # gitignored — built by scripts/build.sh
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

## Configuration reference

Global config is stored at `~/.config/granola/.env` (written by `granola init`).
A local `.env` in the working directory overrides the global config.

| Variable | Default | Description |
|---|---|---|
| `GRANOLA_API_KEY` | — | Granola API key (required) |
| `GRANOLA_NOTES_DIR` | `./granola-notes` | Directory for synced notes |
| `GRANOLA_FILENAME_FORMAT` | `{date}-{title}` | Filename template |
| `GRANOLA_USE_FOLDERS` | `false` | Organize by folder subfolders |
| `GRANOLA_SYNC_CONTENT` | `transcript` | `transcript` / `summary` / `both` |

## Note ID format

`not_` followed by 14 alphanumeric characters, e.g. `not_1d3tmYTlCICgjy`

## CLI commands (user reference)

```bash
granola init                                        # interactive setup
granola list-notes                                  # list 10 most recent notes (JSON)
granola list-notes --limit 25                       # list up to 25 notes
granola list-notes --after 2026-01-01               # notes created after date
granola list-notes --before 2026-02-01              # notes created before date
granola list-notes --updated-after 2026-01-01       # notes updated after date
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
granola install-skill --force                       # overwrite existing SKILL.md (reinstall)
```

## Library usage (user reference)

```typescript
import { listNotes, listAllNotes, getNote, syncNotes } from "@samkawsarani/granola-cli";

// Paginated list (single page)
const page = await listNotes({ pageSize: 10, createdAfter: "2026-01-01" });
const notes = page.notes;

// All notes (auto-paginates)
const allNotes = await listAllNotes({ after: "2026-01-01", before: "2026-03-01", updatedAfter: "2026-01-01", limit: 100 });

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
