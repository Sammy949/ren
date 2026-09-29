const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadStorage({
  initial = {},
  failSetCall,
  failRemove,
  corruptVerification = false,
} = {}) {
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
      if (
        corruptVerification &&
        Array.isArray(keys) &&
        keys.includes("ren_import_commit_v1")
      ) {
        const noteKey = keys.find((key) => key.startsWith("note_"));
        result[noteKey] = { ...result[noteKey], content: "damaged" };
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

function loadNotePad({ confirmResult = true } = {}) {
  const context = {
    clearTimeout,
    confirm: () => confirmResult,
    console: { error() {} },
    document: { addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "sidepanel.js"), "utf8") +
      "\nthis.RenNotePad = RenNotePad;",
    context,
  );
  return context.RenNotePad;
}

function createImportApp() {
  const RenNotePad = loadNotePad();
  const app = Object.create(RenNotePad.prototype);
  const attributes = new Map([["contenteditable", "true"]]);
  app.dataLoadFailed = false;
  app.importInProgress = false;
  app.importFileInput = { value: "selected" };
  app.noteContent = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
  };
  app.notes = [note("old", "open")];
  app.currentNoteId = "old";
  app.notesCache = new Map([["old", app.notes[0]]]);
  app.editRevision = 0;
  app.autoSaveTimeout = null;
  app.saveCurrentNote = async () => {};
  app.queueStorageSave = (operation) => operation();
  app.loadCurrentNote = () => {};
  app.renderNotesList = () => {};
  app.notifications = [];
  app.showNotification = (...args) => app.notifications.push(args);
  app.getEditable = () => attributes.get("contenteditable");
  return app;
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
  assert.deepEqual(
    JSON.parse(JSON.stringify(await fixture.storage.getPreImportBackupInfo())),
    {
      createdAt: result.backupCreatedAt,
      storedNoteCount: 2,
    },
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

test("a replacement that cannot be verified restores the previous notebook", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["old"],
      sylva_current_note: "old",
      note_old: note("old", "original"),
    },
    corruptVerification: true,
  });

  await assert.rejects(
    fixture.storage.replaceAllNotesWithBackup([note("new")], "new"),
    /could not be verified/,
  );

  assert.deepEqual(fixture.data.sylva_notes_index, ["old"]);
  assert.equal(fixture.data.sylva_current_note, "old");
  assert.equal(fixture.data.note_old.content, "original");
  assert.equal(Object.hasOwn(fixture.data, "note_new"), false);
  assert.equal(Object.hasOwn(fixture.data, "ren_import_commit_v1"), false);
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

test("a stale import does not overwrite newer notes or the recovery backup", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["old"],
      note_old: note("old", "newer"),
      ren_pre_import_backup_v1: { version: 1, createdAt: "earlier", entries: {} },
    },
  });
  await assert.rejects(
    fixture.storage.replaceAllNotesWithBackup(
      [note("incoming")], "incoming",
      { index: ["old"], notes: [note("old", "stale")] },
    ),
    (error) => error.name === "StorageConflictError",
  );
  assert.equal(fixture.setCalls, 0);
  assert.equal(fixture.data.note_old.content, "newer");
  assert.equal(fixture.data.ren_pre_import_backup_v1.createdAt, "earlier");
});

test("a stale restore cannot replace changes made after import", async () => {
  const fixture = loadStorage({
    initial: {
      sylva_notes_index: ["new"],
      note_new: note("new", "edited after import"),
      ren_pre_import_backup_v1: {
        version: 1, createdAt: "earlier", hadNotesIndex: true,
        hadCurrentNote: true,
        entries: {
          sylva_notes_index: ["old"], sylva_current_note: "old",
          note_old: note("old"),
        },
      },
    },
  });
  await assert.rejects(
    fixture.storage.restorePreImportBackup({
      index: ["new"], notes: [note("new", "stale")],
    }),
    (error) => error.name === "StorageConflictError",
  );
  assert.equal(fixture.setCalls, 0);
  assert.equal(fixture.data.note_new.content, "edited after import");
});

test("import validates the whole backup before replacing live state", async () => {
  const app = createImportApp();
  const replacement = [note("new", "replacement")];
  let flushed = false;
  app.saveCurrentNote = async () => { flushed = true; };
  app.storage = {
    async replaceAllNotesWithBackup(notes, currentNoteId) {
      assert.equal(flushed, true);
      assert.equal(app.notes[0].id, "old");
      assert.deepEqual(Array.from(notes, ({ id }) => id), ["new"]);
      assert.equal(currentNoteId, "new");
      return { cleanupPending: false };
    },
  };

  await app.importNotes({
    target: {
      files: [{
        size: 100,
        text: async () => JSON.stringify({
          version: "1.0",
          notes: replacement,
          currentNoteId: "new",
        }),
      }],
    },
  });

  assert.equal(app.notes[0].id, "new");
  assert.equal(app.currentNoteId, "new");
  assert.equal(app.importFileInput.value, "");
  assert.equal(app.importInProgress, false);
  assert.equal(app.getEditable(), "true");
  assert.deepEqual(app.notifications, [
    ["Imported 1 notes. A pre-import backup is available.", "success"],
  ]);
});

test("a failed replacement keeps the current in-memory notebook", async () => {
  const app = createImportApp();
  app.storage = {
    replaceAllNotesWithBackup: async () => { throw new Error("quota exceeded"); },
  };

  await app.importNotes({
    target: {
      files: [{
        text: async () => JSON.stringify({ notes: [note("new")] }),
      }],
    },
  });

  assert.equal(app.notes[0].id, "old");
  assert.equal(app.currentNoteId, "old");
  assert.equal(app.getEditable(), "true");
  assert.deepEqual(app.notifications, [
    ["Import failed. Your current notes remain open.", "error"],
  ]);
});

test("invalid or duplicate imported notes are rejected without partial import", () => {
  const app = createImportApp();
  const duplicate = { notes: [note("same"), note("same")] };
  assert.throws(
    () => app.prepareImportedNotebook(duplicate),
    /duplicate note IDs/,
  );
  assert.throws(
    () => app.prepareImportedNotebook({ notes: [note("unsafe id")] }),
    /invalid ID/,
  );
  assert.equal(app.notes[0].id, "old");
});

test("backup import preserves valid title ownership metadata", () => {
  const app = createImportApp();
  const suggested = { ...note("suggested"), titleSource: "suggested" };
  const legacy = note("legacy");
  const prepared = app.prepareImportedNotebook({ notes: [suggested, legacy] });
  assert.equal(prepared.notes[0].titleSource, "suggested");
  assert.equal(Object.hasOwn(prepared.notes[1], "titleSource"), false);
});

test("the restore action reloads live state from the pre-import backup", async () => {
  const app = createImportApp();
  let restored = false;
  let loaded = 0;
  let rendered = 0;
  app.storage = {
    restorePreImportBackup: async () => { restored = true; },
    getAllNotes: async () => [note("before", "restored")],
    getCurrentNoteId: async () => "before",
  };
  app.loadCurrentNote = () => { loaded++; };
  app.renderNotesList = () => { rendered++; };

  await app.restoreImportBackup();

  assert.equal(restored, true);
  assert.equal(app.notes[0].id, "before");
  assert.equal(app.currentNoteId, "before");
  assert.equal(app.notesCache.get("before").content, "restored");
  assert.equal(loaded, 1);
  assert.equal(rendered, 1);
  assert.equal(app.getEditable(), "true");
  assert.deepEqual(app.notifications, [
    ["Restored the pre-import backup.", "success"],
  ]);
});
