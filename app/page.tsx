"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TaskSize = "small" | "medium" | "large";
type Task = { id: string; title: string; prompt: string; workspace: string; updatedAt: string; status: "complete" | "working"; size: TaskSize; activityCount: number };
type WorkItem = { time: string; category: string; subject: string; description: string; detail: string };
type WorkGroup = { id: string; title: string; summary: string; why: string; outcome: string; start: string; end: string; items: WorkItem[] };
type EvidenceLink = { label: string; url: string };
type EvidenceItem = { name: string; description: string; fileType?: string; help?: string; links?: EvidenceLink[]; time: string; count: number };
type EvidenceCategory = { id: "files" | "folders" | "commands" | "research" | "software" | "skills" | "tools"; label: string; count: number; items: EvidenceItem[] };
type Usage = { available: boolean; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number; totalTokens?: number; peakContextTokens?: number; contextWindow?: number; contextPercent?: number };
type Analysis = {
  task: Task & { startedAt: string; duration: string; progress: number };
  overview: string;
  activitySummary: string;
  groups: WorkGroup[];
  categories: EvidenceCategory[];
  totals: { actions: number; files: number; folders: number; commands: number; research: number; software: number; skills: number; tools: number; checks: number; network: number };
  usage: Usage;
  privacy: { model: string; localOnly: boolean };
  analyzedAt: string;
  warning?: string;
};
type CodexSettings = {
  codexHome: string;
  sessionsDir: string;
  source: "saved" | "environment" | "default";
  sourceLabel: string;
  sessionFileCount: number;
  platformBrowseAvailable: boolean;
};

function apiBase() {
  if (typeof window === "undefined") return "http://127.0.0.1:4317";
  const port = new URLSearchParams(window.location.search).get("api") || "4317";
  return `http://127.0.0.1:${port}`;
}

function timeAgo(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function categoryLabel(category: string) {
  return ({ files: "File", setup: "Setup", check: "Check", review: "Review", model: "Llama", research: "Online", skill: "Skill", media: "Image", work: "Work" } as Record<string, string>)[category] || "Work";
}

function compactNumber(value = 0) {
  return new Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

const categoryMarks: Record<string, string> = { files: "F", folders: "D", commands: ">", research: "R", software: "S", skills: "K", tools: "T" };

const evidenceHelp: Record<string, string> = {
  "change review": "Checks the project's saved and unsaved changes so the agent can understand what was modified and avoid overwriting existing work.",
  "file inspection": "Looks through file names, folders, or selected file contents to understand how a project is organized. This is normally a read-only action.",
  "project build": "Turns the project's source files into a finished version and reports compilation or configuration problems.",
  "automated checks": "Runs the project's tests or other checks to confirm that important behavior still works.",
  "local preview": "Starts the project on this computer so the agent or user can open and check it locally.",
  "package installation": "Adds software packages that the project needs in order to build or run.",
  "ollama and llama": "Uses the locally installed Ollama service and Llama model. In Agent Footprint, Llama rewrites sanitized activity details in normal language.",
  "file organization": "Creates, copies, moves, or arranges project files and folders.",
  "online lookup": "Uses an internet-connected lookup to find information needed for the task.",
  "supporting command": "Runs a terminal operation that supports the task, such as inspecting, preparing, or checking the project.",
  "did other computer work": "A computer operation that could not be classified confidently enough to give it a more specific name.",
  "environment check": "Checks which software or system environment is available before the agent relies on it.",
  "dependency check": "Checks installed software packages and their versions without adding anything new.",
  "process management": "Finds, checks, or stops programs that are currently running on the computer.",
  "service control": "Starts, stops, or checks a background service needed by the task.",
  "file search": "Searches file names or text to locate relevant parts of a project.",
  "text processing": "Filters, rearranges, or summarizes text produced by files or other commands.",
  "version-control operation": "Uses Git to save, organize, retrieve, or combine versions of project work.",
  "database operation": "Inspects or changes structured records stored in a database.",
  "permission change": "Changes who can open, edit, or run a file or folder.",
  "script execution": "Runs a script that performs a prepared sequence of project operations.",
  "network request": "Requests information or a file through a network connection.",
  "browser launch": "Opens a local or online page so it can be viewed in a browser.",
  "archive operation": "Creates or opens a compressed collection of files.",
  "used the terminal": "Asked the computer's terminal to inspect files, start an app, build a project, or run tests.",
  "edited files": "Made a controlled change to one or more project files.",
  "controlled a running process": "Sent input to, or checked on, a program that was already running.",
  "waited for a process": "Waited for a longer operation to produce more output or finish.",
  "researched online": "Searched for or opened information on the internet to support the task.",
  "generated an image": "Created or edited an image from written instructions.",
  "viewed an image": "Opened an existing image so its visible content could be inspected.",
  "read codex history": "Read information from recent Codex tasks to recover relevant context.",
  "used figma": "Read from or wrote to a Figma design file using connected tools.",
  "used spreadsheet tools": "Read, analyzed, or updated spreadsheet data using specialized tools.",
  "used document tools": "Read, created, or updated documents, PDFs, or presentations using specialized tools.",
  "coordinated tools": "Coordinated one or more tool actions in a single step.",
};

function helpForEvidence(category: EvidenceCategory["id"], name: string) {
  const exact = evidenceHelp[name.toLowerCase()];
  if (exact) return exact;
  return ({
    files: `This is a project file the agent read, created, updated, or removed while completing the task.`,
    folders: `This is a folder the agent used to organize or locate related project files.`,
    commands: `This is a general kind of terminal command. The dashboard hides the raw command and shows its purpose instead.`,
    research: `This represents information the agent looked up outside the local project. Safe public source links are shown when the record contains them.`,
    software: `This is software or a package added so the project could run, build, or support a requested capability.`,
    skills: `This is a specialized workflow the agent loaded directly or that the dashboard inferred from a specialized tool call.`,
    tools: `This is a capability Codex called to perform a specific kind of work, such as running a command, editing a file, or checking an image.`,
  } satisfies Record<EvidenceCategory["id"], string>)[category];
}

function HelpTip({ id, text, label }: { id: string; text: string; label: string }) {
  return (
    <span className="help-tip">
      <button type="button" aria-label={`What does ${label} mean?`} aria-describedby={id}>?</button>
      <span className="help-popup" id={id} role="tooltip">{text}</span>
    </span>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [taskLimit, setTaskLimit] = useState(20);
  const [totalTasks, setTotalTasks] = useState(0);
  const [settings, setSettings] = useState<CodexSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codexHomeDraft, setCodexHomeDraft] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");

  const loadSettings = useCallback(async () => {
    const response = await fetch(`${apiBase()}/api/settings`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The Codex Home setting could not be loaded.");
    setSettings(body);
    setCodexHomeDraft(body.codexHome || "");
    return body as CodexSettings;
  }, []);

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(taskLimit) });
    const response = await fetch(`${apiBase()}/api/tasks?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The recent tasks could not be loaded.");
    setTasks(body.tasks || []);
    setTotalTasks(Number(body.total || 0));
    if (body.tasks?.length) setSelected((current) => current || body.tasks[0].id);
    else { setSelected(""); setAnalysis(null); setLoading(false); }
  }, [taskLimit]);

  const analyze = useCallback(async (id: string, quiet = false) => {
    if (!id) return;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const response = await fetch(`${apiBase()}/api/analyze?id=${encodeURIComponent(id)}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This task could not be explained.");
      setAnalysis(body);
      setOpenCards(new Set(body.groups?.[0]?.id ? [body.groups[0].id] : []));
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "The local analyzer is not available.");
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    // These asynchronous loaders synchronize the view with the local analyzer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings().catch(() => undefined);
    loadTasks().catch((err) => { setError(err instanceof Error ? err.message : "The local analyzer is not available."); setLoading(false); });
  }, [loadSettings, loadTasks]);

  useEffect(() => {
    // A selection change starts its asynchronous local analysis.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selected) analyze(selected);
  }, [selected, analyze]);

  useEffect(() => {
    if (analysis?.task.status !== "working") return;
    const timer = window.setInterval(() => loadTasks().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [analysis?.task.status, loadTasks]);

  useEffect(() => {
    // Keep the selection valid when a different Codex Home loads a new list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tasks.length && !tasks.some((task) => task.id === selected)) setSelected(tasks[0].id);
  }, [tasks, selected]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selected), [tasks, selected]);
  const openSettings = () => {
    setCodexHomeDraft(settings?.codexHome || "");
    setSettingsNotice("");
    setSettingsOpen(true);
  };
  const saveSettings = async (reset = false) => {
    setSettingsBusy(true);
    setSettingsNotice("");
    try {
      const response = await fetch(`${apiBase()}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reset ? { reset: true } : { codexHome: codexHomeDraft }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The Codex Home directory could not be changed.");
      setSettings(body);
      setCodexHomeDraft(body.codexHome);
      setSettingsNotice(`Using this directory. ${body.sessionFileCount} session ${body.sessionFileCount === 1 ? "file was" : "files were"} found.`);
      setError("");
      setSelected("");
      setAnalysis(null);
      setLoading(true);
      await loadTasks();
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : "The Codex Home directory could not be changed.");
    } finally { setSettingsBusy(false); }
  };
  const chooseDirectory = async () => {
    setSettingsBusy(true);
    setSettingsNotice("");
    try {
      const response = await fetch(`${apiBase()}/api/settings/choose`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The folder chooser could not be opened.");
      if (!body.cancelled && body.codexHome) {
        setCodexHomeDraft(body.codexHome);
        setSettingsNotice("Folder selected. Choose “Use this directory” to apply it.");
      }
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : "The folder chooser could not be opened.");
    } finally { setSettingsBusy(false); }
  };
  const revealDirectory = async () => {
    setSettingsBusy(true);
    setSettingsNotice("");
    try {
      const response = await fetch(`${apiBase()}/api/settings/reveal`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The directory could not be shown in Finder.");
      setSettingsNotice("Opened the active Codex Home directory in Finder.");
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : "The directory could not be shown in Finder.");
    } finally { setSettingsBusy(false); }
  };
  const toggle = (id: string) => setOpenCards((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">F</span><div><strong>Agent Footprint <em className="version-badge">V9</em></strong><small>Individual requests, explained clearly</small></div></div>
        <div className="top-actions">
          <div className="local-status"><span className="status-dot" />Local & private <b>Llama 3.2 · Ollama</b></div>
          <button type="button" className="directory-button" onClick={openSettings}><span aria-hidden="true">⌂</span> Codex Home</button>
        </div>
      </header>

      {settingsOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="codex-home-title">
            <div className="settings-heading">
              <div><span className="eyebrow">Local data source</span><h2 id="codex-home-title">Codex Home</h2></div>
              <button type="button" className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close Codex Home settings">×</button>
            </div>
            <p className="settings-intro">Agent Footprint reads the <code>sessions</code> folder inside this directory. Changing it only changes which local Codex records this dashboard reads.</p>
            <div className="current-directory">
              <span>Active directory</span>
              <code>{settings?.codexHome || "Loading…"}</code>
              <small>{settings?.sourceLabel || "Checking location"} · {settings?.sessionFileCount ?? 0} session files</small>
            </div>
            <label className="directory-field">
              <span>Provide a Codex Home directory</span>
              <input value={codexHomeDraft} onChange={(event) => setCodexHomeDraft(event.target.value)} placeholder="~/.codex" spellCheck={false} autoCapitalize="none" />
              <small>Choose the Codex Home folder itself. If you choose its <code>sessions</code> folder, Version 9 automatically uses the parent directory.</small>
            </label>
            <div className="settings-actions">
              {settings?.platformBrowseAvailable && <button type="button" className="secondary-action" onClick={chooseDirectory} disabled={settingsBusy}>Choose folder…</button>}
              <button type="button" className="primary-action" onClick={() => saveSettings(false)} disabled={settingsBusy || !codexHomeDraft.trim()}>{settingsBusy ? "Checking…" : "Use this directory"}</button>
              {settings?.platformBrowseAvailable && <button type="button" className="secondary-action" onClick={revealDirectory} disabled={settingsBusy}>Show in Finder</button>}
            </div>
            <div className="settings-footer">
              <button type="button" onClick={() => saveSettings(true)} disabled={settingsBusy}>Restore automatic location</button>
              <small>Automatic means <code>CODEX_HOME</code> when provided, otherwise <code>~/.codex</code>.</small>
            </div>
            {settingsNotice && <p className="settings-notice" role="status">{settingsNotice}</p>}
          </section>
        </div>
      )}

      <div className="workspace">
        <aside className="task-rail">
          <div className="rail-heading"><span>Recent requests</span><small>{tasks.length} of {totalTasks}</small></div>
          {tasks.length < totalTasks && <button type="button" className="load-older" onClick={() => setTaskLimit((current) => Math.min(totalTasks, current + 20))}><span>Load 20 older requests</span><small>{totalTasks - tasks.length} remaining</small></button>}
          <nav aria-label="Recent Codex requests">
            {tasks.map((task, index) => (
              <button key={task.id} className={task.id === selected ? "task-button active" : "task-button"} onClick={() => setSelected(task.id)}>
                <span className="task-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{task.workspace} · {task.size} · {timeAgo(task.updatedAt)}</small></span>
                <span className={`task-state ${task.status}`} aria-label={task.status}>{task.status === "working" ? "Working" : "Done"}</span>
              </button>
            ))}
            {!tasks.length && <p className="task-list-empty">No recent Codex requests were found.</p>}
          </nav>
          <div className="rail-note"><span>Privacy note</span><p>Raw commands, source code, outputs, and full paths are not displayed.</p></div>
        </aside>

        <section className="content">
          {error ? (
            <div className="empty-state"><span>Couldn’t open the activity record</span><h1>The local analyzer is not responding.</h1><p>{error}</p><button onClick={() => selected ? analyze(selected) : loadTasks()}>Try again</button></div>
          ) : loading ? (
            <div className="loading-state"><div className="spinner" /><span>Llama is turning the activity record into a clear explanation…</span><small>This can take a little while for a large task.</small></div>
          ) : !analysis ? (
            <div className="empty-state"><span>No local requests found</span><h1>Choose the Codex Home that contains your session records.</h1><p>{settings ? `The active directory contains ${settings.sessionFileCount} session files.` : "The active Codex Home could not be confirmed."}</p><button onClick={openSettings}>Change Codex Home</button></div>
          ) : (
            <>
              <section className="summary-card">
                <div className="summary-top">
                  <div className="summary-copy"><span className="eyebrow">Task overview</span><h1>{selectedTask?.title || analysis.task.title}</h1><p>{analysis.overview}</p></div>
                  <button className="refresh-button" onClick={() => analyze(selected)} aria-label="Explain this task again">↻ <span>Explain again</span></button>
                </div>
                <div className="progress-row">
                  <div className="progress-copy"><span>{analysis.task.status === "working" ? "Codex is still working" : "Task finished"}</span><small>{analysis.task.duration} · {analysis.totals.actions} recorded actions</small></div>
                  <div className="progress-track" role="progressbar" aria-valuenow={analysis.task.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${analysis.task.progress}%` }} /></div>
                  <strong>{analysis.task.progress}%</strong>
                </div>
              </section>

              <section className="activity-snapshot">
                <div className="snapshot-heading"><div><span className="eyebrow">Activity summary</span><h2>What the agent used and changed</h2><p>{analysis.activitySummary}</p></div><small>Click any category to see its names and plain-language details.</small></div>
                <div className="evidence-grid">
                  {analysis.categories.map((category) => (
                    <details className={`evidence-card ${category.id}`} key={category.id}>
                      <summary>
                        <span className="evidence-mark">{categoryMarks[category.id]}</span>
                        <span className="evidence-title"><strong>{category.count}</strong><b>{category.label}</b></span>
                        <span className="evidence-open">View list <i>+</i></span>
                      </summary>
                      <div className="evidence-body">
                        {category.items.length ? <ul>{category.items.map((item, index) => (
                          <li key={`${category.id}-${index}`}>
                            <span className="evidence-name">
                              <span className={`name-chip ${category.id}`}>{item.name}</span>
                              <HelpTip id={`help-${category.id}-${index}`} label={item.name} text={item.help || helpForEvidence(category.id, item.name)} />
                            </span>
                            <span className="evidence-detail">
                              {item.fileType && <span className="file-type-name">{item.fileType}</span>}
                              <span className="evidence-description">{item.description}</span>
                              {!!item.links?.length && <span className="research-links" aria-label="Research sources">{item.links.map((link, linkIndex) => <a key={`${link.url}-${linkIndex}`} href={link.url} target="_blank" rel="noreferrer noopener">{link.label}<span aria-hidden="true">↗</span></a>)}</span>}
                            </span>
                            {item.count > 1 && <b className="repeat-count">×{item.count}</b>}
                          </li>
                        ))}</ul> : <p>{category.id === "skills" ? "No skills or specialized workflows were detected for this task." : `No ${category.label.toLowerCase()} were recorded for this task.`}</p>}
                        {category.id === "skills" && <div className="skill-detection-note"><span aria-hidden="true">!</span><p><strong>Skill detection is best-effort.</strong> Codex records do not always include a separate skill event. Some workflows are inferred from specialized tools, and others may not appear.</p></div>}
                      </div>
                    </details>
                  ))}
                </div>
              </section>

              <section className="usage-card">
                <div className="usage-heading"><span className="eyebrow">Token & context use</span><p>{analysis.usage.available ? "Measured from the token information stored in this Codex task." : "This older task does not include token information."}</p></div>
                {analysis.usage.available ? <>
                  <div className="usage-metrics">
                    <div><strong>{compactNumber(analysis.usage.inputTokens)}</strong><span>input tokens</span><small>{compactNumber(analysis.usage.cachedInputTokens)} cached</small></div>
                    <div><strong>{compactNumber(analysis.usage.outputTokens)}</strong><span>output tokens</span><small>{compactNumber(analysis.usage.reasoningTokens)} reasoning</small></div>
                    <div><strong>{compactNumber(analysis.usage.totalTokens)}</strong><span>total tokens</span><small>for this task</small></div>
                    <div><strong>{analysis.usage.contextPercent}%</strong><span>peak context</span><small>{compactNumber(analysis.usage.peakContextTokens)} of {compactNumber(analysis.usage.contextWindow)}</small></div>
                  </div>
                  <div className="context-track" aria-label={`${analysis.usage.contextPercent}% peak context use`}><span style={{ width: `${analysis.usage.contextPercent}%` }} /></div>
                </> : <span className="usage-unavailable">Token use is unavailable for this task.</span>}
              </section>

              <div className="section-title"><div><span>What happened</span><h2>The work, grouped into clear sections</h2></div><p>Open a section to see the files and supporting actions inside it.</p></div>

              <section className="work-list">
                {analysis.groups.map((group, index) => {
                  const open = openCards.has(group.id);
                  return (
                    <article className={open ? "work-card open" : "work-card"} key={group.id}>
                      <button className="card-cover" onClick={() => toggle(group.id)} aria-expanded={open}>
                        <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="card-main"><span className="card-time">{group.start}{group.end !== group.start ? ` – ${group.end}` : ""}</span><strong>{group.title}</strong><p>{group.summary}</p></span>
                        <span className="card-count">{group.items.length} {group.items.length === 1 ? "action" : "actions"}</span>
                        <span className="card-toggle">{open ? "−" : "+"}</span>
                      </button>
                      {open && (
                        <div className="card-details">
                          <div className={group.outcome ? "plain-explanation" : "plain-explanation single"}>
                            <div><span>Why this was done</span><p>{group.why}</p></div>
                            {group.outcome && <div><span>Result</span><p>{group.outcome}</p></div>}
                          </div>
                          {group.items.length > 0 && <ol className="action-list">
                            {group.items.map((item, itemIndex) => (
                              <li key={`${group.id}-${itemIndex}`}><span className={`action-icon ${item.category}`}>{categoryLabel(item.category).slice(0, 1)}</span><div><div className="action-meta"><b>{categoryLabel(item.category)}</b><time>{item.time ? new Date(item.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : ""}</time></div><p><span className={`name-chip ${item.category}`}>{item.subject}</span>{item.description}</p><small>{item.detail}</small></div></li>
                            ))}
                          </ol>}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {analysis.warning && <div className="warning"><strong>Llama fallback used</strong><span>{analysis.warning}</span></div>}
              <footer><span>Only plain-language descriptions are shown.</span><span>Updated {new Date(analysis.analyzedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
