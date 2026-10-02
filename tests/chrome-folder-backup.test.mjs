import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, typeText, loadNotebook } from "./helpers/chrome.mjs";

test("folder backup writes verified snapshots and handles cancellation and failure", { timeout: 45000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-folder-backup-"));
  let chrome, page;
  try {
    chrome = await startChrome(profile); page = await openExtensionPage(chrome);
    const original = { id: "backup", title: "Backup", content: "<p>Original</p>", createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" };
    await loadNotebook(page, [original]);
    // Only substitute the OS chooser. Writes use real browser filesystem handles.
    await evaluate(page, `(async () => {
      window.backupDirectory = await (await navigator.storage.getDirectory()).getDirectoryHandle('Backups', { create: true });
      window.pickBackupDirectory = async options => {
        window.pickerOptions = options;
        window.pickerHadActivation = navigator.userActivation.isActive;
        return backupDirectory;
      };
      window.showDirectoryPicker = pickBackupDirectory;
      window.originalSaveNote = renStorage.saveNote;
      renStorage.saveNote = async () => { throw new Error('Simulated local save failure'); };
    })()`);
    await click(page, "#noteContent"); await press(page, "a", "KeyA", 2); await typeText(page, "Unsaved but backed up");
    await press(page, ",", "Comma", 2);
    await poll(() => evaluate(page, 'document.getElementById("settingsModal").open'), "settings");
    const status = () => evaluate(page, 'document.getElementById("settingsStatus").textContent');
    await click(page, "#settingsFolderBackupBtn");
    await poll(async () => (await status()).startsWith("Backup saved to"), "verified backup");
    assert.equal(await evaluate(page, 'pickerHadActivation'), true);
    assert.equal(await evaluate(page, 'pickerOptions.mode'), "readwrite");
    const files = await evaluate(page, `(async () => { const result=[]; for await (const [name,handle] of backupDirectory.entries()) result.push({name, data:JSON.parse(await (await handle.getFile()).text())}); return result; })()`);
    assert.equal(files.length, 1);
    assert.match(files[0].name, /^ren-backup-.*\.json$/);
    assert.match(files[0].data.notes[0].content, /Unsaved but backed up/);
    assert.equal(files[0].data.currentNoteId, original.id);
    await click(page, "#settingsFolderBackupBtn");
    await poll(async () => (await status()).startsWith("Backup saved to"), "second backup");
    assert.equal(await evaluate(page, '(async () => {let n=0; for await (const _ of backupDirectory.values()) n++; return n;})()'), 2);

    // Cancel quietly; denied access and failed writes must never claim success.
    for (const name of ["AbortError", "NotAllowedError"]) {
      await evaluate(page, `window.showDirectoryPicker = async () => { throw new DOMException('Test failure', ${JSON.stringify(name)}); };`);
      await click(page, "#settingsFolderBackupBtn");
      await poll(() => evaluate(page, '!document.getElementById("settingsFolderBackupBtn").disabled'), "picker settled");
      assert.equal((await status()).includes("Could not save"), name !== "AbortError");
      assert.equal((await status()).includes("Backup saved"), false);
    }
    // Actual write/readback verification, including a corrupted result.
    await evaluate(page, `window.originalWriteBackup = RenBackups.write; RenBackups.write = async () => { throw new Error('Disk full'); }; window.showDirectoryPicker = pickBackupDirectory;`);
    await click(page, "#settingsFolderBackupBtn");
    await poll(async () => (await status()).includes("Could not save"), "write failure");
    assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), true);
    await evaluate(page, 'RenBackups.write = originalWriteBackup; renStorage.saveNote = originalSaveNote;');
    const failure = await evaluate(page, `(async () => {
      let aborted = false; let removed = false;
      const directory = { removeEntry: async () => { removed = true; }, getFileHandle: async (_name, options) => {
        if (!options) throw new DOMException('', 'NotFoundError');
        return { createWritable: async () => ({write: async () => {throw new Error('Disk full');},close:async()=>{},abort:async()=>{aborted=true;}}) };
      }};
      try { await RenBackups.write(directory, '{}'); } catch (error) { return aborted && removed && error.message === "Disk full"; }
    })()`);
    assert.equal(failure, true, "abort an incomplete write");
    const verified = await evaluate(page, `(async () => {
      const directory = {removeEntry:async()=>{},getFileHandle:async(_name,options)=>{
        if(!options) throw new DOMException('','NotFoundError');
        return {createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}}),getFile:async()=>({text:async()=> 'corrupt'})};
      }};
      try {await RenBackups.write(directory,'{}');return false;} catch (error) {return error.message === 'Backup verification failed';}
    })()`);
    assert.equal(verified, true, "reject a mismatched readback");
    // The exact folder-backup payload passes Ren's restore validation.
    assert.deepEqual(await evaluate(page, `Object.create(RenNotePad.prototype).prepareImportedNotebook(${JSON.stringify(files[0].data)}).notes`), files[0].data.notes);
    await press(page, "Escape", "Escape");
    assert.equal(await evaluate(page, 'document.getElementById("settingsModal").open'), false);
    await evaluate(page, 'window.showDirectoryPicker = undefined');
    await press(page, ",", "Comma", 2);
    assert.equal(await evaluate(page, 'document.getElementById("settingsFolderBackupBtn").hidden'), true);
    assert.equal(await evaluate(page, 'document.getElementById("settingsExportBtn").disabled'), false);
  } finally {
    page?.close(); if (chrome) await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
});
