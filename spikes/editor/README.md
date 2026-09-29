# Structured editor proof

This is a separate MV3 extension with disposable content. It never loads Ren's
storage or production side panel. Run `bun install --frozen-lockfile` and
`bun run build` in this directory. With `REN_CHROME_BIN` pointing to Chrome,
run `node verify.mjs`. The verifier uses a disposable profile and removes it
after the run. The bundle is local; the package does not use a CDN.

Verified in packaged Chrome with Tiptap 3.31.3:

- Typed `**bold** next` becomes bold text followed by plain text. Undo and
  redo preserve that mark boundary.
- Selecting `selected`, applying code, pressing Right, and typing ` after`
  produces `<code>selected</code> after` when the code mark is noninclusive.
- `[ ] task` creates a task item. IME composition commits Japanese text.
  Pasted bold text keeps its mark while a script tag is discarded.
- The editor and page fit a 320 px viewport. The page runs under a
  `chrome-extension:` URL from a local MV3 bundle.

The proof does not migrate notes or replace Ren's live editor. It also does
not establish full v1 HTML round trips, all shortcuts, accessibility, or large
document performance. Those are integration gates, not assumptions from this
spike. The paste check is a synthetic clipboard event; test real clipboard
interaction during integration.
