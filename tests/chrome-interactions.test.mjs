import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll } from "./helpers/chrome.mjs";

async function press(page, key, code, modifiers = 0) {
  await page.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}
async function click(page, selector) {
  const point = await evaluate(page, `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await page.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

test("Ren workspace alignment, sidebar resizing, and theme selection", { timeout: 45000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-interactions-"));
  let chrome, page;
  try {
    chrome = await startChrome(profile);
    page = await openExtensionPage(chrome);
    assert.equal(await evaluate(page, `(async () => {
      const logo = new Image(); logo.src = chrome.runtime.getURL("icons/ren.svg");
      await logo.decode(); return logo.naturalWidth > 0;
    })()`),true);
    const screenshot = async (name) => {
      if (!process.env.REN_UI_ARTIFACT_DIR) return;
      await mkdir(process.env.REN_UI_ARTIFACT_DIR,{recursive:true});
      await new Promise(resolve => setTimeout(resolve,350));
      const {data}=await page.call("Page.captureScreenshot",{format:"png"});
      await writeFile(path.join(process.env.REN_UI_ARTIFACT_DIR,`${name}.png`),Buffer.from(data,"base64"));
    };
    await evaluate(page, `(async () => {
      await renStorage.completeOnboarding();
      await renStorage.saveAllNotes([{id:"layout",title:"Layout fixture",content:"Direct text<p>Paragraph text</p>",createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"}], "layout");
    })()`);
    await page.call("Page.reload");
    await poll(() => evaluate(page, `document.getElementById("noteTitle")?.textContent === "Layout fixture"`), "fixture load");
    for (const width of [320,400,600,900]) {
      await page.call("Emulation.setDeviceMetricsOverride", { width, height:700, deviceScaleFactor:1, mobile:false });
      const layout = await evaluate(page, `(() => {
        const h=document.querySelector("header").getBoundingClientRect();
        const t=document.getElementById("noteTitle").getBoundingClientRect();
        const l=document.querySelector(".header-logo").getBoundingClientRect();
        return {height:h.height,centers:[t.y+t.height/2,l.y+l.height/2],right:t.right,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.equal(layout.height,48);
      assert.ok(Math.abs(layout.centers[0]-layout.centers[1])<1);
      assert.ok(layout.right<=width);
      assert.equal(layout.overflow,false);
      await click(page,"#noteTitle");
      assert.equal(await evaluate(page, `document.querySelector("header").getBoundingClientRect().height`),48);
      await press(page,"Escape","Escape");
      assert.equal(await evaluate(page, `document.activeElement.id`),"noteTitle");
    }
    await page.call("Emulation.setDeviceMetricsOverride", { width:400, height:700, deviceScaleFactor:1, mobile:false });
    await click(page,"#hamburgerBtn");
    await poll(() => evaluate(page, `Math.abs(document.getElementById("sidebar").getBoundingClientRect().x)<0.1`), "sidebar open");
    assert.equal(await evaluate(page, `document.getElementById("sidebar").getBoundingClientRect().top`),48);
    await screenshot("sidebar-narrow");
    const handle = await evaluate(page, `(() => { const r=document.getElementById("sidebarResizeHandle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+100}; })()`);
    await page.call("Input.dispatchMouseEvent", {type:"mousePressed",...handle,button:"left",clickCount:1});
    await page.call("Input.dispatchMouseEvent", {type:"mouseMoved",x:handle.x+32,y:handle.y,button:"left",buttons:1});
    await page.call("Input.dispatchMouseEvent", {type:"mouseReleased",x:handle.x+32,y:handle.y,button:"left",clickCount:1});
    assert.equal(await evaluate(page, `document.getElementById("sidebar").getBoundingClientRect().width`),320);
    await press(page,"ArrowRight","ArrowRight");
    assert.equal(await evaluate(page, `document.getElementById("sidebarResizeHandle").getAttribute("aria-valuenow")`),"336");
    await press(page,"End","End");
    assert.equal(await evaluate(page, `document.getElementById("sidebar").getBoundingClientRect().width`),368);
    await press(page,"Home","Home");
    assert.equal(await evaluate(page, `document.getElementById("sidebar").getBoundingClientRect().width`),220);
    await press(page,"ArrowRight","ArrowRight");
    await page.call("Page.reload");
    await poll(() => evaluate(page, `document.getElementById("sidebarResizeHandle")?.getAttribute("aria-valuenow")==="236"`), "remembered sidebar width");
    assert.equal(await evaluate(page, `document.getElementById("sidebar").inert`),true);
    await page.call("Emulation.setDeviceMetricsOverride", {width:900,height:700,deviceScaleFactor:1,mobile:false});
    await click(page,"#hamburgerBtn");
    await poll(() => evaluate(page, `Math.abs(document.getElementById("sidebar").getBoundingClientRect().x)<0.1`),"docked sidebar");
    assert.equal(await evaluate(page, `document.querySelector(".writing-canvas").getBoundingClientRect().left`),236);
    await screenshot("sidebar-docked");
    await evaluate(page, `document.getElementById("sidebarResizeHandle").focus()`);
    await press(page,"End","End");
    assert.equal(await evaluate(page, `document.querySelector(".writing-canvas").getBoundingClientRect().width`),420);
    assert.equal(await evaluate(page, `getComputedStyle(document.querySelector(".toolbar-headings-expanded")).display`),"none");
    assert.equal(await evaluate(page, `(() => {const bar=document.querySelector(".editor-toolbar");return bar.scrollWidth<=bar.clientWidth;})()`),true);
    await click(page,"#hamburgerBtn");
    await poll(() => evaluate(page, `document.getElementById("sidebar").getBoundingClientRect().right<=0.1`),"sidebar closed");
    const colors=[];
    for (const theme of ["light","dark"]) {
      const styles=await evaluate(page, `(() => {
        document.documentElement.setAttribute("data-theme",${JSON.stringify(theme)});
        const editor=document.getElementById("noteContent");editor.focus();const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);
        return [editor,editor.querySelector("p"),document.getElementById("noteTitleInput"),document.getElementById("searchInput")].map(e=>getComputedStyle(e,"::selection").backgroundColor);
      })()`);
      assert.equal(new Set(styles).size,1);
      assert.notEqual(styles[0],"rgba(0, 0, 0, 0)");
      colors.push(styles[0]);
      await screenshot(`selection-${theme}`);
    }
    assert.notEqual(colors[0],colors[1]);
  } finally {
    page?.close(); if(chrome) await stopChrome(chrome);
    await rm(profile,{recursive:true,force:true});
  }
});
