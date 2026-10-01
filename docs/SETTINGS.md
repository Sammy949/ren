# Settings

Rewritten on 1 October 2026 after repeated Settings-button reports.

## Ownership

- `sidepanel.html` contains one static native `dialog` and its controls.
- `settings.js` owns opening, closing, focus return, action bindings, theme save
  state, and recovery metadata. Both pointer and shortcut entry use `open()`.
- The browser provides top-layer placement and inert background content. Tab
  wrapping keeps keyboard navigation inside the dialog. Escape, the close
  button, and a backdrop press/release all use the same close path.
- Navigation closes before the dialog opens. Focus returns to a visible trigger.
  A queued close event cannot reset a newly reopened dialog.
- Theme selection updates only after the settings write succeeds. Failed writes
  leave the previous theme active, show an inline error, and allow retry. Rapid
  clicks cannot race theme writes. System preference remains browser-driven.
- Recovery metadata is loaded on each open; stale results cannot update a later
  opening. Import/restore use existing validated storage operations and explicit
  confirmation. Export remains available during a notebook conflict.
- Backup actions close the native modal before file picking, download, or
  confirmation. Help opens after Settings closes; dialogs do not stack.

## Verified

The packaged runtime passed `chrome-settings`, `chrome-dialogs`, `chrome-editor`,
and `chrome-storage-smoke` sequentially, plus all four unit suites, syntax checks,
and the deterministic package check. New coverage includes:

- Actual sidebar button opening at narrow/wide widths, theme clicks, and close.
- Repeated shortcut opening, Tab/Shift+Tab, Escape, backdrop clicks, focus return.
- Theme persistence across reload; injected write failure and successful retry;
  system light/dark preference changes.
- Downloaded backup contents; real file-input import; native confirmation
  acceptance in the disposable test profile; restoring the pre-import copy;
  handoff to keyboard shortcuts.
- A 320×360 viewport with contained scrolling. Screenshots inspected at 320×360
  and 400×700. Existing Ren colors and typography retained; no decorative redesign.

Review package: 14 runtime files, 182620 bytes. SHA-256:

```text
025e97d7f12e519856bce0e9faf540b919c350545f5201ac4f5a3ea0b2a44cc4
```

No release version or tag was created. Native screen-reader and platform checks
remain on the roadmap. This package supersedes the earlier Settings-button ZIP.

## 1.1.0 follow-up

The shared lifecycle now lives in `modals.js`; `settings.js` retains theme and
backup actions. Help, onboarding, rename, and delete use the same modal controller.
See [RELEASE_1.1.0.md](RELEASE_1.1.0.md) for the current package and scope. Earlier
checksums in this document identify historical review builds.
