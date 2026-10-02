import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click, loadNotebook } from "./helpers/chrome.mjs";

test("context menu retains selection, executes transactions, and supports keyboard and native fallback", {timeout:45000}, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-context-"));
  let chrome, page;
  try {
    chrome = await startChrome(profile); page = await openExtensionPage(chrome);
    await page.call("Emulation.setDeviceMetricsOverride", {width:400,height:700,deviceScaleFactor:1,mobile:false});
    await loadNotebook(page, [{id:"menu",title:"Context menu",content:"<p>Menu text</p>",createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-01T00:00:00Z"}]);
    const menuOpen = () => evaluate(page, '!document.getElementById("editorContextMenu").hidden');
    const html = () => evaluate(page, 'document.getElementById("noteContent").innerHTML');
    const rightClick = async (modifiers=0) => {
      const point = await evaluate(page, `(() => {const r=document.createRange();r.selectNodeContents(document.querySelector('#noteContent p, #noteContent h2'));const b=r.getBoundingClientRect();return {x:b.left+5,y:b.top+5};})()`);
      await page.call("Input.dispatchMouseEvent", {type:"mousePressed",button:"right",clickCount:1,...point,modifiers});
      await page.call("Input.dispatchMouseEvent", {type:"mouseReleased",button:"right",clickCount:1,...point,modifiers});
    };
    await click(page,"#noteContent"); await press(page,"a","KeyA",2);
    await rightClick(); assert.equal(await menuOpen(),true);
    assert.equal(await evaluate(page, 'document.querySelector("#editorContextMenu [data-command=undo]").disabled'), true);
    await click(page,'#editorContextMenu [data-command="toggleBold"]');
    assert.equal(await html(),"<p><strong>Menu text</strong></p>");
    assert.equal(await evaluate(page, "document.activeElement.id"), "noteContent", "command restores focus before the next shortcut");
    await press(page,"z","KeyZ",2); assert.equal(await html(),"<p>Menu text</p>");
    await press(page,"y","KeyY",2); assert.match(await html(),/<strong>/);
    await rightClick();
    assert.equal(await evaluate(page, 'document.querySelector("#editorContextMenu [data-command=toggleBold]").getAttribute("aria-checked")'), "true");
    await click(page,'#editorContextMenu [data-command="submenu"]');
    await click(page,'#editorContextMenu button:nth-of-type(4)');
    assert.match(await html(),/<h2>/);
    await press(page,"s","KeyS",2);
    await poll(()=>evaluate(page, '(async()=>(await renStorage.getAllNotes())[0].content.includes("<h2>"))()'), "menu command save");
    await page.call("Page.reload");
    await poll(()=>html().then(value=>value.includes("<h2>")),"menu command reload");
    await click(page,"#noteContent"); await press(page,"a","KeyA",2);
    await press(page,"F10","F10",8);
    assert.equal(await menuOpen(),true);
    await press(page,"End","End");
    assert.equal(await evaluate(page,'document.activeElement.dataset.command'),"unsetAllMarks");
    await press(page,"Enter","Enter");
    assert.equal(await html(),"<h2>Menu text</h2><p><br class=\"ProseMirror-trailingBreak\"></p>");
    await rightClick(8); assert.equal(await menuOpen(),false,"Shift keeps browser menu");
    await press(page,"Escape","Escape");
    await click(page,"#noteContent");
    await page.call("Emulation.setDeviceMetricsOverride", {width:320,height:300,deviceScaleFactor:1,mobile:false});
    // CDP acknowledges metrics before the resize event/frame can finish. The
    // menu intentionally closes on resize, so open only after layout settles.
    await evaluate(page, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await press(page,"F10","F10",8); assert.equal(await menuOpen(),true);
    assert.equal(await evaluate(page, `(() => {const r=document.getElementById('editorContextMenu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`),true);
    if(process.env.REN_UI_ARTIFACT_DIR) {
      await mkdir(process.env.REN_UI_ARTIFACT_DIR,{recursive:true});
      const {data}=await page.call("Page.captureScreenshot",{format:"png"});
      await writeFile(path.join(process.env.REN_UI_ARTIFACT_DIR,"context-menu.png"),Buffer.from(data,"base64"));
    }
    await press(page,"Escape","Escape"); assert.equal(await menuOpen(),false);
    assert.equal(await evaluate(page,"document.activeElement.id"),"noteContent");
  } finally { page?.close(); if(chrome) await stopChrome(chrome); await rm(profile,{recursive:true,force:true}); }
});
