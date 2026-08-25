# Windows Bar Lifecycle And Visual Parity Design

## Goal

Make Windows Bar reliable and visually equivalent to macOS Bar while retaining Windows-native tray, DPI, notification, and packaging mechanics.

## Lifecycle

- All local CCS entry points default to `127.0.0.1:8080`.
- Explicit `HOST` and `--port` values still override defaults.
- Bar discovery uses IPv4 loopback only and checks sticky port first, then `8080`, `8181`, `3000`, `3001`, `3002`, and `8000`.
- `ccs bar` launches one detached CCS server, waits for a lightweight authenticated Bar health endpoint, opens native app, then returns prompt.
- `ccs bar serve` remains foreground diagnostics command.
- Server process and discovery records publish only after HTTP readiness succeeds.
- Launch failure removes only state owned by failed process and preserves previous valid recovery state.
- Each launch creates identifiable diagnostics instead of ambiguous append-only PID history.
- Quota collection, usage aggregation, cache refresh, log compression, and provider scans cannot block readiness endpoint.
- Native app launched directly uses validated descriptor to start same server contract without terminal.

## Visual Contract

SwiftUI source and sanitized macOS screenshot are product specification. Windows implementation matches:

- 360-DIP panel width and content-driven capped height.
- Header geometry, logo, version placement, refresh state, dividers, and section rhythm.
- Light/dark surfaces, borders, radii, shadows, accent colors, and semantic status colors.
- Typography scale, weights, line heights, casing, and muted-label hierarchy.
- Subscription cards, profile carousel, quota rows, chips, reset labels, pace labels, alerts, spend cards, charts, pool accounts, models, and footer.
- Starting, offline, empty, stale, partial-failure, update, and populated states.
- Settings hierarchy, labels, controls, persistence, and update behavior.

Windows-native differences are limited to notification-area anchoring, keyboard conventions, notifications, per-monitor DPI, startup registration, and installer mechanics.

## Quality Gates

- No stock WPF control chrome appears in product UI.
- Version derives from `macos-bar/VERSION` in development and release builds.
- Screenshot fixtures cover offline, starting, populated, stale, alerts, update, light, and dark states at fixed DPI.
- Lifecycle tests cover bound-but-unresponsive server, stale process records, launch rollback, direct app self-start, and IPv4-only ownership.
- Manual verification covers Windows 10/11, 100-300% DPI, all taskbar edges, keyboard, high contrast, and actual installed update flow.
