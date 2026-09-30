# Editor formatting baseline

Captured on 26 September 2026 in the packaged Chrome extension, at a 320 px
panel width, using synthetic text. The browser test inserts text through native
editing commands, then inspects the rendered editor DOM. The editor at that baseline was
`contenteditable` with custom block changes and `document.execCommand()`.

| Sequence | Observed result | Expected direction |
| --- | --- | --- |
| Type `# `, then `Heading` | `<h1>Heading</h1>`; cursor stays in the heading. | Keep this input rule and caret placement. |
| Type `**bold** next` | Literal `**bold** next` inside a paragraph. | Restore inline input rules in the replacement editor; no formatting spill into ` next`. |
| Select `selected`, invoke inline code, type ` after` | The code node initially contains `selected`. The next insertion removes it and leaves a styled `font`/`span` containing ` after`. | Preserve `selected` as code and put the continuation outside the code mark. |
| Type `[] task`, toggle checkbox, serialize and reload | Task element is created; checked property, attribute, and container class survive reload. | Preserve this behavior with a structured task node. |

The inline code continuation is a confirmed content-loss bug in the original
editor. Typed bold syntax remaining literal is intentional in v1 because the
older inline shortcut spilled formatting into following text. Neither should be
treated as an acceptable v2 outcome.

## Interim safeguard

On `fix/inline-code-selection-loss`, the code command collapses the selection
after insertion. The same Chrome sequence now retains `selected` while typing
continues. Chrome still appends ` after` inside the code element, so formatting
spill remains a failing v2 requirement. Placing a DOM range in an empty sibling
or at the parent boundary produced the same spill in the packaged browser.

## Next browser matrix

For each supported block and inline mark: type, transform, continue typing,
move the cursor, undo, redo, save, reopen, export, and import. Include IME,
selection crossing blocks, empty task items, pasted HTML, adjacent marks,
nested lists, and a narrow side panel. Record the exact package used for each
run; keep all fixtures synthetic.

## Production integration, 30 September 2026

`tests/chrome-editor.test.mjs` now uses real keyboard and pointer events against
Ren's integrated Tiptap editor. The observed failures above are historical.
Heading conversion undoes/redoes; typed bold ends before the following plain
text; inline code preserves the selected text and keeps continuation outside
code; checked tasks survive v1 serialization and reload. History exhaustion,
redo invalidation, note switching, native input undo, IME, and real clipboard
paste pass. See `EDITOR_INTEGRATION.md` for exact coverage and remaining gates.
