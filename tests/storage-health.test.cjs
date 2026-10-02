const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadStorage({ initial = {}, bytesInUse = 0, failBytes, unlimited = false } = {}) {
  const data = structuredClone(initial);
  const runtime = { lastError: null, getManifest: () => ({ permissions: unlimited ? ["storage", "unlimitedStorage"] : ["storage"] }) };
  let writes = 0;
  const local = {
    QUOTA_BYTES: 10 * 1024 * 1024,
    get(keys, callback) {
      if (keys === null) {
        callback(structuredClone(data));
        return;
      }
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key]);
      }
      callback(result);
    },
    getBytesInUse(_keys, callback) {
      if (failBytes) runtime.lastError = { message: failBytes };
      callback(bytesInUse);
      runtime.lastError = null;
    },
    set(items, callback) {
      writes++;
      Object.assign(data, items);
      callback();
    },
    remove(keys, callback) {
      writes++;
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      callback();
    },
  };
  const context = {
    chrome: { storage: { local, sync: local }, runtime },
    console: { log() {}, error() {} },
    localStorage: { getItem() { return null; } },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "storage.js"), "utf8") +
      "\nthis.RenStorage = RenStorage;",
    context,
  );
  return {
    storage: new context.RenStorage(),
    get writes() { return writes; },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const validNote = {
  id: "a",
  title: "A",
  content: "private note text",
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

test("storage health reports a consistent notebook without writing", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["a"],
      sylva_current_note: "a",
      note_a: validNote,
    },
    bytesInUse: 1024,
  });

  const report = plain(await fixture.storage.getStorageHealth());

  assert.deepEqual(report, {
    version: 1,
    healthy: true,
    issueCount: 0,
    bytesInUse: 1024,
    quotaBytes: 10 * 1024 * 1024,
    indexValid: true,
    indexedNoteCount: 1,
    storedNoteCount: 1,
    invalidIndexEntries: [],
    duplicateNoteIds: [],
    missingNoteIds: [],
    orphanNoteIds: [],
    malformedNotes: [],
    currentNoteId: "a",
    currentNoteValid: true,
  });
  assert.equal(fixture.writes, 0);
  assert.equal(JSON.stringify(report).includes(validNote.content), false);
});

test("storage health inventories inconsistencies without exposing content", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["a", "a", "missing", 42, ""],
      sylva_current_note: "ghost",
      note_a: {
        ...validNote,
        id: "different-id",
        title: 12,
        createdAt: "not-a-date",
      },
      note_orphan: { ...validNote, id: "orphan", content: "do not report me" },
    },
    bytesInUse: 2048,
  });

  const report = plain(await fixture.storage.getStorageHealth());

  assert.equal(report.healthy, false);
  assert.equal(report.issueCount, 7);
  assert.deepEqual(report.invalidIndexEntries, [3, 4]);
  assert.deepEqual(report.duplicateNoteIds, ["a"]);
  assert.deepEqual(report.missingNoteIds, ["missing"]);
  assert.deepEqual(report.orphanNoteIds, ["orphan"]);
  assert.deepEqual(report.malformedNotes, [
    {
      storageKey: "note_a",
      reasons: ["id-key-mismatch", "invalid-title", "invalid-created-at"],
    },
  ]);
  assert.equal(report.currentNoteValid, false);
  assert.equal(fixture.writes, 0);
  assert.equal(JSON.stringify(report).includes("do not report me"), false);
});

test("storage health handles a malformed index and reports byte-read failures", async () => {
  const malformed = loadStorage({
    initial: { sylva_notes_index: "a", note_a: validNote },
  });
  const report = plain(await malformed.storage.getStorageHealth());
  assert.equal(report.indexValid, false);
  assert.deepEqual(report.orphanNoteIds, ["a"]);
  assert.equal(malformed.writes, 0);

  const failed = loadStorage({ failBytes: "byte count failed" });
  await assert.rejects(
    failed.storage.getStorageHealth(),
    /byte count failed/,
  );
  assert.equal(failed.writes, 0);
});

test("unlimited storage reports bytes without a misleading finite quota", async () => {
  const { storage } = loadStorage({ bytesInUse: 15 * 1024 * 1024, unlimited: true });
  const info = plain(await storage.getStorageInfo());
  assert.equal(info.bytesInUse, 15 * 1024 * 1024);
  assert.equal(info.quota, null);
  assert.equal(info.percentUsed, null);
  assert.equal(info.unlimited, true);
  assert.equal((await storage.getStorageHealth()).quotaBytes, null);
});
