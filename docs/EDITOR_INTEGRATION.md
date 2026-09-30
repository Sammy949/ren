# Structured editor integration

The production editor uses locally bundled Tiptap/ProseMirror. Source lives in
`src/editor/`; `editor.js` is the generated browser bundle. Do not edit the bundle
by hand. The manifest still loads local scripts and requires no remote code.

## Build and verification

Use Bun and the checked-in lockfile:

```sh
bun install --frozen-lockfile
bun run build
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p '*test.py'
python3 scripts/package_extension.py
```

Set `REN_CHROME_BIN` to a Chrome executable. Set `REN_EXTENSION_ROOT` to an
extracted release ZIP to test the packaged runtime. Set `REN_UPGRADE_FROM_ROOT`
to the extracted previous release to exercise the same-path upgrade. Then run:

```sh
node --test tests/chrome-editor.test.mjs tests/chrome-interactions.test.mjs tests/chrome-storage-smoke.test.mjs
```

The tests create disposable profiles containing synthetic notes. Optional
`REN_UI_ARTIFACT_DIR` captures synthetic layout/selection screenshots.

On 30 September 2026, normal and clean-cache installs failed tarball integrity
checks for ProseMirror dependencies. Verification used the existing spike's
installed dependencies, with all 42 package versions checked against `bun.lock`.
The bundle builds and passes the packaged browser gates. A clean dependency
installation remains a release gate; version matching is not a tarball-integrity
check. Do not disable integrity verification to get past this failure.

## Data boundary

Editing uses a structured document and transactional history. Persistence still
uses the existing HTML note/backup shape during this integration. Versioned JSON
storage is not implemented yet. Task nodes serialize to Ren's v1 checkbox shape.
Reading a note does not rewrite its HTML. The first edited save retains exact
source HTML in `originalContent`; backups preserve that field.

Legacy conversion is detached from the active document. Unsupported elements,
attributes, styles, task shapes, unsafe links, and combined code formatting are
not silently discarded: the note opens in a sanitized read-only preview. The
original stored content remains available in a JSON export. The preview is not
an exact visual rendering of unsupported source formatting.

Each note load creates a fresh ProseMirror state, including fresh history.
History is not retained between notes or across browser restarts. Toolbar
availability comes from undo/redo depth. Native title/search input history
stays with those inputs. Application shortcuts are suppressed while a dialog is
open, including the interval before focus reaches its controls.

Every storage write includes a distinct sequence marker. Chrome can omit an
unchanged marker from its change event; without the sequence, a repeated save
at one edit revision could look like an external write and reload the editor.

## Verified on the packaged Linux Chrome build

- Typing undo/redo, exhausted history, both redo bindings, redo invalidation
  after a new edit, toolbar undo/redo, and history reset on note switch.
- Selection retained through a toolbar click, inline-code continuation outside
  the code mark, heading undo/redo, Markdown bold, italic, and underline.
- Task command, checked-state undo/redo, v1 serialization, and checked reload.
- Native title-input undo, editor shortcut exclusion in search, dialog scope,
  new note, save, sidebar, search, settings, help, and actual backup download.
- Native IME composition and real clipboard HTML paste through Ctrl+V.
- Unsupported-source preview, unchanged source, and backup recovery metadata.
- Shared selection colors, stable title geometry, pointer/keyboard sidebar resize,
  persistence, bounds, and narrow overlay/wide docking.
- Existing failed-storage, restart, import/restore, and package smoke gates.
- Ctrl+S commits a title edit; AltGraph input is not intercepted as an app shortcut.
- Toolbar layout follows available canvas width after sidebar resizing. Empty-note
  cleanup preserves manual, quarantined, divider-only, and task-only notes.
- The package includes the title/welcome SVG; asset checks catch omitted CSS URLs.

## Still open

Real macOS keyboard behavior and the browser-managed Open Ren command require a
native browser pass. The full formatting matrix remains open, including complex
nested lists, selections spanning blocks, all toolbar actions, large documents,
and wider historical note shapes. JSON persistence, full rollback, performance
budgets, and the remaining roadmap release gates are separate work.
