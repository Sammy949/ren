import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, loadNotebook } from "./helpers/chrome.mjs";

test("Settings owns theme, backup actions, and repeated modal lifecycles", { timeout: 60000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-settings-"));
  let chrome, page;
  const original = { id: "settings-original", title: "Original", content: "<p>Keep this note</p>", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  try {
    chrome = await startChrome(profile); page = await openExtensionPage(chrome);
    await page.call("Page.enable");
    // Accept the real import/restore confirmation dialogs in this disposable profile.
    page.socket.addEventListener("message", ({data}) => {
      if (JSON.parse(data).method === "Page.javascriptDialogOpening") page.call("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    });
    await loadNotebook(page, [original]);
    const open = async () => {
      await press(page, ",", "Comma", 2);
      await poll(() => evaluate(page, 'document.getElementById("settingsModal").matches(":modal")'), "native modal");
    };
    await open();
    assert.equal(await evaluate(page, 'getComputedStyle(document.getElementById("settingsModal")).outlineStyle'), "none");
    await press(page, "Tab", "Tab");
    assert.equal(await evaluate(page, 'document.activeElement.id'), "themeLight");
    assert.equal(await evaluate(page, 'getComputedStyle(document.activeElement).outlineStyle'), "none");
    assert.equal(await evaluate(page, 'getComputedStyle(document.activeElement).backgroundColor === getComputedStyle(document.getElementById("settingsModal")).color'), true, "keyboard focus remains visible through fill");
    await poll(() => evaluate(page, 'document.getElementById("settingsRestoreImportBtn").hidden'), "no recovery action without backup");
    await click(page, "#themeLight");
    await poll(() => evaluate(page, 'document.getElementById("themeLight").getAttribute("aria-pressed") === "true" && !document.getElementById("themeLight").disabled'), "saved theme");
    assert.equal(await evaluate(page, 'document.getElementById("settingsStatus").textContent'), "");
    await evaluate(page, 'window.originalSetTheme = renStorage.setTheme; renStorage.setTheme = async () => { throw new Error("Simulated settings write failure"); };');
    await click(page, "#themeDark");
    await poll(() => evaluate(page, 'document.getElementById("settingsStatus").textContent.includes("Could not save")'), "theme failure");
    assert.equal(await evaluate(page, 'document.documentElement.dataset.theme'), "light");
    assert.equal(await evaluate(page, 'document.getElementById("themeLight").getAttribute("aria-pressed")'), "true");
    await evaluate(page, 'renStorage.setTheme = window.originalSetTheme; delete window.originalSetTheme;');
    await click(page, "#themeDark");
    await poll(() => evaluate(page, 'document.documentElement.dataset.theme === "dark"'), "theme retry");
    await page.call("Page.reload");
    await poll(() => evaluate(page, 'document.documentElement.dataset.theme === "dark" && document.getElementById("noteTitle").textContent === "Original"'), "persisted theme");
    for (let index = 0; index < 3; index++) {
      await open();
      assert.equal(await evaluate(page, 'document.querySelectorAll("#settingsModal").length'), 1);
      await press(page, "Escape", "Escape");
      assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), false);
    }
    await open();
    await page.call("Input.dispatchMouseEvent", {type:"mousePressed", x:2, y:2, button:"left", clickCount:1});
    await page.call("Input.dispatchMouseEvent", {type:"mouseReleased", x:2, y:2, button:"left", clickCount:1});
    assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), false, "backdrop closes Settings");
    await open();
    await click(page, "#themeSystem");
    await poll(() => evaluate(page, 'document.getElementById("themeSystem").getAttribute("aria-pressed") === "true"'), "system theme");
    const surfaces = [];
    for (const theme of ["light", "dark"]) {
      await page.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      surfaces.push(await evaluate(page, 'getComputedStyle(document.getElementById("settingsModal")).backgroundColor'));
    }
    assert.notEqual(surfaces[0], surfaces[1]);
    await page.call("Emulation.setDeviceMetricsOverride", { width: 320, height: 360, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(page, `(() => {const r=document.getElementById('settingsModal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), true);
    if (process.env.REN_UI_ARTIFACT_DIR) {
      await mkdir(process.env.REN_UI_ARTIFACT_DIR, {recursive:true});
      const {data} = await page.call("Page.captureScreenshot", {format:"png"});
      await writeFile(path.join(process.env.REN_UI_ARTIFACT_DIR, "settings-small.png"), Buffer.from(data,"base64"));
    }
    await page.call("Emulation.setDeviceMetricsOverride", { width: 400, height: 700, deviceScaleFactor: 1, mobile: false });
    if (process.env.REN_UI_ARTIFACT_DIR) {
      const {data} = await page.call("Page.captureScreenshot", {format:"png"});
      await writeFile(path.join(process.env.REN_UI_ARTIFACT_DIR, "settings.png"), Buffer.from(data,"base64"));
    }
    const downloads = path.join(profile, "downloads"); await mkdir(downloads);
    await page.call("Browser.setDownloadBehavior", {behavior:"allow", downloadPath:downloads});
    await click(page, "#settingsExportBtn");
    const filename = await poll(async () => (await readdir(downloads)).find(file => file.endsWith(".json")), "export download");
    const backup = JSON.parse(await readFile(path.join(downloads, filename), "utf8"));
    assert.equal(backup.notes[0].content, original.content);
    const importFile = path.join(profile, "replacement.json");
    await writeFile(importFile, JSON.stringify({ notes: [{...original, id:"replacement",title:"Imported",content:"<p>Replacement</p>"}] }));
    await open();
    await page.call("Page.setInterceptFileChooserDialog", {enabled:true});
    await click(page, "#settingsImportBtn");
    assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), false);
    const {root} = await page.call("DOM.getDocument");
    const {nodeId} = await page.call("DOM.querySelector", {nodeId:root.nodeId,selector:"#importFileInput"});
    await page.call("DOM.setFileInputFiles", {nodeId, files:[importFile]});
    await poll(() => evaluate(page, 'document.getElementById("noteTitle").textContent === "Imported"'), "import through Settings");
    await open();
    await poll(() => evaluate(page, '(()=>{const b=document.getElementById("settingsRestoreImportBtn");return !b.hidden&&!b.disabled;})()'), "recovery control");
    await click(page, "#settingsRestoreImportBtn");
    await poll(() => evaluate(page, 'document.getElementById("noteTitle").textContent === "Original"'), "restore through Settings");
    assert.equal(await evaluate(page, '(async()=>(await renStorage.getAllNotes())[0].content)()'), original.content);
    await open();
    await click(page, "#settingsShortcutsBtn");
    assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), false);
    assert.equal(await evaluate(page, 'document.getElementById("shortcutsHelpModal").open'), true);
  } finally {
    page?.close(); if (chrome) await stopChrome(chrome);
    await rm(profile, {recursive:true,force:true});
  }
});
