import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";

export function automaticCodexHome(env = process.env, home = homedir()) {
  const configured = String(env.CODEX_HOME || "").trim();
  return configured ? resolve(configured) : resolve(home, ".codex");
}

export function normalizeCodexHomePath(input, home = homedir()) {
  const raw = String(input || "").trim().replace(/[\\/]+$/, "");
  if (!raw) throw new Error("Enter or choose a Codex Home directory.");
  const expanded = raw === "~" ? home : raw.startsWith("~/") ? resolve(home, raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) throw new Error("Enter an absolute directory, such as ~/.codex or /Users/name/.codex.");
  const absolute = resolve(expanded);
  return basename(absolute).toLowerCase() === "sessions" ? dirname(absolute) : absolute;
}

async function countSessionFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  const counts = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return countSessionFiles(path);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? 1 : 0;
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

export async function inspectCodexHome(input, home = homedir()) {
  const codexHome = normalizeCodexHomePath(input, home);
  const sessionsDir = resolve(codexHome, "sessions");
  let homeInfo;
  let sessionsInfo;
  try { homeInfo = await stat(codexHome); } catch { throw new Error("That Codex Home directory does not exist."); }
  if (!homeInfo.isDirectory()) throw new Error("Codex Home must be a directory.");
  try { sessionsInfo = await stat(sessionsDir); } catch { throw new Error("That directory does not contain a sessions folder."); }
  if (!sessionsInfo.isDirectory()) throw new Error("The sessions entry inside Codex Home is not a directory.");
  return { codexHome, sessionsDir, sessionFileCount: await countSessionFiles(sessionsDir) };
}
