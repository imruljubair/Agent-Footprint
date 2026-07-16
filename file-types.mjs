import { basename, extname } from "node:path";

const specialNames = {
  ".env": "Environment settings file",
  ".gitignore": "Git ignore rules file",
  ".npmrc": "Node package-manager settings file",
  ".nvmrc": "Node.js version settings file",
  dockerfile: "Docker container instructions file",
  license: "Software license document",
  makefile: "Build instructions file",
  "package-lock.json": "JavaScript dependency lock file",
  "package.json": "JavaScript project information file",
  "tsconfig.json": "TypeScript configuration file",
};

const extensionNames = {
  ".c": "C source code file",
  ".cjs": "CommonJS JavaScript source code file",
  ".command": "macOS command script",
  ".cpp": "C++ source code file",
  ".css": "Cascading Style Sheet",
  ".csv": "Comma-separated spreadsheet data file",
  ".db": "Database file",
  ".doc": "Microsoft Word document",
  ".docx": "Microsoft Word document",
  ".gif": "Animated or still image file",
  ".go": "Go source code file",
  ".html": "Web page file",
  ".java": "Java source code file",
  ".jpeg": "JPEG image file",
  ".jpg": "JPEG image file",
  ".js": "JavaScript source code file",
  ".json": "JSON data or configuration file",
  ".jsonl": "Line-by-line JSON log or data file",
  ".jsx": "React JavaScript source code file",
  ".lock": "Dependency lock file",
  ".md": "Markdown documentation file",
  ".mjs": "Modular JavaScript source code file",
  ".pdf": "Portable Document Format file",
  ".php": "PHP source code file",
  ".png": "PNG image file",
  ".ppt": "Microsoft PowerPoint presentation",
  ".pptx": "Microsoft PowerPoint presentation",
  ".py": "Python source code file",
  ".rb": "Ruby source code file",
  ".rs": "Rust source code file",
  ".sass": "Sass stylesheet file",
  ".scss": "Sass stylesheet file",
  ".sh": "Shell script",
  ".sql": "Database query script",
  ".sqlite": "SQLite database file",
  ".svg": "Scalable vector image file",
  ".toml": "TOML configuration file",
  ".ts": "TypeScript source code file",
  ".tsx": "React TypeScript source code file",
  ".tsv": "Tab-separated data file",
  ".txt": "Plain text document",
  ".vue": "Vue component source file",
  ".webp": "WebP image file",
  ".xls": "Microsoft Excel workbook",
  ".xlsx": "Microsoft Excel workbook",
  ".xml": "XML data file",
  ".yaml": "YAML configuration file",
  ".yml": "YAML configuration file",
  ".zip": "Compressed file archive",
};

export function fileTypeName(path) {
  const name = basename(String(path || "")).toLowerCase();
  if (specialNames[name]) return specialNames[name];
  if (name.endsWith(".d.ts")) return "TypeScript declaration file";
  if (/^readme(?:\.|$)/.test(name)) return "Project documentation file";
  const extension = extname(name);
  if (extensionNames[extension]) return extensionNames[extension];
  if (extension) return `File with an uncommon ${extension} format`;
  return "File without a filename extension";
}
