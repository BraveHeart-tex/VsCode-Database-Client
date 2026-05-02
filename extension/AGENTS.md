# AGENTS.md

Guidance in this file applies to everything under `extension/`.

## Purpose

This package is the VS Code extension host side of `db-client`.

It is responsible for:
- extension activation and command registration
- sidebar tree views and other VS Code UI contributions
- the webview panel wrapper
- message passing between the extension host and the webview UI
- database connection lifecycle and query execution

The Svelte frontend lives outside this folder in `webview-ui/`. Shared protocol and payload types live in `shared/`.

## Architecture

- `src/extension.ts`
  - activation entry point
  - registers commands, views, and message bus handlers
- `src/bridge/MessageBus.ts`
  - extension-side messaging layer for the webview
- `src/panels/MainPanel.ts`
  - creates the `WebviewPanel`
  - handles dev-server vs built-webview loading
- `src/db/ConnectionStore.ts`
  - persists saved connection configs in VS Code secret storage
- `src/db/ConnectionManager.ts`
  - owns live PostgreSQL pools and query execution
- `src/providers/SchemaTreeProvider.ts`
  - sidebar tree data provider for connections, schemas, tables, and columns

## Working rules

- Prefer small edits that match the existing file structure.
- Reuse `ConnectionManager` for database access. Do not open ad hoc database clients in providers or commands.
- Reuse `ConnectionStore` for persisted connection data. Do not add duplicate persistence paths.
- Keep shared message contracts in `shared/` rather than redefining payloads locally.
- When changing webview communication, update both the extension handler and the shared message type.
- When changing sidebar behavior, prefer extending `SchemaTreeProvider` instead of adding parallel tree abstractions.
- Keep VS Code API usage explicit and easy to follow. Avoid clever wrappers unless they remove real duplication.

## Database behavior

- Assume PostgreSQL-compatible databases.
- Use metadata tables in `information_schema` for schema introspection when possible.
- Do not infer keys or relationships from naming conventions like `id` or `*_id`.
- Escape SQL literals carefully when building introspection SQL strings.
- Handle connection and query failures explicitly and surface useful messages through VS Code UI.

## Webview integration

- `MainPanel` should be the only place that decides whether the webview loads from the Vite dev server or built assets.
- Preserve strict CSP behavior. If dev-mode changes are needed, keep them scoped and intentional.
- `MessageBus` is the extension/webview communication boundary. Keep payloads serializable.

## Tree view conventions

- Use `ThemeIcon` names supported by VS Code.
- Keep labels short and move richer metadata into `description` or `tooltip`.
- Load expensive children lazily. Do not eagerly fetch table columns while expanding a connection or schema.
- Return empty arrays or message nodes on recoverable tree-load failures, and show a VS Code error message when helpful.

## Validation

Run these commands after logic changes in this package:

```sh
pnpm -C extension typecheck
pnpm -C extension build
```

If a change affects shared contracts or extension/webview integration, also run the relevant checks in sibling packages.

## Testing

- Add or update tests only when there is already a clear test home for the behavior.
- Do not invent a new test harness for a very small change.
- If no tests are added, make sure the validation commands above are run and reported.

## Style notes

- Keep TypeScript strict. Avoid `any`.
- Prefer descriptive helper functions over dense inline logic.
- Follow the current naming style: concrete class names, direct method names, and small local helpers.
- Avoid unrelated refactors while implementing a focused feature.
