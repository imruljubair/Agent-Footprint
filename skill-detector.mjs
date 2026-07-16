const definitions = {
  "sites-building": { name: "Sites building", general: "Provides guidance for building or updating a complete website while preserving the project's hosting structure.", description: "Used the Sites building workflow to make or check changes to a website." },
  "sites-hosting": { name: "Sites hosting", general: "Provides guidance for publishing and managing a website through Sites hosting.", description: "Used the Sites hosting workflow to publish or manage a website." },
  imagegen: { name: "Image generation", general: "Provides a structured workflow for creating or editing bitmap images from written instructions.", description: "Used the image-generation workflow to create or edit visual material." },
  "openai-docs": { name: "OpenAI documentation", general: "Provides current, official guidance for building with OpenAI products and APIs.", description: "Used the OpenAI documentation workflow to answer or implement an OpenAI-related request." },
  "skill-creator": { name: "Skill creation", general: "Provides guidance for designing and maintaining reusable Codex skills.", description: "Used the skill-creation workflow to create or improve a Codex skill." },
  "skill-installer": { name: "Skill installation", general: "Provides guidance for finding and installing Codex skills.", description: "Used the skill-installation workflow to add a Codex skill." },
  "plugin-creator": { name: "Plugin creation", general: "Provides guidance for creating and maintaining Codex plugins.", description: "Used the plugin-creation workflow to create or update a plugin." },
  "control-in-app-browser": { name: "Browser control", general: "Provides guidance for interacting with pages through the in-app browser.", description: "Used the browser-control workflow to open or interact with a page." },
  documents: { name: "Documents", general: "Provides a specialized workflow for creating, editing, and checking Word-style documents.", description: "Used the document workflow to work with a document correctly." },
  pdf: { name: "PDF", general: "Provides a specialized workflow for reading, creating, and visually checking PDF files.", description: "Used the PDF workflow to work with a PDF correctly." },
  presentations: { name: "Presentations", general: "Provides a specialized workflow for creating, editing, and checking slide presentations.", description: "Used the presentation workflow to work with slides correctly." },
  spreadsheets: { name: "Spreadsheets", general: "Provides a specialized workflow for creating, editing, analyzing, and checking spreadsheet files.", description: "Used the spreadsheet workflow to work with tabular data correctly." },
  "excel-live-control": { name: "Excel control", general: "Provides guidance for working with a currently connected Microsoft Excel workbook.", description: "Used the Excel-control workflow to work with a live workbook." },
  visualize: { name: "Visualization", general: "Provides guidance for creating clear charts, interactive demonstrations, and explanatory visualizations.", description: "Used the visualization workflow to present information visually." },
  "figma-use": { name: "Figma", general: "Provides guidance for reading from or writing to a Figma design file using connected tools.", description: "Used a Figma workflow to work with a design file correctly." },
};

function titleFromSlug(slug) {
  return String(slug || "Specialized workflow").replace(/^figma-/, "Figma ").replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function definitionFor(slug) {
  if (definitions[slug]) return definitions[slug];
  const name = titleFromSlug(slug);
  return {
    name,
    general: `Provides specialized instructions for ${name.toLowerCase()} work.`,
    description: `Used the ${name} workflow to handle that kind of work correctly.`,
  };
}

function wrappedToolName(input) {
  const matches = [...String(input || "").matchAll(/\btools\.([a-z0-9_]+)\s*\(/gi)];
  return matches.at(-1)?.[1] || "";
}

function lastExecCommandText(input) {
  const text = String(input || "");
  const start = text.lastIndexOf("tools.exec_command");
  if (start < 0) return "";
  const tail = text.slice(start);
  const doubleQuoted = tail.match(/\bcmd\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (doubleQuoted) {
    try { return JSON.parse(`"${doubleQuoted[1]}"`); } catch { return doubleQuoted[1]; }
  }
  return tail.match(/\bcmd\s*:\s*'([^']*)'/s)?.[1] || "";
}

function inferredSlug(call) {
  const name = String(call.name || "");
  const input = String(call.input || call.arguments || "");
  const wrapped = name === "exec" ? wrappedToolName(input) : name;
  if (/image_gen__imagegen|imagegen/i.test(wrapped)) return "imagegen";
  if (/figma/i.test(wrapped)) return "figma-use";
  if (/excel_live|excel-live/i.test(wrapped)) return "excel-live-control";
  if (/spreadsheet|excel/i.test(wrapped)) return "spreadsheets";
  if (/presentation|powerpoint|slides/i.test(wrapped)) return "presentations";
  if (/\bpdf\b/i.test(wrapped)) return "pdf";
  if (/document|docx|word/i.test(wrapped)) return "documents";
  if (/visualize/i.test(wrapped)) return "visualize";
  if (/mcp__browser|browser__|control_in_app_browser/i.test(wrapped)) return "control-in-app-browser";
  return null;
}

export function detectSkills(events, startIndex = 0) {
  const skills = new Map();
  const add = (slug, time, detection) => {
    const definition = definitionFor(slug);
    const key = definition.name.toLowerCase();
    const previous = skills.get(key);
    const finalDetection = previous?.detection === "detected" || detection === "detected" ? "detected" : "inferred";
    const sourceText = finalDetection === "detected" ? "The workflow instructions were loaded directly." : "This workflow was inferred from a specialized tool call.";
    skills.set(key, {
      name: definition.name,
      description: `${definition.description} ${sourceText}`,
      help: definition.general,
      detection: finalDetection,
      time: previous?.time || time,
      count: (previous?.count || 0) + 1,
    });
  };

  for (const event of events.slice(startIndex)) {
    if (event.type !== "response_item" || !["custom_tool_call", "function_call"].includes(event.payload?.type)) continue;
    const call = event.payload;
    const input = String(call.input || call.arguments || "");
    const explicit = new Set();
    const identity = call.name === "exec" ? wrappedToolName(input) : String(call.name || "");
    const directlyReadsInstructions = /exec_command|read_mcp_resource|skills?_read/i.test(identity);
    const instructionSource = /exec_command/i.test(identity) ? lastExecCommandText(input) : input;
    if (directlyReadsInstructions) for (const match of instructionSource.matchAll(/[\\/]skills[\\/](?:\.system[\\/])?([^\\/\s"'`]+)[\\/]SKILL\.md/gi)) explicit.add(match[1].toLowerCase());
    for (const slug of explicit) add(slug, event.timestamp, "detected");
    if (!explicit.size) {
      const slug = inferredSlug(call);
      if (slug) add(slug, event.timestamp, "inferred");
    }
  }
  return [...skills.values()];
}
