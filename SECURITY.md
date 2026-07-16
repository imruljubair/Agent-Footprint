# Security and privacy

Agent Footprint is intended to run locally. It reads Codex session records from a user-selected Codex Home and uses a local Ollama model for generated explanations.

## Local access

- The analyzer listens only on `127.0.0.1`.
- Browser requests are accepted only from `localhost` and `127.0.0.1` origins.
- Directory selection is validated and must contain a `sessions` directory.
- Finder and folder-picker operations use fixed system programs with argument arrays rather than shell interpolation.
- Settings are saved with user-only file permissions where supported.

## What to review before use

- The application needs read access to the selected Codex Home to build the dashboard.
- Sanitization reduces accidental disclosure but cannot guarantee that every possible secret format will be recognized.
- Do not expose the local analyzer through a proxy, port-forward, public tunnel, or untrusted network.
- Review the source and use synthetic session data before adapting the project for a shared or remotely hosted environment.

## Reporting a vulnerability

Do not publish credentials, private session records, or exploitable details in a public issue. Contact the repository owner privately with a concise description, reproduction steps, and the affected version. Repository owners should replace this paragraph with their preferred private security-contact method before publishing.

