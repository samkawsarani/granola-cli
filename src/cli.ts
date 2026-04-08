import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createInterface } from "readline";
import { APIError, CONFIG_DIR, CONFIG_ENV, loadConfig } from "./client";
import { listNotes, listAllNotes, getNote, syncNotes } from "./granola";
import { readPackagedSkillMarkdown } from "./skill-path";

// Read version from package.json (inlined by bun build)
const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
const VERSION = pkg.version;

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function promptInput(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream & {
      setRawMode?: (mode: boolean) => void;
      isTTY?: boolean;
    };

    if (!stdin.isTTY || !stdin.setRawMode) {
      // Non-TTY fallback (piped input, CI)
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    let input = "";
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      if (char === "\r" || char === "\n") {
        stdin.removeListener("data", onData);
        stdin.setRawMode!(false);
        stdin.pause();
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (char === "\u0003") {
        process.exit(1);
      } else if (char === "\u007f" || char === "\b") {
        if (!hidden && input.length > 0) process.stdout.write("\b \b");
        input = input.slice(0, -1);
      } else if (char >= " ") {
        if (!hidden) process.stdout.write(char);
        input += char;
      }
    };

    stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdInit(): Promise<void> {
  console.log("Granola CLI setup\n");

  const apiKey = await promptInput("Granola API key: ", true);
  if (!apiKey) throw new Error("API key cannot be empty.");

  const notesDir =
    (await promptInput("Notes directory [~/granola-notes]: ")) || "~/granola-notes";

  console.log("\nFilename format tokens: {date}  {title}");
  console.log("Examples:");
  console.log("  '{date}-{title}'         → 2026-01-27-quarterly-yoghurt-budget-review.md");
  console.log("  '{title}'                → quarterly-yoghurt-budget-review.md");
  console.log("  '{date}/{title}'         → 2026-01-27/quarterly-yoghurt-budget-review.md");
  const filenameFormat =
    (await promptInput("Filename format [{date}-{title}]: ")) || "{date}-{title}";

  const useFoldersRaw = await promptInput("Organize notes into folder subfolders? [y/N]: ");
  const useFolders = useFoldersRaw.toLowerCase() === "y" || useFoldersRaw.toLowerCase() === "yes";

  console.log("\nWhat to include in synced files?");
  console.log("  transcript  — transcript only (default)");
  console.log("  summary     — summary only");
  console.log("  both        — summary + transcript");
  let syncContent = (await promptInput("Include [transcript]: ")).toLowerCase() || "transcript";
  if (!["transcript", "summary", "both"].includes(syncContent)) {
    console.log(`Unknown value '${syncContent}', defaulting to 'transcript'.`);
    syncContent = "transcript";
  }

  const existingContent = fs.existsSync(CONFIG_ENV)
    ? fs.readFileSync(CONFIG_ENV, "utf8")
    : "";
  const filteredLines = existingContent
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("GRANOLA_"));

  const newLines = [
    `GRANOLA_API_KEY=${apiKey}`,
    `GRANOLA_NOTES_DIR=${notesDir}`,
    `GRANOLA_FILENAME_FORMAT=${filenameFormat}`,
    `GRANOLA_USE_FOLDERS=${useFolders ? "true" : "false"}`,
    `GRANOLA_SYNC_CONTENT=${syncContent}`,
  ];

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_ENV, [...filteredLines, ...newLines].join("\n") + "\n");

  console.log(`\nConfiguration saved to ${CONFIG_ENV}`);
  console.log("Override any value by setting it in a local .env file.");
  console.log("Run `granola sync-notes` to sync your notes.");
}

async function cmdListNotes(options: {
  limit?: number;
  after?: string;
  before?: string;
  updatedAfter?: string;
  cursor?: string;
  pageSize?: number;
}): Promise<void> {
  let notes: Record<string, unknown>[];

  if (options.limit || options.after || options.before || options.updatedAfter) {
    notes = await listAllNotes({ after: options.after, limit: options.limit });
  } else {
    const result = await listNotes({
      pageSize: options.pageSize ?? 10,
      cursor: options.cursor,
      createdBefore: options.before,
      updatedAfter: options.updatedAfter,
    });
    notes = result.notes;
  }

  console.log(JSON.stringify(notes, null, 2));
}

async function cmdGetNote(options: { id: string; transcript: boolean }): Promise<void> {
  const note = await getNote(options.id, options.transcript);
  console.log(JSON.stringify(note, null, 2));
}

async function cmdSyncNotes(options: {
  after?: string;
  format?: string;
  limit?: number;
  force?: boolean;
}): Promise<void> {
  loadConfig();

  const notesDir = process.env.GRANOLA_NOTES_DIR ?? "~/granola-notes";
  const filenameFormat = process.env.GRANOLA_FILENAME_FORMAT ?? "{date}-{title}";
  const useFolders = ["true", "1", "yes"].includes(
    (process.env.GRANOLA_USE_FOLDERS ?? "false").toLowerCase(),
  );
  const syncContent = process.env.GRANOLA_SYNC_CONTENT ?? "transcript";

  const result = await syncNotes({
    notesDir,
    after: options.after,
    fmt: options.format,
    limit: options.limit,
    filenameFormat,
    useFolders,
    syncContent,
    force: options.force,
  });

  console.log(
    `Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.moved} moved.`,
  );
}

const SKILL_INSTALL_NAME = "granola";

function sameRealPath(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function throwIfLegacyFlatSkillEntry(entryPath: string, label: string): void {
  if (!fs.existsSync(entryPath)) return;
  const st = fs.statSync(entryPath);
  if (st.isFile()) {
    throw new Error(
      `Legacy install: ${label} is a file at ${entryPath}. Remove it, then run install-skill again. The skill now lives in ${SKILL_INSTALL_NAME}/SKILL.md.`,
    );
  }
}

function symlinkSkillDir(targetAbs: string, linkAbs: string): void {
  fs.symlinkSync(targetAbs, linkAbs, "dir");
}

function skillMdExists(skillMdPath: string): boolean {
  return fs.existsSync(skillMdPath) && fs.statSync(skillMdPath).isFile();
}

async function resolveClaudeSymlinkChoice(
  claudeFlag: boolean,
  claudeSkillDir: string,
): Promise<boolean> {
  if (claudeFlag) return true;
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  if (!stdin.isTTY) {
    console.log("Not a TTY: skipping .claude symlink. Pass --claude to create it.");
    return false;
  }
  const answer = await promptInput(
    `Create a symlink at ${claudeSkillDir} so Claude Code can load this skill? [Y/n]: `,
  );
  const a = answer.trim().toLowerCase();
  return a === "" || a === "y" || a === "yes";
}

async function cmdInstallSkill(options: { global: boolean; claude: boolean }): Promise<void> {
  const content = readPackagedSkillMarkdown();
  const agentsSkillsDir = options.global
    ? path.join(os.homedir(), ".agents", "skills")
    : path.join(process.cwd(), ".agents", "skills");
  const claudeSkillsDir = options.global
    ? path.join(os.homedir(), ".claude", "skills")
    : path.join(process.cwd(), ".claude", "skills");

  const agentsDirAbs = path.resolve(agentsSkillsDir);
  const claudeDirAbs = path.resolve(claudeSkillsDir);
  const agentsSkillDir = path.join(agentsDirAbs, SKILL_INSTALL_NAME);
  const agentsSkillMd = path.join(agentsSkillDir, "SKILL.md");
  const claudeSkillDir = path.join(claudeDirAbs, SKILL_INSTALL_NAME);
  const claudeSkillMd = path.join(claudeSkillDir, "SKILL.md");

  let skillsDirsAreSame = false;
  try {
    if (fs.existsSync(agentsDirAbs) && fs.existsSync(claudeDirAbs)) {
      skillsDirsAreSame = sameRealPath(agentsDirAbs, claudeDirAbs);
    }
  } catch {
    skillsDirsAreSame = false;
  }

  const agentsSkillMdPresent = skillMdExists(agentsSkillMd);

  if (skillsDirsAreSame) {
    throwIfLegacyFlatSkillEntry(agentsSkillDir, `"${SKILL_INSTALL_NAME}" under .agents/skills`);
    if (fs.existsSync(agentsSkillDir) && fs.statSync(agentsSkillDir).isDirectory()) {
      if (agentsSkillMdPresent) {
        console.log(
          `Skill already installed at ${agentsSkillMd} (.claude/skills and .agents/skills are the same directory).`,
        );
        return;
      }
      fs.writeFileSync(agentsSkillMd, content);
      console.log(`Skill written to ${agentsSkillMd}`);
      return;
    }
    fs.mkdirSync(agentsSkillDir, { recursive: true });
    fs.writeFileSync(agentsSkillMd, content);
    console.log(`Skill written to ${agentsSkillMd}`);
    return;
  }

  throwIfLegacyFlatSkillEntry(agentsSkillDir, `"${SKILL_INSTALL_NAME}" under .agents/skills`);
  throwIfLegacyFlatSkillEntry(claudeSkillDir, `"${SKILL_INSTALL_NAME}" under .claude/skills`);

  const agentsSkillDirExists = fs.existsSync(agentsSkillDir) && fs.statSync(agentsSkillDir).isDirectory();
  const claudeSkillDirExists = fs.existsSync(claudeSkillDir) && fs.statSync(claudeSkillDir).isDirectory();

  if (agentsSkillDirExists && claudeSkillDirExists) {
    if (sameRealPath(agentsSkillDir, claudeSkillDir)) {
      if (agentsSkillMdPresent) {
        console.log(`Skill already installed; ${claudeSkillDir} points to ${agentsSkillDir}.`);
        return;
      }
      fs.writeFileSync(agentsSkillMd, content);
      console.log(`Skill written to ${agentsSkillMd}`);
      return;
    }
    throw new Error(
      `Refusing to overwrite: both ${agentsSkillDir} and ${claudeSkillDir} exist and are not the same directory. Remove or rename one, then run install-skill again.`,
    );
  }

  if (!agentsSkillDirExists && claudeSkillDirExists) {
    throw new Error(
      `Refusing to overwrite: ${claudeSkillDir} already exists but ${agentsSkillDir} does not. Remove or rename the Claude path, then run install-skill again.`,
    );
  }

  const needsClaudeSymlink =
    (agentsSkillDirExists && !claudeSkillDirExists) ||
    (!agentsSkillDirExists && !claudeSkillDirExists);
  const linkClaude = needsClaudeSymlink
    ? await resolveClaudeSymlinkChoice(options.claude, claudeSkillDir)
    : false;

  if (agentsSkillDirExists && !claudeSkillDirExists) {
    if (!agentsSkillMdPresent) {
      fs.writeFileSync(agentsSkillMd, content);
      console.log(`Skill written to ${agentsSkillMd}`);
    }
    if (linkClaude) {
      fs.mkdirSync(path.dirname(claudeSkillDir), { recursive: true });
      symlinkSkillDir(agentsSkillDir, claudeSkillDir);
      console.log(`Linked ${claudeSkillDir} -> ${agentsSkillDir}`);
    } else {
      console.log("Skipped .claude symlink.");
    }
    return;
  }

  fs.mkdirSync(agentsSkillDir, { recursive: true });
  fs.writeFileSync(agentsSkillMd, content);
  console.log(`Skill written to ${agentsSkillMd}`);

  if (linkClaude) {
    fs.mkdirSync(path.dirname(claudeSkillDir), { recursive: true });
    symlinkSkillDir(agentsSkillDir, claudeSkillDir);
    console.log(`Linked ${claudeSkillDir} -> ${agentsSkillDir}`);
  } else {
    console.log("Skipped .claude symlink.");
  }
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("granola")
  .description("Granola API CLI — access and sync meeting notes")
  .version(VERSION);

program
  .command("init")
  .description("Interactive setup")
  .action(async () => {
    try {
      await cmdInit();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("list-notes")
  .description("List notes")
  .option("--limit <n>", "Maximum number of notes", parseInt)
  .option("--after <date>", "Created after (YYYY-MM-DD)")
  .option("--before <date>", "Created before (YYYY-MM-DD)")
  .option("--updated-after <date>", "Updated after (YYYY-MM-DD)")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--page-size <n>", "Page size", parseInt, 10)
  .action(async (opts) => {
    try {
      await cmdListNotes({
        limit: opts.limit,
        after: opts.after,
        before: opts.before,
        updatedAfter: opts.updatedAfter,
        cursor: opts.cursor,
        pageSize: opts.pageSize,
      });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("get-note")
  .description("Get a single note")
  .requiredOption("--id <id>", "Note ID")
  .option("--transcript", "Include transcript", false)
  .action(async (opts) => {
    try {
      await cmdGetNote({ id: opts.id, transcript: opts.transcript });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("sync-notes")
  .description("Sync notes to local files")
  .option("--after <date>", "Only sync notes created after (YYYY-MM-DD)")
  .option("--format <fmt>", "Output format: markdown or json", "markdown")
  .option("--limit <n>", "Maximum number of notes to sync", parseInt)
  .option("--force", "Re-sync all notes regardless of state", false)
  .action(async (opts) => {
    try {
      await cmdSyncNotes({
        after: opts.after,
        format: opts.format,
        limit: opts.limit,
        force: opts.force,
      });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("install-skill")
  .description(
    "Write .agents/skills/granola/SKILL.md; optionally symlink .claude/skills/granola (prompt or --claude)",
  )
  .option("--global", "Use ~/.agents/skills and ~/.claude/skills", false)
  .option("--claude", "Create the .claude skills symlink without prompting", false)
  .action(async (opts) => {
    try {
      await cmdInstallSkill({ global: opts.global, claude: opts.claude });
    } catch (err) {
      handleError(err);
    }
  });

function handleError(err: unknown): never {
  if (err instanceof APIError) {
    process.stderr.write(`API error ${err.statusCode}: ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(String(err) + "\n");
  }
  process.exit(1);
}

program.parseAsync(process.argv);
