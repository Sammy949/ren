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
  app.saveQueue = Promise.resolve();
  app.autoSaveStatus = { textContent: "Ready" };
  app.notes = [{ id: "a", title: "A", content: "first" }];
  app.currentNoteId = "a";
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
