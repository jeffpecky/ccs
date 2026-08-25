# Windows Bar Lifecycle And Visual Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make detached CCS Bar startup reliable and make Windows Bar visually and behaviorally equivalent to macOS Bar.

**Architecture:** Keep one CCS web server and add a lightweight authenticated readiness endpoint that never performs quota or analytics work. Make detached launch state ownership explicit and transactional. Port SwiftUI geometry and visual tokens into custom WPF resources/templates while retaining Windows-native tray, DPI, notifications, and installer mechanics.

**Tech Stack:** TypeScript, Bun, Express, Node HTTP, .NET 8, WPF, MSTest, PowerShell 7

## Task 1: Add Lightweight Authenticated Readiness

**Files:**
- Modify: `src/web-server/index.ts`
- Modify: `src/web-server/middleware/auth-middleware.ts`
- Modify: `src/commands/bar/launch-subcommand.ts`
- Modify: `src/commands/bar/bar-server-probe.ts`
- Modify: `windows-bar/CCSBar.Core/AuthAndDiscovery.cs`
- Modify: `macos-bar/Sources/CCSBarCore/BarServerProbe.swift`
- Test: `tests/unit/commands/bar-command.test.ts`
- Test: `tests/unit/web-server/api-routes-bar-local-access-guard.test.ts`
- Test: `windows-bar/CCSBar.Tests/CoreTests.cs`
- Test: `macos-bar/Sources/CCSBarCheck/main.swift`

1. Write failing tests for authenticated `GET /api/bar/health` returning immediately while summary dependency hangs.
2. Run focused tests and confirm failure.
3. Implement endpoint before heavy route imports/work.
4. Change CLI and native probes to health endpoint.
5. Run focused Bun/.NET tests and Swift source contract checks.
6. Commit: `fix(bar): use lightweight readiness health`

## Task 2: Make Detached Launch Transactional

**Files:**
- Modify: `src/commands/bar/launch-subcommand.ts`
- Modify: `src/commands/bar/serve-subcommand.ts`
- Modify: `src/commands/bar/bar-process-control.ts`
- Modify: `src/commands/bar/bar-paths.ts`
- Test: `tests/unit/commands/bar-lifecycle-subcommands.test.ts`
- Test: `tests/unit/commands/bar-lifecycle-hardening.test.ts`

1. Write failing tests for bound-but-unresponsive child, stale PID, replacement rollback, and ownership-safe cleanup.
2. Add launch identity to process record and per-launch log path.
3. Publish discovery only after health succeeds.
4. Make cleanup conditional on process plus launch identity.
5. Keep latest diagnostics pointer without ambiguous append history.
6. Run repeated lifecycle tests.
7. Commit: `fix(bar): make detached launch transactional`

## Task 3: Remove Startup Event-Loop Blocking

**Files:**
- Modify: `src/web-server/index.ts`
- Modify: `src/cliproxy/sync/index.ts` or exact watcher implementation found during execution
- Modify: `src/web-server/usage/aggregator.ts`
- Modify: `src/web-server/usage/cliproxy-usage-syncer.ts`
- Test: new focused startup responsiveness tests under `tests/unit/web-server/`

1. Write failing test proving health responds while background initialization is unresolved.
2. Move watcher/usage initialization after listen and schedule asynchronously.
3. Bound synchronous filesystem work or move it outside request loop.
4. Verify health latency and summary degradation behavior.
5. Commit: `perf(bar): keep server readiness responsive`

## Task 4: Fix Direct-App Self-Start And Flash

**Files:**
- Modify: `windows-bar/CCSBar.App/WindowsServices.cs`
- Modify: `windows-bar/CCSBar.App/App.xaml.cs`
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml.cs`
- Test: `windows-bar/CCSBar.App.Tests/AppServicesTests.cs`

1. Write failing tests for descriptor-driven `bar launch --no-open`, single launch attempt, and activation without immediate deactivation hide.
2. Route app self-start through same launch orchestration contract.
3. Create panel lazily and defer deactivation handling until activation settles.
4. Await/cancel startup tasks on shutdown.
5. Commit: `fix(windows-bar): stabilize self-start and activation`

## Task 5: Create Exact WPF Visual System

**Files:**
- Rewrite: `windows-bar/CCSBar.App/App.xaml`
- Modify: `windows-bar/CCSBar.Core/PanelAndTheme.cs`
- Add: `windows-bar/CCSBar.App/Controls/` only for controls reused at least twice
- Test: `windows-bar/CCSBar.App.Tests/VisualContractTests.cs`

1. Encode Swift values for panel surfaces, text, muted text, accent, quota colors, borders, radii, shadows, spacing, and type scale.
2. Add custom templates for buttons, chips, checkboxes, combo boxes, progress tracks, menu items, scrollbars, separators, and tooltips.
3. Add test rejecting default WPF templates in product XAML.
4. Add token-value contract tests against Swift source values.
5. Commit: `style(windows-bar): port macOS visual system`

## Task 6: Rebuild Header, States, And Footer

**Files:**
- Rewrite: `windows-bar/CCSBar.App/MainWindow.xaml`
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml.cs`
- Modify: `windows-bar/CCSBar.App/CCSBar.App.csproj`
- Modify: `windows-bar/Scripts/package.ps1`
- Test: `windows-bar/CCSBar.App.Tests/VisualContractTests.cs`

1. Match 360-DIP shell, header, divider, offline/starting/empty states, scrolling region, and footer exactly.
2. Replace stock offline buttons with styled controls and macOS copy/layout.
3. Inject `macos-bar/VERSION` into development and package assembly metadata.
4. Preserve Windows tray anchoring and per-monitor DPI.
5. Commit: `style(windows-bar): match Bar shell states`

## Task 7: Rebuild Subscription And Account Content

**Files:**
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml`
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml.cs`
- Modify: `windows-bar/CCSBar.Core/BarViewModel.cs`
- Test: `windows-bar/CCSBar.Tests/CoreTests.cs`
- Test: `windows-bar/CCSBar.App.Tests/VisualContractTests.cs`

1. Match subscription section heading and “most room” label.
2. Match native subscription cards, profile carousel, tags, quota rows, reset labels, pace, tier, and stale footnotes.
3. Match pool-account rows and action menus.
4. Preserve mouse, keyboard, and touchpad behavior.
5. Commit: `style(windows-bar): match account cards`

## Task 8: Rebuild Analytics, Alerts, And Update UI

**Files:**
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml`
- Modify: `windows-bar/CCSBar.App/MainWindow.xaml.cs`
- Modify: `windows-bar/CCSBar.App/Sparkline.cs`
- Test: `windows-bar/CCSBar.App.Tests/VisualContractTests.cs`

1. Match spend strip, period selector, bar/line chart, idle state, surface/model breakdown.
2. Match alert banner/group/collapse behavior.
3. Match update-available row and progress state.
4. Commit: `style(windows-bar): match analytics and alerts`

## Task 9: Rebuild Settings Window

**Files:**
- Rewrite: `windows-bar/CCSBar.App/SettingsWindow.xaml`
- Modify: `windows-bar/CCSBar.App/SettingsWindow.xaml.cs`
- Test: `windows-bar/CCSBar.App.Tests/VisualContractTests.cs`

1. Match macOS settings hierarchy, section labels, descriptions, toggles, selectors, alert thresholds, and updates.
2. Use shared visual system, no stock control chrome.
3. Preserve persisted settings behavior.
4. Commit: `style(windows-bar): match settings window`

## Task 10: Add Deterministic Visual Baselines

**Files:**
- Add: `windows-bar/CCSBar.App.Tests/Fixtures/`
- Add: `windows-bar/CCSBar.App.Tests/VisualSnapshotTests.cs`
- Add: `windows-bar/Scripts/capture-visuals.ps1`

1. Render offline, starting, populated, stale, alerts, update, light, and dark fixtures at 100% DPI.
2. Store approved PNG baselines.
3. Compare dimensions and pixels with small anti-aliasing tolerance using stdlib image access or exact bitmap sampling helpers.
4. Commit: `test(windows-bar): add visual parity baselines`

## Task 11: End-To-End Verification

1. Run focused Bun lifecycle/readiness tests.
2. Run `bun run typecheck` and `bun run build`.
3. Run all .NET tests/build/publish/package.
4. Run detached `node dist/ccs.js bar` on temporary port and verify prompt returns, authenticated health responds, and app connects.
5. Verify direct app launch self-starts server.
6. Inspect screenshots against macOS reference.
7. Manual Windows 10/11, 100-300% DPI, all taskbar edges, keyboard, high contrast, installer/update matrix.
8. Request final code review.
