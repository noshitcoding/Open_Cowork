---
title: Current Routes
type: route
doc_type: current-state
status: seed-current
owner: product-docs
last_updated: 2026-07-02
last_verified: 2026-07-02
routes:
  - /
  - /tasks
  - /crew
  - /projects
  - /features
  - /settings
canonical_for:
  - current route inventory
  - navigation shell behavior
source_files:
  - app/src/App.tsx
  - app/src/components/Layout.tsx
  - app/src/components/LeftSidebar.tsx
  - app/src/components/SettingsView.tsx
  - app/src/components/ProjectView.tsx
  - app/src/components/TasksView.tsx
  - app/src/components/CrewView.tsx
  - app/src/components/FeaturesView.tsx
related_docs:
  - docs/ARCHITECTURE_CURRENT.md
---

# Current Routes

Routes are declared in `AppRoutes` and nested under `Layout`.

| Path | Component | Current Purpose |
| --- | --- | --- |
| `/` | `CoworkView` | Main chat workspace with provider/model selection, attachments, project context, approvals, tool progress, terminal dock, and assistant output. |
| `/tasks` | `TasksView` | Create, edit, run, stop, delete, and schedule work tasks. Tasks can run through a crew or directly through a model. |
| `/crew` | `CrewView` -> `CrewPanel` | Configure crews, agents, providers, governance, runtime settings, access, diagnostics, history, and live run behavior. |
| `/projects` | `ProjectView` | Manage projects, project instructions, linked files/folders/links, and project-thread membership. |
| `/features` | `FeaturesView` | Current feature status dashboard for major product areas. |
| `/settings` | `SettingsView` | Settings workspace with tabbed sections controlled by the `section` search param. |
| `*` | `Navigate` | Redirects unknown paths to `/`. |

## Settings Sections

`/settings` defaults to `section=ai` when no valid section is supplied.

| Section Key | Label | Owns |
| --- | --- | --- |
| `ai` | AI & model | LLM profiles, provider defaults, streaming autosave, personalities |
| `agent` | Agent & Skills | Agent behavior, engine config, system prompts, skills, pipelines, embedded crew panel |
| `memory` | Memory | Agent memory, profile, provider, notes |
| `sessions` | Sessions & Insights | Session search, insights, run panel |
| `terminal` | Terminal & Processes | Terminal backends and managed processes |
| `mcp` | MCP Server | MCP settings and server management |
| `ui` | Interface | Focus/compact/verbose modes, timestamps, theme sync, notifications, close confirmation |
| `security` | Security & data | File safety, command filters, toolset policy, data retention, runtime instructions |
| `system` | System & Info | Workspace path, gateway diagnostics, connectors, about/disclaimer |

## Shell Decisions

- `BrowserRouter` is used inside the desktop app.
- Route components are lazy-loaded and wrapped with `RouteReady` to remove the boot loader after the first render frame.
- `Layout` is persistent across routes and owns top navigation, left sidebar, command palette, shortcut overlay, language switcher, and theme toggle.
- Top-tab routes are `/`, `/tasks`, `/crew`, `/projects`, `/features`, and `/settings`.
- Keyboard shortcuts are currently `Ctrl+1` workspace, `Ctrl+2` settings, `Ctrl+3` crew, `Ctrl+K` command palette, `Ctrl+Shift+B` sidebar, `Ctrl+Shift+L` theme, and `Ctrl+Shift+?` shortcuts overlay.
- Focus mode hides the left sidebar; the left sidebar is resizable between the store-defined min/max width.

## Route Update Rule

When adding or removing a route, update this file, `App.tsx`, `Layout.tsx`, and any command-palette/navigation tests in the same change.
