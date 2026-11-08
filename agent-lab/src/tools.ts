import type Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { readFile as fsReadFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Jobsite Twin repo root: this file is <repo>/agent-lab/src/tools.ts.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MAX_BYTES = 100_000;

// What the model sees: name, when to use it, and the shape of its input.
export const readFileTool: Anthropic.Beta.BetaTool = {
  name: "read_file",
  description:
    "Read a text file from the Jobsite Twin repository and return its contents as UTF-8 text. " +
    "Use this whenever you need to know what a file in the repository says. " +
    "The path is relative to the repository root (for example \"README.md\" or \"server/src/schema.graphql\"). " +
    "Only files inside the repository can be read; git-ignored files (such as .env and node_modules) " +
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

// Every tool offered to the model.
export const tools = [readFileTool];

// Run the tool the model asked for. Throws an Error with a readable message for
// an unknown tool or bad input; the loop reports that back to the model.
export async function runTool(name: string, input: unknown): Promise<string> {
  switch (name) {
    case readFileTool.name: {
      const { path: requested } = (input ?? {}) as { path?: unknown };
      if (typeof requested !== "string") {
        throw new Error("read_file needs a string `path`.");
      }
      return readFile(requested);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// What actually runs. Throws an Error with a readable message on any refusal.
export async function readFile(requested: string): Promise<string> {
  const root = await realpath(REPO_ROOT);

  // Resolve symlinks before checking, so a link can't point outside the repo.
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

  return fsReadFile(target, "utf8");
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
