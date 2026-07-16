import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const DEFAULT_CACHE_PATH = resolve(homedir(), ".codex", "agent-footprint", "command-explanations-v2.json");
const cacheStates = new Map();

export const OTHER_TERMINAL_OPERATION = {
  name: "Did other computer work",
  category: "work",
  general: "A terminal operation that could not be classified confidently enough to give it a more specific name.",
  description: "Ran another terminal operation needed by the task.",
  detail: "Its exact purpose could not be identified confidently, and the raw command remains hidden.",
  source: "fallback",
};

function result(name, category, general, description, detail) {
  return { name, category, general, description, detail, source: "rules" };
}

export function ruleClassification(input) {
  const text = String(input || "").toLowerCase();
  if (/apply_patch|\*\*\* begin patch/.test(text)) return { ignore: true };
  if (/npm (install|i\b)|pnpm (install|add)|yarn add|pip\w* install|brew install/.test(text)) return result("Installed project software", "setup", "Adds software packages that a project needs in order to build or run.", "Installed software packages needed by the project.", "This prepared the project with the software it required.");
  if (/npm run build|pnpm build|yarn build|vinext build|next build|vite build/.test(text)) return result("Checked the finished build", "check", "Turns project source files into a finished build and reports compilation or configuration problems.", "Built the project to look for problems.", "This checked that the project could be prepared successfully.");
  if (/npm (run )?test|node --test|pytest|vitest|jest|playwright test/.test(text)) return result("Ran automated tests", "check", "Runs automated tests or checks to confirm that important project behavior still works.", "Ran the project's automated checks.", "This helped confirm that the requested behavior still worked.");
  if (/npm run dev|vinext dev|vite\b|next dev|wrangler dev/.test(text)) return result("Opened a local preview", "check", "Starts a development version of the project on this computer so it can be checked locally.", "Started a local preview of the project.", "This made it possible to check the work in a local browser.");
  if (/ollama (list|show|pull)|11434|api\/chat/.test(text)) return result("Used local Llama", "model", "Checks or uses the locally installed Ollama service and Llama model.", "Checked or used the local Llama model.", "Llama was used locally to turn activity details into a normal explanation.");
  if (/\bgit\s+(status|diff|log|show)\b/.test(text)) return result("Reviewed project changes", "review", "Checks saved or unsaved project changes without modifying them.", "Reviewed the project's saved and unsaved changes.", "This helped the agent understand existing work and avoid overwriting it.");
  if (/\bgit\s+(add|commit|branch|switch|merge|rebase|tag|push|pull|fetch|restore|checkout)\b/.test(text)) return result("Managed saved changes", "work", "Uses Git to save, organize, retrieve, or combine versions of project work.", "Used version control to manage project changes.", "This kept the project's change history or branches organized.");
  if (/\b(command -v|which|whereis|node --version|node -v|npm --version|python\d* --version|uname\b|sw_vers\b|printenv\b)\b/.test(text)) return result("Checked the computer setup", "review", "Checks which software or system environment is available before the agent relies on it.", "Checked the available software or system environment.", "This confirmed what the computer could use for the task.");
  if (/\b(npm (ls|list|outdated|view)|pnpm list|yarn list|pip\d* (list|show|check)|brew list)\b/.test(text)) return result("Checked installed packages", "review", "Checks installed packages and their versions without adding new software.", "Checked the project's installed software packages.", "This confirmed which dependencies were available or needed attention.");
  if (/\b(ps\b|pgrep\b|pkill\b|kill\b|killall\b|lsof\b)/.test(text)) return result("Managed running programs", "work", "Finds, checks, or stops programs that are running on the computer.", "Checked or managed a running program.", "This helped avoid conflicts and kept the correct local process running.");
  if (/\b(systemctl|launchctl|brew services|ollama serve)\b/.test(text)) return result("Managed a background service", "work", "Starts, stops, or checks a background service needed by the task.", "Managed a background service used by the project.", "This made sure a required local service was available.");
  if (/\b(rg\b|grep\b|find\b|fd\b|locate\b)/.test(text)) return result("Searched project files", "review", "Searches file names or text to locate relevant parts of a project.", "Searched the available files or text.", "This helped the agent quickly find the material related to the request.");
  if (/\b(sed -n|cat\b|head\b|tail\b|less\b|ls\b|jq\b|readfile|wc\b|stat\b)/.test(text)) return result("Looked at files", "review", "Reads file names, metadata, or selected contents to understand a project without intentionally changing it.", "Looked through the available files and records.", "This helped the agent understand the existing project before changing it.");
  if (/\b(awk\b|sort\b|uniq\b|cut\b|tr\b|xargs\b|perl\s+-[pe])/.test(text)) return result("Processed text", "work", "Filters, rearranges, or summarizes text produced by files or other commands.", "Processed text needed for the task.", "This turned raw text into a more useful form for the next step.");
  if (/\b(sqlite3\b|psql\b|mysql\b|drizzle-kit\b|prisma\b|database|\bsql\b)/.test(text)) return result("Worked with stored data", "work", "Inspects or changes structured records stored in a database.", "Worked with the project's database or stored records.", "This supported the data needed by the project.");
  if (/\b(chmod\b|chown\b|chgrp\b)/.test(text)) return result("Changed file access", "setup", "Changes who can open, edit, or run a file or folder.", "Adjusted a file or folder permission.", "This allowed the intended person or program to use it correctly.");
  if (/\b(curl\b|wget\b)/.test(text) && /https?:\/\/(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})/i.test(text)) return result("Checked a local service", "check", "Connects to a service running on this computer or private network to confirm that it responds.", "Checked whether a local service was responding.", "This verified a local part of the project without treating it as online research.");
  if (/\b(web__run|search_query)\b/.test(text)) return result("Researched online", "research", "Uses an internet-connected research tool to find information needed for the task.", "Looked up information online.", "This gathered outside information needed to support the task.");
  if (/\b(curl\b|wget\b)/.test(text)) return result("Requested online information", "research", "Requests public information or a file through an internet connection.", "Used an internet-connected command to gather information.", "This retrieved information needed to support the task.");
  if (/\b(open\s+https?:|open_in_codex|xdg-open\b)/.test(text)) return result("Opened a page", "research", "Opens a local or online page so it can be viewed in a browser.", "Opened a page for viewing.", "This made the relevant page available for inspection.");
  if (/\b(tar\b|zip\b|unzip\b|gzip\b|gunzip\b)/.test(text)) return result("Opened or packaged files", "work", "Creates or opens a compressed collection of files.", "Created or opened a file archive.", "This packaged files together or made archived files available.");
  if (/\b(mkdir\b|\bmv\b|\bcp\b|\brm\b|rmdir\b|touch\b)/.test(text)) return result("Organized files", "files", "Creates, copies, moves, removes, or arranges project files and folders.", "Organized the project's folders or files.", "This kept the work in the correct place.");
  if (/\b(bash\b|zsh\b|sh\s+[^-]|python\d*\s+[^-]|node\s+[^-]|\.\/[^\s]+)/.test(text)) return result("Ran a project script", "work", "Runs a script that performs a prepared sequence of project operations.", "Ran a project or support script.", "This carried out a prepared part of the workflow.");
  return null;
}

function extractCommandText(input) {
  const raw = String(input || "");
  try {
    const parsed = JSON.parse(raw);
    const queue = [parsed];
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== "object") continue;
      if (typeof value.cmd === "string") return value.cmd;
      if (typeof value.command === "string") return value.command;
      queue.push(...Object.values(value));
    }
  } catch { /* The Codex wrapper is often JavaScript rather than plain JSON. */ }
  const doubleQuoted = raw.match(/\b(?:cmd|command)\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (doubleQuoted) {
    try { return JSON.parse(`"${doubleQuoted[1]}"`); } catch { return doubleQuoted[1]; }
  }
  const singleQuoted = raw.match(/\b(?:cmd|command)\s*:\s*'([^']*)'/s);
  if (singleQuoted) return singleQuoted[1];
  return raw;
}

export function sanitizeCommand(input) {
  let text = extractCommandText(input).slice(0, 4000);
  text = text
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1=<redacted>")
    .replace(/\b[A-Z_][A-Z0-9_]{2,}=(?:"[^"]*"|'[^']*'|[^\s]+)/g, "ENV_VALUE=<redacted>")
    .replace(/\bhttps?:\/\/[^\s"'`]+/gi, "<url>")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "<email>")
    .replace(/(?:\/Users|\/home|\/var|\/private|\/tmp|\/Volumes|\/opt|\/etc)(?:\/[^\s"'`,;)}\]]+)+/g, "<path>")
    .replace(/(?:~\/|\.\.\/|\.\/)(?:[^\s"'`,;)}\]]+\/)*[^\s"'`,;)}\]]+/g, "<path>")
    .replace(/(--[a-z0-9_-]+)=([^\s]+)/gi, "$1=<value>")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 1200);
}

function sanitizePrompt(value) {
  return sanitizeCommand(String(value || "")).slice(0, 320);
}

function hashFor(sanitizedCommand, prompt) {
  return createHash("sha256").update(`v2\n${sanitizedCommand}\n${prompt}`).digest("hex");
}

async function loadCache(cachePath) {
  if (!cacheStates.has(cachePath)) {
    cacheStates.set(cachePath, (async () => {
      try {
        const value = JSON.parse(await readFile(cachePath, "utf8"));
        return value?.version === 2 && value.explanations ? value : { version: 2, explanations: {} };
      } catch { return { version: 2, explanations: {} }; }
    })());
  }
  return cacheStates.get(cachePath);
}

async function saveCache(cachePath, cache) {
  await mkdir(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporary, cachePath);
}

function normalizedModelClassification(value) {
  const reportedConfidence = Number(value?.confidence);
  const confidence = Number.isFinite(reportedConfidence) && reportedConfidence > 0 ? reportedConfidence : 0.7;
  const name = String(value?.name || "").trim().replace(/[^a-z0-9 &+./-]/gi, "").slice(0, 48);
  const general = String(value?.general || "").trim().slice(0, 280);
  const description = String(value?.description || "").trim().slice(0, 220);
  const detail = String(value?.purpose || "").trim().slice(0, 260);
  if (confidence < 0.65 || !name || !general || !description || !detail) return null;
  return { name, category: "work", general, description, detail, source: "local-llama" };
}

export async function classifyCommands(inputs, options = {}) {
  const model = options.model || "llama3.2:latest";
  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;
  const fetchImpl = options.fetchImpl || fetch;
  const prompt = sanitizePrompt(options.taskPrompt || "");
  const output = new Map();
  const cache = await loadCache(cachePath);
  const pendingByKey = new Map();

  for (const input of new Set(inputs.map((value) => String(value || "")))) {
    const known = ruleClassification(input);
    if (known) { output.set(input, known); continue; }
    const sanitized = sanitizeCommand(input);
    const key = hashFor(sanitized, prompt);
    if (cache.explanations[key]) output.set(input, cache.explanations[key]);
    else if (!pendingByKey.has(key)) pendingByKey.set(key, { id: key.slice(0, 16), key, sanitized, inputs: [input] });
    else pendingByKey.get(key).inputs.push(input);
  }

  const pending = [...pendingByKey.values()].slice(0, 24);
  if (pending.length) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetchImpl("http://127.0.0.1:11434/api/chat", {
          method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model, stream: false, format: "json", options: { temperature: 0.05, num_predict: 1200 },
            messages: [
              { role: "system", content: "Classify unfamiliar terminal operations for a normal person. The commands have already been sanitized and may contain <path>, <url>, <value>, or <redacted>. Never reconstruct missing values or quote the command. Return JSON only: {classifications:[{id, confidence from 0 to 1, name as a short past-tense action of 2 to 5 words, general explaining what this command type normally does, description describing the action in past tense, purpose explaining why it was likely useful for this task}]}. Prefer labels like 'Checked a local service' or 'Prepared image files'. Be concrete, brief, and avoid jargon. If uncertain, use confidence below 0.65." },
              { role: "user", content: JSON.stringify({ taskSummary: prompt || "No task summary available", commands: pending.map(({ id, sanitized }) => ({ id, sanitizedCommand: sanitized })) }) },
            ],
          }),
        });
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const body = await response.json();
      const parsed = JSON.parse(body.message?.content || "{}");
      const modelItems = Array.isArray(parsed.classifications) ? parsed.classifications : [];
      const byId = new Map(modelItems.map((item) => [String(item.id), item]));
      let changed = false;
      for (const [index, item] of pending.entries()) {
        const classification = normalizedModelClassification(byId.get(item.id) || modelItems[index]);
        const finalValue = classification || OTHER_TERMINAL_OPERATION;
        for (const input of item.inputs) output.set(input, finalValue);
        if (classification) { cache.explanations[item.key] = classification; changed = true; }
      }
      if (changed) await saveCache(cachePath, cache);
    } catch {
      for (const item of pending) for (const input of item.inputs) output.set(input, OTHER_TERMINAL_OPERATION);
    }
  }

  for (const input of inputs) if (!output.has(String(input || ""))) output.set(String(input || ""), OTHER_TERMINAL_OPERATION);
  return output;
}
