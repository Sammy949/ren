import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, loadNotebook } from "./helpers/chrome.mjs";

test("note dialogs share lifecycle and preserve records after failed writes", {timeout:45000}, async () => {
  const profile=await mkdtemp(path.join(os.tmpdir(),"ren-note-dialogs-")); let chrome,page;
  try {
    chrome=await startChrome(profile); page=await openExtensionPage(chrome);
    const note=id=>({id,title:id,content:`<p>${id} body</p>`,createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-01T00:00:00Z"});
    await loadNotebook(page,[note("First"),note("Second")]);
    const openAction=async action=>{
      await click(page,"#hamburgerBtn");
      await poll(()=>evaluate(page,'Math.abs(document.getElementById("sidebar").getBoundingClientRect().x)<.1'),"sidebar");
      await click(page,`.${action}-note-btn[data-note-id="First"]`);
      assert.equal(await evaluate(page,`document.getElementById('${action}Modal').matches(':modal')`),true);
      assert.equal(await evaluate(page,"document.querySelectorAll('dialog[open]').length"),1);
    };
    await openAction("rename");
    assert.equal(await evaluate(page,"document.activeElement.id"),"renameInput");
    await press(page,"Escape","Escape");
    assert.equal(await evaluate(page,"document.activeElement.id"),"hamburgerBtn");
    await openAction("rename");
    await page.call("Input.insertText",{text:"Chosen name"});
    await evaluate(page, 'window.saveNoteOriginal=renStorage.saveNote; renStorage.saveNote=async()=>{throw new Error("Simulated write failure");};');
    await click(page,"#confirmRename");
    await poll(()=>evaluate(page,'document.querySelector("#renameModal .modal-error").textContent.includes("Could not save")'),"rename failure");
    assert.equal(await evaluate(page,'document.getElementById("renameModal").open'),true);
    assert.equal(await evaluate(page,'document.getElementById("noteTitle").textContent'),"First");
    await evaluate(page,'renStorage.saveNote=window.saveNoteOriginal; delete window.saveNoteOriginal;');
    await click(page,"#confirmRename");
    await poll(()=>evaluate(page,'!document.getElementById("renameModal").open'),"rename success");
    assert.equal(await evaluate(page,'document.getElementById("noteTitle").textContent'),"Chosen name");
    await openAction("delete");
    assert.equal(await evaluate(page,"document.activeElement.id"),"cancelDelete");
    await press(page,"n","KeyN",3);
    assert.equal(await evaluate(page,'(async()=>(await renStorage.getAllNotes()).length)()'),2,"app shortcut blocked in alertdialog");
    await evaluate(page,'window.saveAllOriginal=renStorage.saveAllNotes; renStorage.saveAllNotes=async()=>{throw new Error("Simulated write failure");};');
    await click(page,"#confirmDelete");
    await poll(()=>evaluate(page,'document.querySelector("#deleteModal .modal-error").textContent.includes("Could not save")'),"delete failure");
    assert.equal(await evaluate(page,'document.getElementById("noteTitle").textContent'),"Chosen name");
    assert.equal(await evaluate(page,'(async()=>(await renStorage.getAllNotes()).length)()'),2);
    await evaluate(page,'renStorage.saveAllNotes=window.saveAllOriginal; delete window.saveAllOriginal;');
    await click(page,"#confirmDelete");
    await poll(()=>evaluate(page,'!document.getElementById("deleteModal").open'),"delete success");
    assert.equal(await evaluate(page,'document.getElementById("noteTitle").textContent'),"Second");
    assert.equal(await evaluate(page,'(async()=>(await renStorage.getAllNotes()).length)()'),1);
    await page.call("Page.reload");
    await poll(()=>evaluate(page,'document.getElementById("noteTitle")?.textContent==="Second"'),"persisted deletion");
  } finally {page?.close();if(chrome)await stopChrome(chrome);await rm(profile,{recursive:true,force:true});}
});
