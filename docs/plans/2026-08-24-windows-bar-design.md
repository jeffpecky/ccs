# Windows Bar Design

## Goal

Add native Windows companion under `windows-bar/` matching `macos-bar/` UI, data, and behavior while using Windows-native tray, window, notification, startup, and packaging mechanics.

## Product Contract

- macOS Bar and Windows Bar expose same information architecture, copy, states, refresh behavior, settings, alerts, analytics, and update behavior.
- Both clients probe and launch same CCS server contract.
- `ccs bar serve` starts normal CCS web server with Bar discovery, compatibility probing, logging, and detached-launch support. It is not separate service.
- `bun run dev` and `bun run start` remain source-development workflows.
- Native Bars do not directly start, stop, or supervise CLIProxyAPI. CCS remains CLIProxy lifecycle authority through existing dashboard and APIs.
- Exiting native Bar does not stop CCS or CLIProxyAPI.

## Repository Layout

```text
ccs/
|- src/commands/bar/       shared Bar server command and discovery contract
|- macos-bar/              native SwiftUI client
`- windows-bar/            native .NET 8 WPF client
```

Windows Bar lives in CCS repository so API contracts, releases, tests, and product behavior evolve together.

## Server Architecture

All startup modes call existing `startServer()` implementation.

`ccs bar serve` adds loopback-only binding, safe port selection, `~/.ccs/bar/bar.json` discovery state, validated `launch.json`, `serve.log`, compatible-server reuse, compatibility probing, and graceful state cleanup.

Current package lacks upstream Bar CLI integration, so command infrastructure must be restored before Windows launch logic.

## Windows Client Architecture

Use .NET 8 WPF with no third-party UI framework initially.

- `App`: single-instance process and application lifetime.
- `TrayIconHost`: notification-area icon, primary click, fallback context menu.
- `BarWindow`: borderless 360-DIP panel anchored to notification area.
- `BarViewModel`: probe, launch, polling, refresh, cached-data, and error state.
- `CcsBarClient`: typed `/api/bar/summary` and `/api/bar/analytics` client.
- `BarDiscovery`: reads discovery and launch descriptor files.
- `BarServerLauncher`: validates and starts packaged CCS command without shell interpolation.
- Core services: formatting, quota gauges, alerts, analytics, preferences, update comparison.

UI thread renders only. Network, process, file, and update work stays asynchronous and cancellable.

## UI Parity

Panel mirrors macOS Bar structure:

1. Header and CCS status.
2. Native subscription cards.
3. Profile carousel with default account first and `ccs`/`ccsx` tags.
4. CLIProxy pool rows.
5. Quota gauges and reset labels.
6. Alerts.
7. Spend analytics and charts.
8. Refresh, dashboard, settings, updates, and quit actions.

Required states: starting, fresh, stale cached, offline with `Start CCS`, empty, partial failure, and update available.

Visual tokens derive from macOS Bar values and become WPF resources. Windows uses native focus, keyboard, DPI, taskbar placement, reduced-motion, high-contrast, and notifications. No fake macOS chrome.

## Data Flow

```text
Tray click
-> probe discovered and fallback loopback CCS URLs
-> launch `ccs bar serve` when no compatible server responds
-> poll up to 12 seconds
-> GET /api/bar/summary
-> GET /api/bar/analytics
-> render and retain last good payload
-> refresh periodically and on user action
```

Dashboard action opens current CCS base URL. CLIProxy-off state does not make CCS offline; unavailable CLIProxy-backed rows degrade independently.

## Error Handling

- Missing or invalid descriptor: use validated packaged-command fallback; otherwise show offline.
- Launch failure: show concise error and diagnostics path.
- Timeout: stop spinner, retain cached rows, expose retry.
- Endpoint failure: preserve last good section and mark stale.
- Corrupt preferences/discovery: ignore invalid data and restore safe defaults.
- Duplicate app start: activate existing panel and exit new process.
- Version mismatch: show compatibility error and update action.

## Packaging And Migration

- Publish self-contained Windows x64 package; evaluate arm64 after parity.
- End users require neither Bun nor source checkout.
- Package or install compatible CCS runtime and write launch descriptor during installation.
- Sign executable and installer before public release.
- Keep `CLIProxyAPI-Tray` unchanged during development.
- Migrate startup preference only after replacement installation path works.
- Remove old tray only after parity and rollback testing.

## Testing

- CCS command tests: dispatch, bind defaults, port selection, discovery writes, descriptor validation, reuse, cleanup, and logs.
- Shared route tests: summary, analytics, compatibility, partial CLIProxy availability.
- Windows unit tests: models, decoding, formatting, gauges, alerts, ordering, discovery, launcher validation, preferences, and update comparison.
- WPF view-model tests: starting, online, stale, offline, empty, retry, cancellation, and update states.
- Windows integration test: packaged CCS launch, discovery, API load, dashboard open, and restart recovery.
- Manual matrix: Windows 10/11, light/dark/high contrast, 100-300% DPI, keyboard, all taskbar edges, offline startup, CCS restart, and update flow.

## Delivery Order

1. Restore shared `ccs bar serve` contract and tests.
2. Add Windows solution and portable core tests.
3. Build launcher, discovery, API client, and view-model.
4. Recreate panel UI and settings.
5. Add notifications, updater, packaging, and startup integration.
6. Run parity, accessibility, DPI, lifecycle, and migration verification.
