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
    await poll(() => evaluate(page, 'document.activeElement?.id === "startWritingBtn"'), "onboarding focus");
    assert.doesNotMatch(await evaluate(page, 'document.getElementById("welcomeModal").textContent'), /unlimited/i);
    for (const modifiers of [0, 8]) {
      await press(page, "Tab", "Tab", modifiers);
      assert.equal(await evaluate(page, 'document.activeElement.id'), "startWritingBtn");
    }
    await click(page, "#startWritingBtn");
    await poll(() => evaluate(page, 'document.getElementById("noteContent").textContent.includes("Notes stay in this browser")'), "welcome note");
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
  } finally {
    page?.close();
    if (chrome) await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
});
