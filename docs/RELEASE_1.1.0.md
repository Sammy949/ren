# Ren 1.1.0 review build

## Scope

Samuel scoped 1.1.0 to the editor/reliability work already implemented, an editor
context menu, shared modal behavior, and focused layout cleanup. Versioned JSON
storage and additional editor extensions remain separate future work.

## Changes

- Text context menu: undo/redo, bold, italic, underline, strike, inline code,
  clear formatting, and conversion to paragraph, H1–H3, lists, tasks, or quote.
  Actions use Tiptap transactions and share the editor's history.
- Right-click inside a selection retains that selection. Shift+F10 and the
  context-menu key open the menu; arrows, Home/End, Enter/Space, and Escape/Tab
  handle navigation and dismissal. Shift+right-click preserves the browser menu
  for spelling and clipboard functions. Unsupported read-only notes retain the
  browser menu. Menu placement is bounded and scrollable in small panels.
- `modals.js` owns the lifecycle of Settings, shortcuts, welcome, rename, and
  delete. One native modal can be open at a time. Focus containment, backdrop,
  Escape, and focus return share one implementation. Sidebar closing happens
  before opening a dialog; old queued close events cannot close a newer opening.
- Rename/delete wait for storage success before changing the visible note set.
  A failed operation keeps its dialog open with an error and retry. Background
  app shortcuts are suppressed for both dialogs and alert dialogs.
- Shared dialog geometry, simpler action rows and onboarding copy, restrained
  theme selection, consistent spacing, and reduced-motion overrides. Existing
  Ren colors, typography, and writing layout are retained.

## Verification

- Build, JavaScript syntax, four unit suites, deterministic packaging, and asset
  checks passed. Packaging now checks script references as well as CSS assets.
- Packaged browser coverage: context menu, shared dialogs, editor/history,
  formatting, layout/selection, rename/delete failure/retry, Settings actions,
  and storage/restart/upgrade. Tests use synthetic notes and disposable profiles.
- The first combined run passed seven suites; the context-menu test opened during
  a still-pending resize event. The menu correctly closes on resize. The test now
  waits for layout frames before keyboard opening and passed on two reruns.
- Actual Settings sidebar-button clicks, theme actions, export, import, restore,
  and shortcut handoff passed. Settings and context-menu screenshots were
  inspected at narrow/short sizes; normal Settings shows version 1.1.0.

The exact cause of Samuel's installed copy failing to open Settings was not
independently reproduced in the fresh test profile. The complete 1.1.0 package,
including both controller scripts, is the build to verify in that installation.
No existing browser profile or personal notes were modified by these tests.

## Package

Manifest version: `1.1.0`. Archive: `ren-v1.1.0.zip`, 184373 bytes, 15 runtime files.
SHA-256:

```text
2ee944de1595deba18aa7da32094f9515461b645113d46e3ae962b75b9a40f82
```

For an existing unpacked installation, update its existing folder and use Reload
in `chrome://extensions`, then reopen Ren. Do not remove the extension to update
it: removing it removes its local note storage. Export a backup before updating.

This is a review build, not a Chrome Web Store submission. Native macOS/browser
commands, screen-reader/zoom coverage, performance budgets, exhaustive historical
formatting, and shutdown/quota edge cases remain unverified release limitations.
