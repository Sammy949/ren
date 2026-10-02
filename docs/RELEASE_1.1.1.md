# Ren 1.1.1 review build

Follow-up to the tagged 1.1.0 review build. The existing tag is unchanged.
This build has not been submitted to the Chrome Web Store.

## Changes

- Settings action, theme, and close icons restored using the existing icon style.
- Removed the browser-storage reminder and “Theme saved.” message. Empty status
  consumes no space; write errors still appear with retry available.
- Buttons use immediate filled keyboard focus; buttons and modal shells no longer
  get outline boxes. Tab containment and focus return remain intact.
- Settings now groups backup actions under “Backup & restore.” Choose **Back up
  to folder**, select a folder, and allow Chrome's requested access. Every click
  creates a new dated JSON snapshot, including pending editor changes.
- A snapshot is serialized before opening the chooser. It is written, closed,
  and read back before success is shown. Older files are not intentionally
  replaced. Failed new files are removed when filesystem permissions permit.
- Cancelling the picker is quiet. Permission, write, and verification failures
  leave notes unchanged and show an error. Export notes remains the download
  fallback; Import notes restores these same JSON files with pre-import recovery.
- Backups are manual and unencrypted. There is no background schedule, cloud
  service, persistent folder-handle database, or change to note storage keys.
- Modal controllers and styles live under `src/ui`; duplicate Settings rules
  were consolidated. No new dependencies or extension manifest permissions.
- Context-menu commands restore editor focus synchronously. An immediate undo
  after formatting previously could arrive before Tiptap's deferred focus.

## Verification

- Build and JavaScript syntax checks passed; four unit suites and deterministic
  packaging passed. Nine browser suites passed before the accessibility follow-up;
  all five affected browser suites passed against the rebuilt ZIP afterward.
- The first full run found the context-menu focus race, a focus assertion during
  a color transition, and an obsolete assertion for the removed reminder. The
  runtime fixes and updated assertions passed the subsequent full run.
- Folder tests substitute only the OS chooser on the success path and write to
  real browser filesystem handles in a disposable profile. They cover pending
  edits despite local-save failure, separate successive files, valid restore
  payloads, cancellation, permission denial, write failure, stream abort, corrupt
  readback rejection, and download fallback when the picker API is absent.
- Settings tests exercise theme saves/failures, real backup download, file-input
  import and recovery, Tab focus styling, Escape, and repeated opening/closing.
- Inspected Settings at 400×700 and 320×360. Small panels scroll within the modal.
  Rechecked the design reference: existing palette/type retained, bare icons,
  consistent alignment and spacing, concise copy, no new decorative cards,
  gradients, motion, or dependencies. Icons requested by Samuel take precedence
  over the reference's default reservations about familiar theme icons.

### Keyboard coverage

Native input events delivered to extension pages exercised Ctrl+Alt+N, Ctrl+S,
Ctrl+Shift+E, Ctrl+Shift+O, Ctrl+comma, Ctrl+F, Ctrl+slash, Ctrl+Alt+C,
Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, formatting keys, and context-menu Shift+F10,
arrows/Home/End/Enter/Escape. Modal shortcut suppression and native title-input
undo were also checked. Context-menu focus restoration is asserted immediately.

The tests do not prove OS/browser interception behavior. Manually check
Alt+Shift+S in the Chrome shell, other reserved shortcuts while the actual side
panel is focused, and macOS Command mappings. The real OS folder chooser and
permission prompt also remain a manual check; headless tests cannot approve them.

## Review steps

1. Load the unpacked build without removing the existing production installation.
2. Open Settings; change theme and navigate with Tab/Shift+Tab.
3. Choose Back up to folder. Select a test folder and grant access.
4. Confirm a new JSON file appears; repeat and confirm the first file remains.
5. In a disposable Ren installation, import that file and check its notes.
6. Check native side-panel shortcuts and undo immediately after right-click bold.

Chrome's File System Access API requires user activation and explicit folder
access. See [Chrome's API guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
and [directory picker options](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).

## Artifact

`ren-v1.1.1.zip`: 186795 bytes, 17 runtime files. Rebuilt with the dialog
accessibility fix; replaces the earlier untagged 1.1.1 review archive.

SHA-256: `84a3d0119778addfff0a1f5611b44e3ff85dcedd0bc0ad7a6adfaf2d034a59b6`

## Accessibility follow-up

Reproduced Samuel's welcome-dialog warning: the shared close handler applied
`aria-hidden=true` while Start Writing retained focus. Removed redundant
`aria-hidden` from native dialogs; the browser's open/close state controls their
visibility and accessibility. Shortcut suppression now checks `dialog[open]`.
The sidebar moves focus before setting its hidden/inert state.

The regression test fails on the old code and passes on the fix. It records
attempts to aria-hide a focused subtree, enables Chrome's accessibility tree,
and checks browser logs for the reported warning. Onboarding, Settings, help,
focus return, and Tab/Escape are exercised. The rebuilt package also passed
editor, note-dialog, Settings-action, and folder-backup suites, plus four unit
suites, syntax checks, and deterministic packaging. Screen-reader testing remains
manual.
