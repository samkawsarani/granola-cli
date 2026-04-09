import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GranolaClient, APIError, __setClient } from "../src/client";
import {
  makeFilename,
  noteToMarkdown,
  loadSyncState,
  saveSyncState,
  listNotes,
  listAllNotes,
  getNote,
  syncNotes,
} from "../src/granola";
import { readPackagedSkillMarkdown } from "../src/skill-path";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOTE_SUMMARY = {
  id: "not_1d3tmYTlCICgjy",
  object: "note",
  title: "Quarterly Yoghurt Budget Review",
  owner: { name: "Oat Benson", email: "oat@granola.ai" },
  created_at: "2026-01-27T15:30:00Z",
  updated_at: "2026-01-27T16:45:00Z",
};

const FULL_NOTE = {
  ...NOTE_SUMMARY,
  attendees: [
    { name: "Oat Benson", email: "oat@granola.ai" },
    { name: "Raisin Patel", email: "raisin@granola.ai" },
  ],
  folder_membership: [
    { id: "fol_4y6LduVdwSKC27", object: "folder", name: "Top secret recipes" },
  ],
  calendar_event: {
    event_title: "Quarterly yoghurt budget review",
    invitees: [{ email: "raisin@granola.ai" }],
    organiser: "oat@granola.ai",
    calendar_event_id: "abc123",
    scheduled_start_time: "2026-01-27T15:30:00Z",
    scheduled_end_time: "2026-01-27T16:30:00Z",
  },
  summary_text: "The quarterly yoghurt budget review was a success.",
  summary_markdown: "## Summary\n\nThe review was a success.",
  transcript: null,
};

const FULL_NOTE_WITH_TRANSCRIPT = {
  ...FULL_NOTE,
  transcript: [
    {
      speaker: { source: "microphone" },
      text: "Greek is the only yoghurt that deserves us.",
      start_time: "2026-01-27T15:30:00Z",
      end_time: "2026-01-27T15:31:00Z",
    },
    {
      speaker: { source: "speaker" },
      text: "Regular yoghurt is just milk that gave up halfway.",
      start_time: "2026-01-27T15:31:00Z",
      end_time: "2026-01-27T15:32:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock client helper
// ---------------------------------------------------------------------------

type GetHandler = (urlPath: string, params?: Record<string, string | number>) => Promise<unknown>;

function mockClient(handler: GetHandler): GranolaClient {
  const client = new GranolaClient("test-key");
  client.get = handler;
  return client;
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `granola-test-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  __setClient(null);
});

// ---------------------------------------------------------------------------
// Unit tests — no HTTP
// ---------------------------------------------------------------------------

describe("readPackagedSkillMarkdown", () => {
  test("returns non-empty markdown with stable heading", () => {
    const md = readPackagedSkillMarkdown();
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("# Granola CLI");
  });
});

describe("makeFilename", () => {
  test("default format", () => {
    const result = makeFilename(
      "Quarterly Yoghurt Budget Review!",
      "2026-01-27T15:30:00Z",
      "{date}-{title}",
    );
    expect(result).toBe("2026-01-27-quarterly-yoghurt-budget-review");
  });

  test("custom format", () => {
    const result = makeFilename("My Meeting", "2026-03-15T10:00:00Z", "{title}_{date}");
    expect(result).toBe("my-meeting_2026-03-15");
  });
});

describe("noteToMarkdown", () => {
  test("has front matter", () => {
    const md = noteToMarkdown(FULL_NOTE as Record<string, unknown>, "transcript");
    expect(md).toContain("---");
    expect(md).toContain("id: not_1d3tmYTlCICgjy");
    expect(md).toContain("title: Quarterly Yoghurt Budget Review");
    expect(md).toContain("oat@granola.ai");
  });

  test("transcript only — no summary", () => {
    const md = noteToMarkdown(FULL_NOTE_WITH_TRANSCRIPT as Record<string, unknown>, "transcript");
    expect(md).toContain("## Transcript");
    expect(md).toContain("Microphone");
    expect(md).toContain("Speaker");
    expect(md).toContain("15:30:00");
    expect(md).not.toContain("## Summary");
  });

  test("summary only", () => {
    const md = noteToMarkdown(FULL_NOTE as Record<string, unknown>, "summary");
    expect(md).toContain("## Summary");
    expect(md).not.toContain("## Transcript");
  });

  test("both summary and transcript", () => {
    const md = noteToMarkdown(FULL_NOTE_WITH_TRANSCRIPT as Record<string, unknown>, "both");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Transcript");
  });
});

describe("sync state", () => {
  test("roundtrip", () => {
    const dir = tmpDir();
    const state = {
      notes: {
        "not_abc": {
          file: "2026-01-27-my-meeting.md",
          synced_at: "2026-01-27T17:00:00+00:00",
          updated_at: "2026-01-27T16:45:00Z",
          folder: null,
        },
      },
    };
    saveSyncState(dir, state);
    const loaded = loadSyncState(dir);
    expect(loaded.notes["not_abc"].file).toBe("2026-01-27-my-meeting.md");
    expect(loaded.notes["not_abc"].updated_at).toBe("2026-01-27T16:45:00Z");
  });
});

// ---------------------------------------------------------------------------
// Mocked API tests
// ---------------------------------------------------------------------------

test("list_notes API", async () => {
  const client = mockClient(async () => ({
    notes: [NOTE_SUMMARY],
    hasMore: false,
    cursor: null,
  }));
  __setClient(client);

  const result = await listNotes({ pageSize: 10 });
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0].id).toBe("not_1d3tmYTlCICgjy");
  expect(result.hasMore).toBe(false);
});

test("list_notes pagination", async () => {
  const note2 = { ...NOTE_SUMMARY, id: "not_2nd0000000000" };
  let calls = 0;

  const client = mockClient(async () => {
    calls++;
    if (calls === 1) return { notes: [NOTE_SUMMARY], hasMore: true, cursor: "page2" };
    return { notes: [note2], hasMore: false, cursor: null };
  });
  __setClient(client);

  const all = await listAllNotes();
  expect(all).toHaveLength(2);
  expect(all[0].id).toBe("not_1d3tmYTlCICgjy");
  expect(all[1].id).toBe("not_2nd0000000000");
});

test("get_note without transcript", async () => {
  const client = mockClient(async () => FULL_NOTE);
  __setClient(client);

  const note = await getNote("not_1d3tmYTlCICgjy");
  expect(note.id).toBe("not_1d3tmYTlCICgjy");
  expect(note.summary_text).toBe("The quarterly yoghurt budget review was a success.");
});

test("get_note with transcript", async () => {
  const client = mockClient(async () => FULL_NOTE_WITH_TRANSCRIPT);
  __setClient(client);

  const note = await getNote("not_1d3tmYTlCICgjy", true);
  expect(note.transcript).not.toBeNull();
  expect((note.transcript as unknown[]).length).toBe(2);
});

test("sync_notes writes markdown files", async () => {
  const dir = tmpDir();
  let getNoteCalled = false;

  const client = mockClient(async (urlPath) => {
    if (urlPath === "/v1/notes") return { notes: [NOTE_SUMMARY], hasMore: false, cursor: null };
    getNoteCalled = true;
    return FULL_NOTE_WITH_TRANSCRIPT;
  });
  __setClient(client);

  const result = await syncNotes({ notesDir: dir, syncContent: "transcript" });
  expect(result.synced).toBe(1);
  expect(result.skipped).toBe(0);
  expect(getNoteCalled).toBe(true);

  const state = loadSyncState(dir);
  expect(state.notes["not_1d3tmYTlCICgjy"]).toBeDefined();

  const relPath = state.notes["not_1d3tmYTlCICgjy"].file;
  const mdPath = path.join(dir, relPath);
  expect(fs.existsSync(mdPath)).toBe(true);

  const content = fs.readFileSync(mdPath, "utf8");
  expect(content).toContain("## Transcript");
  expect(content).toContain("Microphone");
});

test("sync_notes deduplication", async () => {
  const dir = tmpDir();

  const client = mockClient(async (urlPath) => {
    if (urlPath === "/v1/notes") return { notes: [NOTE_SUMMARY], hasMore: false, cursor: null };
    return FULL_NOTE_WITH_TRANSCRIPT;
  });
  __setClient(client);

  const first = await syncNotes({ notesDir: dir, syncContent: "transcript" });
  const second = await syncNotes({ notesDir: dir, syncContent: "transcript" });

  expect(first.synced).toBe(1);
  expect(second.synced).toBe(0);
  expect(second.skipped).toBe(1);
});

test("sync_notes updated_at triggers resync", async () => {
  const dir = tmpDir();
  const updatedNote = { ...NOTE_SUMMARY, updated_at: "2026-02-01T10:00:00Z" };
  let callCount = 0;

  const client = mockClient(async (urlPath) => {
    if (urlPath === "/v1/notes") {
      callCount++;
      return {
        notes: [callCount === 1 ? NOTE_SUMMARY : updatedNote],
        hasMore: false,
        cursor: null,
      };
    }
    return FULL_NOTE_WITH_TRANSCRIPT;
  });
  __setClient(client);

  const first = await syncNotes({ notesDir: dir });
  const second = await syncNotes({ notesDir: dir });

  expect(first.synced).toBe(1);
  expect(second.synced).toBe(1);
  expect(second.skipped).toBe(0);
});

test("sync_notes folder move", async () => {
  const dir = tmpDir();

  const noteInFolderA = {
    ...NOTE_SUMMARY,
    attendees: [],
    calendar_event: null,
    summary_text: "x",
    summary_markdown: null,
    transcript: null,
    folder_membership: [{ id: "fol_aaaaaaaaaaaa00", object: "folder", name: "Folder A" }],
  };
  const noteInFolderB = {
    ...noteInFolderA,
    updated_at: "2026-02-01T10:00:00Z",
    folder_membership: [{ id: "fol_bbbbbbbbbbbb00", object: "folder", name: "Folder B" }],
  };

  let listCallCount = 0;
  let getCallCount = 0;

  const client = mockClient(async (urlPath) => {
    if (urlPath === "/v1/notes") {
      listCallCount++;
      const note =
        listCallCount === 1
          ? { ...NOTE_SUMMARY, updated_at: "2026-01-27T16:45:00Z" }
          : { ...NOTE_SUMMARY, updated_at: "2026-02-01T10:00:00Z" };
      return { notes: [note], hasMore: false, cursor: null };
    }
    getCallCount++;
    return getCallCount === 1 ? noteInFolderA : noteInFolderB;
  });
  __setClient(client);

  const first = await syncNotes({ notesDir: dir, useFolders: true });
  const second = await syncNotes({ notesDir: dir, useFolders: true });

  expect(first.synced).toBe(1);
  expect(second.moved).toBe(1);

  const state = loadSyncState(dir);
  const currentRel = state.notes["not_1d3tmYTlCICgjy"].file;
  expect(currentRel).toContain("Folder B");
  expect(fs.existsSync(path.join(dir, currentRel))).toBe(true);
});

test("sync_notes force", async () => {
  const dir = tmpDir();

  const client = mockClient(async (urlPath) => {
    if (urlPath === "/v1/notes") return { notes: [NOTE_SUMMARY], hasMore: false, cursor: null };
    return FULL_NOTE_WITH_TRANSCRIPT;
  });
  __setClient(client);

  await syncNotes({ notesDir: dir });
  const second = await syncNotes({ notesDir: dir, force: true });

  expect(second.synced).toBe(1);
  expect(second.skipped).toBe(0);
});

test("client 429 retry", async () => {
  let calls = 0;
  const realFetch = global.fetch;

  global.fetch = (async (_url: string | URL | Request) => {
    calls++;
    if (calls === 1) {
      return new Response("{}", { status: 429, headers: { "Retry-After": "0" } });
    }
    return new Response(
      JSON.stringify({ notes: [NOTE_SUMMARY], hasMore: false, cursor: null }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const client = new GranolaClient("test-key");
    const result = (await client.get("/v1/notes")) as {
      notes: typeof NOTE_SUMMARY[];
      hasMore: boolean;
    };
    expect(calls).toBe(2);
    expect(result.notes[0].id).toBe("not_1d3tmYTlCICgjy");
  } finally {
    global.fetch = realFetch;
  }
});
