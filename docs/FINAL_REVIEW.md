# Ren revamp: implementation checkpoint

Date: 1 October 2026

## Verdict

The editor/history, layout, title ownership, shortcut scoping, and initial data
reliability work is ready for review. This is not a release sign-off or completion
of the entire revamp. The remaining gates below are still open. No release tag
or manifest version change was made.

## Final review fixes

- **Storage refresh race:** when a clean panel began reading an external change,
  typing before the read completed could be replaced by the loaded snapshot.
  A deferred-read regression test reproduced this. The panel now checks its edit
  revision again after the read and preserves local content for export.
- **Out-of-order refreshes:** a slower old read could replace a newer result.
  A second regression test reproduced this. A sequence guard now discards stale
  refreshes; starting import or restore also invalidates pending refreshes.
- **Dialog focus:** settings/help lacked Tab containment. Onboarding's delayed
  focus callback could also steal focus from a newly opened settings dialog,
  reproduced by native keyboard events in Chrome. Focus is assigned immediately;
  traps skip hidden and disabled controls. Welcome, settings, and help are covered
  by forward/reverse Tab and Escape checks where applicable.
- **Copy:** removed onboarding note-sync and unlimited-capacity claims, plus the
  store draft's guarantee of never losing a word. Corrected both privacy pages:
  clearing browsing history/cache does not remove extension-storage notes.
  Reference: [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Verification record

Result: all five packaged browser suites, all four unit-test suites, JavaScript
syntax checks, the production build, and the Python packaging check passed on
this checkpoint. The final browser run used sequential execution.

The review ZIP contains 13 runtime files, 181446 bytes. SHA-256:

```text
178bf48ff1e09416f8ceef3e4c82cb21ec26e8368ff041f634a39508cbd5e9a7
```

Repeat the checks from the repository root:

```sh
node --check sidepanel.js
node --check storage.js
node --check background.js
node --test tests/*.test.cjs
bun run build
python3 -m unittest discover -s tests -p '*test.py'
python3 scripts/package_extension.py
```

Set `REN_CHROME_BIN`, `REN_EXTENSION_ROOT` to the extracted ZIP, and
`REN_UPGRADE_FROM_ROOT` to an extracted previous package, then run:

```sh
node --test --test-concurrency=1 tests/chrome-dialogs.test.mjs tests/chrome-editor.test.mjs tests/chrome-formatting.test.mjs tests/chrome-interactions.test.mjs tests/chrome-storage-smoke.test.mjs
```

All tests use synthetic notes and disposable profiles. Browser coverage includes
typing/history, native shortcuts, clipboard and IME, toolbar formatting round
trips, numbered-list import preparation, task state, title ownership, unsupported
source recovery, sidebar resizing, theme selection, storage failure/conflict,
backup/import/restore, browser restart, and same-path prior-package upgrade.

Rendered narrow-sidebar and dark-selection screenshots were inspected. The
design review preserves Samuel's existing visual direction: no new typography,
palette, decorative components, or layout redesign. Header alignment, gutters,
clipping, bare brand mark, and selection consistency were checked. This does not
certify every accessibility or motion state.

The prior clean-install check succeeded with integrity verification enabled;
its generated bundle matched byte for byte. Earlier tarball failures and the
earlier parallel browser timeout remain recorded in `EDITOR_INTEGRATION.md`.
The data-safety review examined editor/storage boundaries and concrete races;
it is not a comprehensive dependency or security certification.

## Remaining release gates

1. Versioned JSON persistence, full migration rollback, and the complete
   historical-note/export/import matrix. Production still persists HTML.
2. Deeper list editing, cross-block selections, large documents, real quota
   exhaustion, rapid navigation, and shutdown during pending writes.
3. Startup, typing, search, save, and heap measurements at 10/100/1,000 notes.
4. Native macOS/browser-managed shortcuts, screen-reader operation, full focus
   order, zoom, reduced motion, and remaining title/theme checks.
5. Branch-stack reconciliation, release package approval, version/tag, and store
   submission. The existing `gh` authentication limitation has not been retested.

See `ROADMAP.md` for the continuing work and `EDITOR_INTEGRATION.md` for the
document-conversion boundary and recovery behavior.
