import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startChrome, openExtensionPage, evaluate, stopChrome, poll, press, click } from "./helpers/chrome.mjs";

test("onboarding and dialogs retain native keyboard focus", { timeout: 45000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "ren-dialogs-"));
  let chrome, page;
  try {
    chrome = await startChrome(profile);
    page = await openExtensionPage(chrome);
    await page.call("Log.enable");
    await page.call("Accessibility.enable");
    const accessibilityWarnings = [];
    page.socket.addEventListener("message", ({data}) => {
      const event = JSON.parse(data);
      if (event.method === "Log.entryAdded" && /Blocked aria-hidden/.test(event.params.entry.text)) accessibilityWarnings.push(event.params.entry.text);
    });
    await evaluate(page, `(() => {
      window.hiddenFocusedElements = [];
      const setAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (name === 'aria-hidden' && String(value) === 'true' && this.contains(document.activeElement)) {
          hiddenFocusedElements.push(this.id);
        }
        return setAttribute.call(this, name, value);
      };
    })()`);
    await poll(() => evaluate(page, 'document.activeElement?.id === "startWritingBtn"'), "onboarding focus");
    await page.call("Accessibility.getFullAXTree");
    assert.doesNotMatch(await evaluate(page, 'document.getElementById("welcomeModal").textContent'), /unlimited/i);
    for (const modifiers of [0, 8]) {
      await press(page, "Tab", "Tab", modifiers);
      assert.equal(await evaluate(page, 'document.activeElement.id'), "startWritingBtn");
    }
    await click(page, "#startWritingBtn");
    await poll(() => evaluate(page, 'document.getElementById("noteContent").textContent.includes("Notes stay in this browser")'), "welcome note");
    assert.deepEqual(await evaluate(page, 'hiddenFocusedElements'), [], "closing welcome must not aria-hide its focused button");
    for (const width of [400, 900]) {
      await page.call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
      await click(page, "#hamburgerBtn");
      await poll(() => evaluate(page, 'Math.abs(document.getElementById("sidebar").getBoundingClientRect().x) < 0.1'), "sidebar open");
      await click(page, "#settingsBtn");
      assert.equal(await evaluate(page, 'document.getElementById("settingsModal")?.open'), true, "Settings click opens dialog");
      assert.equal(await evaluate(page, 'document.activeElement.id'), "closeSettings", "Settings click puts focus in dialog");
      await click(page, "#themeDark");
      await poll(() => evaluate(page, 'document.documentElement.getAttribute("data-theme") === "dark"'), "clicked theme");
      await click(page, "#closeSettings");
      assert.equal(await evaluate(page, 'document.activeElement.id'), "hamburgerBtn", "closing Settings restores a visible control");
    }
    for (const [key, code, modal] of [[",", "Comma", "settingsModal"], ["/", "Slash", "shortcutsHelpModal"]]) {
      await click(page, "#noteContent");
      await press(page, key, code, 2);
      await poll(() => evaluate(page, `document.getElementById('${modal}')?.contains(document.activeElement)`), "dialog focus");
      for (const modifiers of [0, 8]) {
        for (let index = 0; index < 16; index++) {
          await press(page, "Tab", "Tab", modifiers);
          assert.equal(await evaluate(page, `document.getElementById('${modal}').contains(document.activeElement)`), true, `${modal} Tab modifiers=${modifiers}`);
        }
      }
      await press(page, "Escape", "Escape");
      assert.equal(await evaluate(page, 'document.activeElement.id'), "noteContent");
    }
    await page.call("Accessibility.getFullAXTree");
    assert.deepEqual(await evaluate(page, 'hiddenFocusedElements'), [], "no focused subtree is aria-hidden");
    assert.deepEqual(accessibilityWarnings, [], "Chrome reports no blocked aria-hidden");
  } finally {
    page?.close();
    if (chrome) await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
});
