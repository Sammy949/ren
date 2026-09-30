import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, typeText, loadNotebook } from "./helpers/chrome.mjs";

const note = (id, content) => ({ id, title: id, content, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" });

test("formatting commands survive history, save, and reopen", { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-formatting-"));
  let chrome, page;
  try {
    chrome = await startChrome(profile);
    page = await openExtensionPage(chrome);
    await page.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    const html = () => evaluate(page, `(() => {
      const clone = document.getElementById('noteContent').cloneNode(true);
      for (const element of clone.querySelectorAll('.ProseMirror-selectednode')) {
        element.classList.remove('ProseMirror-selectednode');
        if (!element.className) element.removeAttribute('class');
        element.removeAttribute('draggable');
      }
      return clone.innerHTML;
    })()`);
    const stored = () => evaluate(page, '(async () => (await renStorage.getAllNotes())[0])()');
    const saveReload = async () => {
      await press(page, "s", "KeyS", 2);
      await poll(async () => (await stored()).originalContent !== undefined, "formatted save");
      const before = await stored();
      await page.call("Page.reload");
      await poll(() => evaluate(page, `document.getElementById("noteTitle")?.textContent === ${JSON.stringify(before.title)}`), "formatted reload");
      assert.equal(await evaluate(page, 'document.getElementById("editorRecoveryNotice").hidden'), true, before.id);
      assert.equal((await stored()).content, before.content);
      return before;
    };
    for (const [action, tag] of [
      ["bold", "strong"], ["italic", "em"], ["underline", "u"], ["strikethrough", "s"],
      ["code", "code"], ["h1", "h1"], ["h2", "h2"], ["h3", "h3"],
      ["blockquote", "blockquote"], ["bulletList", "ul"], ["numberedList", "ol"], ["hr", "hr"],
    ]) {
      await loadNotebook(page, [note(action, "<p>Alpha β &amp; 🎈</p>")]);
      await click(page, "#noteContent");
      await press(page, "a", "KeyA", 2);
      if (action.endsWith("List")) await click(page, "#toolbarListsBtn");
      await click(page, `[data-action="${action}"]`);
      const formatted = await html();
      assert.match(formatted, new RegExp(`<${tag}[ >]`), action);
      await press(page, "z", "KeyZ", 2);
      assert.equal(await html(), "<p>Alpha β &amp; 🎈</p>", `${action} undo`);
      await press(page, "y", "KeyY", 2);
      assert.equal(await html(), formatted, `${action} redo`);
      await saveReload();
      assert.equal(await html(), formatted, `${action} reopen`);
    }

    // Input rules may generate non-default ordered-list numbering.
    await loadNotebook(page, [note("numbering", "")]);
    await click(page, "#noteContent");
    await typeText(page, "7. Seven");
    assert.match(await html(), /<ol start="7">/);
    await saveReload();
    assert.match(await html(), /<ol start="7">/);
    const imported = await evaluate(page, `(async () => {
      const app = Object.create(RenNotePad.prototype);
      return app.prepareImportedNotebook({notes: await renStorage.getAllNotes()}).notes;
    })()`);
    assert.match(imported[0].content, /<ol start="7">/);
    await loadNotebook(page, imported);
    assert.match(await html(), /<ol start="7">/);

    // Existing nested lists, adjacent marks, links, and hard breaks remain editable.
    for (const [id, content] of [
      ["nested", "<ul><li><p>Parent</p><ol><li><p>Child</p></li></ol></li></ul><p>End</p>"],
      ["adjacent", '<p><strong>Bold</strong><em>Italic</em><u>Under</u><s>Strike</s><code>Code</code><a href="https://example.com/">Link</a><br>End</p>'],
      ["empty-task", '<div class="editor-checkbox-item" contenteditable="false"><input class="checkbox-input" type="checkbox"><span class="checkbox-text" contenteditable="true"></span></div>'],
    ]) {
      await loadNotebook(page, [note(id, content)]);
      assert.equal(await evaluate(page, 'document.getElementById("editorRecoveryNotice").hidden'), true, id);
      await click(page, "#noteContent");
      await press(page, "End", "End", 2);
      await typeText(page, " appended");
      const edited = await html();
      await saveReload();
      assert.equal(await html(), edited, `${id} reopen`);
    }
  } finally {
    page?.close();
    if (chrome) await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
});
