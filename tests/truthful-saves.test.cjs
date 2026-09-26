const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadNotePad() {
  const context = {
    document: { addEventListener() {} },
    console: { error() {} },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "sidepanel.js"), "utf8") +
      "\nthis.RenNotePad = RenNotePad;",
    context,
  );
  return context.RenNotePad;
}

function createSaveApp() {
  const RenNotePad = loadNotePad();
  const app = Object.create(RenNotePad.prototype);
  app.dataLoadFailed = false;
  app.editRevision = 0;
  app.savedRevision = 0;
  app.flushSavePromise = null;
  app.instanceId = "panel-a";
  app.storageConflict = false;
  app.saveQueue = Promise.resolve();
  app.autoSaveStatus = { textContent: "Ready" };
  app.saveRecoveryExportBtn = { hidden: true };
  app.notes = [{ id: "a", title: "A", content: "first" }];
  app.notesCache = new Map([["a", app.notes[0]]]);
  app.persistedNotes = new Map([["a", { ...app.notes[0] }]]);
  app.currentNoteId = "a";
  app.editor = true;
  app.noteContent = { innerHTML: "first", value: "first" };
  app.showNotification = () => {};
  app.announceToScreenReader = () => {};
  return app;
}

test("notebook writes are serialized and use queue-time snapshots", async () => {
  const app = createSaveApp();
  const writes = [];
  app.storage = {
    saveAllNotes(notes, currentNoteId) {
      const pending = deferred();
      writes.push({ notes, currentNoteId, pending });
      return pending.promise;
    },
  };

  const firstSave = app.saveData();
  await Promise.resolve();
  app.notes[0].content = "second";
  const secondSave = app.saveData();
  await Promise.resolve();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].notes[0].content, "first");

  writes[0].pending.resolve();
  await firstSave;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 2);
  assert.equal(writes[1].notes[0].content, "second");
  writes[1].pending.resolve();
  await secondSave;
});

test("a failed write does not prevent a later queued save", async () => {
  const app = createSaveApp();
  const writes = [];
  app.storage = {
    saveAllNotes(notes) {
      writes.push(notes[0].content);
      if (writes.length === 1) return Promise.reject(new Error("disk failed"));
      return Promise.resolve();
    },
  };

  await assert.rejects(app.saveData(), /disk failed/);
  app.notes[0].content = "retry";
  await app.saveData();

  assert.deepEqual(writes, ["first", "retry"]);
});

test("a failed save reveals export until a retry succeeds", async () => {
  const app = createSaveApp();
  app.editRevision = 1;
  app.noteContent.innerHTML = "unsaved open edit";
  let attempts = 0;
  app.saveCurrentNote = async () => {
    attempts++;
    if (attempts === 1) throw new Error("quota exceeded");
  };

  assert.equal(await app.saveCurrentNoteWithStatus(), false);
  assert.equal(app.autoSaveStatus.textContent, "Could not save");
  assert.equal(app.saveRecoveryExportBtn.hidden, false);
  assert.equal(app.createExportData().notes[0].content, "unsaved open edit");

  assert.equal(await app.saveCurrentNoteWithStatus(), true);
  assert.equal(app.autoSaveStatus.textContent, "Saved");
  assert.equal(app.saveRecoveryExportBtn.hidden, true);
});

test("a failed note write retries against the last confirmed snapshot", async () => {
  const app = createSaveApp();
  const expected = [];
  let attempts = 0;
  app.storage = {
    async saveNote(note, _index, _current, _context, previous) {
      attempts++;
      expected.push(previous.content);
      if (attempts === 1) throw new Error("quota exceeded");
      assert.equal(note.content, "retry content");
    },
  };

  app.notes[0].content = "failed content";
  await assert.rejects(app.saveNoteData(app.notes[0]), /quota exceeded/);
  assert.equal(app.persistedNotes.get("a").content, "first");

  app.notes[0].content = "retry content";
  await app.saveNoteData(app.notes[0]);
  assert.deepEqual(expected, ["first", "first"]);
  assert.equal(app.persistedNotes.get("a").content, "retry content");
});

test("an ordinary note save uses the incremental storage path", async () => {
  const app = createSaveApp();
  app.notes.push({ id: "b", title: "B", content: "untouched" });
  const calls = [];
  app.storage = {
    saveNote(note, notesIndex, currentNoteId) {
      calls.push({ note, notesIndex, currentNoteId });
      return Promise.resolve();
    },
    saveAllNotes() {
      throw new Error("ordinary note save rewrote the notebook");
    },
  };

  await app.saveNoteData(app.notes[0]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].note.content, "first");
  assert.deepEqual(Array.from(calls[0].notesIndex), ["a", "b"]);
  assert.equal(calls[0].currentNoteId, "a");
});

test("save status changes to Saved only after the write completes", async () => {
  const app = createSaveApp();
  const pending = deferred();
  app.editRevision = 1;
  app.saveCurrentNote = () => pending.promise;

  const saving = app.saveCurrentNoteWithStatus({ revision: 1 });
  assert.equal(app.autoSaveStatus.textContent, "Saving...");

  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(app.autoSaveStatus.textContent, "Saved");
});

test("an older save cannot mark a newer edit as Saved", async () => {
  const app = createSaveApp();
  const pending = deferred();
  app.editRevision = 1;
  app.saveCurrentNote = () => pending.promise;

  const saving = app.saveCurrentNoteWithStatus({ revision: 1 });
  app.editRevision = 2;
  app.autoSaveStatus.textContent = "Saving...";
  pending.resolve();

  assert.equal(await saving, true);
  assert.equal(app.autoSaveStatus.textContent, "Saving...");
});

test("a failed current-note write reports failure instead of Saved", async () => {
  const app = createSaveApp();
  app.editRevision = 1;
  app.saveCurrentNote = async () => { throw new Error("quota exceeded"); };

  assert.equal(await app.saveCurrentNoteWithStatus({ revision: 1 }), false);
  assert.equal(app.autoSaveStatus.textContent, "Could not save");
});

test("hiding Ren flushes a dirty revision and records the successful save", async () => {
  const app = createSaveApp();
  let saves = 0;
  app.editRevision = 2;
  app.savedRevision = 1;
  app.saveCurrentNote = async () => { saves++; };

  assert.equal(await app.flushPendingSave(), true);
  assert.equal(saves, 1);
  assert.equal(app.savedRevision, 2);
  assert.equal(app.autoSaveStatus.textContent, "Saved");
});

test("hiding Ren does not rewrite a clean note", async () => {
  const app = createSaveApp();
  let saves = 0;
  app.editRevision = 3;
  app.savedRevision = 3;
  app.saveCurrentNote = async () => { saves++; };

  assert.equal(await app.flushPendingSave(), true);
  assert.equal(saves, 0);
});

test("a failed visibility flush remains dirty for retry", async () => {
  const app = createSaveApp();
  app.editRevision = 1;
  app.saveCurrentNote = async () => { throw new Error("storage unavailable"); };

  assert.equal(await app.flushPendingSave(), false);
  assert.equal(app.savedRevision, 0);
  assert.equal(app.autoSaveStatus.textContent, "Could not save");
});

test("visibility and pagehide share one in-flight flush", async () => {
  const app = createSaveApp();
  const pending = deferred();
  let saves = 0;
  app.editRevision = 1;
  app.saveCurrentNote = () => {
    saves++;
    return pending.promise;
  };

  const visibilitySave = app.flushPendingSave();
  const pagehideSave = app.flushPendingSave();
  assert.equal(saves, 1);

  pending.resolve();
  assert.equal(await visibilitySave, true);
  assert.equal(await pagehideSave, true);
  assert.equal(saves, 1);
});

test("an external notebook change blocks a dirty panel from overwriting it", async () => {
  const app = createSaveApp();
  const notices = [];
  app.editRevision = 1;
  app.noteContent.innerHTML = "unsaved local edit";
  app.showNotification = (...args) => notices.push(args);

  await app.handleStorageChanges({
    note_a: { newValue: { id: "a", title: "External", content: "external" } },
    ren_last_write_v1: { newValue: { instanceId: "panel-b", revision: 1 } },
  });

  assert.equal(app.storageConflict, true);
  assert.equal(app.notes[0].content, "unsaved local edit");
  assert.equal(app.autoSaveStatus.textContent, "Changed elsewhere");
  assert.equal(notices.length, 1);
  await assert.rejects(app.saveData(), /[Aa]nother Ren panel/);
  assert.equal(app.createExportData().notes[0].content, "unsaved local edit");
});

test("a clean panel refreshes after another panel saves", async () => {
  const app = createSaveApp();
  let loaded = 0;
  let rendered = 0;
  const external = { id: "a", title: "External", content: "new value" };
  app.storage = {
    getAllNotes: async () => [external],
    getCurrentNoteId: async () => "a",
  };
  app.loadCurrentNote = () => { loaded++; };
  app.renderNotesList = () => { rendered++; };

  await app.handleStorageChanges({
    note_a: { newValue: external },
    ren_last_write_v1: { newValue: { instanceId: "panel-b", revision: 1 } },
  });

  assert.equal(app.storageConflict, false);
  assert.equal(app.notesCache.get("a").content, "new value");
  assert.equal(loaded, 1);
  assert.equal(rendered, 1);
});

test("a panel ignores its own tagged storage event", async () => {
  const app = createSaveApp();
  app.editRevision = 1;

  await app.handleStorageChanges({
    note_a: { newValue: { id: "a", content: "first" } },
    ren_last_write_v1: { newValue: { instanceId: "panel-a", revision: 1 } },
  });

  assert.equal(app.storageConflict, false);
});
