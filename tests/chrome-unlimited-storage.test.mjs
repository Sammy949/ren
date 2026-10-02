import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, loadNotebook } from "./helpers/chrome.mjs";

test("notebooks beyond 10 MB survive restart, export, and import", { timeout: 120000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-unlimited-"));
  let chrome, page;
  const working = { id: "working", title: "Working note", content: "<p>Current note</p>", createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" };
  try {
    chrome = await startChrome(profile); page = await openExtensionPage(chrome);
    assert.equal(await evaluate(page, 'chrome.runtime.getManifest().permissions.includes("unlimitedStorage")'), true);
    await loadNotebook(page, [working]);
    // Generate synthetic text in Chrome to avoid transmitting a huge fixture over CDP.
    await evaluate(page, `(async () => {
      const notes = [${JSON.stringify(working)}, ...Array.from({length:12}, (_,i) => ({
        ...${JSON.stringify(working)}, id:'large-'+i, title:'Large '+i,
        content:'<p>'+String(i).padStart(2,'0')+' text '.repeat(180000)+'</p>'
      }))];
      await renStorage.saveAllNotes(notes, 'working');
    })()`);
    const measure = () => evaluate(page, `(async () => {
      const notes = await renStorage.getAllNotes();
      const data = new TextEncoder().encode(JSON.stringify(notes));
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n=>n.toString(16).padStart(2,'0')).join('');
      return {count:notes.length,digest,info:await renStorage.getStorageInfo(),current:await renStorage.getCurrentNoteId()};
    })()`);
    const before = await measure();
    assert.equal(before.count, 13);
    assert.ok(before.info.bytesInUse > 10 * 1024 * 1024);
    assert.equal(before.info.quota, null);
    assert.equal(before.info.percentUsed, null);
    assert.equal(before.info.unlimited, true);
    page.close(); await stopChrome(chrome);
    chrome = await startChrome(profile); page = await openExtensionPage(chrome);
    await poll(() => evaluate(page, 'document.getElementById("noteTitle").textContent === "Working note"'), "restarted notebook");
    const reopened = await measure();
    assert.equal(reopened.digest, before.digest);
    assert.equal(reopened.current, "working");

    const downloads = path.join(profile, "downloads"); await mkdir(downloads);
    await page.call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    await press(page, "E", "KeyE", 10);
    const filename = await poll(async () => (await readdir(downloads)).find(name => name.endsWith(".json")), "large export");
    const backupPath = path.join(downloads, filename);
    const exported = await readFile(backupPath);
    assert.ok(exported.length > 10 * 1024 * 1024);
    assert.equal(JSON.parse(exported).notes.length, 13);

    // Restore the actual downloaded file through Ren's file input and confirmation.
    await evaluate(page, `(async () => {
      await renStorage.replaceAllNotesWithBackup([{...${JSON.stringify(working)},id:'replacement',title:'Replacement'}], 'replacement');
    })()`);
    await page.call("Page.reload");
    await poll(() => evaluate(page, 'document.getElementById("noteTitle").textContent === "Replacement"'), "replacement notebook");
    await page.call("Page.enable");
    page.socket.addEventListener("message", ({data}) => {
      if (JSON.parse(data).method === "Page.javascriptDialogOpening") page.call("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    });
    await press(page, ",", "Comma", 2);
    await page.call("Page.setInterceptFileChooserDialog", { enabled: true });
    await click(page, "#settingsImportBtn");
    const {root} = await page.call("DOM.getDocument");
    const {nodeId} = await page.call("DOM.querySelector", { nodeId: root.nodeId, selector: "#importFileInput" });
    await page.call("DOM.setFileInputFiles", { nodeId, files: [backupPath] });
    await poll(() => evaluate(page, 'document.getElementById("noteTitle").textContent === "Working note"'), "large import", 30000);
    assert.equal((await measure()).digest, before.digest);
    assert.equal(await evaluate(page, '(async () => (await renStorage.getPreImportBackupInfo()).storedNoteCount)()'), 1);
    // No count-only rejection above the old import cap; schema checks still apply.
    assert.equal(await evaluate(page, `(() => {
      const app = Object.create(RenNotePad.prototype);
      const notes = Array.from({length:10001}, (_,i)=>({...${JSON.stringify(working)},id:'many-'+i,content:''}));
      return app.prepareImportedNotebook({notes}).notes.length;
    })()`), 10001);
    console.log(`Verified ${before.info.bytesInUse} local bytes and ${exported.length} exported bytes; 13 notes retained across restart and import.`);
  } finally {
    page?.close(); if (chrome) await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
});
