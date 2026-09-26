const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadStorage({ initial = {}, failGet, failRemove } = {}) {
  const data = { ...initial };
  const runtime = { lastError: null };
  let writes = 0;
  const writtenItems = [];
  const local = {
    get(keys, callback) {
      const error = failGet?.(keys);
      if (error) {
        runtime.lastError = { message: error };
        callback({});
        runtime.lastError = null;
        return;
      }
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.hasOwn(data, key)) result[key] = data[key];
      }
      callback(result);
    },
    set(items, callback) {
      writes++;
      writtenItems.push(items);
      Object.assign(data, items);
      callback();
    },
    remove(keys, callback) {
      const error = failRemove?.(keys);
      if (error) {
        runtime.lastError = { message: error };
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
    storage: new context.RenStorage(),
    data,
    writtenItems,
    get writes() { return writes; },
  };
}

test("a failed index read cannot be mistaken for an empty notebook", async () => {
  const fixture = loadStorage({
    initial: { sylva_notes_index: ["a"], note_a: { id: "a" } },
    failGet: (keys) => keys === "sylva_notes_index" && "read failed",
  });

  await assert.rejects(fixture.storage.getAllNotes(), /read failed/);
  assert.equal(fixture.writes, 0);
  assert.deepEqual(Array.from(fixture.data.sylva_notes_index), ["a"]);
});

test("a failed note read rejects instead of returning a partial list", async () => {
  const fixture = loadStorage({
    initial: { sylva_notes_index: ["a"], note_a: { id: "a" } },
    failGet: (keys) => Array.isArray(keys) && "note read failed",
  });

  await assert.rejects(fixture.storage.getAllNotes(), /note read failed/);
});

test("a missing indexed note is reported instead of silently dropped", async () => {
  const fixture = loadStorage({
    initial: { sylva_notes_index: ["a", "b"], note_a: { id: "a" } },
  });

  await assert.rejects(fixture.storage.getAllNotes(), /indexed note is missing/);
  assert.equal(fixture.writes, 0);
});

test("migration read failure aborts initialization before any write", async () => {
  const fixture = loadStorage({
    failGet: (keys) => keys === "sylva_migrated_v4" && "read failed",
  });

  await assert.rejects(fixture.storage.initialize(), /read failed/);
  assert.equal(fixture.writes, 0);
});

test("failed removal is reported to the caller", async () => {
  const fixture = loadStorage({
    initial: { note_a: { id: "a" } },
    failRemove: () => "remove failed",
  });

  await assert.rejects(fixture.storage.removeLocal("note_a"), /remove failed/);
  assert.ok(fixture.data.note_a);
});

test("bulk note data and the current note commit in one storage write", async () => {
  const fixture = loadStorage();

  await fixture.storage.saveAllNotes(
    [{ id: "a", title: "A", content: "saved" }],
    "a",
  );

  assert.equal(fixture.writes, 1);
  assert.deepEqual(Array.from(fixture.data.sylva_notes_index), ["a"]);
  assert.equal(fixture.data.sylva_current_note, "a");
  assert.equal(fixture.data.note_a.content, "saved");
});

test("saving one note does not rewrite unrelated note bodies", async () => {
  const fixture = loadStorage({
    initial: {
      note_a: { id: "a", content: "old" },
      note_b: { id: "b", content: "untouched" },
      sylva_notes_index: ["a", "b"],
    },
  });

  await fixture.storage.saveNote(
    { id: "a", content: "new" },
    ["a", "b"],
    "a",
  );

  assert.equal(fixture.writes, 1);
  assert.deepEqual(
    Object.keys(fixture.writtenItems[0]).sort(),
    ["note_a", "sylva_current_note", "sylva_notes_index"],
  );
  assert.equal(fixture.data.note_a.content, "new");
  assert.equal(fixture.data.note_b.content, "untouched");
});

test("a stale panel cannot overwrite a newer note revision", async () => {
  const fixture = loadStorage({
    initial: {
      note_a: { id: "a", content: "old", updatedAt: "2026-09-26T00:00:00.000Z" },
      sylva_notes_index: ["a"],
    },
  });

  await fixture.storage.saveNote(
    { id: "a", content: "panel A", updatedAt: "2026-09-26T00:00:00.000Z" },
    ["a"],
    "a",
    { instanceId: "panel-a", revision: 1 },
    { id: "a", content: "old", updatedAt: "2026-09-26T00:00:00.000Z" },
  );
  await assert.rejects(
    fixture.storage.saveNote(
      { id: "a", content: "panel B", updatedAt: "2026-09-26T00:00:00.000Z" },
      ["a"],
      "a",
      { instanceId: "panel-b", revision: 1 },
    { id: "a", content: "old", updatedAt: "2026-09-26T00:00:00.000Z" },
    ),
    (error) => error.name === "StorageConflictError",
  );

  assert.equal(fixture.data.note_a.content, "panel A");
  assert.equal(fixture.data.ren_last_write_v1.instanceId, "panel-a");
});

test("a failed notebook load never creates or saves a replacement note", async () => {
  const context = {
    document: { addEventListener() {} },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "sidepanel.js"), "utf8") +
      "\nthis.RenNotePad = RenNotePad;",
    context,
  );

  const app = Object.create(context.RenNotePad.prototype);
  let saves = 0;
  let renders = 0;
  const notices = [];
  app.storage = {
    isOnboardingComplete: async () => true,
    getAllNotes: async () => { throw new Error("read failed"); },
    saveAllNotes: async () => { saves++; },
  };
  app.autoSaveStatus = { textContent: "Ready" };
  app.noteContent = { setAttribute(name, value) { this[name] = value; } };
  app.newNoteBtn = { disabled: false };
  app.importFileInput = { value: "stale-selection" };
  app.notes = [];
  app.currentNoteId = null;
  app.renderNotesList = () => { renders++; };
  app.showNotification = (...args) => notices.push(args);

  await app.loadData();

  assert.equal(saves, 0);
  assert.equal(renders, 0);
  assert.equal(app.autoSaveStatus.textContent, "Could not load notes");
  assert.equal(app.dataLoadFailed, true);
  assert.equal(app.noteContent.contenteditable, "false");
  assert.equal(app.newNoteBtn.disabled, true);
  await app.createNewNote();
  await assert.rejects(app.saveData(), /notes have not loaded/);
  app.executeShortcutAction("forceSave");
  app.exportNotes();
  await app.importNotes({ target: { files: [{ text: async () => "{}" }] } });
  assert.equal(app.notes.length, 0);
  assert.equal(saves, 0);
  assert.equal(app.autoSaveStatus.textContent, "Could not load notes");
  assert.equal(app.importFileInput.value, "");
  assert.equal(notices.length, 1);
});
