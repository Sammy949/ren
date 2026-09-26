const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadStorage({ initial = {}, failSetCall, failRemove } = {}) {
  const data = structuredClone(initial);
  const runtime = { lastError: null };
  let setCalls = 0;
  let removeCalls = 0;
  const local = {
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
    set(items, callback) {
      setCalls++;
      if (setCalls === failSetCall) {
        runtime.lastError = { message: "write failed" };
        callback();
        runtime.lastError = null;
        return;
      }
      Object.assign(data, structuredClone(items));
      callback();
    },
    remove(keys, callback) {
      removeCalls++;
      if (failRemove) {
        runtime.lastError = { message: "cleanup failed" };
        callback();
        runtime.lastError = null;
        return;
      }
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
    data,
    storage: new context.RenStorage(),
    get setCalls() { return setCalls; },
    get removeCalls() { return removeCalls; },
  };
}

function note(id, content = id) {
  return {
    id,
    title: id.toUpperCase(),
    content,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

test("replacement preserves, verifies, and can restore the previous notebook", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["old"],
      sylva_current_note: "old",
      note_old: note("old", "original"),
      note_orphan: note("orphan", "recoverable orphan"),
      sylva_settings: { theme: "dark" },
    },
  });

  const result = await fixture.storage.replaceAllNotesWithBackup(
    [note("new", "replacement")],
    "new",
  );

  assert.equal(result.cleanupPending, false);
  assert.equal(result.obsoleteNoteCount, 2);
  assert.deepEqual(fixture.data.sylva_notes_index, ["new"]);
  assert.equal(fixture.data.sylva_current_note, "new");
  assert.equal(fixture.data.note_new.content, "replacement");
  assert.equal(Object.hasOwn(fixture.data, "note_old"), false);
  assert.equal(Object.hasOwn(fixture.data, "note_orphan"), false);
  assert.equal(fixture.data.sylva_settings.theme, "dark");
  assert.equal(
    fixture.data.ren_pre_import_backup_v1.entries.note_old.content,
    "original",
  );
  assert.equal(
    fixture.data.ren_pre_import_backup_v1.entries.note_orphan.content,
    "recoverable orphan",
  );

  await fixture.storage.restorePreImportBackup();

  assert.deepEqual(fixture.data.sylva_notes_index, ["old"]);
  assert.equal(fixture.data.sylva_current_note, "old");
  assert.equal(fixture.data.note_old.content, "original");
  assert.equal(fixture.data.note_orphan.content, "recoverable orphan");
  assert.equal(Object.hasOwn(fixture.data, "note_new"), false);
  assert.equal(Object.hasOwn(fixture.data, "ren_import_commit_v1"), false);
});

test("a replacement write failure leaves the previous notebook and backup intact", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["old"],
      sylva_current_note: "old",
      note_old: note("old", "original"),
    },
    failSetCall: 2,
  });

  await assert.rejects(
    fixture.storage.replaceAllNotesWithBackup([note("new")], "new"),
    /write failed/,
  );

  assert.deepEqual(fixture.data.sylva_notes_index, ["old"]);
  assert.equal(fixture.data.note_old.content, "original");
  assert.equal(Object.hasOwn(fixture.data, "note_new"), false);
  assert.equal(
    fixture.data.ren_pre_import_backup_v1.entries.note_old.content,
    "original",
  );
  assert.equal(fixture.removeCalls, 0);
});

test("failed orphan cleanup is reported after a verified replacement", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["old"],
      sylva_current_note: "old",
      note_old: note("old"),
    },
    failRemove: true,
  });

  const result = await fixture.storage.replaceAllNotesWithBackup(
    [note("new")],
    "new",
  );

  assert.equal(result.cleanupPending, true);
  assert.deepEqual(fixture.data.sylva_notes_index, ["new"]);
  assert.equal(fixture.data.note_new.id, "new");
  assert.equal(fixture.data.note_old.id, "old");
});

test("replacement rejects duplicate IDs before writing a backup", async () => {
  const fixture = loadStorage();

  await assert.rejects(
    fixture.storage.replaceAllNotesWithBackup([note("same"), note("same")], "same"),
    /duplicate note IDs/,
  );
  assert.equal(fixture.setCalls, 0);
});
