# Examples

The following examples are fictional. They demonstrate how Agent Footprint presents local Codex activity without publishing raw prompts, commands, outputs, source code, or full paths.

## Selecting a different Codex Home

Suppose Codex records are stored in a custom directory:

```text
/Users/example/codex-profile
└── sessions/
```

Open **Codex Home**, choose or enter `/Users/example/codex-profile`, and select **Use this directory**. The dashboard validates the folder, reports how many session files it found, and refreshes the request list.

Selecting `/Users/example/codex-profile/sessions` also works: Agent Footprint automatically uses its parent as Codex Home.

Use **Restore automatic location** to return to `CODEX_HOME`, or to `~/.codex` when that environment variable is absent.

## Individual requests in one conversation

Given this conversation:

```text
User: Create a one-page PDF explaining the project.
Codex: [creates and checks the document]
User: Still working?
Codex: The PDF is ready.
```

the sidebar shows two entries:

```text
01  Create a one-page PDF explaining the project.  DONE
02  Still working?                                    DONE
```

Document creation and inspection belong to the first request because they occurred before the second user message.

## Software task

For `Add validation to the contact form and test it`, the expanded dashboard might show:

```text
Files
  contact-form.tsx       TypeScript React source file — Updated
  contact-form.test.tsx  TypeScript React test source file — Created

Commands
  File inspection ×4
  Run automated tests ×2

Tool calls
  Command runner ×6
  File editor ×2
```

Repeated operations are grouped to keep the overview readable. The `?` control explains each friendly label.

## Online research

A Research item may include a sanitized source:

```text
Online research
  Read public documentation
  Source: https://docs.example.org/guide
```

Credentials, fragments, and sensitive or tracking query parameters are removed. When no recoverable public URL exists, the research activity remains visible but the dashboard does not invent a link.

## Files with unfamiliar extensions

```text
build-demo.mjs  Modular JavaScript source code file — Updated
records.parquet Apache Parquet data file — Inspected
```

Unknown extensions fall back to a general file description rather than making an unsupported claim.

## Skills and workflows

```text
Skills & workflows
  PDF workflow — Directly detected
  Spreadsheet workflow — Inferred from recorded tools
```

Skill detection is not guaranteed because session records do not always contain a separate Skill event.

## Tokens and peak context

```text
Input tokens   333.8K
Output tokens    3.0K
Total tokens   336.8K
Peak context     18.1% (46.7K of 258.4K)
```

Total tokens are cumulative usage recorded for the request. Peak context is the largest portion of the model’s context window occupied at one time, not the percentage of cumulative tokens used.

