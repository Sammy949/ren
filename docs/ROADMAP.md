# Ren rewrite roadmap

Updated: 2 October 2026. Status: milestone 0 complete; reliability and editor milestones in progress.

## Purpose and working memory

Ren is a local-first Chrome side-panel notepad. Its value is fast capture, reliable
recall, and calm writing. Keep the current light and dark visual character as the
baseline. The rewrite succeeds when formatting feels predictable and a user can
trust that a note which says "Saved" can be reopened with the same content.

This file is the project memory for the rewrite. Update the **Decisions**,
**Evidence**, and **Next action** sections whenever a milestone closes. Do not
record private notes, extension IDs, browser-profile paths, or recovery data here.

## What exists today

- MV3 extension with a Bun-built local Tiptap/ProseMirror bundle. The manifest
  loads `background.js`, `sidepanel.html`, `storage.js`, generated `editor.js`,
  and `sidepanel.js` directly. Source and build notes are in
  `docs/EDITOR_INTEGRATION.md`.
- Notes live in `chrome.storage.local`; theme and onboarding preference live in
  `chrome.storage.sync`. Legacy `sylva_*` keys are intentional compatibility data.
- Editing now uses a structured document and transaction history. Stored notes
  and exports still use compatible HTML during integration. An edited legacy
  note retains its source in `originalContent`; unsupported source opens read-only.
  Permanent versioned JSON persistence remains open.
- Originally, each normal save called `saveAllNotes(this.notes)`, writing the
  entire note set and index. Incremental note saves now avoid this. Search still
  scans in-memory note content and rebuilds note cards.
- Title ownership now distinguishes a new note's one-time first-line suggestion
  from a manual title. The save status waits for storage confirmation.
- The September data-loss postmortem is an untracked incident note. It reports an
  extension-ID mismatch and failed recovery. The available record does **not**
  prove that frequent writes fragmented LevelDB or caused the loss. Treat that as
  a hypothesis, not an architectural premise.

## Decisions

1. **Reliability before feature breadth.** Preserve existing notes and exports
   before changing editor or storage formats. Do not add categories, cloud sync,
   accounts, or a broad visual redesign to this rewrite.
2. **Replace the editor engine, preserve the product shell.** Use a bundled,
   headless Tiptap/ProseMirror editor with Ren's existing toolbar and CSS.
   Tiptap supports vanilla JavaScript, structured documents, history, task
   lists, and input rules. Bun now builds the local bundle; TypeScript adoption
   remains a separate engineering decision. React is not a prerequisite for fixing formatting.
3. **Use a structured document as the new canonical editor format.** Keep the
   original v1 HTML intact during migration. Convert through an explicit,
   versioned allowlist; preserve unsupported content for recovery rather than
   silently dropping it. Export must remain useful outside Ren.
4. **Keep `chrome.storage.local` initially.** Fix write scope, sequencing,
   failure reporting, and recovery first. Evaluate IndexedDB only if atomic
   migration/import or measured scale makes it worthwhile. Switching databases
   alone does not prevent shutdown loss or replace backups.
5. **Treat "memory" as three workstreams:** durable notes and recovery, bounded
   runtime memory/work per action, and this maintained project record.
6. **Keep development isolated from personal notes.** A production manifest key
   can give an unpacked build the production extension ID. Test that only in a
   separate Chrome profile with disposable data, after a verified backup.

## Evidence and risks found in the code

| Priority | Observation | Why it matters | Proof or status |
| --- | --- | --- | --- |
| P0 | Autosave previously showed "Saved" without awaiting storage; failed writes resolved as if successful. | Users could be told a failed write succeeded. | Fixed on `fix/truthful-saves`; completion-order and failed-write tests pass. |
| P0 | Normal edits previously rewrote every note on each save. | Write cost grew with the whole collection; overlapping writes made ordering hard to reason about. | Fixed on `perf/incremental-note-saves`; normal edits now write one note and the small index metadata. |
| P0 | Chrome storage reads previously ignored `runtime.lastError`; `getAllNotes()` also turned caught read failures into `[]`. | A transient read failure could lead Ren to create a new note and replace the visible index while old note keys remained. | Safeguarded on `fix/storage-read-failures`; focused failure tests pass. |
| P0 | Imported content, note titles, search text, and notification messages previously reached `innerHTML` without a strict allowlist or text encoding. | A crafted backup/title/query could inject markup or deceptive controls into the extension UI. | Fixed on `fix/import-markup-safety`; hostile browser fixtures verify the content allowlist and text-only UI paths. |
| P0 | Import previously replaced the index while leaving old `note_*` keys in storage. | Hidden orphan notes consumed quota and made recovery confusing. | Fixed on `fix/recoverable-note-import`; old keys are removed only after verified replacement and remain recoverable from the pre-import backup. |
| P1 | Manual title edits were overwritten by first-line derivation on a later body save. | The title component had no stable ownership rule. | Fixed on `fix/title-ownership`; packaged Chrome verifies suggestion, rename, body save, restart, keyboard access, and narrow header fit. |
| P1 | Undo/redo used guessed flags and custom DOM edits outside history. | Toolbar availability and actual history disagreed. | Rebuilt with transaction history; packaged keyboard/toolbar/selection tests pass. Full formatting matrix remains open. |
| P1 | Note IDs use `Date.now().toString()` for new notes; imports accept loosely typed IDs. | Fast creation or malformed imports can collide or produce bad keys. | Direct code path; collision test needed. |
| P1 | Browser coverage originally omitted formatting and realistic side-panel geometry. | Editor and layout regressions escaped review. | Packaged layout, selection, resizing, history, IME, and clipboard gates now exist. Full formatting and accessibility matrices remain open. |
| P2 | `getStorageInfo()` assumed 5 MB rather than reading Chrome's local quota. | Usage UI would misreport headroom. | Fixed on `feat/storage-health-report`; real Chrome quota and byte count are exercised by the smoke test. |
| P2 | Onboarding says notes sync, while notes are local. Settings previously displayed "Ren v2.0" while the manifest is 1.0.0; this now reads the manifest. | Product copy contradicts actual behavior. | Repository code and manifest. |

Do not describe the original incident as "corruption caused by the editor." Editor
bugs can damage a note's formatting or serialized content. Extension identity,
storage writes, import handling, and backup gaps are separate failure paths.

## Milestones and exit gates

### 0. Safeguard the existing data and capture a baseline

**Status: complete on 26 September 2026.** The repeatable gate now covers the
unpacked checkout, deterministic release ZIP, prior-package upgrade, panel
reopen, browser restart, backup/import/restore, failed reads and writes, and a
read-only health inventory using synthetic data in disposable profiles.

- Create a real-browser smoke harness in a disposable Chrome profile. Exercise
  the published-format v1 package and an unpacked build; record version and
  extension ID locally without committing those values.
- Export sample v1 notes covering plain text, headings, lists, tasks, links,
  code, pasted text, long notes, emoji, and special characters. Use synthetic
  fixtures in the repo, never personal notes.
- Verify export/import round trips and opening notes after panel close, browser
  restart, extension update, and failed storage writes. Preserve exact failure
  output in private test artifacts when it contains note data.
- Inventory every storage key and make a read-only health report: indexed notes,
  orphan keys, missing keys, duplicate IDs, malformed records, and bytes used.
  Never delete or "repair" data silently.

**Exit:** A repeatable browser smoke run and a tested backup/restore path exist.
The migration can be stopped without touching original note records.

### 1. Make saves truthful and recoverable on the current release line

- Give edits a dirty revision and serialize writes per note. Save only the dirty
  note and update the index only when membership/order changes. A later revision
  must never be overwritten by an earlier completion.
- Distinguish an empty collection from a failed read. Surface and retry read
  errors without creating a new note or changing the index; do not swallow
  `runtime.lastError` in Chrome storage wrappers.
- Show `Saving`, `Saved`, or `Could not save` from the actual write result.
  Keep dirty content in memory after failure, allow retry, and show an export
  escape hatch. `Ctrl/Cmd+S` waits for the write result.
- Flush pending work on note switch and visibility change where possible; do not
  rely on an asynchronous write started during `beforeunload` to complete.
- Make import a staged, validated operation with a pre-import backup and a
  verifiable commit point. Define replace and merge behavior explicitly. Remove
  orphan keys only after a verified replacement and a recovery window.
- Read quota from the API rather than a fixed number. Consider
  `unlimitedStorage` only after measuring real usage and assessing the changed
  permission. Add a clear manual backup reminder and test restoration.
- Keep the extension ID stable across updates. If local development needs the
  production ID, use the manifest-key method only in an isolated profile.

**Exit:** Forced quota/write failures never yield "Saved"; rapid typing,
switching, multiple panel instances, browser close/reopen, and import failure do
not silently lose or resurrect notes. A real export restores the same note set.

### 2. Replace formatting with a document model

- Build a small Tiptap spike inside an MV3 package, fully bundled with no remote
  executable code. Prove text selection, cursor placement, IME/composition,
  copy/paste, undo/redo, task toggles, and narrow side-panel behavior.
- Define Ren's supported schema before migration: paragraphs, H1-H3, bold,
  italic, underline, strike, inline code, bullets, numbers, tasks, quotes,
  dividers, links, and hard breaks. Omit unsupported editor features until they
  have a clear data model and test.
- Use native editor commands/input rules for toolbar and Markdown behavior.
  Preserve selection when clicking toolbar controls. Derive undo/redo disabled
  state from editor history. Keep the toolbar visible and usable at narrow width.
- Convert v1 HTML through a strict allowlist to versioned editor JSON. Keep raw
  v1 HTML beside the converted result until round-trip tests pass. Quarantine
  malformed entries and explain them in the UI; never replace with an empty doc
  without user acknowledgement.
- Test each formatting action as a sequence: type, transform, continue typing,
  move cursor, undo, redo, save, reload, export, import. Include adjacent marks,
  nested lists, empty task items, pasted HTML, and special characters.

**Exit:** The formatting matrix passes in the packaged Chrome extension. No
known spill, caret jump, task-state loss, or content loss remains in the tested
matrix. Legacy fixtures open and re-export without silent loss.

### 3. Give the title component one source of truth

- Make `title` an explicit note field. A new note may suggest a title from its
  first meaningful line once, until the user edits the title. Later body saves
  must not overwrite a manual title. Specify behavior for clearing the title,
  blank notes, and imported titles.
- Save title edits with the same revision/error model as body edits. Keep title,
  sidebar card, search index, and export in sync.
- Test pointer, keyboard, screen reader label, focus return, long names, and
  narrow header clipping. Retain the current simple visual treatment.

**Exit:** Rename survives typing, switching, restart, export/import, and undo
boundaries according to the written title rule.

### 4. Bound memory and work per action

- Measure, then optimize. Record typing latency, save time/bytes, panel startup,
  heap use, and search latency with 10, 100, and 1,000 synthetic notes plus one
  large note. These are proposed test sizes, not claims about current users.
- Avoid retaining two full copies of every document plus HTML previews when not
  needed. Cache compact title/plain-text previews, load full body only for the
  active note, and discard editor history when switching notes.
- Update one note card for a one-note change. Search indexed plain text rather
  than raw HTML. Add list virtualization only if measurements show rendering is
  the bottleneck; keep keyboard and screen reader behavior intact.
- Set measurable budgets from the baseline before implementation. A proposed
  interaction target is p95 typing latency under 50 ms on the agreed test
  machine, with no collection-wide storage rewrite for one note edit.

**Exit:** The benchmark report shows the baseline and new result on the same
machine; no worsening of correctness or accessibility to reach the target.

### 5. Make shortcuts and appearance coherent

- Separate browser-level commands from shortcuts that work only while the panel
  has focus. Document operating-system differences and reserved browser keys.
- Give the editor first refusal for formatting, selection, undo, redo, and IME.
  Give application shortcuts clear scope in modals, title input, search, and the
  body. Build the shortcuts help from the same registry used by handlers.
- Test every shortcut by keyboard in the packaged extension. Check tab order,
  modal focus traps, Escape, zoom, reduced motion, light/dark/system themes,
  and realistic side-panel widths. Make only focused visual adjustments to
  clipped controls, hierarchy, contrast, and save/error states.
- Correct copy that implies note sync, unlimited capacity, or impossible
  autosave guarantees. Correct the privacy policy's browsing-data deletion
  claim against Chrome's current extension-storage guidance. Show the manifest
  version in settings from one source.

**Exit:** Each displayed shortcut works in its documented scope; the editor
remains usable in narrow panels and all themes without a redesign.

### 6. Release and recovery gate

- Run typecheck, unit tests for state/storage/migration, editor interaction
  tests, and packaged-extension smoke tests. Test upgrade from the exact v1
  storage shape with synthetic copies and with an isolated consenting profile.
- Verify extension ID continuity, data count and checksums before/after upgrade,
  rollback access to the untouched v1 backup, and clean reinstall plus import.
- Verify the packaged ZIP contains no remote executable code or private data.
  Update the privacy policy, store copy, and version only after the behavior is
  measured. Release in a staged manner if the store workflow permits.

**Exit:** A signed-off release checklist records the exact package, test run,
known limitations, and recovery instructions. No claim of "cannot lose data";
users retain a tested export path.

## Open decisions for Samuel

These do not block the first safeguard milestone.

1. Should import default to **replace after automatic pre-import backup** or
   **merge with duplicate review**? Recommendation: replace only with a tested
   pre-import backup and a clear confirmation; offer merge later.
2. Should v2 stay strictly local, or is cross-device note sync a separate future
   product goal? Recommendation: keep v2 local and describe it honestly.

## Remaining work, in execution order

- [x] Fix title-bar height and alignment, theme selection, and internal notes-list resizing.
- [x] Integrate the structured editor with real transaction history; derive Undo/Redo
  availability from history and prevent history crossing note boundaries.
- [x] Verify in-panel Ctrl shortcuts with native browser key events in editor,
  title, search, and dialog contexts, including redo aliases.
- [ ] Verify native macOS bindings and the browser-managed Open Ren command.
- [x] Retain original HTML on edited saves and keep unsupported source readable/exportable.
- [ ] Implement and validate versioned JSON persistence; prove full rollback and import/export.
- [x] Verify toolbar actions, adjacent marks, nested-list round trips, task toggles,
  real clipboard, code cursor movement, IME, undo/redo, save, and reopen.
- [ ] Extend coverage to deeper list editing, cross-block selections, large notes,
  and export/import of the full formatting matrix.
- [ ] Close reliability gates for quota exhaustion, rapid switching,
  and shutdown during pending writes. ID collisions are now guarded; existing
  restart/concurrency tests cover part of this.
- [ ] Close title checks for export/import, long names, screen-reader operation,
  and interaction with editor history.
- [ ] Measure typing, startup, search, save cost, and heap use at 10/100/1,000 notes
  and a large note. Set budgets from the measurements, then optimize.
- [ ] Finish focus order, dialogs, zoom, reduced motion, and all theme checks;
  correct onboarding sync/capacity claims and review privacy/store copy.
- [x] Verify a clean frozen-lockfile dependency installation and identical rebuilt bundle.
- [ ] Run release/upgrade/rollback checks, review the package, reconcile the branch
  stack, and create the version/tag only when the release gates pass.

## Next action

Review the packaged 1.1.1 Settings and folder-backup flow in Samuel's installation.
The published `v1.1.0` tag identifies the earlier review build and remains unchanged.
Confirm the native folder chooser and Chrome/OS shortcut routing, then reconcile
the branch stack before Store submission. Versioned JSON persistence and measured
performance work remain separate. Folder backups are explicit snapshots, not an
automatic scheduler or a replacement for browser storage.

## Progress log

- 24 September 2026: On branch `fix/storage-read-failures`, storage read/remove
  errors now propagate; a missing indexed note aborts load; a failed load blocks
  note writes, creation, import, export, and false `Ctrl+S` success. Six focused
  Node tests pass. A local headless-browser smoke check loaded the panel through
  its `localStorage` fallback, but did not exercise packaged extension storage.
  Milestone 0 remains open. Existing note contents and storage keys were not
  modified by this work.
- 25 September 2026: On branch `fix/truthful-saves`, notebook writes are queued
  from snapshots; note data, index, and current-note ID commit in one storage
  call; failed writes remain retryable; autosave and `Ctrl+S` only report
  success after storage confirms it. Twelve focused storage/save tests pass, and
  the local fallback UI loads in headless Chrome. Packaged extension storage and
  restart recovery remain to be exercised before milestone 0 closes.
- 25 September 2026: On branch `perf/incremental-note-saves`, ordinary body and
  title edits write only the changed note plus the ordered ID list and current
  note ID. Switching notes writes only the selection. Collection-wide writes
  remain limited to structural operations such as create, delete, onboarding,
  and import. Fourteen focused storage/save tests pass.
- 25 September 2026: On branch `test/packaged-storage-smoke`, a Node test launches
  Ren as an unpacked extension in a disposable Chrome profile, writes a synthetic
  note through `chrome.storage`, fully restarts Chrome, and verifies the note and
  active selection. Two consecutive restart cycles passed, alongside all fourteen
  focused storage/save tests. The harness deletes its profile and never opens a
  personal browser profile. Packaged release ZIP and import/export coverage remain
  open, so milestone 0 is not yet complete.
- 26 September 2026: On branch `feat/storage-health-report`, Ren can produce a
  versioned, read-only health report covering malformed indexes and records,
  duplicate IDs, missing indexed notes, orphan note keys, stale current-note
  selection, actual bytes used, and Chrome's reported quota. Reports exclude note
  content and never repair or delete records. Three focused health tests, all
  fourteen storage/save tests, and the real Chrome storage smoke test pass.
- 26 September 2026: On branch `fix/recoverable-note-import`, imports validate
  every note and reject duplicates before changing live state. Ren flushes the
  open editor, saves a pre-import recovery snapshot, verifies the replacement,
  removes obsolete note keys only after verification, and offers restoration in
  Settings. Failed writes or verification restore the previous notebook. Nine
  focused import/restore tests and a real Chrome replace/restore round trip pass.
  Imported HTML still needs an allowlist before this milestone is complete.
- 26 September 2026: On branch `fix/import-markup-safety`, imported rich text is
  reduced to Ren's supported tag and attribute allowlist. Executable URLs,
  scripts, embedded media, foreign markup, event handlers, and arbitrary
  attributes are removed. Titles, search results, note cards, and notifications
  render user strings with text nodes. Hostile fixtures pass in the real Chrome
  extension while safe links, inline formatting, and task checkboxes survive.
- 26 September 2026: On branch `test/v1-backup-roundtrip`, checked-in synthetic
  v1 fixtures cover headings, inline marks, code, quotes, lists, dividers, line
  breaks, tasks, links, emoji, special characters, an empty note, ordering, and
  current selection. The exact note set survives export, JSON serialization,
  validated import, verified storage replacement, a full Chrome restart, and
  pre-import restoration in two consecutive runs. The release ZIP file set and
  extension-update path remain open, so milestone 0 is not yet closed.
- 26 September 2026: On branch `test/release-package-smoke`, Ren's package builder
  creates a deterministic ZIP from an explicit eleven-file runtime allowlist; a
  unit test checks every archived byte. The full Chrome gate passes from the
  extracted ZIP. A same-path upgrade from the existing v1 archive preserves the
  synthetic notebook, and a panel-only close/reopen preserves it before the full
  browser restart. These results close milestone 0. No release tag was created.
- 26 September 2026: On branch `fix/visibility-save-flush`, Ren tracks dirty and
  persisted revisions and starts a save when the panel becomes hidden or emits
  `pagehide`. Clean notes do not rewrite, failures remain dirty for retry, and
  overlapping lifecycle events share one in-flight flush. Ten focused save tests
  and the exact packaged Chrome gate pass an immediate edit/hide/restart cycle.
- 26 September 2026: On branch `fix/multi-panel-conflicts`, normal note writes
  compare the full last-confirmed note inside a browser Web Lock. A stale panel
  keeps its open edits available for export and shows a conflict instead of
  overwriting the other panel. Clean panels refresh when storage changes. Failed
  writes retain the confirmed baseline for retry. Two consecutive packaged
  Chrome runs raced two panels and passed. Structural operations still need the
  same concurrency gate before milestone 1 closes.
- 26 September 2026: On branch `fix/structural-write-conflicts`, normal and
  notebook-wide writes share one browser Web Lock. Create, delete, import, and
  pre-import restore check the last confirmed index and note contents before
  changing storage. Stale operations stop with a conflict and leave the newer
  notebook intact. Focused stale save/import/restore tests pass. Two packaged
  Chrome runs raced notebook-wide writes from separate panels: one committed,
  one reported a conflict, and the restart/import/restore gate still passed.
- 26 September 2026: On branch `feat/save-recovery-controls`, failed saves and
  panel conflicts expose an "Export edits" action beside the status. Export
  includes the open editor contents. Settings explain that notes live in this
  browser and recommend a regular downloaded copy. The displayed version comes
  from the manifest; export feedback says the download started, rather than
  claiming a file reached disk. Focused retry coverage and the packaged Chrome
  gate pass, including a 320 px panel fit check for the recovery action.
- 26 September 2026: On branch `test/editor-formatting-baseline`, the packaged
  Chrome gate now types real heading, inline-mark, code, and task sequences.
  `docs/EDITOR_BASELINE.md` records the results. Heading conversion and checked
  task serialization work. Typed `**bold**` remains literal by design in v1.
  Selecting text for inline code and typing after it removes the selected text
  in Chrome, a confirmed content-loss bug to fix before the editor migration.
- 26 September 2026: On branch `fix/inline-code-selection-loss`, the inline code
  command collapses Chrome's selection after replacing selected text. The next
  insertion no longer removes that text; packaged Chrome verifies content and
  undo. Chrome still extends the code mark into following typing even when the
  caret is moved to an empty sibling or parent boundary. This remains a v2
  formatting failure, not a solved inline-mark behavior.
- 29 September 2026: On branch `spike/structured-editor`, a separate bundled
  MV3 extension proves Tiptap 3.31.3 in a disposable Chrome profile. Typed
  Markdown bold ends before following text; a noninclusive inline-code mark
  keeps selected code text and places following typing outside it. Task input,
  undo/redo, IME composition, synthetic HTML paste, and 320 px fit pass. The
  proof never opens Ren storage. Migration, real clipboard behavior, all
  shortcuts, and performance remain unverified for the production editor.
- 29 September 2026: On branch `feat/editor-v1-conversion`, the isolated proof
  converts all three synthetic v1 fixture notes to editor JSON while retaining
  exact source HTML. Headings, inline marks, breaks, lists, links, and checked
  task state are asserted, and the JSON parses back identically. Unsupported
  images, styles, classes, unsafe links, and malformed tasks are quarantined
  without changing the editor. This covers the checked-in fixture shapes, not
  every historical note, so production integration must keep raw HTML and show
  unsupported records rather than silently replacing them.
- 29 September 2026: Samuel chose a one-time title suggestion from the first
  meaningful line. On `fix/title-ownership`, new notes record whether the title
  is default, suggested, or manual. Existing and imported titles stay fixed
  unless their own metadata says otherwise. Clearing a title chooses a manual
  "Untitled"; Escape cancels. The header title is keyboard reachable. Focused
  tests and packaged Chrome verify the suggestion, rename, body save, restart,
  Enter/Escape editing, and 320 px header fit. Export/import and screen-reader
  behavior still need a separate check before the title milestone closes.

- 29 September 2026: On `fix/editor-conversion-isolation`, the isolated v1
  converter parses against the editor schema without mutating the open editor.
  Browser verification compares the editor document and selection state before
  and after accepted and quarantined conversions. It also confirms the JSON
  stays stable when the editor adds its trailing paragraph after a final block.
  This remains an isolated proof; stored Ren notes are unchanged.

- 30 September 2026: On `fix/sidebar-layout-selection`, the title bar is a stable
  48 px while displaying and editing a title. The internal notes list starts below
  it, resizes by pointer and keyboard, remembers width, and docks at wide widths.
  Hidden navigation is inert. Selection uses shared theme tokens on root text,
  nested content, and inputs. Packaged Chrome tests cover 320/400/600/900 px,
  pointer dragging, keyboard bounds, reload, docking, and both selection themes.
  Screenshots were inspected; the existing packaged storage/upgrade suite passes.
  The browser harness now waits for Ren rather than an initially blank target.

- 30 September 2026: On `feat/structured-editor-history`, the bundled production
  editor uses actual transaction history and fresh history per note. Native input
  history stays in title/search fields; dialogs suppress application shortcuts.
  Packaged Chrome checks cover keyboard and toolbar undo/redo, heading conversion,
  selection/code boundaries, task toggles and reload, IME, actual clipboard paste,
  in-panel application shortcuts, and downloaded backups with source metadata.
  Distinct storage write markers prevent repeated saves from triggering a false
  external reload. Ctrl+S also commits title edits. Canvas-based toolbar layout
  follows sidebar width, empty-note cleanup preserves non-text content, and the
  package now includes the title/welcome SVG asset. The existing packaged storage/recovery and layout gates pass.
  HTML remains the persistence format; JSON migration and the full matrix remain
  open. `docs/EDITOR_INTEGRATION.md` records coverage and the unresolved clean-install
  integrity failures. No release tag was created.

### 30 September 2026: formatting round-trip matrix

- Added packaged Chrome coverage for every formatting toolbar action through
  undo, redo, save, and reopen; nested lists, adjacent marks, links, hard breaks,
  and empty task editing are also covered.
- Reproduced and fixed ordered lists starting above 1 becoming read-only after
  reopen. Preserve validated ordered-list start/type attributes during conversion
  and import sanitization.
- Independently verified the previously failing tarballs against registry and
  lockfile hashes. A fresh isolated install succeeded with integrity checks on;
  its generated bundle exactly matches the working bundle. Original install
  failure cause remains unknown.
- A parallel storage browser run timed out; its isolated rerun passed. Added
  explicit CDP command timeouts and rejection on browser disconnect. Use
  sequential browser execution for release checks. All four packaged browser
  suites then passed sequentially, including prior-package upgrade.

### 30 September 2026: note ID collision guard

- A deterministic rapid-creation test reproduced four new records reusing one
  millisecond ID and replacing the existing cache entry.
- Onboarding and new notes now use UUIDs, with an explicit local collision check
  even if the candidate generator repeats. Existing IDs are retained.
- The same test now preserves all five records and the original cached content.
  This closes ID allocation collisions, not all concurrent notebook mutations.

### 1 October 2026: final implementation review

- Reproduced and fixed late external reads replacing in-flight edits and older
  reads replacing newer results. Pending refreshes are invalidated for import
  and restore; conflict content remains exportable.
- Added native keyboard checks for onboarding, settings, and help focus. Fixed
  missing Tab containment and delayed callbacks stealing focus from a dialog.
- Corrected onboarding sync/capacity claims, store save guarantees, and privacy
  deletion guidance against Chrome's storage documentation.
- Recorded the reviewed package, repeatable verification commands, and remaining
  release gates in [FINAL_REVIEW.md](FINAL_REVIEW.md). This checkpoint does not
  complete the versioned-storage, performance, or native-accessibility milestones.

### 1 October 2026: Settings button follow-up

- Fixed sidebar-close focus overriding the Settings dialog opened by a click.
- Added actual Settings-button, theme-button, and close-button clicks at narrow
  and wide widths. Previous dialog tests exercised keyboard opening only.

### 1 October 2026: Settings rewrite

- Replaced dynamic overlay construction with one static native dialog and a
  dedicated controller. Pointer and keyboard entry now share lifecycle/state.
- Theme writes are serialized, successful persistence precedes selected state,
  and failures appear inline with retry. Recovery reads ignore stale results.
- Verified theme persistence/failure, repeated open/close, backdrop and keyboard
  use, actual export/import/restore controls, and small-window layout.
- Architecture, verification, and package checksum: [SETTINGS.md](SETTINGS.md).

### 1 October 2026: scoped 1.1.0 workspace

- Samuel selected the existing improvements, context menu, modal rewrite, and
  layout cleanup as 1.1.0 scope; JSON storage and extra editor extensions follow.
- Added a transaction-backed, keyboard-accessible editor context menu with a
  browser-menu fallback and bounded placement.
- Shared native modal lifecycle now covers Settings/help/welcome/rename/delete.
  Confirmed rename/delete failure and retry preserve notes until storage succeeds.
- Set the manifest to 1.1.0. The build and its known verification limits are
  recorded in [RELEASE_1.1.0.md](RELEASE_1.1.0.md). Store submission is not done.

## Primary references checked for this plan

- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): current local quota, failures, bytes in use, access levels.
- [Chrome extension storage behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies): persistence, eviction, IndexedDB context.
- [Chrome manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key): stable development extension ID.
- [Chrome commands API](https://developer.chrome.com/docs/extensions/reference/api/commands): browser shortcut rules and conflicts.
- [Chrome MV3 remote code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code): bundle editor code locally.
- [MDN `execCommand()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand): deprecated and inconsistent editing commands.
- [Tiptap vanilla JavaScript setup](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript), [StarterKit](https://tiptap.dev/docs/editor/extensions/functionality/starterkit), [task lists](https://tiptap.dev/docs/editor/extensions/nodes/task-list), and [JSON/HTML output](https://tiptap.dev/docs/guides/output-json-html): editor spike basis.
- [MDN IndexedDB usage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB): transactions and shutdown limits.

### 2 October 2026: modal polish and folder backups

- Restored Settings action/theme/close icons; removed the backup reminder and
  successful-theme message. Empty status no longer reserves space. Buttons use
  immediate filled keyboard focus instead of outlines; modal shells have no outline.
- Added explicit folder backups: choose a folder, write a unique dated snapshot,
  close and read back before reporting success. Include pending edits; cancel
  quietly; keep older backups; keep download/import/recovery as fallbacks.
- Grouped modal controllers and styles under `src/ui`, consolidating duplicate
  Settings styles. The user's filesystem request means computer-folder backups,
  not a broader repository restructure.
- Found and fixed a real context-menu focus race: synchronous focus return now
  allows immediate undo/redo after a menu action.
- Nine packaged Chrome suites, four unit suites, build/syntax, and deterministic
  packaging pass. OS chooser interaction and native browser/OS key routing remain
  manual checks. See [RELEASE_1.1.1.md](RELEASE_1.1.1.md).

### 2 October 2026: focused-dialog accessibility correction

- Reproduced the welcome-modal `aria-hidden` warning with a failing regression.
- Removed redundant native-dialog ARIA visibility; use the actual open state for
  shortcut suppression. Sidebar now returns focus before hiding its subtree.
- Five affected packaged browser suites and four unit suites pass; Chrome logs
  contain no blocked-ARIA warning in the regression flow.
- Rebuilt the untagged 1.1.1 ZIP. The release record contains its replacement
  checksum. Local workspace and GitHub branch both carry this correction.

### 2 October 2026: unlimited local storage

- Samuel explicitly approved `unlimitedStorage`. Added the required permission
  without changing storage keys, the note schema, or Chrome sync settings.
- Storage health records actual bytes; quota and percentage are null when the
  local byte quota is disabled. Chrome still reports its default QUOTA_BYTES
  constant, so that constant alone cannot describe effective headroom.
- Removed the 10 MB file-import and 10,000-note import caps so larger exports
  remain restorable. Schema validation and pre-import recovery remain in place.
- Available disk and memory still bound operation; importing/exporting currently
  materializes JSON in memory. This change is not an unbounded-scale performance
  claim. Measurement and packaging evidence are in RELEASE_1.1.1.md.

- Final evidence: all ten packaged Chrome suites passed. A 12,962,201-byte local
  notebook survived restart and its 12,962,433-byte exported file restored with
  identical note hashes. Validation accepted 10,001 note records. Four unit
  suites, syntax, build, and deterministic packaging passed.
