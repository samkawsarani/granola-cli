# Granola CLI

Use `granola` to access Granola meeting notes.

## Commands

- `granola list-notes [--after YYYY-MM-DD] [--updated-after YYYY-MM-DD] [--limit N]` — list recent notes (JSON array)
- `granola get-note --id <note_id>` — get full note with summary
- `granola get-note --id <note_id> --transcript` — include transcript
- `granola sync-notes [--after YYYY-MM-DD] [--force]` — sync all notes to local files
- `granola sync-notes --format json` — sync as JSON instead of Markdown

## Note ID format
`not_` followed by 14 alphanumeric characters, e.g. `not_1d3tmYTlCICgjy`

## Typical agent workflow
1. `granola list-notes --limit 10` to see recent notes
2. `granola get-note --id <id>` to read content
3. `granola sync-notes` to keep local files up to date (idempotent, re-runs detect updates and folder moves)

## Notes directory
Synced files go to `GRANOLA_NOTES_DIR` (default `./granola-notes`).
`sync-state.json` tracks what has been synced; do not edit manually.
Use `--force` to re-sync everything (e.g. after changing `GRANOLA_SYNC_CONTENT`).
