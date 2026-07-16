import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyCommands, ruleClassification, sanitizeCommand } from "../command-classifier.mjs";
import { extractResearchLinks, sanitizeResearchUrl } from "../research-links.mjs";
import { detectSkills } from "../skill-detector.mjs";
import { fileTypeName } from "../file-types.mjs";
import { cleanPrompt, meaningfulOutcome, titleFromPrompt } from "../prompt-cleaner.mjs";
import { userRequestSegments } from "../request-segments.mjs";
import { automaticCodexHome, inspectCodexHome, normalizeCodexHomePath } from "../codex-home.mjs";

const root = new URL("../", import.meta.url);

test("uses local Llama and normal-person explanation rules", async () => {
  const server = await readFile(new URL("local-server.mjs", root), "utf8");
  assert.match(server, /llama3\.2:latest/);
  assert.match(server, /normal person/);
  assert.match(server, /Do not use metaphors/);
  assert.match(server, /automaticCodexHome/);
});

test("includes recent tasks, expandable sections, and a portable launcher", async () => {
  const [page, launcher] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("start-footprint.command", root), "utf8"),
  ]);
  assert.match(page, /tasks\.length/);
  assert.match(page, /Why this was done/);
  assert.match(page, />Result</);
  assert.doesNotMatch(page, /What came out of it/);
  assert.match(page, /Token & context use/);
  assert.match(page, /analysis\.categories/);
  assert.match(page, /What does \$\{label\} mean/);
  assert.match(page, /helpForEvidence/);
  assert.doesNotMatch(page, /Task size/);
  assert.doesNotMatch(page, /statusFilter/);
  assert.doesNotMatch(page, /task-filters/);
  assert.match(page, /Load 20 older requests/);
  assert.match(page, /totalTasks/);
  assert.match(launcher, /free_port/);
  assert.match(launcher, /\?api=\$API_PORT/);
  assert.match(launcher, /\/usr\/sbin\/lsof/);
  assert.match(launcher, /"version":"9"/);
  assert.match(page, /version-badge/);
  assert.match(page, /Codex Home/);
  assert.match(page, /Choose folder/);
  assert.match(page, /Show in Finder/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});

test("uses the original first-sentence title behavior without attachment cleanup", () => {
  const wrapped = `# Files mentioned by the user:\n\n## fictional-diagram.png: /temporary/example/fictional-diagram.png\n\n## My request for Codex:\nSummarize the fictional diagram and list its major sections.`;
  assert.match(cleanPrompt(wrapped), /Files mentioned by the user/);
  assert.match(titleFromPrompt(wrapped), /^# Files mentioned by the user/);
  assert.equal(titleFromPrompt("Please update the page. Then check it."), "Please update the page.");
});

test("uses CODEX_HOME and validates user-selected Codex directories", async () => {
  const home = await mkdtemp(join(tmpdir(), "footprint-codex-home-"));
  const codexHome = join(home, ".codex");
  const sessions = join(codexHome, "sessions", "2026", "01");
  try {
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "session-example.jsonl"), "{}\n");
    assert.equal(automaticCodexHome({}, home), codexHome);
    assert.equal(automaticCodexHome({ CODEX_HOME: join(home, "custom") }, home), join(home, "custom"));
    assert.equal(normalizeCodexHomePath(join(codexHome, "sessions"), home), codexHome);
    assert.deepEqual(await inspectCodexHome(codexHome, home), { codexHome, sessionsDir: join(codexHome, "sessions"), sessionFileCount: 1 });
    await assert.rejects(inspectCodexHome(join(home, "missing"), home), /does not exist/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("shows outcomes only when they describe a concrete result", () => {
  assert.equal(meaningfulOutcome("The task was reviewed, but no file or command activity was recorded yet."), "");
  assert.equal(meaningfulOutcome("3 related actions were recorded."), "");
  assert.equal(meaningfulOutcome("The page built successfully and all tests passed."), "The page built successfully and all tests passed.");
});

test("reports files, folders, commands, research, software, tools, and token use", async () => {
  const [server, page] = await Promise.all([
    readFile(new URL("local-server.mjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  for (const category of ["files", "folders", "commands", "research", "software", "skills", "tools"]) assert.match(server, new RegExp(`id: "${category}"`));
  assert.match(server, /usageFromEvents/);
  assert.match(server, /contextPercent/);
  assert.doesNotMatch(server, /unique\.length === 20/);
  assert.doesNotMatch(server, /findSessionFiles\(SESSIONS_DIR\)[^\n]*slice/);
  assert.match(server, /totalAvailable: tasks\.length/);
  assert.match(server, /hasMore: visible\.length < tasks\.length/);
  assert.doesNotMatch(server, /url\.searchParams\.get\("size"\)/);
  assert.doesNotMatch(server, /url\.searchParams\.get\("status"\)/);
  assert.match(server, /const commands = new Map/);
  assert.match(server, /previousCommand\?\.count/);
  assert.match(page, /research-links/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /Skill detection is best-effort/);
  assert.match(page, /file-type-name/);
  assert.match(page, /className="load-older"[\s\S]*?<nav aria-label="Recent Codex requests">/);
});

test("creates one stable sidebar entry for every user request", () => {
  const events = [
    { type: "session_meta", payload: { id: "session-1" }, timestamp: "2026-01-01T00:00:00Z" },
    { type: "event_msg", payload: { type: "user_message", message: "Create a one-page PDF" }, timestamp: "2026-01-01T00:00:01Z" },
    { type: "response_item", payload: { type: "custom_tool_call", name: "pdf" }, timestamp: "2026-01-01T00:00:02Z" },
    { type: "event_msg", payload: { type: "user_message", message: "Still working?" }, timestamp: "2026-01-01T00:00:03Z" },
    { type: "event_msg", payload: { type: "task_complete" }, timestamp: "2026-01-01T00:00:04Z" },
  ];
  const segments = userRequestSegments(events, "session-1");
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(({ id, startIndex, endIndex, activityCount, status }) => ({ id, startIndex, endIndex, activityCount, status })), [
    { id: "session-1:request:1", startIndex: 1, endIndex: 3, activityCount: 1, status: "complete" },
    { id: "session-1:request:3", startIndex: 3, endIndex: 5, activityCount: 0, status: "complete" },
  ]);
});

test("classifies a broad set of common command purposes with local rules", () => {
  assert.equal(ruleClassification("git status").name, "Reviewed project changes");
  assert.equal(ruleClassification("rg -n value app").name, "Searched project files");
  assert.equal(ruleClassification("lsof -iTCP:3000").name, "Managed running programs");
  assert.equal(ruleClassification("chmod +x start.command").name, "Changed file access");
  assert.equal(ruleClassification("sqlite3 local.db .tables").name, "Worked with stored data");
  assert.equal(ruleClassification("curl http://127.0.0.1:4317/api/health").name, "Checked a local service");
  assert.equal(ruleClassification("curl https://example.com/report").name, "Requested online information");
  assert.equal(ruleClassification("mysteryctl inspect"), null);
});

test("sanitizes unknown commands before local Llama and caches the explanation without raw commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "footprint-classifier-"));
  const cachePath = join(directory, "cache.json");
  const command = "PRIVATE_TOKEN=abc123 mysteryctl inspect /Users/person/Secret/file.txt --endpoint=https://private.example/data";
  assert.doesNotMatch(sanitizeCommand(command), /abc123|\/Users\/person|private\.example/);
  let requests = 0;
  const fetchImpl = async (url, options) => {
    requests += 1;
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    const request = JSON.parse(options.body);
    const serialized = JSON.stringify(request);
    assert.doesNotMatch(serialized, /abc123|\/Users\/person|private\.example/);
    const id = request.messages[1].content && JSON.parse(request.messages[1].content).commands[0].id;
    return {
      ok: true,
      async json() {
        return { message: { content: JSON.stringify({ classifications: [{ id, confidence: 0.93, name: "Checked a service", general: "Checks the state of a locally managed service.", description: "Checked the state of a local service.", purpose: "This likely confirmed that a service needed by the task was available." }] }) } };
      },
    };
  };
  try {
    const first = await classifyCommands([command], { model: "llama3.2:latest", taskPrompt: "Check the local service", cachePath, fetchImpl });
    const second = await classifyCommands([command], { model: "llama3.2:latest", taskPrompt: "Check the local service", cachePath, fetchImpl });
    assert.equal(first.get(command).name, "Checked a service");
    assert.equal(second.get(command).source, "local-llama");
    assert.equal(requests, 1);
    const stored = await readFile(cachePath, "utf8");
    assert.doesNotMatch(stored, /mysteryctl|abc123|\/Users\/person|private\.example/);
    assert.match(stored, /Checked a service/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("uses an honest fallback when local Llama cannot classify an unknown command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "footprint-fallback-"));
  try {
    const command = "unknown-operation frobnicate";
    const values = await classifyCommands([command], { cachePath: join(directory, "cache.json"), fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(values.get(command).name, "Did other computer work");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("accepts a complete local-Llama classification when the small model omits confidence or rewrites the id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "footprint-small-model-"));
  try {
    const command = "unfamiliarctl inspect";
    const values = await classifyCommands([command], {
      cachePath: join(directory, "cache.json"),
      fetchImpl: async () => ({ ok: true, async json() { return { message: { content: JSON.stringify({ classifications: [{ id: "rewritten-id", confidence: null, name: "Checked a service", general: "Checks the state of a local service.", description: "Checked a local service.", purpose: "This likely confirmed that the service was ready." }] }) } }; } }),
    });
    assert.equal(values.get(command).name, "Checked a service");
    assert.equal(values.get(command).source, "local-llama");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("extracts public research links and removes sensitive URL information", () => {
  const raw = "https://person:password@example.com/report?id=42&utm_source=test&gad_source=campaign&access_token=secret#private";
  assert.equal(sanitizeResearchUrl(raw), "https://example.com/report?id=42");
  assert.equal(sanitizeResearchUrl("http://127.0.0.1:4317/private"), null);
  const links = extractResearchLinks([
    { text: `Report (${raw})` },
    { text: "Second source https://www.ipcc.ch/report/ar6/ and duplicate https://www.ipcc.ch/report/ar6/" },
  ]);
  assert.deepEqual(links, [
    { label: "example.com", url: "https://example.com/report?id=42" },
    { label: "ipcc.ch", url: "https://www.ipcc.ch/report/ar6/" },
  ]);
  assert.equal(sanitizeResearchUrl("https://doi.org/example.--------------------------------------------------------------------------------"), "https://doi.org/example");
});

test("groups directly detected and inferred skills without treating ordinary tools as skills", () => {
  const events = [
    { type: "response_item", timestamp: "2026-01-01T00:00:00Z", payload: { type: "custom_tool_call", name: "exec", input: "await tools.exec_command({cmd: 'sed -n 1,200p /plugins/sites/skills/sites-building/SKILL.md'});" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "custom_tool_call", name: "exec", input: "await tools.exec_command({cmd: 'sed -n 201,400p /plugins/sites/skills/sites-building/SKILL.md'});" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: { type: "custom_tool_call", name: "exec", input: "const r = await tools.mcp__codex_apps__figma_use({});" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:03Z", payload: { type: "function_call", name: "mcp__codex_apps__spreadsheet_edit", arguments: "{}" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:04Z", payload: { type: "custom_tool_call", name: "exec", input: "const r = await tools.exec_command({cmd: 'ls'});" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:05Z", payload: { type: "custom_tool_call", name: "exec", input: "await tools.apply_patch('test fixture /plugins/sites/skills/imaginary/SKILL.md');" } },
  ];
  const skills = detectSkills(events);
  assert.deepEqual(skills.map(({ name, count, detection }) => ({ name, count, detection })), [
    { name: "Sites building", count: 2, detection: "detected" },
    { name: "Figma", count: 1, detection: "inferred" },
    { name: "Spreadsheets", count: 1, detection: "inferred" },
  ]);
});

test("describes common filename extensions in normal language", () => {
  assert.equal(fileTypeName("build_demo.mjs"), "Modular JavaScript source code file");
  assert.equal(fileTypeName("app/page.tsx"), "React TypeScript source code file");
  assert.equal(fileTypeName("results.xlsx"), "Microsoft Excel workbook");
  assert.equal(fileTypeName("package.json"), "JavaScript project information file");
  assert.equal(fileTypeName("README.md"), "Project documentation file");
  assert.equal(fileTypeName("mystery.xyz"), "File with an uncommon .xyz format");
});
