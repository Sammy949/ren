import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = process.env.REN_EXTENSION_ROOT
  ? path.resolve(process.env.REN_EXTENSION_ROOT)
  : repoRoot;
const v1Fixture = JSON.parse(
  await readFile(path.join(repoRoot, "tests/fixtures/v1-notes.json"), "utf8"),
);
import { startChrome, openExtensionPage, evaluate, stopChrome, poll } from "./helpers/chrome.mjs";

test("Ren notes survive Chrome restarts and package upgrades", { timeout: 45_000 }, async () => {
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "ren-smoke-"));
  const upgradeFromRoot = process.env.REN_UPGRADE_FROM_ROOT
    ? path.resolve(process.env.REN_UPGRADE_FROM_ROOT)
    : null;
  let loadedExtensionRoot = extensionRoot;
  let activeExtensionRoot;
  let chrome;
  let page;

  try {
    if (upgradeFromRoot) {
      activeExtensionRoot = await mkdtemp(
        path.join(os.tmpdir(), "ren-extension-"),
      );
      await rm(activeExtensionRoot, { recursive: true, force: true });
      await cp(upgradeFromRoot, activeExtensionRoot, { recursive: true });
      loadedExtensionRoot = activeExtensionRoot;

      chrome = await startChrome(profileDirectory, loadedExtensionRoot);
      page = await openExtensionPage(chrome);
      await evaluate(page, `(async () => {
        const note = {
          id: "smoke-note",
          title: "Before upgrade",
          content: "Stored by the previous package",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z"
        };
        await renStorage.saveAllNotes([note]);
        await renStorage.setCurrentNoteId(note.id);
      })()`);
      page.close();
      await stopChrome(chrome);

      await rm(activeExtensionRoot, { recursive: true, force: true });
      await cp(extensionRoot, activeExtensionRoot, { recursive: true });
      chrome = await startChrome(profileDirectory, loadedExtensionRoot);
      page = await openExtensionPage(chrome);
      const upgraded = await evaluate(page, `(async () => ({
        notes: await renStorage.getAllNotes(),
        currentNoteId: await renStorage.getCurrentNoteId()
      }))()`);
      assert.equal(upgraded.notes.length, 1);
      assert.equal(upgraded.notes[0].content, "Stored by the previous package");
      assert.equal(upgraded.currentNoteId, "smoke-note");
    } else {
      chrome = await startChrome(profileDirectory, loadedExtensionRoot);
      page = await openExtensionPage(chrome);
    }
    const markupSafety = await evaluate(page, `(() => {
      const app = Object.create(RenNotePad.prototype);
      const raw = '<p onclick="globalThis.injected = true">Hello <strong>bold</strong><img src=x onerror="globalThis.injected = true"><a href="javascript:globalThis.injected = true">bad</a><a href="https://example.com" onclick="globalThis.injected = true">good</a></p><div class="editor-checkbox-item" onclick="globalThis.injected = true"><input type="checkbox" checked onfocus="globalThis.injected = true"><span class="checkbox-text" contenteditable="true">task</span></div><script>globalThis.injected = true</script>';
      const sanitized = app.sanitizeNoteHTML(raw);
      const prepared = app.prepareImportedNotebook({
        notes: [{
          id: 'hostile-note',
          title: 'Hostile fixture',
          content: raw,
          createdAt: '2026-09-26T00:00:00.000Z',
          updatedAt: '2026-09-26T00:00:00.000Z'
        }]
      });
      const content = document.createElement('div');
      content.innerHTML = sanitized;

      app.searchQuery = 'title';
      const hostileTitle = '<img src=x onerror="globalThis.injected = true">Title';
      const card = app.createNoteElement({
        id: 'safe-id',
        title: hostileTitle,
        content: '<p>Preview</p>',
        updatedAt: '2026-09-26T00:00:00.000Z'
      });

      app.notificationContainer = document.createElement('div');
      app.hideNotification = () => {};
      app.showNotification(hostileTitle, 'success');
      const notification = app.notificationContainer.firstElementChild;
      const links = content.querySelectorAll('a');
      return {
        sanitized,
        preparedContent: prepared.notes[0].content,
        unsafeElements: content.querySelectorAll('script,img,iframe,object,embed,svg,math').length,
        unsafeAttributes: content.querySelectorAll('[onclick],[onerror],[onfocus],[style],[id]').length,
        badHref: links[0]?.getAttribute('href') || null,
        goodHref: links[1]?.getAttribute('href') || null,
        goodRel: links[1]?.getAttribute('rel') || null,
        checkboxCount: content.querySelectorAll('.editor-checkbox-item input[type="checkbox"][checked]').length,
        cardText: card.querySelector('.note-title').textContent,
        cardImages: card.querySelectorAll('img').length,
        notificationText: notification.querySelector('.notification-message').textContent,
        notificationImages: notification.querySelectorAll('img').length,
        injected: globalThis.injected === true
      };
    })()`);
    assert.equal(markupSafety.unsafeElements, 0);
    assert.equal(markupSafety.preparedContent, markupSafety.sanitized);
    assert.equal(markupSafety.unsafeAttributes, 0);
    assert.equal(markupSafety.badHref, null);
    assert.equal(markupSafety.goodHref, "https://example.com");
    assert.match(markupSafety.goodRel, /noopener/);
    assert.equal(markupSafety.checkboxCount, 1);
    assert.equal(markupSafety.cardText, '<img src=x onerror="globalThis.injected = true">Title');
    assert.equal(markupSafety.cardImages, 0);
    assert.equal(markupSafety.notificationText, markupSafety.cardText);
    assert.equal(markupSafety.notificationImages, 0);
    assert.equal(markupSafety.injected, false);

    const written = await evaluate(page, `(async () => {
      const note = {
        id: "smoke-note",
        title: "Smoke test",
        content: "Stored in real Chrome storage",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z"
      };
      await renStorage.saveAllNotes([note], note.id);
      return {
        notes: await renStorage.getAllNotes(),
        currentNoteId: await renStorage.getCurrentNoteId(),
        health: await renStorage.getStorageHealth()
      };
    })()`);
    assert.equal(written.notes[0].content, "Stored in real Chrome storage");
    assert.equal(written.currentNoteId, "smoke-note");
    assert.equal(written.health.healthy, true);
    assert.equal(written.health.indexedNoteCount, 1);
    assert.equal(written.health.storedNoteCount, 1);
    assert.ok(written.health.bytesInUse > 0);
    assert.ok(written.health.quotaBytes >= written.health.bytesInUse);

    await page.call("Page.close");
    page.close();
    page = await openExtensionPage(chrome);
    const panelReopened = await evaluate(page, `(async () => ({
      notes: await renStorage.getAllNotes(),
      currentNoteId: await renStorage.getCurrentNoteId()
    }))()`);
    assert.equal(panelReopened.notes.length, 1);
    assert.equal(panelReopened.notes[0].content, "Stored in real Chrome storage");
    assert.equal(panelReopened.currentNoteId, "smoke-note");

    await evaluate(page, `(() => {
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "<p>Saved while Ren is hidden</p>";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });
      document.dispatchEvent(new Event("visibilitychange"));
    })()`);
    const hiddenContent = await poll(async () => {
      const content = await evaluate(page, `(async () =>
        (await renStorage.getAllNotes())[0]?.content
      )()`);
      return content === "<p>Saved while Ren is hidden</p>" ? content : null;
    }, "dirty note flush while Ren is hidden");
    assert.equal(hiddenContent, "<p>Saved while Ren is hidden</p>");

    page.close();
    await stopChrome(chrome);
    chrome = await startChrome(profileDirectory, loadedExtensionRoot);
    page = await openExtensionPage(chrome);

    const reopened = await evaluate(page, `(async () => ({
      notes: await renStorage.getAllNotes(),
      currentNoteId: await renStorage.getCurrentNoteId()
    }))()`);
    assert.equal(reopened.notes.length, 1);
    assert.equal(reopened.notes[0].title, "Smoke test");
    assert.equal(reopened.notes[0].content, "<p>Saved while Ren is hidden</p>");
    assert.equal(reopened.currentNoteId, "smoke-note");

    const peerPage = await openExtensionPage(chrome);
    await poll(async () => {
      const editors = await Promise.all(
        [page, peerPage].map((client) =>
          evaluate(client, `document.getElementById("noteContent")?.textContent`),
        ),
      );
      return editors.every((text) => text === "Saved while Ren is hidden");
    }, "both Ren panels to load the same note");
    await evaluate(page, `(() => {
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "<p>Unsaved edit from the first panel</p>";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await evaluate(peerPage, `(() => {
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "<p>Saved by the second panel</p>";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await Promise.all(
      [page, peerPage].map((client) =>
        evaluate(client, `(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden"
          });
          document.dispatchEvent(new Event("visibilitychange"));
        })()`),
      ),
    );
    const readPanelConflict = async () => {
      const [first, second] = await Promise.all(
        [page, peerPage].map((client) =>
          evaluate(client, `({
            status: document.getElementById("autoSaveStatus")?.textContent,
            open: document.getElementById("noteContent")?.innerHTML
          })`),
        ),
      );
      const stored = await evaluate(page, `(async () =>
        (await renStorage.getAllNotes())[0]?.content
      )()`);
      return [first, second].some(({ status }) => status === "Changed elsewhere")
        ? { first, second, stored }
        : null;
    };
    const panelConflict = await poll(
      readPanelConflict,
      "simultaneous panel conflict detection",
    ).catch(async (error) => {
      const diagnostics = await Promise.all(
        [page, peerPage].map((client) =>
          evaluate(client, `({
            status: document.getElementById("autoSaveStatus")?.textContent,
            open: document.getElementById("noteContent")?.innerHTML,
            locks: Boolean(globalThis.navigator?.locks)
          })`),
        ),
      );
      throw new Error(
        `${error.message}: ${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    });
    assert.ok([
      "<p>Unsaved edit from the first panel</p>",
      "<p>Saved by the second panel</p>",
    ].includes(panelConflict.stored));
    const conflictedPanel = [panelConflict.first, panelConflict.second].find(
      ({ status }) => status === "Changed elsewhere",
    );
    assert.ok(conflictedPanel);
    assert.notEqual(conflictedPanel.open, panelConflict.stored);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const afterStaleTimer = await evaluate(page, `(async () => ({
      stored: (await renStorage.getAllNotes())[0]?.content,
      status: document.getElementById("autoSaveStatus")?.textContent
    }))()`);
    assert.equal(afterStaleTimer.stored, panelConflict.stored);

    const bulkBaseline = await evaluate(page, `(async () => ({
      index: (await renStorage.getAllNotes()).map(({ id }) => id),
      notes: await renStorage.getAllNotes()
    }))()`);
    const bulkWrite = (client, content) => evaluate(client, `(async () => {
      try {
        const note = { ...${JSON.stringify(bulkBaseline.notes[0])}, content: ${JSON.stringify(content)} };
        await renStorage.saveAllNotes(
          [note], note.id,
          { instanceId: ${JSON.stringify(content)}, revision: 1 },
          ${JSON.stringify(bulkBaseline)}
        );
        return { outcome: "saved" };
      } catch (error) {
        return { outcome: error.name };
      }
    })()`);
    const bulkOutcomes = await Promise.all([
      bulkWrite(page, "<p>Structural write A</p>"),
      bulkWrite(peerPage, "<p>Structural write B</p>"),
    ]);
    assert.deepEqual(
      bulkOutcomes.map(({ outcome }) => outcome).sort(),
      ["StorageConflictError", "saved"],
    );
    const preImportContent = await evaluate(page, `(async () =>
      (await renStorage.getAllNotes())[0]?.content
    )()`);
    assert.ok([
      "<p>Structural write A</p>",
      "<p>Structural write B</p>",
    ].includes(preImportContent));
    await peerPage.call("Page.close");
    peerPage.close();

    const importRoundTrip = await evaluate(page, `(async () => {
      const fixture = ${JSON.stringify(v1Fixture)};
      const app = Object.create(RenNotePad.prototype);
      app.dataLoadFailed = false;
      app.notes = fixture.notes;
      app.currentNoteId = fixture.currentNoteId;
      const exported = JSON.parse(JSON.stringify(app.createExportData()));
      const prepared = app.prepareImportedNotebook(exported);
      await renStorage.replaceAllNotesWithBackup(
        prepared.notes,
        prepared.currentNoteId
      );
      return {
        exportVersion: exported.version,
        prepared,
        replaced: await renStorage.getAllNotes()
      };
    })()`);
    assert.equal(importRoundTrip.exportVersion, "1.0");
    assert.deepEqual(importRoundTrip.prepared.notes, v1Fixture.notes);
    assert.equal(importRoundTrip.prepared.currentNoteId, v1Fixture.currentNoteId);
    assert.deepEqual(importRoundTrip.replaced, v1Fixture.notes);

    page.close();
    await stopChrome(chrome);
    chrome = await startChrome(profileDirectory, loadedExtensionRoot);
    page = await openExtensionPage(chrome);
    const persistedImport = await evaluate(page, `(async () => ({
      notes: await renStorage.getAllNotes(),
      currentNoteId: await renStorage.getCurrentNoteId()
    }))()`);
    assert.deepEqual(persistedImport.notes, v1Fixture.notes);
    assert.equal(persistedImport.currentNoteId, v1Fixture.currentNoteId);

    await evaluate(page, `document.getElementById("settingsBtn").click()`);
    const restoreControl = await poll(
      () => evaluate(page, `(() => {
        const button = document.getElementById("settingsRestoreImportBtn");
        if (!button || button.hidden || button.disabled) {
          return null;
        }
        return button.querySelector(".settings-btn-desc").textContent;
      })()`),
      "pre-import restore control",
    );
    assert.match(restoreControl, /Restore 1 note saved before the latest import/);

    const restored = await evaluate(page, `(async () => {
      await renStorage.restorePreImportBackup();
      return {
        notes: await renStorage.getAllNotes(),
        currentNoteId: await renStorage.getCurrentNoteId()
      };
    })()`);
    assert.equal(restored.notes.length, 1);
    assert.equal(restored.notes[0].id, "smoke-note");
    assert.equal(restored.notes[0].content, preImportContent);
    assert.equal(restored.currentNoteId, "smoke-note");

    await evaluate(page, `document.getElementById("closeSettings").click()`);
    await poll(() => evaluate(page,
      `document.getElementById("noteTitle")?.textContent === ${JSON.stringify(restored.notes[0].title)}`),
    "restored note to appear in the panel");
    await evaluate(page, `document.getElementById("newNoteBtn").click()`);
    const titledNoteId = await poll(() => evaluate(page, `(async () => {
      const notes = await renStorage.getAllNotes();
      return notes.length === 2 ? notes[0].id : null;
    })()`), "new note to be saved");
    await evaluate(page, `(() => {
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "<p>First title</p>";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await poll(() => evaluate(page, `(async () => {
      const note = (await renStorage.getAllNotes()).find(({ id }) => id === ${JSON.stringify(titledNoteId)});
      return note?.title === "First title" && note?.titleSource === "suggested";
    })()`), "one-time title suggestion");
    await evaluate(page, `(() => {
      document.getElementById("noteTitle").click();
      const input = document.getElementById("noteTitleInput");
      input.value = "Chosen title";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    })()`);
    await poll(() => evaluate(page, `(async () => {
      const note = (await renStorage.getAllNotes()).find(({ id }) => id === ${JSON.stringify(titledNoteId)});
      return note?.title === "Chosen title" && note?.titleSource === "manual";
    })()`), "manual title to be saved");
    await evaluate(page, `(() => {
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "<p>Changed body heading</p>";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await poll(() => evaluate(page, `(async () => {
      const note = (await renStorage.getAllNotes()).find(({ id }) => id === ${JSON.stringify(titledNoteId)});
      return note?.content === "<p>Changed body heading</p>" && note?.title === "Chosen title";
    })()`), "manual title to survive body save");
    page.close();
    await stopChrome(chrome);
    chrome = await startChrome(profileDirectory, loadedExtensionRoot);
    page = await openExtensionPage(chrome);
    const persistedTitle = await evaluate(page, `(async () =>
      (await renStorage.getAllNotes()).find(({ id }) => id === ${JSON.stringify(titledNoteId)})
    )()`);
    assert.equal(persistedTitle.title, "Chosen title");
    assert.equal(persistedTitle.titleSource, "manual");

    await evaluate(page, `document.getElementById("noteTitle").focus()`);
    await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    const keyboardTitleState = await evaluate(page, `(() => {
      const title = document.getElementById("noteTitle");
      const input = document.getElementById("noteTitleInput");
      return { titleTag: title.tagName, activeTag: document.activeElement?.tagName,
        activeId: document.activeElement?.id, inputHidden: input.classList.contains("hidden") };
    })()`);
    assert.deepEqual(keyboardTitleState, {
      titleTag: "BUTTON", activeTag: "INPUT", activeId: "noteTitleInput", inputHidden: false,
    });
    await evaluate(page, `document.getElementById("noteTitleInput").value = "Cancelled keyboard edit"`);
    await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate(page, `(() => {
      const title = document.getElementById("noteTitle");
      return document.activeElement === title && title.textContent === "Chosen title";
    })()`), true);

    await page.call("Emulation.setDeviceMetricsOverride", {
      width: 320, height: 700, deviceScaleFactor: 1, mobile: false,
    });
    const recoveryUi = await evaluate(page, `(() => {
      const status = document.getElementById("autoSaveStatus");
      const button = document.getElementById("saveRecoveryExportBtn");
      const app = {
        autoSaveStatus: status,
        saveRecoveryExportBtn: button,
      };
      RenNotePad.prototype.setSaveStatus.call(app, "Could not save");
      const visible = !button.hidden && button.getBoundingClientRect().width > 0;
      const buttonBounds = button.getBoundingClientRect();
      const titleBounds = document.getElementById("noteTitle").getBoundingClientRect();
      RenNotePad.prototype.setSaveStatus.call(app, "Saved");
      document.getElementById("settingsBtn").click();
      const modal = document.getElementById("settingsModal");
      return {
        visible,
        buttonFits: buttonBounds.left >= 0 && buttonBounds.right <= window.innerWidth,
        titleFits: titleBounds.left >= 0 && titleBounds.right <= window.innerWidth,
        hiddenAfterSave: button.hidden,
        reminder: modal.querySelector(".settings-backup-reminder")?.textContent,
        version: modal.querySelector(".settings-version")?.textContent,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert.equal(recoveryUi.visible, true);
    assert.equal(recoveryUi.buttonFits, true);
    assert.equal(recoveryUi.titleFits, true);
    assert.equal(recoveryUi.hiddenAfterSave, true);
    assert.match(recoveryUi.reminder, /Export a copy regularly/);
    assert.ok(recoveryUi.version.includes(`Ren v${JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8")).version}`));
    assert.ok(recoveryUi.documentWidth <= recoveryUi.viewportWidth);

    // Editor interactions are exercised with native key/pointer events in chrome-editor.test.mjs.

  } finally {
    page?.close();
    if (chrome) await stopChrome(chrome);
    await rm(profileDirectory, { recursive: true, force: true });
    if (activeExtensionRoot) {
      await rm(activeExtensionRoot, { recursive: true, force: true });
    }
  }
});
