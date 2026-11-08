import type Anthropic from "@anthropic-ai/sdk";
import { execFile, execFileSync, spawn } from "node:child_process";
import { readFile as fsReadFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The Jobsite Twin repo root: this file is <repo>/agent-lab/src/tools.ts.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MAX_BYTES = 100_000;
const MAX_MATCHES = 50;
const MAX_LINE_CHARS = 300;
const TEST_TIMEOUT_MS = 3 * 60_000;
const TEST_TAIL_LINES = 50;

// ---------------------------------------------------------------------------
// Tool definitions: what the model sees (name, when to use it, input shape).
// ---------------------------------------------------------------------------

export const readFileTool: Anthropic.Beta.BetaTool = {
  name: "read_file",
  description:
    "Read a text file from the Jobsite Twin repository and return its contents as UTF-8 text. " +
    "Use this whenever you need to know what a file in the repository says. " +
    "The path is relative to the repository root (for example \"README.md\" or \"server/src/schema.graphql\"). " +
    "Only files inside the repository can be read; .env files, git-ignored files (such as node_modules) " +
    `and files larger than ${MAX_BYTES} bytes are refused with an error.`,
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the repository root, e.g. \"README.md\".",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  strict: true,
};

export const searchCodeTool: Anthropic.Beta.BetaTool = {
  name: "search_code",
  description:
    "Search the Jobsite Twin repository for an exact piece of text and return the matching lines as " +
    "`path:line:text`, with paths relative to the repository root. " +
    "Use this to find where something is defined or used before reading whole files. " +
    "The pattern is matched literally and case-sensitively (it is not a regular expression). " +
    `At most ${MAX_MATCHES} matches are returned; if there are more, the result says how many, ` +
    "and a more specific pattern will narrow them. " +
    "Git-ignored files (such as node_modules and build output) and .env files are not searched.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The exact text to search for, e.g. \"function describeApiError\".",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  strict: true,
};

export const editFileTool: Anthropic.Beta.BetaTool = {
  name: "edit_file",
  description:
    "Edit a file in the Jobsite Twin repository by replacing one exact snippet of text with new text. " +
    "old_text must match the file exactly, including whitespace and indentation, and must appear exactly once: " +
    "if it is not found, or appears more than once, nothing is changed and an error says which. " +
    "To make old_text unique, include more of the surrounding lines. Read the file first so old_text is exact. " +
    "The path is relative to the repository root. Test files (*.spec.ts), .env files, git-ignored files " +
    `and files larger than ${MAX_BYTES} bytes cannot be edited.`,
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the repository root, e.g. \"src/app/app.ts\".",
      },
      old_text: {
        type: "string",
        description: "The exact text to replace. Must appear exactly once in the file.",
      },
      new_text: {
        type: "string",
        description: "The text to put in its place (may be empty to delete old_text).",
      },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  },
  strict: true,
};

export const runTestsTool: Anthropic.Beta.BetaTool = {
  name: "run_tests",
  description:
    "Run the Jobsite Twin frontend unit tests (`npx ng test --watch=false`, Vitest) from the repository root. " +
    `Returns the exit code (0 means every test passed) and the last ${TEST_TAIL_LINES} lines of output. ` +
    "Use it to check that the code works, for example after edit_file. Takes no input. " +
    "Usually finishes in seconds; it is stopped after 3 minutes.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  strict: true,
};

// Every tool offered to the model.
export const tools = [readFileTool, searchCodeTool, editFileTool, runTestsTool];

// Run the tool the model asked for. Throws an Error with a readable message for
// an unknown tool or bad input; the loop reports that back to the model.
export async function runTool(name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case readFileTool.name:
      return readFile(stringArg(args, "path"));
    case searchCodeTool.name:
      return searchCode(stringArg(args, "pattern"));
    case editFileTool.name:
      return editFile(stringArg(args, "path"), stringArg(args, "old_text"), stringArg(args, "new_text"));
    case runTestsTool.name:
      return runTests();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`Missing string input \`${key}\`.`);
  return value;
}

// ---------------------------------------------------------------------------
// Implementations: what actually runs. Each throws an Error with a readable
// message on any refusal.
// ---------------------------------------------------------------------------

export async function readFile(requested: string): Promise<string> {
  const { target } = await resolveRepoFile(requested);
  return fsReadFile(target, "utf8");
}

export async function searchCode(pattern: string): Promise<string> {
  if (pattern === "") throw new Error("pattern must not be empty.");
  const root = await realpath(REPO_ROOT);

  let stdout: string;
  try {
    // git grep skips git-ignored files; --untracked also searches new files
    // that aren't committed yet. The pathspecs exclude every .env file.
    ({ stdout } = await execFileAsync(
      "git",
      [
        "grep", "--untracked", "-n", "-I", "--fixed-strings", "-e", pattern,
        "--", ".", ":(exclude,glob)**/.env", ":(exclude,glob)**/.env.*",
      ],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 },
    ));
  } catch (error) {
    const { code, stderr } = error as { code?: unknown; stderr?: string };
    if (code === 1) return `No matches for "${pattern}".`; // git grep: 1 = nothing found
    throw new Error(`Search failed: ${stderr?.trim() || String(error)}`);
  }

  const lines = stdout.split("\n").filter(Boolean);
  const shown = lines
    .slice(0, MAX_MATCHES)
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} …` : line));
  const more = lines.length - shown.length;
  return shown.join("\n") + (more > 0 ? `\n(${more} more matches not shown; use a more specific pattern.)` : "");
}

export async function editFile(requested: string, oldText: string, newText: string): Promise<string> {
  // Guardrail: tests define "correct"; the agent must fix the code, not the tests.
  // Checked on the requested path and again after symlinks are resolved.
  if (isTestFile(requested)) throw new Error(TEST_FILE_REFUSAL);
  if (oldText === "") throw new Error("old_text must not be empty.");
  const { target } = await resolveRepoFile(requested);
  if (isTestFile(target)) throw new Error(TEST_FILE_REFUSAL);
  const content = await fsReadFile(target, "utf8");

  const count = countOccurrences(content, oldText);
  if (count === 0) {
    throw new Error(
      `old_text was not found in ${requested}. It must match exactly, including whitespace; read the file and copy it.`,
    );
  }
  if (count > 1) {
    throw new Error(
      `old_text appears ${count} times in ${requested}; include more surrounding text so it matches exactly once.`,
    );
  }

  // Splice by position rather than String.replace, which treats `$` in newText specially.
  const index = content.indexOf(oldText);
  await writeFile(target, content.slice(0, index) + newText + content.slice(index + oldText.length), "utf8");
  return `Edited ${requested}: replaced 1 occurrence.`;
}

export function runTests(): Promise<string> {
  return new Promise((resolve, reject) => {
    // The tests don't need the API key, so don't hand it to them.
    const { ANTHROPIC_API_KEY: _apiKey, ...env } = process.env;
    const child = spawn("npx", ["ng", "test", "--watch=false"], {
      cwd: REPO_ROOT,
      env: { ...env, NG_CLI_ANALYTICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so the timeout can stop npx and everything it started.
      detached: true,
    });

    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // already exited
      }
    }, TEST_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the tests: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const tail = stripAnsi(output).trimEnd().split("\n").slice(-TEST_TAIL_LINES).join("\n");
      const status = timedOut
        ? `timed out after ${TEST_TIMEOUT_MS / 60_000} minutes and was stopped`
        : `exit code: ${code ?? signal}`;
      // A failing test run is a normal result for the model to read, not a tool error.
      resolve(`${status}\n--- last ${TEST_TAIL_LINES} lines of output ---\n${tail}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Guards shared by the file tools.
// ---------------------------------------------------------------------------

// Resolve a model-supplied path to a real file inside the repo, or throw.
async function resolveRepoFile(requested: string): Promise<{ target: string }> {
  if (isEnvFile(requested)) throw new Error(`Refused: ${requested} is an .env file.`);

  const root = await realpath(REPO_ROOT);

  // Resolve symlinks before checking, so a link can't point outside the repo
  // (or at an .env file under another name).
  let target: string;
  try {
    target = await realpath(path.resolve(root, requested));
  } catch {
    throw new Error(`File not found: ${requested}`);
  }

  const relative = path.relative(root, target);
  if (relative === "") {
    throw new Error(`Not a file: ${requested}`);
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refused: ${requested} is outside the repository.`);
  }
  if (isEnvFile(target)) {
    throw new Error(`Refused: ${requested} is an .env file.`);
  }
  if (isGitIgnored(root, relative)) {
    throw new Error(`Refused: ${requested} is git-ignored (it may hold secrets or build output).`);
  }

  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error(`Not a file: ${requested}`);
  }
  if (info.size > MAX_BYTES) {
    throw new Error(`Refused: ${requested} is ${info.size} bytes (limit ${MAX_BYTES}).`);
  }

  return { target };
}

const TEST_FILE_REFUSAL = "Editing test files is not allowed.";

// *.spec.ts, case-insensitively (macOS file names are case-insensitive).
function isTestFile(filePath: string): boolean {
  return /\.spec\.ts$/i.test(path.basename(filePath));
}

// .env, .env.local, .env.example, ...
function isEnvFile(filePath: string): boolean {
  return /^\.env(\..*)?$/.test(path.basename(filePath));
}

// `git check-ignore -q` exits 0 when the path is ignored, 1 when it is not.
function isGitIgnored(root: string, relative: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", relative], { cwd: root, stdio: "ignore" });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return false;
    throw new Error("Could not check .gitignore rules (is git installed?).");
  }
}

// Counts overlapping matches too, so "aa" in "aaa" counts as ambiguous.
function countOccurrences(text: string, snippet: string): number {
  let count = 0;
  for (let i = text.indexOf(snippet); i !== -1; i = text.indexOf(snippet, i + 1)) count++;
  return count;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
