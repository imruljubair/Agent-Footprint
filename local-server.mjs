import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { classifyCommands, OTHER_TERMINAL_OPERATION } from "./command-classifier.mjs";
import { automaticCodexHome, inspectCodexHome, normalizeCodexHomePath } from "./codex-home.mjs";
import { extractResearchLinks } from "./research-links.mjs";
import { detectSkills } from "./skill-detector.mjs";
import { fileTypeName } from "./file-types.mjs";
import { cleanPrompt, meaningfulOutcome, titleFromPrompt } from "./prompt-cleaner.mjs";
import { userRequestSegments } from "./request-segments.mjs";

const PORT = Number(process.env.FOOTPRINT_API_PORT || 4317);
const MODEL = process.env.FOOTPRINT_MODEL || "llama3.2:latest";
const AUTOMATIC_CODEX_HOME = automaticCodexHome();
const SETTINGS_PATH = resolve(AUTOMATIC_CODEX_HOME, "agent-footprint", "settings-v9.json");
const runFile = promisify(execFile);
let activeCodexHome = AUTOMATIC_CODEX_HOME;
let codexHomeSource = process.env.CODEX_HOME ? "environment" : "default";
let SESSIONS_DIR = resolve(activeCodexHome, "sessions");
const cache = new Map();

try {
  const saved = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
  const inspected = await inspectCodexHome(saved.codexHome);
  activeCodexHome = inspected.codexHome;
  SESSIONS_DIR = inspected.sessionsDir;
  codexHomeSource = "saved";
} catch {
  // A missing or outdated preference falls back to the official Codex location.
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function allowedBrowserOrigin(origin) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch { return false; }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error("The settings request was too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("The settings request was not valid JSON."); }
}

async function findSessionFiles(dir, output = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return output; }
  await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await findSessionFiles(path, output);
    else if (entry.name.endsWith(".jsonl")) {
      const info = await stat(path);
      output.push({ path, mtimeMs: info.mtimeMs, size: info.size });
    }
  }));
  return output;
}

function safeLines(text) {
  return text.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function formatClock(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
}

async function readSessionSummaries(file) {
  const text = await readFile(file.path, "utf8");
  const events = safeLines(text);
  const meta = events.find((event) => event.type === "session_meta")?.payload || {};
  const sessionId = meta.id || meta.session_id || basename(file.path).replace(/^.*-([0-9a-f-]{36})\.jsonl$/, "$1");
  return userRequestSegments(events, sessionId).map((segment) => {
    const prompt = cleanPrompt(segment.event.payload.message);
    const size = segment.activityCount <= 10 ? "small" : segment.activityCount <= 30 ? "medium" : "large";
    return {
      id: segment.id,
      file: file.path,
      fileMtime: file.mtimeMs,
      startIndex: segment.startIndex,
      requestAt: segment.requestAt,
      title: titleFromPrompt(prompt),
      prompt,
      workspace: basename(meta.cwd || "Local workspace"),
      updatedAt: segment.updatedAt,
      status: segment.status,
      size,
      activityCount: segment.activityCount,
    };
  });
}

async function recentTasks() {
  const files = (await findSessionFiles(SESSIONS_DIR)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const settled = await Promise.allSettled(files.map(readSessionSummaries));
  const summaries = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return summaries.sort((a, b) => new Date(b.requestAt) - new Date(a.requestAt));
}

async function settingsSnapshot() {
  const sessionFileCount = (await findSessionFiles(SESSIONS_DIR)).length;
  return {
    codexHome: activeCodexHome,
    sessionsDir: SESSIONS_DIR,
    source: codexHomeSource,
    sourceLabel: codexHomeSource === "saved" ? "Saved choice" : codexHomeSource === "environment" ? "CODEX_HOME environment variable" : "Default Codex location",
    sessionFileCount,
    platformBrowseAvailable: process.platform === "darwin",
  };
}

async function activateCodexHome(input, source = "saved") {
  const inspected = await inspectCodexHome(input);
  activeCodexHome = inspected.codexHome;
  SESSIONS_DIR = inspected.sessionsDir;
  codexHomeSource = source;
  cache.clear();
  return { ...await settingsSnapshot(), sessionFileCount: inspected.sessionFileCount };
}

async function saveCodexHome(input) {
  const inspected = await inspectCodexHome(input);
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, `${JSON.stringify({ codexHome: inspected.codexHome }, null, 2)}\n`, { mode: 0o600 });
  return activateCodexHome(inspected.codexHome, "saved");
}

async function resetCodexHome() {
  try { await unlink(SETTINGS_PATH); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return activateCodexHome(AUTOMATIC_CODEX_HOME, process.env.CODEX_HOME ? "environment" : "default");
}

async function chooseCodexHome() {
  if (process.platform !== "darwin") throw new Error("The folder chooser is available on macOS. Enter the directory manually on this system.");
  try {
    const { stdout } = await runFile("/usr/bin/osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose your Codex Home folder")']);
    return { cancelled: false, codexHome: normalizeCodexHomePath(stdout) };
  } catch (error) {
    if (/User canceled/i.test(String(error?.stderr || error?.message || ""))) return { cancelled: true };
    throw error;
  }
}

function relativeName(path, workspace) {
  const clean = String(path || "").trim().replace(/["'`,;)}\]]+$/, "");
  if (!clean) return "a project file";
  if (workspace && clean.startsWith(workspace + sep)) return relative(workspace, clean) || basename(clean);
  if (clean.includes(`${sep}.codex${sep}`)) return `Codex records/${basename(clean)}`;
  return basename(clean) || "a project file";
}

function purposeForFile(path, operation) {
  const name = basename(path).toLowerCase();
  const ext = extname(name);
  if (name === "package.json" || name.endsWith("lock.json")) return "to define the app and the software it needs";
  if (name.includes("readme")) return "to explain how to use the project";
  if (name.endsWith(".command") || name.includes("start-")) return "to make the app easy to start with a double-click";
  if (name.includes("test") || name.includes("spec")) return "to check that the important parts keep working";
  if (name.includes("config") || name.startsWith(".") || [".toml", ".yaml", ".yml"].includes(ext)) return "to control how the project runs";
  if ([".css", ".scss"].includes(ext)) return "to control the page's appearance and layout";
  if ([".tsx", ".jsx", ".html"].includes(ext)) return "to build what the person sees and interacts with";
  if ([".ts", ".js", ".mjs", ".py"].includes(ext)) return "to handle the app's behavior behind the scenes";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "to provide an image used by the project";
  return operation === "removed" ? "because it was no longer needed" : "as part of the requested work";
}

function toolName(call) {
  const name = String(call.name || "tool");
  const input = String(call.input || call.arguments || "");
  const combined = `${name} ${input}`;
  if (name === "exec" && /apply_patch|\*\*\* begin patch/i.test(input)) return "Edited files";
  if (name === "exec" && /write_stdin/i.test(input)) return "Controlled a running process";
  if (name === "exec" && /exec_command/i.test(input)) return "Used the terminal";
  if (/wait/i.test(name)) return "Waited for a process";
  if (/web|browser|search/i.test(combined)) return "Researched online";
  if (/imagegen/i.test(combined)) return "Generated an image";
  if (/view_image/i.test(combined)) return "Viewed an image";
  if (/figma/i.test(combined)) return "Used Figma";
  if (/spreadsheet|excel/i.test(combined)) return "Used spreadsheet tools";
  if (/document|pdf|presentation/i.test(combined)) return "Used document tools";
  if (/codex_app/i.test(combined)) return "Read Codex history";
  if (name === "exec") return "Coordinated tools";
  return name.replace(/^mcp__/, "").replaceAll("__", " · ").replaceAll("_", " ");
}

function installedSoftware(input) {
  const text = String(input || "");
  const results = [];
  const patterns = [
    { re: /\b(?:npm\s+(?:install|i)|pnpm\s+(?:add|install)|yarn\s+add)\s+([^"'\n;&]+)/gi, manager: "JavaScript package" },
    { re: /\b(?:pip|pip3|python\s+-m\s+pip)\s+install\s+([^"'\n;&]+)/gi, manager: "Python package" },
    { re: /\bbrew\s+install\s+([^"'\n;&]+)/gi, manager: "Mac software" },
  ];
  for (const { re, manager } of patterns) {
    for (const match of text.matchAll(re)) {
      const names = match[1].replace(/\\n/g, " ").split(/\s+/).filter((name) => name && !name.startsWith("-") && !/[(){}]/.test(name)).slice(0, 12);
      for (const name of names) results.push({ name: name.replace(/\\+$/, ""), manager });
    }
  }
  if (/init-site\.sh/i.test(text)) results.push({ name: "Project dependencies", manager: "JavaScript packages" });
  return results;
}

function usageFromEvents(events, startIndex, endIndex) {
  const entries = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === "event_msg" && event.payload?.type === "token_count" && event.payload?.info);
  const previous = entries.filter(({ index }) => index < startIndex).at(-1)?.event.payload.info.total_token_usage || {};
  const current = entries.filter(({ index }) => index >= startIndex && index < endIndex);
  const latest = current.at(-1)?.event.payload.info;
  if (!latest) return { available: false };
  const total = latest.total_token_usage || {};
  const difference = (key) => Math.max(0, Number(total[key] || 0) - Number(previous[key] || 0));
  const contextWindow = Number(latest.model_context_window || 0);
  const peakContextTokens = Math.max(0, ...current.map(({ event }) => Number(event.payload.info.last_token_usage?.input_tokens || 0)));
  return {
    available: true,
    inputTokens: difference("input_tokens"),
    cachedInputTokens: difference("cached_input_tokens"),
    outputTokens: difference("output_tokens"),
    reasoningTokens: difference("reasoning_output_tokens"),
    totalTokens: difference("total_tokens"),
    peakContextTokens,
    contextWindow,
    contextPercent: contextWindow ? Math.min(100, Math.round((peakContextTokens / contextWindow) * 1000) / 10) : 0,
  };
}

function commandInputsFromEvents(events, startIndex, endIndex) {
  return events.slice(startIndex, endIndex)
    .filter((event) => event.type === "response_item" && ["custom_tool_call", "function_call"].includes(event.payload?.type))
    .map((event) => event.payload)
    .filter((call) => call.name === "exec" && /exec_command/i.test(String(call.input || call.arguments || "")))
    .map((call) => String(call.input || call.arguments || ""));
}

function researchOutputByCall(events, startIndex, endIndex) {
  const outputs = new Map();
  for (const event of events.slice(startIndex, endIndex)) {
    const payload = event.payload || {};
    if (!["custom_tool_call_output", "function_call_output"].includes(payload.type) || !payload.call_id) continue;
    outputs.set(payload.call_id, payload.output ?? payload.content ?? "");
  }
  return outputs;
}

function isResearchCall(call, input) {
  const name = String(call.name || "");
  if (name !== "exec" && /web|browser|search/i.test(name)) return true;
  return name === "exec" && /tools\.[a-z0-9_]*(?:web__run|browser|search)[a-z0-9_]*\s*\(/i.test(input);
}

function evidenceFromEvents(events, startIndex, endIndex, workspace, commandClassifications) {
  const files = new Map();
  const folders = new Map();
  const commands = new Map();
  const research = [];
  const software = new Map();
  const tools = new Map();
  const skills = detectSkills(events.slice(startIndex, endIndex));
  const researchOutputs = researchOutputByCall(events, startIndex, endIndex);
  for (let index = startIndex; index < endIndex; index += 1) {
    const event = events[index];
    const time = event.timestamp;
    if (event.type === "event_msg" && event.payload?.type === "patch_apply_end" && event.payload?.success) {
      for (const [path, change] of Object.entries(event.payload.changes || {})) {
        const name = relativeName(path, workspace);
        const verb = change.type === "add" ? "Created" : change.type === "delete" ? "Removed" : "Updated";
        files.set(`${change.type}:${name}`, { name, fileType: fileTypeName(path), description: `${verb} ${purposeForFile(path, verb.toLowerCase())}.`, time, count: 1 });
        const folderPath = relativeName(resolve(path, ".."), workspace);
        const folderName = folderPath === "." ? "Project root" : folderPath;
        if (!folders.has(folderName)) folders.set(folderName, { name: folderName, description: "This folder contained files used or changed during the task.", time, count: 1 });
      }
    }
    if (event.type === "response_item" && ["custom_tool_call", "function_call"].includes(event.payload?.type)) {
      const call = event.payload;
      const friendlyTool = toolName(call);
      const previousTool = tools.get(friendlyTool);
      tools.set(friendlyTool, { name: friendlyTool, description: "Called to support part of the task.", time, count: (previousTool?.count || 0) + 1 });
      const input = String(call.input || call.arguments || "");
      const isTerminalCommand = call.name === "exec" && /exec_command/i.test(input);
      if (isTerminalCommand) {
        const classification = commandClassifications.get(input) || OTHER_TERMINAL_OPERATION;
        if (!classification.ignore) {
          const commandKey = classification.name.toLowerCase();
          const previousCommand = commands.get(commandKey);
          commands.set(commandKey, { name: classification.name, description: classification.description, help: classification.general, time: previousCommand?.time || time, count: (previousCommand?.count || 0) + 1 });
        }
        if (classification.category === "research") {
          const links = extractResearchLinks([input, researchOutputs.get(call.call_id)]);
          research.push({ name: classification.name, description: classification.description, help: classification.general, links, time, count: 1 });
        }
        for (const item of installedSoftware(input)) {
          if (!software.has(item.name)) software.set(item.name, { name: item.name, description: `Installed as ${item.manager.toLowerCase()} needed by the work.`, time, count: 1 });
        }
      }
      if (!isTerminalCommand && isResearchCall(call, input)) {
        const links = extractResearchLinks([input, researchOutputs.get(call.call_id)]);
        research.push({ name: friendlyTool, description: "Used to find or open information needed for the task.", help: "Uses an internet-connected research tool to search for or open information relevant to the task.", links, time, count: 1 });
      }
    }
  }
  return [
    { id: "files", label: "Files", items: [...files.values()] },
    { id: "folders", label: "Folders", items: [...folders.values()] },
    { id: "commands", label: "Commands", items: [...commands.values()] },
    { id: "research", label: "Research", items: research },
    { id: "software", label: "Software", items: [...software.values()] },
    { id: "skills", label: "Skills & workflows", items: skills },
    { id: "tools", label: "Tool calls", items: [...tools.values()] },
  ].map((category) => ({ ...category, count: category.items.reduce((sum, item) => sum + (item.count || 1), 0) }));
}

function extractActions(events, startIndex, endIndex, workspace, commandClassifications) {
  const actions = [];
  const seenFiles = new Set();
  for (let index = startIndex; index < endIndex; index += 1) {
    const event = events[index];
    const time = event.timestamp;
    if (event.type === "event_msg" && event.payload?.type === "patch_apply_end" && event.payload?.success) {
      for (const [path, change] of Object.entries(event.payload.changes || {})) {
        const key = `${change.type}:${path}`;
        if (seenFiles.has(key)) continue;
        seenFiles.add(key);
        const verb = change.type === "add" ? "created" : change.type === "delete" ? "removed" : "updated";
        const name = relativeName(path, workspace);
        actions.push({
          time, category: "files", subject: name,
          description: `The agent ${verb} ${name} ${purposeForFile(path, verb)}.`,
          detail: `${verb[0].toUpperCase()}${verb.slice(1)} file`,
        });
      }
      continue;
    }
    if (event.type === "response_item" && event.payload?.type === "custom_tool_call") {
      const call = event.payload;
      const input = String(call.input || call.arguments || "");
      if (call.name === "exec" && /exec_command/i.test(input)) {
        const classification = commandClassifications.get(input) || OTHER_TERMINAL_OPERATION;
        if (!classification.ignore) actions.push({ time, category: classification.category, subject: classification.name, description: classification.description, detail: classification.detail });
      } else if (isResearchCall(call, input)) {
        actions.push({ time, category: "research", subject: "Online information", description: "Looked up or opened information needed for the task.", detail: "This used an internet-connected research tool; source links are available in the activity summary." });
      } else if (/imagegen/i.test(`${call.name} ${input}`)) {
        actions.push({ time, category: "media", subject: "Generated image", description: "Created a new image for the project.", detail: "This supplied a visual that the project needed." });
      } else if (/figma|document|spreadsheet|pdf|presentation/i.test(`${call.name} ${input}`)) {
        const kind = `${call.name} ${input}`.match(/figma|document|spreadsheet|pdf|presentation/i)?.[0] || "specialized";
        actions.push({ time, category: "skill", subject: `${kind} workflow`, description: `Used the ${kind} workflow to handle that kind of content correctly.`, detail: "This provided specialized guidance for the work." });
      }
    }
    if (event.type === "response_item" && event.payload?.type === "function_call") {
      const name = String(event.payload.name || "");
      if (/web|browser|search/.test(name)) actions.push({ time, category: "research", subject: "Online information", description: "Looked up or opened information needed for the task.", detail: "This used a network-connected tool; the page does not display the raw request or address." });
    }
  }
  const filtered = [];
  for (const action of actions) {
    const previous = filtered.at(-1);
    if (previous && previous.category !== "files" && previous.description === action.description) continue;
    filtered.push(action);
  }
  return filtered.slice(0, 60);
}

function fallbackGroups(actions) {
  if (!actions.length) return [{
    title: "Understanding the request", summary: "The agent read the request and prepared to work on it.",
    why: "It needed to understand the goal before making changes.", outcome: "", items: [],
  }];
  const buckets = [
    { key: "understand", match: ["review", "research", "skill"], title: "Understanding what was needed" },
    { key: "make", match: ["files", "setup", "media", "work"], title: "Making the requested changes" },
    { key: "check", match: ["check", "model"], title: "Checking that everything worked" },
  ];
  return buckets.map((bucket) => {
    const items = actions.filter((action) => bucket.match.includes(action.category));
    if (!items.length) return null;
    return {
      title: bucket.title,
      summary: bucket.key === "understand" ? "The agent looked at the available information and worked out what the task required." : bucket.key === "make" ? "The agent created or updated the pieces needed to complete the request." : "The agent ran checks and reviewed the result before finishing.",
      why: bucket.key === "understand" ? "This reduced the chance of changing the wrong thing." : bucket.key === "make" ? "These were the practical changes that produced the requested result." : "This helped catch problems before the work was handed back.",
      outcome: bucket.key === "check" ? "The available checks were used to confirm the result." : "",
      items,
    };
  }).filter(Boolean);
}

function normalizeModelResult(value, actions) {
  if (!value || typeof value !== "object" || !Array.isArray(value.groups)) throw new Error("Llama returned an unexpected response");
  const usedIndexes = new Set();
  const groups = value.groups.slice(0, 6).map((group, groupIndex) => {
    const indexes = Array.isArray(group.actionIndexes) ? group.actionIndexes : [];
    const items = indexes.map((index) => {
      const actionIndex = Number(index) - 1;
      if (actionIndex >= 0 && actions[actionIndex]) usedIndexes.add(actionIndex);
      return actions[actionIndex];
    }).filter(Boolean);
    return {
      title: String(group.title || `Part ${groupIndex + 1}`),
      summary: String(group.summary || "Related work was completed."),
      why: String(group.why || "This supported the task."),
      outcome: meaningfulOutcome(group.outcome),
      items,
    };
  }).filter((group) => group.items.length);
  const leftovers = actions.filter((_, index) => !usedIndexes.has(index));
  if (leftovers.length && groups.length) groups.at(-1).items.push(...leftovers);
  else if (leftovers.length) groups.push({ title: "Other supporting work", summary: "The agent also completed a few supporting actions.", why: "These actions helped the main work run correctly.", outcome: "", items: leftovers });
  return { overview: String(value.overview || "The agent worked through the request in a few practical stages."), groups: groups.length ? groups : fallbackGroups(actions) };
}

async function explainWithLlama(task, actions) {
  const evidence = actions.map((action, index) => ({ number: index + 1, time: formatClock(action.time), what: action.description, why: action.detail }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, stream: false, format: "json", options: { temperature: 0.15, num_predict: 1400 },
        messages: [
          { role: "system", content: "You explain computer work to a normal person. Be informal, direct, and concrete. Say 'the agent' or describe the action directly; never say 'the system', 'the recorded actions', or 'the activity record'. Do not use metaphors, stories, characters, kitchens, painters, journeys, chapters, jargon, marketing language, or dramatic wording. Group related actions into 2 to 5 meaningful work sections. Explain what happened and why it was needed. Give an outcome only when there is a concrete result; otherwise use an empty string. Never describe a count of recorded actions as a result, and never say that no activity was recorded. Never invent actions. Return JSON only with: overview (2 short sentences), groups (array of {title, summary, why, outcome, actionIndexes}). Section titles should sound natural, such as 'Setting up the project' or 'Checking the finished page'. Include every action index exactly once." },
          { role: "user", content: JSON.stringify({ request: task.prompt, recordedActions: evidence }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const body = await response.json();
    return normalizeModelResult(JSON.parse(body.message?.content || "{}"), actions);
  } finally { clearTimeout(timer); }
}

async function analyzeTask(task) {
  const text = await readFile(task.file, "utf8");
  const events = safeLines(text);
  const meta = events.find((event) => event.type === "session_meta")?.payload || {};
  const sessionId = meta.id || meta.session_id || "local-session";
  const segment = userRequestSegments(events, sessionId).find((item) => item.startIndex === task.startIndex);
  if (!segment) throw new Error("This individual request could not be found in the Codex record.");
  const latest = segment.event;
  const startIndex = segment.startIndex;
  const endIndex = segment.endIndex;
  const workspacePath = meta.cwd || "";
  const endTimestamp = segment.updatedAt;
  const commandClassifications = await classifyCommands(commandInputsFromEvents(events, startIndex, endIndex), { model: MODEL, taskPrompt: task.prompt });
  const actions = extractActions(events, startIndex, endIndex, workspacePath, commandClassifications);
  const categories = evidenceFromEvents(events, startIndex, endIndex, workspacePath, commandClassifications);
  const usage = usageFromEvents(events, startIndex, endIndex);
  let explanation;
  let warning = "";
  try { explanation = await explainWithLlama(task, actions); }
  catch (error) {
    explanation = { overview: "The agent worked through the request in a few practical stages. Open each section to see what it did and why.", groups: fallbackGroups(actions) };
    warning = `Llama was not available, so this explanation was organized locally without the model. ${error instanceof Error ? error.message : ""}`.trim();
  }
  const startMs = new Date(latest.timestamp).getTime();
  const endMs = new Date(endTimestamp).getTime();
  const status = segment.status;
  const progress = status === "complete" ? 100 : Math.min(92, Math.max(12, 18 + actions.length * 4));
  const fileActions = actions.filter((action) => action.category === "files");
  const categoryCount = (id) => categories.find((category) => category.id === id)?.count || 0;
  const summaryParts = [
    `${categoryCount("files")} ${categoryCount("files") === 1 ? "file" : "files"}`,
    `${categoryCount("folders")} ${categoryCount("folders") === 1 ? "folder" : "folders"}`,
    `${categoryCount("commands")} ${categoryCount("commands") === 1 ? "command" : "commands"}`,
    `${categoryCount("research")} research ${categoryCount("research") === 1 ? "action" : "actions"}`,
    `${categoryCount("software")} software ${categoryCount("software") === 1 ? "item" : "items"}`,
    `${categoryCount("skills")} skill or workflow ${categoryCount("skills") === 1 ? "use" : "uses"}`,
    `${categoryCount("tools")} tool ${categoryCount("tools") === 1 ? "call" : "calls"}`,
  ];
  return {
    task: { id: task.id, title: task.title, prompt: task.prompt, workspace: basename(workspacePath || task.workspace), status, size: task.size, activityCount: task.activityCount, startedAt: latest.timestamp, updatedAt: endTimestamp, duration: formatDuration(endMs - startMs), progress },
    overview: explanation.overview,
    groups: explanation.groups.map((group, index) => ({ ...group, id: `group-${index + 1}`, start: formatClock(group.items[0]?.time || latest.timestamp), end: formatClock(group.items.at(-1)?.time || endTimestamp) })),
    activitySummary: `The agent worked with ${summaryParts.join(", ")}.`,
    categories,
    totals: { actions: actions.length, files: fileActions.length, folders: categoryCount("folders"), commands: categoryCount("commands"), research: categoryCount("research"), software: categoryCount("software"), skills: categoryCount("skills"), tools: categoryCount("tools"), checks: actions.filter((action) => action.category === "check").length, network: actions.filter((action) => action.category === "research").length },
    usage,
    privacy: { model: MODEL, localOnly: true, rawCommandsShown: false, rawCodeShown: false },
    analyzedAt: new Date().toISOString(), warning,
  };
}

const server = createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  if (!allowedBrowserOrigin(origin)) return send(res, 403, { error: "Only the local Agent Footprint page can use this analyzer." });
  res.setHeader("access-control-allow-origin", origin || "http://localhost");
  res.setHeader("vary", "Origin");
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/settings") return send(res, 200, await settingsSnapshot());
    if (req.method === "POST" && url.pathname === "/api/settings") {
      try {
        const body = await readJsonBody(req);
        return send(res, 200, body.reset ? await resetCodexHome() : await saveCodexHome(body.codexHome));
      } catch (error) {
        return send(res, 400, { error: error instanceof Error ? error.message : "The Codex Home directory could not be changed." });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/settings/choose") {
      try { return send(res, 200, await chooseCodexHome()); }
      catch (error) { return send(res, process.platform === "darwin" ? 500 : 501, { error: error instanceof Error ? error.message : "The folder chooser could not be opened." }); }
    }
    if (req.method === "POST" && url.pathname === "/api/settings/reveal") {
      if (process.platform !== "darwin") return send(res, 501, { error: "Reveal in Finder is available on macOS." });
      await runFile("/usr/bin/open", [activeCodexHome]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      const tasks = await recentTasks();
      const requestedLimit = Number(url.searchParams.get("limit") || 20);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 20;
      const visible = tasks.slice(0, limit);
      return send(res, 200, {
        // Internal location and request-boundary fields never leave the local API.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        tasks: visible.map(({ file, fileMtime, startIndex, requestAt, ...task }) => task),
        total: tasks.length,
        totalAvailable: tasks.length,
        hasMore: visible.length < tasks.length,
        model: MODEL,
      });
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/analyze") {
      const tasks = await recentTasks();
      const task = tasks.find((item) => item.id === url.searchParams.get("id")) || tasks[0];
      if (!task) return send(res, 404, { error: "No Codex requests were found in the selected Codex Home directory." });
      const key = `${task.id}:${task.fileMtime}:${task.status}`;
      if (!cache.has(key)) cache.set(key, analyzeTask(task));
      return send(res, 200, await cache.get(key));
    }
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, version: "9", model: MODEL, codexHomeSource });
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "The analyzer could not read the Codex records." });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Footprint analyzer ready at http://127.0.0.1:${PORT} using ${MODEL}`));
