import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = import.meta.dirname;
const chromeBinary = process.env.REN_CHROME_BIN || "/usr/bin/google-chrome";
if (!existsSync(chromeBinary)) throw new Error("Set REN_CHROME_BIN to Chrome");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function poll(read, label) {
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    try {
      const result = await read();
      if (result) return result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
  }
  return result.result.value;
}

const profile = await mkdtemp(path.join(os.tmpdir(), "ren-editor-proof-"));
const port = await reservePort();
const extension = path.join(root, "dist");
const chrome = spawn(chromeBinary, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  `--disable-extensions-except=${extension}`,
  `--load-extension=${extension}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = "";
chrome.stderr.on("data", (chunk) => {
  chromeErrors = `${chromeErrors}${chunk}`.slice(-4_000);
});
let worker;
let browser;
let page;

try {
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`)
    .then((response) => response.json());
  const workerTarget = await poll(async () => {
    const candidates = (await targets()).filter((target) =>
      target.type === "service_worker" &&
      target.url.endsWith("/background.js") &&
      target.webSocketDebuggerUrl
    );
    for (const candidate of candidates) {
      const client = new Cdp(candidate.webSocketDebuggerUrl);
      try {
        await client.call("Runtime.enable");
        const description = await evaluate(client,
          "chrome.runtime.getManifest().description");
        if (description === "Isolated editor behavior proof with synthetic content") {
          return candidate;
        }
      } finally {
        client.close();
      }
    }
    return null;
  }, "editor extension worker").catch((error) => {
    throw new Error(`${error.message}: ${chromeErrors}`, { cause: error });
  });
  worker = new Cdp(workerTarget.webSocketDebuggerUrl);
  await worker.call("Runtime.enable");
  const pageUrl = await evaluate(worker, "chrome.runtime.getURL('sidepanel.html')");
  assert.match(pageUrl, /^chrome-extension:\/\//);

  const version = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then((response) => response.json());
  browser = new Cdp(version.webSocketDebuggerUrl);
  const { targetId } = await browser.call("Target.createTarget", { url: pageUrl });
  const pageTarget = await poll(async () =>
    (await targets()).find((target) => target.id === targetId),
  "editor proof page");
  page = new Cdp(pageTarget.webSocketDebuggerUrl);
  await page.call("Runtime.enable");
  await page.call("Emulation.setDeviceMetricsOverride", {
    width: 320, height: 700, deviceScaleFactor: 1, mobile: false,
  });
  try {
    await poll(() => evaluate(page, "Boolean(globalThis.renEditorProof)"),
      "Tiptap initialization");
  } catch (error) {
    const diagnostics = await evaluate(page, `({
      readyState: document.readyState,
      title: document.title,
      text: document.body?.innerText?.slice(0, 200),
      scripts: [...document.scripts].map((script) => script.src),
      proof: typeof globalThis.renEditorProof,
    })`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`, { cause: error });
  }

  const focusEditor = async () => {
    await evaluate(page, `(() => {
      renEditorProof.commands.setContent("<p></p>");
      renEditorProof.commands.focus("end");
    })()`);
    await poll(() => evaluate(page,
      "document.activeElement?.classList.contains('tiptap')"),
    "editor focus");
  };
  const type = async (value) => {
    for (const character of value) {
      await page.call("Input.insertText", { text: character });
    }
  };

  await focusEditor();
  await type("**bold** next");
  const inlineHTML = await evaluate(page, "renEditorProof.getHTML()");
  const inlineJSON = await evaluate(page, "renEditorProof.getJSON()");
  await evaluate(page, "renEditorProof.commands.undo()");
  const undoHTML = await evaluate(page, "renEditorProof.getHTML()");
  await evaluate(page, "renEditorProof.commands.redo()");
  const redoHTML = await evaluate(page, "renEditorProof.getHTML()");

  await focusEditor();
  await type("[ ] task");
  const taskHTML = await evaluate(page, "renEditorProof.getHTML()");

  await evaluate(page, `(() => {
    renEditorProof.commands.setContent("<p>selected</p>");
    renEditorProof.commands.setTextSelection({ from: 1, to: 9 });
    renEditorProof.chain().focus().toggleCode().run();
  })()`);
  await page.call("Input.dispatchKeyEvent", {
    type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39,
  });
  await page.call("Input.dispatchKeyEvent", {
    type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39,
  });
  await type(" after");
  const selectedCodeHTML = await evaluate(page, "renEditorProof.getHTML()");

  await focusEditor();
  await page.call("Input.imeSetComposition", {
    text: "に", selectionStart: 1, selectionEnd: 1,
  });
  await page.call("Input.imeSetComposition", {
    text: "日本", selectionStart: 2, selectionEnd: 2,
  });
  await page.call("Input.insertText", { text: "日本" });
  const imeHTML = await evaluate(page, "renEditorProof.getHTML()");

  await focusEditor();
  const pasteHTML = await evaluate(page, `(() => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", "<p>safe <strong>bold</strong><script>unsafe()</script></p>");
    clipboard.setData("text/plain", "safe bold");
    renEditorProof.view.dom.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: clipboard,
    }));
    return renEditorProof.getHTML();
  })()`);

  const layout = await evaluate(page, `(() => {
    const bounds = document.querySelector(".tiptap").getBoundingClientRect();
    return {
      editorFits: bounds.left >= 0 && bounds.right <= window.innerWidth,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      extensionProtocol: location.protocol,
    };
  })()`);
  const result = {
    inlineHTML, inlineJSON, undoHTML, redoHTML, taskHTML, selectedCodeHTML,
    imeHTML, pasteHTML,
    ...layout,
  };
  assert.equal(result.extensionProtocol, "chrome-extension:");
  assert.equal(result.editorFits, true);
  assert.equal(result.pageFits, true);
  assert.match(result.inlineHTML, /<strong>bold<\/strong> next/);
  assert.match(result.redoHTML, /<strong>bold<\/strong> next/);
  assert.match(result.taskHTML, /data-type="taskList"/);
  assert.equal(result.selectedCodeHTML, "<p><code>selected</code> after</p>");
  assert.match(result.imeHTML, /日本/);
  assert.match(result.pasteHTML, /<strong>bold<\/strong>/);
  assert.doesNotMatch(result.pasteHTML, /<script/);
  console.log(JSON.stringify(result, null, 2));
} finally {
  page?.close();
  worker?.close();
  if (browser) {
    await browser.call("Browser.close").catch(() => {});
    browser.close();
  }
  if (chrome.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (chrome.exitCode === null) {
    chrome.kill("SIGKILL");
    await new Promise((resolve) => chrome.once("exit", resolve));
  }
  await rm(profile, { recursive: true, force: true });
}
