# Agent Footprint

Agent Footprint is a private, local dashboard that explains recent Codex activity in ordinary language. It separates conversations into individual user requests and summarizes the files, commands, research, tools, Skills, tokens, and outcomes associated with each request.

Version 9 uses `llama3.2:latest` through a local Ollama service. Task records are not sent to a hosted Llama service.

## Highlights

- Treats every user request as a separate sidebar entry, including follow-ups in the same Codex conversation.
- Lets the user view, choose, enter, save, and reveal the active Codex Home directory.
- Respects the official `CODEX_HOME` environment variable and falls back to `~/.codex`.
- Shows the newest 20 requests first and loads older requests in groups of 20.
- Explains recorded activity in plain language instead of exposing internal tool terminology.
- Groups repeated commands and tool calls with occurrence counts.
- Shows friendly file-type names, such as “Modular JavaScript source code file” for `.mjs`.
- Includes sanitized, clickable public links when recorded online research contains a usable URL.
- Shows token totals and peak context use when Codex recorded those values.
- Detects specialized Skills and workflows when the session contains enough evidence.
- Keeps generated explanations and settings on the local computer.

See [EXAMPLES.md](EXAMPLES.md) for representative behavior.

## Requirements

The one-click launcher is designed for macOS. You need:

- Codex with local session records
- [Node.js](https://nodejs.org/) 22.13 or newer
- npm
- [Ollama](https://ollama.com/)
- The Ollama `llama3.2` model; the launcher downloads it when necessary

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/agent-footprint.git
cd agent-footprint
chmod +x start-footprint.command
./start-footprint.command
```

The launcher installs npm dependencies on the first run, checks Ollama and Llama 3.2, chooses available local ports, starts the analyzer and dashboard, and opens the correct address.

Keep the launcher’s Terminal window open while using Agent Footprint. Press `Control-C` there to stop it.

After the first run, macOS users can also open `start-footprint.command` from Finder. If macOS blocks the downloaded script, right-click it, choose **Open**, and confirm once.

## Selecting Codex Home

Open **Codex Home** in the dashboard header. The panel shows the active directory, how it was selected, and how many session files were found. From there you can:

- Enter an absolute directory manually.
- Open the macOS folder chooser.
- Reveal the active directory in Finder.
- Restore the automatic location.

The automatic location is:

1. `CODEX_HOME`, when that environment variable is set.
2. `~/.codex`, otherwise.

Choose the Codex Home directory that contains the `sessions` folder. If you choose `sessions` itself, Agent Footprint automatically uses its parent directory. A selected directory is validated before it is saved.

The preference is stored locally as `agent-footprint/settings-v9.json` inside the automatic Codex Home. Restoring the automatic location removes that saved preference.

## Manual start

Use three Terminal windows if you prefer to run each service separately.

1. Start Ollama:

   ```bash
   ollama serve
   ```

2. Start the local analyzer:

   ```bash
   npm install
   FOOTPRINT_API_PORT=4317 FOOTPRINT_MODEL=llama3.2:latest node local-server.mjs
   ```

3. Start the dashboard:

   ```bash
   npm run dev -- --port 3000 --strictPort
   ```

Open `http://localhost:3000/?api=4317&version=9`.

If either port is occupied, use different ports and make the `api` query parameter match `FOOTPRINT_API_PORT`.

## How request separation works

One Codex task can contain several user messages. Agent Footprint creates one dashboard entry for every user request. Activity following a request belongs to that request until the next user message begins.

For example, these appear separately:

1. `Create a one-page PDF explaining the project.`

PDF creation and inspection belong to the first request. The follow-up may have little or no activity if it only asked for status.

Request titles retain the original first line rather than being rewritten. Attachment metadata or pasted formatting can therefore occasionally appear in a title.

## Privacy model

Agent Footprint reads the selected local Codex Home and calls Ollama on `127.0.0.1`.

- Raw shell commands, source code, command output, and full local paths are not displayed.
- Known command patterns are classified with local rules.
- Before an unfamiliar command is explained by local Llama, paths, URLs, credentials, environment values, and potentially sensitive arguments are removed.
- Explanations are cached with hashed lookup keys; raw commands are not stored in that cache.
- Research links are limited to public HTTP or HTTPS addresses after credentials, fragments, and sensitive or tracking parameters are removed.
- The local analyzer accepts browser calls only from `localhost` or `127.0.0.1` origins.

The Research section describes network-related activity recorded by Codex. It is not packet-level monitoring.

See [SECURITY.md](SECURITY.md) for additional privacy guidance.

## Known limitations

- The launcher, folder chooser, and Finder integration are macOS-specific.
- Codex Home is configurable, but compatibility still depends on the structure of locally recorded Codex session events.
- Skill detection is best-effort. Loading a `SKILL.md` file is direct evidence, while some workflows can only be inferred.
- Live progress is an estimate because Codex does not record how many future operations remain.
- Research links appear only when a usable public URL exists in the recorded activity.
- Very large histories can take longer to scan.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

Key files:

```text
app/                       Dashboard interface
local-server.mjs           Local analyzer, settings API, and session reader
codex-home.mjs             Codex Home resolution and validation
request-segments.mjs       Individual-request segmentation
command-classifier.mjs     Privacy-aware command classification
research-links.mjs         Public research-link sanitization
skill-detector.mjs         Best-effort Skill and workflow detection
file-types.mjs             Friendly file-type labels
tests/                     Automated behavior and privacy checks
start-footprint.command    macOS launcher
```

the code.

