import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = process.env.REN_EXTENSION_ROOT ? path.resolve(process.env.REN_EXTENSION_ROOT) : repoRoot;
const chromeCandidates = [process.env.REN_CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);

function findChrome() {
  const chrome = chromeCandidates.find(existsSync);
  if (!chrome) {
    throw new Error("Chrome not found. Set REN_CHROME_BIN to a Chrome executable.");
  }
  return chrome;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function poll(action, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

export async function startChrome(profileDirectory, loadedExtensionRoot = extensionRoot) {
  const port = await reservePort();
  const stderr = [];
  const processHandle = spawn(findChrome(), [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${loadedExtensionRoot}`,
    `--load-extension=${loadedExtensionRoot}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  processHandle.stderr.setEncoding("utf8");
  processHandle.stderr.on("data", (chunk) => {
    stderr.push(chunk);
    if (stderr.length > 20) stderr.shift();
  });

  const worker = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const list = await response.json();
    const candidates = list.filter(
      ({ type, url, webSocketDebuggerUrl }) =>
        type === "service_worker" &&
        url.endsWith("/background.js") &&
        webSocketDebuggerUrl,
    );
    for (const candidate of candidates) {
      const client = await CdpClient.connect(candidate.webSocketDebuggerUrl);
      try {
        await client.call("Runtime.enable");
        const manifest = await evaluate(
          client,
          "chrome.runtime.getManifest().name",
        );
        if (manifest === "Ren - Minimalist Notepad") return candidate;
      } finally {
        client.close();
      }
    }
    return null;
  }, "Ren extension service worker").catch((error) => {
    processHandle.kill("SIGKILL");
    throw new Error(`${error.message}\n${stderr.join("").trim()}`, {
      cause: error,
    });
  });

  const extensionId = new URL(worker.url).host;
  return { processHandle, port, extensionId, stderr, worker };
}

export async function openExtensionPage(chrome) {
  const worker = await CdpClient.connect(chrome.worker.webSocketDebuggerUrl);
  await worker.call("Runtime.enable");
  const extension = await evaluate(worker, `({
    id: chrome.runtime.id,
    pageUrl: chrome.runtime.getURL("sidepanel.html"),
    manifestName: chrome.runtime.getManifest().name
  })`);
  worker.close();
  assert.equal(extension.id, chrome.extensionId);
  assert.equal(extension.manifestName, "Ren - Minimalist Notepad");

  const url = extension.pageUrl;
  const version = await fetch(
    `http://127.0.0.1:${chrome.port}/json/version`,
  ).then((response) => response.json());
  const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.call("Target.createTarget", { url });
  browser.close();

  const target = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${chrome.port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find(({ id }) => id === targetId);
  }, "Ren side panel target");
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.call("Runtime.enable");

  await poll(async () => {
    const result = await client.call("Runtime.evaluate", {
      expression: "location.protocol === 'chrome-extension:' && document.readyState === 'complete' && typeof renStorage !== 'undefined'",
      returnByValue: true,
    });
    return result.result.value === true;
  }, "Ren side panel document");

  const state = await client.call("Runtime.evaluate", {
    expression: `({
      url: location.href,
      storageType: typeof renStorage,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 120)
    })`,
    returnByValue: true,
  });
  if (state.exceptionDetails || state.result.value.storageType === "undefined") {
    throw new Error(
      `Ren side panel scripts did not initialize: ${JSON.stringify(
        state.result.value || state.exceptionDetails,
      )}`,
    );
  }

  return client;
}

export async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
  }
  return result.result.value;
}

export async function stopChrome(chrome) {
  if (chrome.processHandle.exitCode !== null) return;
  const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`)
    .then((response) => response.json())
    .catch(() => null);
  if (version?.webSocketDebuggerUrl) {
    const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
    await browser.call("Browser.close").catch(() => {});
    browser.close();
  }
  await Promise.race([
    new Promise((resolve) => chrome.processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (chrome.processHandle.exitCode === null) chrome.processHandle.kill("SIGKILL");
}
