# Ren rewrite roadmap

Updated: 25 September 2026. Status: milestone 0 and storage safeguards in progress.

## Purpose and working memory

Ren is a local-first Chrome side-panel notepad. Its value is fast capture, reliable
recall, and calm writing. Keep the current light and dark visual character as the
baseline. The rewrite succeeds when formatting feels predictable and a user can
trust that a note which says "Saved" can be reopened with the same content.

This file is the project memory for the rewrite. Update the **Decisions**,
**Evidence**, and **Next action** sections whenever a milestone closes. Do not
record private notes, extension IDs, browser-profile paths, or recovery data here.

## What exists today

- MV3 extension, plain JavaScript, no package manager or build step. The manifest
  loads `background.js`, `sidepanel.html`, `storage.js`, `editor.js`, and
  `sidepanel.js` directly.
- Notes live in `chrome.storage.local`; theme and onboarding preference live in
  `chrome.storage.sync`. Legacy `sylva_*` keys are intentional compatibility data.
- Rich content is stored as HTML from a hand-built `contenteditable` editor.
  Block shortcuts and checkboxes are custom DOM mutations; toolbar formatting
  uses `document.execCommand()` in many places. Typed inline formatting was
  disabled after formatting spilled into following text.
- Each normal save calls `saveAllNotes(this.notes)`, writing the entire note set
  and index. Search scans in-memory note content and rebuilds note cards.
- The title has two competing sources: users can edit it, then the next body save
  derives it again from the first line. The save status can say "Saved" before the
  storage promise completes.
- The September data-loss postmortem is an untracked incident note. It reports an
  extension-ID mismatch and failed recovery. The available record does **not**
  prove that frequent writes fragmented LevelDB or caused the loss. Treat that as
  a hypothesis, not an architectural premise.

## Decisions

1. **Reliability before feature breadth.** Preserve existing notes and exports
   before changing editor or storage formats. Do not add categories, cloud sync,
   accounts, or a broad visual redesign to this rewrite.
2. **Replace the editor engine, preserve the product shell.** Spike a bundled,
   headless Tiptap/ProseMirror editor with Ren's existing toolbar and CSS.
   Tiptap supports vanilla JavaScript, structured documents, history, task
   lists, and input rules. Add TypeScript and a local build tool if the spike
   passes. React is not a prerequisite for fixing formatting.
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
| P0 | `scheduleAutoSave()` sets "Saved" without awaiting `saveCurrentNote()`; `saveData()` catches storage failures and resolves. | Users can be told a failed write succeeded. | Reproduced with a failing storage mock; `saveData()` resolved and emitted an error notice. |
| P0 | `saveCurrentNote()` calls `saveData()`, which writes every note on each save. | Write cost grows with the whole collection; overlapping writes can make ordering hard to reason about. | Direct call path in `sidepanel.js`; performance impact still needs measurement. |
| P0 | Chrome storage reads ignore `runtime.lastError`; `getAllNotes()` also turns any caught read failure into `[]`. `loadData()` treats `[]` as a genuinely empty collection. | A transient read failure can lead Ren to create a new note and replace the visible index while old note keys remain. | Code path confirmed; failure sequence needs a packaged-browser test. |
| P0 | Imported content, note titles, search text, and notification messages can reach `innerHTML` without a strict allowlist or text encoding. | A crafted backup/title/query can inject markup into the extension UI. Extension CSP constrains script execution, but markup and deceptive UI remain a concern. | Code path confirmed; browser impact needs a local repro. |
| P0 | Import replaces the index but leaves old `note_*` keys in storage. | Hidden orphan notes consume quota and make recovery confusing. | Reproduced with a mocked `chrome.storage.local`: only the new note was listed, while both keys remained. |
| P1 | Manual title edits can be overwritten by first-line derivation on a later body save. | The title component has no stable ownership rule. | Direct call path in `finishEditingTitle()` and `saveCurrentNote()`. |
| P1 | Undo/redo availability is tracked with booleans, and custom DOM operations bypass the editor's history model. | Toolbar state and actual undo history can disagree. | Direct code path; browser interaction matrix needed. |
| P1 | Note IDs use `Date.now().toString()` for new notes; imports accept loosely typed IDs. | Fast creation or malformed imports can collide or produce bad keys. | Direct code path; collision test needed. |
| P1 | Focused storage tests and a real Chrome restart smoke test now exist, but no formatting or narrow-layout browser gate exists. Store screenshots are 1280px wide, wider than a usual side panel. | Editor and narrow-layout regressions can still escape review. | Storage read/save tests and unpacked-extension restart smoke pass; editor interaction coverage remains open. |
| P2 | `getStorageInfo()` assumes 5 MB; current Chrome documents 10 MB for `storage.local` in modern versions. | Usage UI would misreport headroom. | Current Chrome API reference. |
| P2 | Onboarding says notes sync, while notes are local. Settings display "Ren v2.0" while the manifest is 1.0.0. | Product copy contradicts actual behavior. | Repository code and manifest. |

Do not describe the original incident as "corruption caused by the editor." Editor
bugs can damage a note's formatting or serialized content. Extension identity,
storage writes, import handling, and backup gaps are separate failure paths.

## Milestones and exit gates

### 0. Safeguard the existing data and capture a baseline

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

1. Should a new note's first line ever suggest its title, or should titles always
   start as "Untitled" until edited? Recommendation: suggest once, then respect
   manual edits permanently.
2. Should import default to **replace after automatic pre-import backup** or
   **merge with duplicate review**? Recommendation: replace only with a tested
   pre-import backup and a clear confirmation; offer merge later.
3. Should v2 stay strictly local, or is cross-device note sync a separate future
   product goal? Recommendation: keep v2 local and describe it honestly.

## Next action

Add a read-only storage health report, then make import staged and validated
with synthetic export/import round-trip coverage. Keep backup/restore work ahead
of the editor migration and record measured baseline results.

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

## Primary references checked for this plan

- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): current local quota, failures, bytes in use, access levels.
- [Chrome extension storage behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies): persistence, eviction, IndexedDB context.
- [Chrome manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key): stable development extension ID.
- [Chrome commands API](https://developer.chrome.com/docs/extensions/reference/api/commands): browser shortcut rules and conflicts.
- [Chrome MV3 remote code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code): bundle editor code locally.
- [MDN `execCommand()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand): deprecated and inconsistent editing commands.
- [Tiptap vanilla JavaScript setup](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript), [StarterKit](https://tiptap.dev/docs/editor/extensions/functionality/starterkit), [task lists](https://tiptap.dev/docs/editor/extensions/nodes/task-list), and [JSON/HTML output](https://tiptap.dev/docs/guides/output-json-html): editor spike basis.
- [MDN IndexedDB usage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB): transactions and shutdown limits.
