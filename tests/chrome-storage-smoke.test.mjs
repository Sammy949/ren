import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
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
const chromeCandidates = [
  process.env.REN_CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
  const chrome = chromeCandidates.find(existsSync);
  if (!chrome) {
    throw new Error("Chrome not found. Set REN_CHROME_BIN to a Chrome executable.");
  }
  return chrome;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function poll(action, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function startChrome(profileDirectory, loadedExtensionRoot = extensionRoot) {
  const port = await reservePort();
  const stderr = [];
  const processHandle = spawn(findChrome(), [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${loadedExtensionRoot}`,
    `--load-extension=${loadedExtensionRoot}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  processHandle.stderr.setEncoding("utf8");
  processHandle.stderr.on("data", (chunk) => {
    stderr.push(chunk);
    if (stderr.length > 20) stderr.shift();
  });

  const worker = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const list = await response.json();
    const candidates = list.filter(
      ({ type, url, webSocketDebuggerUrl }) =>
        type === "service_worker" &&
        url.endsWith("/background.js") &&
        webSocketDebuggerUrl,
    );
    for (const candidate of candidates) {
      const client = await CdpClient.connect(candidate.webSocketDebuggerUrl);
      try {
        await client.call("Runtime.enable");
        const manifest = await evaluate(
          client,
          "chrome.runtime.getManifest().name",
        );
        if (manifest === "Ren - Minimalist Notepad") return candidate;
      } finally {
        client.close();
      }
    }
    return null;
  }, "Ren extension service worker").catch((error) => {
    processHandle.kill("SIGKILL");
    throw new Error(`${error.message}\n${stderr.join("").trim()}`, {
      cause: error,
    });
  });

  const extensionId = new URL(worker.url).host;
  return { processHandle, port, extensionId, stderr, worker };
}

async function openExtensionPage(chrome) {
  const worker = await CdpClient.connect(chrome.worker.webSocketDebuggerUrl);
  await worker.call("Runtime.enable");
  const extension = await evaluate(worker, `({
    id: chrome.runtime.id,
    pageUrl: chrome.runtime.getURL("sidepanel.html"),
    manifestName: chrome.runtime.getManifest().name
  })`);
  worker.close();
  assert.equal(extension.id, chrome.extensionId);
  assert.equal(extension.manifestName, "Ren - Minimalist Notepad");

  const url = extension.pageUrl;
  const version = await fetch(
    `http://127.0.0.1:${chrome.port}/json/version`,
  ).then((response) => response.json());
  const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.call("Target.createTarget", { url });
  browser.close();

  const target = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${chrome.port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find(({ id }) => id === targetId);
  }, "Ren side panel target");
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.call("Runtime.enable");

  await poll(async () => {
    const result = await client.call("Runtime.evaluate", {
      expression: "document.readyState === 'complete'",
      returnByValue: true,
    });
    return result.result.value === true;
  }, "Ren side panel document");

  const state = await client.call("Runtime.evaluate", {
    expression: `({
      url: location.href,
      storageType: typeof renStorage,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 120)
    })`,
    returnByValue: true,
  });
  if (state.exceptionDetails || state.result.value.storageType === "undefined") {
    throw new Error(
      `Ren side panel scripts did not initialize: ${JSON.stringify(
        state.result.value || state.exceptionDetails,
      )}`,
    );
  }

  return client;
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
  }
  return result.result.value;
}

async function stopChrome(chrome) {
  if (chrome.processHandle.exitCode !== null) return;
  const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`)
    .then((response) => response.json())
    .catch(() => null);
  if (version?.webSocketDebuggerUrl) {
    const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
    await browser.call("Browser.close").catch(() => {});
    browser.close();
  }
  await Promise.race([
    new Promise((resolve) => chrome.processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (chrome.processHandle.exitCode === null) chrome.processHandle.kill("SIGKILL");
}

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
    assert.equal(reopened.notes[0].title, "Saved while Ren is hidden");
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
        if (!button || button.classList.contains("hidden") || button.disabled) {
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
      RenNotePad.prototype.setSaveStatus.call(app, "Saved");
      document.getElementById("settingsBtn").click();
      const modal = document.getElementById("settingsModal");
      return {
        visible,
        buttonFits: buttonBounds.left >= 0 && buttonBounds.right <= window.innerWidth,
        hiddenAfterSave: button.hidden,
        reminder: modal.querySelector(".settings-backup-reminder")?.textContent,
        version: modal.querySelector(".settings-version")?.textContent,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert.equal(recoveryUi.visible, true);
    assert.equal(recoveryUi.buttonFits, true);
    assert.equal(recoveryUi.hiddenAfterSave, true);
    assert.match(recoveryUi.reminder, /Export a copy regularly/);
    assert.match(recoveryUi.version, /Ren v1\.0\.0/);
    assert.ok(recoveryUi.documentWidth <= recoveryUi.viewportWidth);

    const formattingBaseline = await evaluate(page, `(() => {
      document.getElementById("closeSettings").click();
      const editor = document.getElementById("noteContent");
      editor.innerHTML = "";
      editor.focus();
      document.execCommand("insertText", false, "#");
      document.execCommand("insertText", false, " ");
      const headingAfterShortcut = editor.innerHTML;
      document.execCommand("insertText", false, "Heading");
      const headingAfterTyping = editor.innerHTML;

      editor.innerHTML = "<p><br></p>";
      const paragraph = editor.firstElementChild;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      editor.focus();
      for (const character of "**bold** next") {
        document.execCommand("insertText", false, character);
      }
      const inlineAfterTyping = editor.innerHTML;

      editor.innerHTML = "<p>selected</p>";
      const codeText = editor.querySelector("p").firstChild;
      range.setStart(codeText, 0);
      range.setEnd(codeText, codeText.textContent.length);
      selection.removeAllRanges();
      selection.addRange(range);
      RenEditor.prototype.execCode.call({});
      const codeAfterCommand = editor.innerHTML;
      document.execCommand("insertText", false, " after");
      const codeAfterTyping = editor.innerHTML;
      document.execCommand("undo", false, null);
      const codeAfterUndo = editor.innerHTML;

      editor.innerHTML = "";
      editor.focus();
      for (const character of "[] task") {
        document.execCommand("insertText", false, character);
      }
      const checkbox = editor.querySelector(".checkbox-input");
      const checkboxCreated = Boolean(checkbox);
      if (checkbox) checkbox.click();
      const checkboxSerialized = editor.innerHTML;
      editor.innerHTML = checkboxSerialized;
      RenEditor.prototype.normalizeCheckboxes.call({ element: editor });
      return {
        headingAfterShortcut,
        headingAfterTyping,
        inlineAfterTyping,
        codeAfterCommand,
        codeAfterTyping,
        codeAfterUndo,
        checkboxCreated,
        checkboxSerialized,
        checkboxCheckedAfterReload: editor.querySelector(".checkbox-input")?.checked,
      };
    })()`);
    assert.match(formattingBaseline.headingAfterShortcut, /<h1>/);
    assert.match(formattingBaseline.headingAfterTyping, /<h1>Heading<\/h1>/);
    assert.match(formattingBaseline.codeAfterCommand, /<code>selected<\/code>/);
    assert.match(formattingBaseline.codeAfterTyping, /selected after/);
    assert.match(formattingBaseline.codeAfterUndo, /selected/);
    assert.equal(formattingBaseline.checkboxCreated, true);
    assert.equal(formattingBaseline.checkboxCheckedAfterReload, true);
  } finally {
    page?.close();
    if (chrome) await stopChrome(chrome);
    await rm(profileDirectory, { recursive: true, force: true });
    if (activeExtensionRoot) {
      await rm(activeExtensionRoot, { recursive: true, force: true });
    }
  }
});
