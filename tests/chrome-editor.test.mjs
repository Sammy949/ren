import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {startChrome,openExtensionPage,evaluate,stopChrome,poll,press,click,typeText,loadNotebook} from "./helpers/chrome.mjs";
const note=(id,title,content)=>({id,title,content,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"});

test("structured editor history, selection, shortcuts, and source recovery",{timeout:60000},async()=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),"ren-editor-test-"));
 let chrome,page;
 try {
  chrome=await startChrome(profile);page=await openExtensionPage(chrome);
  await page.call("Emulation.setDeviceMetricsOverride",{width:900,height:700,deviceScaleFactor:1,mobile:false});
  await loadNotebook(page,[note("a","First","<p>Original</p>"),note("b","Second","<p>Second body</p>"),note("c","Unsupported",'<p style="color:red">Keep this original</p>')]);
  const html=()=>evaluate(page,`document.getElementById("noteContent").innerHTML`);
  const history=()=>evaluate(page,`({undo:!document.querySelector('[data-action="undo"]').disabled,redo:!document.querySelector('[data-action="redo"]').disabled})`);
  const replace=async text=>{await click(page,"#noteContent");await press(page,"a","KeyA",2);await typeText(page,text);};
  assert.deepEqual(await history(),{undo:false,redo:false});
  await replace("Changed");
  assert.deepEqual(await history(),{undo:true,redo:false});
  await press(page,"z","KeyZ",2);
  assert.equal(await html(),"<p>Original</p>");
  assert.deepEqual(await history(),{undo:false,redo:true});
  await press(page,"Z","KeyZ",10);
  assert.equal(await html(),"<p>Changed</p>");
  await click(page,'[data-action="undo"]');
  assert.equal(await html(),"<p>Original</p>");
  await click(page,'[data-action="redo"]');
  assert.equal(await html(),"<p>Changed</p>");
  await press(page,"z","KeyZ",2);
  await typeText(page,"X");
  assert.equal((await history()).redo,false);
  await press(page,"s","KeyS",2);
  const stored=await poll(()=>evaluate(page,`(async()=>{const n=(await renStorage.getAllNotes()).find(n=>n.id==="a");return n?.originalContent&&n;})()`),"saved original source");
  assert.equal(stored.originalContent,"<p>Original</p>");

  // Switching notes drops the previous document's editing history.
  await click(page,"#hamburgerBtn");
  await poll(()=>evaluate(page,`document.getElementById("sidebar").getBoundingClientRect().x>=-0.1`),"notes list");
  await click(page,'.note-content-area[data-note-id="b"]');
  await poll(()=>evaluate(page,`document.getElementById("noteTitle").textContent==="Second"`),"second note");
  assert.deepEqual(await history(),{undo:false,redo:false});
  assert.equal(await html(),"<p>Second body</p>");
  await click(page,"#noteContent");
  await press(page,"z","KeyZ",2);
  assert.equal(await html(),"<p>Second body</p>");

  // The title input keeps its own native undo, without undoing the note body.
  await click(page,"#noteTitle");
  await typeText(page,"Renamed");
  await press(page,"z","KeyZ",2);
  assert.equal(await html(),"<p>Second body</p>");
  assert.notEqual(await evaluate(page,`document.getElementById("noteTitleInput").value`),"Renamed");
  await press(page,"Escape","Escape");
  await click(page,"#noteTitle");
  await page.call("Input.insertText",{text:"Chosen title"});
  await press(page,"s","KeyS",2);
  await poll(()=>evaluate(page,`(async()=>(await renStorage.getAllNotes()).find(n=>n.id==="b")?.title==="Chosen title")()`),"title save shortcut");
  await press(page,"f","KeyF",2);
  await poll(()=>evaluate(page,`document.activeElement.id==="searchInput"`),"search focus");
  await press(page,"c","KeyC",3);
  assert.equal(await html(),"<p>Second body</p>");
  await press(page,"Escape","Escape");

  // A real selection survives clicking the toolbar.
  await replace("selected");
  await press(page,"a","KeyA",2);
  await click(page,'[data-action="code"]');
  assert.equal(await html(),"<p><code>selected</code></p>");
  await press(page,"ArrowRight","ArrowRight");
  await typeText(page," after");
  assert.equal(await html(),"<p><code>selected</code> after</p>");
  await press(page,"s","KeyS",2);
  await poll(()=>evaluate(page,`(async()=>{const n=(await renStorage.getAllNotes()).find(n=>n.id==="b");return n?.content==="<p><code>selected</code> after</p>";})()`),"formatted save");

  // Unsupported source opens without conversion or accidental replacement.
  await click(page,"#hamburgerBtn");
  await poll(()=>evaluate(page,`document.getElementById("sidebar").getBoundingClientRect().x>=-0.1`),"notes list");
  await click(page,'.note-content-area[data-note-id="c"]');
  await poll(()=>evaluate(page,`!document.getElementById("editorRecoveryNotice").hidden`),"original preview");
  assert.equal(await evaluate(page,`document.getElementById("legacyNotePreview").textContent`),"Keep this original");
  assert.deepEqual(await history(),{undo:false,redo:false});
  await press(page,"s","KeyS",2);
  assert.equal(await evaluate(page,`(async()=>(await renStorage.getAllNotes()).find(n=>n.id==="c").content)()`),'<p style="color:red">Keep this original</p>');

  await loadNotebook(page,[note("format","Formatting","")]);
  await click(page,"#noteContent");
  await typeText(page,"# ");
  assert.match(await html(),/<h1>/);
  await press(page,"z","KeyZ",2);
  assert.doesNotMatch(await html(),/<h1>/);
  await press(page,"y","KeyY",2);
  assert.match(await html(),/<h1>/);

  await loadNotebook(page,[note("marks","Marks","")]);
  await click(page,"#noteContent");
  await typeText(page,"**bold** next");
  assert.equal(await html(),"<p><strong>bold</strong> next</p>");
  await press(page,"a","KeyA",2);
  await press(page,"i","KeyI",2);
  assert.match(await html(),/<em>/);
  await press(page,"u","KeyU",2);
  assert.match(await html(),/<u>/);
  await press(page,"b","KeyB",2);
  await press(page,"s","KeyS",2);

  await loadNotebook(page,[note("ime","Composition","")]);
  await click(page,"#noteContent");
  await page.call("Input.imeSetComposition",{text:"に",selectionStart:1,selectionEnd:1});
  await page.call("Input.imeSetComposition",{text:"日本",selectionStart:2,selectionEnd:2});
  await page.call("Input.insertText",{text:"日本"});
  assert.match(await html(),/日本/);
  const origin=await evaluate(page,"location.origin");
  await page.call("Browser.grantPermissions",{origin,permissions:["clipboardReadWrite","clipboardSanitizedWrite"]});
  await evaluate(page,`navigator.clipboard.write([new ClipboardItem({"text/html":new Blob(["<p>Clipboard <strong>bold</strong></p>"],{type:"text/html"}),"text/plain":new Blob(["Clipboard bold"],{type:"text/plain"})})])`);
  await press(page,"a","KeyA",2);
  await press(page,"v","KeyV",2);
  await poll(()=>html().then(value=>value.includes("<strong>bold</strong>")),"real clipboard paste");

  await loadNotebook(page,[note("task","Tasks","")]);
  await click(page,"#noteContent");
  await press(page,"c","KeyC",3);
  await typeText(page,"Task text");
  assert.match(await html(),/data-type="taskList"/);
  await click(page,'#noteContent input[type="checkbox"]');
  await press(page,"z","KeyZ",2);
  assert.equal(await evaluate(page,`document.querySelector('#noteContent input[type="checkbox"]').checked`),false);
  await press(page,"y","KeyY",2);
  assert.equal(await evaluate(page,`document.querySelector('#noteContent input[type="checkbox"]').checked`),true);
  await press(page,"s","KeyS",2);
  await poll(()=>evaluate(page,`(async()=>{const n=(await renStorage.getAllNotes())[0];return n.content.includes('checked=""')&&n.content.includes("Task text");})()`),"checked task save");
  await page.call("Page.reload");
  await poll(()=>evaluate(page,`document.querySelector('#noteContent input[type="checkbox"]')?.checked`),"checked task reload");
  assert.deepEqual(await history(),{undo:false,redo:false});

  // Every advertised in-panel application binding gets a real key sequence.
  await press(page,"O","KeyO",10);
  await poll(()=>evaluate(page,`document.getElementById("hamburgerBtn").getAttribute("aria-expanded")==="true"`),"sidebar binding");
  await press(page,"Escape","Escape");
  await press(page,",","Comma",2);
  await poll(()=>evaluate(page,`document.getElementById("settingsModal").matches(":modal")`),"settings binding");
  await press(page,"n","KeyN",3);
  assert.equal(await evaluate(page,`(async()=>(await renStorage.getAllNotes()).length)()`),1);
  await press(page,"Escape","Escape");
  await press(page,"/","Slash",2);
  await poll(()=>evaluate(page,`document.getElementById("shortcutsHelpModal")?.open===true`),"help binding");
  await press(page,"Escape","Escape");
  const downloads=path.join(profile,"downloads");await mkdir(downloads);
  await page.call("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:downloads});
  await press(page,"E","KeyE",10);
  const filename=await poll(async()=> (await readdir(downloads)).find(name=>name.endsWith(".json")),"backup download");
  const backup=JSON.parse(await readFile(path.join(downloads,filename),"utf8"));
  assert.match(backup.notes[0].content,/Task text/);
  assert.equal(backup.notes[0].originalContent,"");
  await press(page,"n","KeyN",3);
  await poll(()=>evaluate(page,`document.getElementById("noteTitle").textContent==="Untitled"`),"new note binding");
  assert.deepEqual(await history(),{undo:false,redo:false});
 } finally {page?.close();if(chrome)await stopChrome(chrome);await rm(profile,{recursive:true,force:true});}
});
