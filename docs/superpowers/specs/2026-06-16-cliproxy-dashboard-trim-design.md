# CLIProxy Dashboard Trim — Design Spec

## Goal

Strip the `ccs/ui/` frontend to a CLIProxy-only management dashboard, matching the scope of CLIProxyAPIPlus's `management.html`. Remove all non-CLIProxy pages, routes, sidebar entries, backend routes, and dead code. Keep the Express backend that bridges to CLIProxy API.

## Scope

### Pages to KEEP

| Route | Page | Notes |
|-------|------|-------|
| `/` | HomePage | Dashboard overview (stats, health, errors) |
| `/analytics` | AnalyticsPage | Usage analytics with charts |
| `/cliproxy` | CliproxyPage | CLIProxy overview |
| `/cliproxy/ai-providers` | CliproxyAiProvidersPage | AI provider management |
| `/cliproxy/control-panel` | CliproxyControlPanelPage | CLIProxy control panel |
| `/logs` | LogsPage | Unified logging |
| `/health` | HealthPage | System health checks |
| `/settings` | SettingsPage | Stripped to CLIProxy-relevant tabs only |
| `/copilot` | CopilotPage | GitHub Copilot (deprecated section) |
| `/legacy/cursor` | CursorPage | Cursor IDE (deprecated section) |
| `/login` | LoginPage | Dashboard auth |

### Pages to REMOVE

| Route | Page | Reason |
|-------|------|--------|
| `/providers` | ApiPage | Profile management — out of scope |
| `/accounts` | AccountsPage | Account management — out of scope |
| `/shared` | SharedPage | Shared resources — out of scope |
| `/claude-extension` | ClaudeExtensionPage | Not in management.html scope |
| `/codex` | CodexPage | Not in management.html scope |
| `/droid` | DroidPage | Not in management.html scope |
| `/updates` | UpdatesPage | Not in management.html scope |
| `/cursor` (redirect) | — | Remove redirect, keep `/legacy/cursor` only |
| `/_styleguide` | StyleguidePage | Dev-only, remove |

### Settings Tabs to KEEP

- General / CLIProxy settings
- Proxy settings
- Auth settings
- Backup/restore

### Settings Tabs to REMOVE

- Browser automation
- WebSearch providers
- Image analysis backends
- Channels
- Environment variables (if CLIProxy-irrelevant)
- Think mode

### Sidebar Structure (after trim)

```
General
  - Home
  - Analytics

CLIProxy
  - Overview
  - AI Providers
  - Control Panel

System
  - Health
  - Logs
  - Settings

Deprecated
  - GitHub Copilot
  - Cursor IDE
```

### Backend Routes to REMOVE

| Route Group | Reason |
|-------------|--------|
| `/api/profiles` | Profile CRUD removed |
| `/api/accounts` | Account management removed |
| `/api/shared` | Shared resources removed |
| `/api/claude-extension` | Claude Extension removed |
| `/api/codex` | Codex CLI removed |
| `/api/droid` | Factory Droid removed |
| `/api/browser` | Browser automation removed |
| `/api/image-analysis` | Image analysis removed |
| `/api/websearch` | WebSearch removed |
| `/api/channels` | Channels removed |
| `/api/bar` | CCS Bar removed (not in scope) |

### Backend Routes to KEEP

| Route Group | Purpose |
|-------------|---------|
| `/api/auth` | Dashboard authentication |
| `/api/health` | System health checks |
| `/api/logs` | Logging |
| `/api/cliproxy` (all sub-routes) | CLIProxy management core |
| `/api/usage` | Usage analytics |
| `/api/settings` | Settings (trimmed) |
| `/api/config` | Unified config |
| `/api/persist` | Backup management |
| `/api/overview` | Dashboard overview stats (HomePage) |
| `/api/copilot` | GitHub Copilot (deprecated) |
| `/api/cursor` | Cursor IDE (deprecated) |

### Dead Code Cleanup

- Remove unused imports in frontend components
- Remove unused hooks, contexts, lib files that only served removed pages
- Remove unused backend services/models that only served removed routes
- Clean up sidebar navigation config to match trimmed page list
- Remove unused i18n translation keys for removed pages

## Architecture

No architecture changes. The existing React SPA + Express backend + CLIProxy API chain stays intact. This is purely a scope reduction.

## Implementation Approach

1. **Frontend**: Remove page files, clean router, clean sidebar config, remove unused components/hooks/lib
2. **Backend**: Remove route files, clean route index, remove unused services
3. **Settings**: Strip settings page tabs to CLIProxy-relevant only
4. **i18n**: Remove unused translation keys
5. **Verify**: Build succeeds, remaining pages load, no broken imports
