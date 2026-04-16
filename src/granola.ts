import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import { getClient } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoteListResult {
  notes: Record<string, unknown>[];
  hasMore: boolean;
  cursor?: string | null;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  moved: number;
}

export interface SyncState {
  notes: Record<
    string,
    {
      file: string;
      synced_at: string;
      updated_at: string;
      folder: string | null;
    }
  >;
}

// ---------------------------------------------------------------------------
// API wrappers
// ---------------------------------------------------------------------------

export async function listNotes(options: {
  pageSize?: number;
  cursor?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
} = {}): Promise<NoteListResult> {
  const params: Record<string, string | number> = {
    page_size: options.pageSize ?? 10,
  };
  if (options.cursor) params.cursor = options.cursor;
  if (options.createdAfter) params.created_after = options.createdAfter;
  if (options.createdBefore) params.created_before = options.createdBefore;
  if (options.updatedAfter) params.updated_after = options.updatedAfter;
  return getClient().get("/v1/notes", params) as Promise<NoteListResult>;
}

export async function listAllNotes(options: {
  after?: string;
  before?: string;
  updatedAfter?: string;
  limit?: number;
} = {}): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await listNotes({
      pageSize: 30,
      cursor,
      createdAfter: options.after,
      createdBefore: options.before,
      updatedAfter: options.updatedAfter,
    });
    let notes = page.notes;
    if (options.limit != null) {
      const remaining = options.limit - results.length;
      notes = notes.slice(0, remaining);
    }
    results.push(...notes);
    if (!page.hasMore || (options.limit != null && results.length >= options.limit)) break;
    cursor = page.cursor ?? undefined;
  }
  return results;
}

export async function getNote(
  noteId: string,
  includeTranscript = false,
): Promise<Record<string, unknown>> {
  const params = includeTranscript ? { include: "transcript" } : undefined;
  return getClient().get(`/v1/notes/${noteId}`, params) as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sanitizeTitle(title: string): string {
  let t = title.toLowerCase().replace(/ /g, "-");
  t = t.replace(/[^a-z0-9\-_]/g, "");
  t = t.replace(/-{2,}/g, "-");
  t = t.replace(/^[-_]+|[-_]+$/g, "");
  return t || "untitled";
}

export function sanitizeDirname(name: string): string {
  let n = name.replace(/[<>:"/\\|?*]/g, "-");
  n = n.replace(/-{2,}/g, "-");
  n = n.replace(/^[-_ ]+|[-_ ]+$/g, "");
  return n || "untitled";
}

export function makeFilename(
  title: string,
  dateStr: string,
  filenameFormat: string,
): string {
  const datePart = dateStr.slice(0, 10);
  const titlePart = sanitizeTitle(title || "untitled");
  return filenameFormat.replace("{date}", datePart).replace("{title}", titlePart);
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}

export function noteToMarkdown(
  note: Record<string, unknown>,
  syncContent = "transcript",
): string {
  const fm: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };

  const owner = (note.owner as Record<string, unknown> | null) ?? {};
  fm.owner = owner.email;

  const attendees = (note.attendees as Record<string, unknown>[] | null) ?? [];
  if (attendees.length > 0) {
    fm.attendees = attendees.map((a) => ({ name: a.name, email: a.email }));
  }

  const folders = (note.folder_membership as Record<string, unknown>[] | null) ?? [];
  if (folders.length > 0) {
    fm.folder_membership = folders.map((f) => ({ id: f.id, name: f.name }));
  }

  const cal = note.calendar_event as Record<string, unknown> | null | undefined;
  if (cal) {
    fm.calendar_event = {
      event_title: cal.event_title,
      scheduled_start_time: cal.scheduled_start_time,
      scheduled_end_time: cal.scheduled_end_time,
    };
  }

  const frontMatter = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  const parts = [`---\n${frontMatter}\n---`];

  if (syncContent === "summary" || syncContent === "both") {
    const summary = ((note.summary_markdown ?? note.summary_text ?? "") as string).trim();
    if (summary) parts.push(summary);
  }

  if (syncContent === "transcript" || syncContent === "both") {
    const transcript = (note.transcript as Record<string, unknown>[] | null) ?? [];
    if (transcript.length > 0) {
      const lines = ["## Transcript", ""];
      for (const entry of transcript) {
        const speaker = (entry.speaker as Record<string, unknown>) ?? {};
        const source = (speaker.source as string) ?? "speaker";
        const label = source === "microphone" ? "Me" : "Them";
        const ts = formatTimestamp((entry.start_time as string) ?? "");
        const text = (entry.text as string) ?? "";
        lines.push(`**[${ts}] ${label}:** ${text}`);
        lines.push("");
      }
      parts.push(lines.join("\n").trimEnd());
    }
  }

  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export function loadSyncState(notesDir: string): SyncState {
  const stateFile = path.join(notesDir, "sync-state.json");
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8")) as SyncState;
    } catch (e) {
      throw new Error(
        `Failed to parse sync state at ${stateFile}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { notes: {} };
}

export function saveSyncState(notesDir: string, state: SyncState): void {
  const stateFile = path.join(notesDir, "sync-state.json");
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export async function syncNotes(options: {
  notesDir: string;
  after?: string;
  fmt?: string;
  limit?: number;
  filenameFormat?: string;
  useFolders?: boolean;
  syncContent?: string;
  force?: boolean;
}): Promise<SyncResult> {
  const notesDir = options.notesDir.replace(/^~/, os.homedir());
  const fmt = options.fmt ?? "markdown";
  const filenameFormat = options.filenameFormat ?? "{date}-{title}";
  const useFolders = options.useFolders ?? false;
  const syncContent = options.syncContent ?? "transcript";
  const force = options.force ?? false;

  fs.mkdirSync(notesDir, { recursive: true });

  const state = loadSyncState(notesDir);
  const notesState = state.notes;

  const summaries = await listAllNotes({ after: options.after, limit: options.limit });
  const needTranscript = syncContent === "transcript" || syncContent === "both";

  let synced = 0;
  let skipped = 0;
  let moved = 0;

  for (const summary of summaries) {
    const noteId = summary.id as string;
    const title = (summary.title as string) || "untitled";
    const createdAt = (summary.created_at as string) || "";
    const updatedAt = (summary.updated_at as string) || "";

    const existing = notesState[noteId];
    const contentChanged = existing && existing.updated_at !== updatedAt;
    const isNew = !existing;

    if (!isNew && !contentChanged && !force) {
      skipped++;
      continue;
    }

    const fullNote = await getNote(noteId, needTranscript);

    const folderList = (fullNote.folder_membership as Record<string, unknown>[] | null) ?? [];
    let folderName: string | null = null;
    let fileDir = notesDir;

    if (useFolders && folderList.length > 0) {
      folderName = sanitizeDirname((folderList[0].name as string) ?? "");
      fileDir = path.join(notesDir, folderName);
    }

    const ext = fmt === "markdown" ? ".md" : ".json";
    const filename = makeFilename(title, createdAt, filenameFormat) + ext;
    const filePath = path.join(fileDir, filename);
    // Normalize to forward slashes for cross-platform consistency in sync-state.json
    const relPath = path.relative(notesDir, filePath).split(path.sep).join("/");

    if (existing && existing.file !== relPath) {
      const notesDirAbs = path.resolve(notesDir);
      const oldAbs = path.resolve(path.join(notesDir, existing.file));
      if (oldAbs.startsWith(notesDirAbs + path.sep) && fs.existsSync(oldAbs)) {
        fs.rmSync(oldAbs);
      }
      moved++;
    }

    fs.mkdirSync(fileDir, { recursive: true });

    if (fmt === "markdown") {
      fs.writeFileSync(filePath, noteToMarkdown(fullNote, syncContent));
    } else {
      fs.writeFileSync(filePath, JSON.stringify(fullNote, null, 2));
    }

    notesState[noteId] = {
      file: relPath,
      synced_at: new Date().toISOString(),
      updated_at: updatedAt,
      folder: folderName,
    };
    synced++;
  }

  saveSyncState(notesDir, state);
  return { synced, skipped, moved };
}
