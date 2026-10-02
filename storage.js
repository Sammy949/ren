/**
 * Ren Storage Module
 * Handles data persistence with hybrid chrome.storage strategy
 *
 * Storage Strategy (Hybrid):
 * - chrome.storage.SYNC for settings (small data, syncs across devices)
 * - chrome.storage.LOCAL for notes (unlimitedStorage removes the API byte quota)
 *
 * This ensures:
 * - Settings sync across devices where user is logged into Chrome
 * - Notes have ample storage space (sync has only 100KB limit)
 *
 * NOTE: Storage keys keep the legacy `sylva_*` prefix on purpose. They are an
 * internal namespace (never shown to users), and renaming them would orphan
 * existing data. A clean migration to Ren-prefixed keys belongs in the v2
 * storage rewrite, not here.
 *
 * Storage structure:
 * - [SYNC] sylva_settings: { theme, onboardingComplete }
 * - [LOCAL] sylva_notes_index: [noteId1, noteId2, ...] (order preserved)
 * - [LOCAL] note_<id>: { id, title, content, createdAt, updatedAt }
 * - [LOCAL] sylva_current_note: noteId
 */

class RenStorage {
  constructor() {
    // Check if chrome.storage APIs are available
    this.useChromeLocal =
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
    this.useChromeSync =
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync;
    this.migrationKey = "sylva_migrated_v4"; // Bumped for hybrid storage
  }

  /**
   * Initialize storage and migrate from localStorage if needed
   */
  async initialize() {
    if (this.useChromeLocal) {
      await this.migrateFromLocalStorage();
    }
  }

  /**
   * Migrate existing localStorage data to chrome.storage (hybrid)
   */
  async migrateFromLocalStorage() {
    try {
      // Check if migration already done (check in local storage)
      const result = await this.getLocal(this.migrationKey);
      if (result[this.migrationKey]) {
        console.log("Storage: Already migrated to chrome.storage (hybrid)");
        return;
      }

      // Check for existing localStorage data
      const notesData = localStorage.getItem("sylva-notes");
      const currentNoteId = localStorage.getItem("sylva-current-note");
      const theme = localStorage.getItem("sylva-theme");
      const onboarding = localStorage.getItem("sylva-onboarding-complete");

      if (!notesData && !currentNoteId) {
        console.log("Storage: No localStorage data to migrate");
        await this.setLocal({ [this.migrationKey]: true });
        return;
      }

      console.log("Storage: Migrating to hybrid chrome.storage...");

      // Parse notes
      const notes = notesData ? JSON.parse(notesData) : [];
      const notesIndex = [];
      const notesData_obj = {};

      for (const note of notes) {
        notesIndex.push(note.id);
        notesData_obj[`note_${note.id}`] = note;
      }

      // Save notes to LOCAL storage (large quota)
      notesData_obj.sylva_notes_index = notesIndex;
      notesData_obj.sylva_current_note = currentNoteId || null;
      await this.setLocal(notesData_obj);

      // Save settings to SYNC storage (syncs across devices)
      if (this.useChromeSync) {
        await this.setSync({
          sylva_settings: {
            theme: theme || "system",
            onboardingComplete: onboarding === "true",
          },
        });
        console.log("Storage: Settings saved to sync storage");
      }

      // Mark migration complete
      await this.setLocal({ [this.migrationKey]: true });

      console.log(
        `Storage: Migration complete. ${notes.length} notes → local, settings → sync`
      );
    } catch (error) {
      console.error("Storage: Migration failed", error);
      throw error;
    }
  }

  // ============================================
  // Low-level Storage APIs
  // ============================================

  /**
   * Get data from LOCAL storage (for notes)
   */
  async getLocal(keys) {
    if (this.useChromeLocal) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    } else {
      return this._getFromLocalStorage(keys);
    }
  }

  /**
   * Set data in LOCAL storage (for notes)
   */
  async setLocal(items) {
    if (this.useChromeLocal) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } else {
      this._setToLocalStorage(items);
    }
  }

  /**
   * Remove data from LOCAL storage
   */
  async removeLocal(keys) {
    if (this.useChromeLocal) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } else {
      this._removeFromLocalStorage(keys);
    }
  }

  /**
   * Get data from SYNC storage (for settings)
   */
  async getSync(keys) {
    if (this.useChromeSync) {
      return new Promise((resolve, reject) => {
        chrome.storage.sync.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    } else {
      return this._getFromLocalStorage(keys);
    }
  }

  /**
   * Set data in SYNC storage (for settings)
   */
  async setSync(items) {
    if (this.useChromeSync) {
      return new Promise((resolve, reject) => {
        chrome.storage.sync.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } else {
      this._setToLocalStorage(items);
    }
  }

  // ============================================
  // localStorage fallback helpers
  // ============================================

  _getFromLocalStorage(keys) {
    const result = {};
    if (keys === null) {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key !== null) Object.assign(result, this._getFromLocalStorage(key));
      }
      return result;
    }
    const keyArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keyArray) {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
    }
    return result;
  }

  _setToLocalStorage(items) {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  _removeFromLocalStorage(keys) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keyArray) {
      localStorage.removeItem(key);
    }
  }

  // ============================================
  // Legacy get/set/remove (use LOCAL for notes)
  // ============================================

  async get(keys) {
    return this.getLocal(keys);
  }

  async set(items) {
    return this.setLocal(items);
  }

  async remove(keys) {
    return this.removeLocal(keys);
  }

  // ============================================
  // High-level API for notes (uses LOCAL storage)
  // ============================================

  /**
   * Get all notes
   * @returns {Promise<Array>} - Array of notes
   */
  async getAllNotes() {
    try {
      const indexResult = await this.getLocal("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];

      if (notesIndex.length === 0) {
        return [];
      }

      const noteKeys = notesIndex.map((id) => `note_${id}`);
      const notesResult = await this.getLocal(noteKeys);

      const notes = [];
      for (const id of notesIndex) {
        const note = notesResult[`note_${id}`];
        if (!note) throw new Error("An indexed note is missing from storage");
        notes.push(note);
      }

      return notes;
    } catch (error) {
      console.error("Storage: Failed to get notes", error);
      throw error;
    }
  }

  /**
   * Save a single note
   * @param {object} note - Note object
   * @param {Array<string>} notesIndex - Ordered note IDs
   * @param {string|null} currentNoteId - Current note ID
   * @returns {Promise<void>}
   */
  async saveNote(
    note,
    notesIndex,
    currentNoteId,
    writeContext = null,
    expectedNote = undefined,
    expectedIndex = undefined,
  ) {
    try {
      const items = {
        [`note_${note.id}`]: note,
        sylva_notes_index: notesIndex,
        sylva_current_note: currentNoteId,
      };
      if (writeContext?.instanceId) {
        items.ren_last_write_v1 = writeContext;
      }
      const commit = async () => {
        if (expectedIndex !== undefined) {
          const storedIndex = (await this.getLocal("sylva_notes_index"))
            .sylva_notes_index || [];
          this.assertNotebookIndex(storedIndex, expectedIndex);
        }
        if (expectedNote !== undefined) {
          const key = `note_${note.id}`;
          const current = (await this.getLocal(key))[key];
          if (!current || !this.storageValuesEqual(current, expectedNote)) {
            const error = new Error(
              "This note changed in another Ren panel",
            );
            error.name = "StorageConflictError";
            throw error;
          }
        }
        await this.setLocal(items);
      };
      await this.withNotebookWriteLock(commit);
    } catch (error) {
      console.error("Storage: Failed to save note", error?.message || error);
      throw error;
    }
  }

  /**
   * Delete a note
   * @param {string} noteId - Note ID to delete
   * @returns {Promise<void>}
   */
  async deleteNote(noteId) {
    try {
      await this.removeLocal(`note_${noteId}`);

      const indexResult = await this.getLocal("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];
      const updatedIndex = notesIndex.filter((id) => id !== noteId);
      await this.setLocal({ sylva_notes_index: updatedIndex });
    } catch (error) {
      console.error("Storage: Failed to delete note", error?.message || error);
      throw error;
    }
  }

  /**
   * Save all notes (for bulk operations like import)
   * @param {Array} notes - Array of notes
   * @param {string|null} [currentNoteId] - Current note to commit atomically
   * @returns {Promise<void>}
   */
  async saveAllNotes(notes, currentNoteId, writeContext = null, expectedNotebook = undefined) {
    try {
      const items = {};
      const notesIndex = [];

      for (const note of notes) {
        items[`note_${note.id}`] = note;
        notesIndex.push(note.id);
      }

      items.sylva_notes_index = notesIndex;
      if (arguments.length > 1) {
        items.sylva_current_note = currentNoteId;
      }
      if (writeContext?.instanceId) {
        items.ren_last_write_v1 = writeContext;
      }
      await this.withNotebookWriteLock(async () => {
        if (expectedNotebook !== undefined) {
          const current = await this.getLocal(null);
          this.assertNotebookUnchanged(current, expectedNotebook);
        }
        await this.setLocal(items);
      });
    } catch (error) {
      console.error(
        "Storage: Failed to save all notes",
        error?.message || error
      );
      throw error;
    }
  }

  /**
   * Replace the notebook after preserving the previous storage shape.
   * The live index changes only after the backup write succeeds.
   * @param {Array<object>} notes
   * @param {string} currentNoteId
   * @returns {Promise<object>} Commit and cleanup result.
   */
  async replaceAllNotesWithBackup(notes, currentNoteId, expectedNotebook = undefined) {
    return this.withNotebookWriteLock(() =>
      this.replaceAllNotesWithBackupUnlocked(notes, currentNoteId, expectedNotebook),
    );
  }

  async replaceAllNotesWithBackupUnlocked(notes, currentNoteId, expectedNotebook) {
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error("Replacement notebook must contain at least one note");
    }

    const noteIds = [];
    const seenIds = new Set();
    const replacement = {};
    for (const note of notes) {
      if (
        !note ||
        typeof note !== "object" ||
        typeof note.id !== "string" ||
        note.id.length === 0
      ) {
        throw new Error("Replacement notebook contains an invalid note ID");
      }
      if (seenIds.has(note.id)) {
        throw new Error("Replacement notebook contains duplicate note IDs");
      }
      seenIds.add(note.id);
      noteIds.push(note.id);
      replacement[`note_${note.id}`] = note;
    }
    if (typeof currentNoteId !== "string" || !seenIds.has(currentNoteId)) {
      throw new Error("Replacement notebook has an invalid current note");
    }

    const previous = await this.getLocal(null);
    if (expectedNotebook !== undefined) {
      this.assertNotebookUnchanged(previous, expectedNotebook);
    }
    const previousNoteKeys = Object.keys(previous).filter((key) =>
      key.startsWith("note_"),
    );
    const backupEntries = {};
    for (const key of [
      ...previousNoteKeys,
      "sylva_notes_index",
      "sylva_current_note",
    ]) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) {
        backupEntries[key] = previous[key];
      }
    }

    const createdAt = new Date().toISOString();
    await this.setLocal({
      ren_pre_import_backup_v1: {
        version: 1,
        createdAt,
        hadNotesIndex: Object.prototype.hasOwnProperty.call(
          previous,
          "sylva_notes_index",
        ),
        hadCurrentNote: Object.prototype.hasOwnProperty.call(
          previous,
          "sylva_current_note",
        ),
        entries: backupEntries,
      },
    });

    const commitId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    Object.assign(replacement, {
      sylva_notes_index: noteIds,
      sylva_current_note: currentNoteId,
      ren_import_commit_v1: { version: 1, commitId, committedAt: createdAt },
    });
    try {
      await this.setLocal(replacement);

      const verification = await this.getLocal(Object.keys(replacement));
      for (const [key, expected] of Object.entries(replacement)) {
        if (!this.storageValuesEqual(verification[key], expected)) {
          throw new Error("Imported notebook could not be verified");
        }
      }
    } catch (error) {
      try {
        await this.restorePreImportBackupUnlocked();
      } catch (restoreError) {
        throw new Error("Import failed and its backup could not be restored", {
          cause: restoreError,
        });
      }
      throw error;
    }

    const replacementKeys = new Set(noteIds.map((id) => `note_${id}`));
    const obsoleteKeys = previousNoteKeys.filter(
      (key) => !replacementKeys.has(key),
    );
    let cleanupPending = false;
    if (obsoleteKeys.length > 0) {
      try {
        await this.removeLocal(obsoleteKeys);
      } catch (error) {
        cleanupPending = true;
        console.error(
          "Storage: Imported notes but could not remove replaced note keys",
          error?.message || error,
        );
      }
    }

    return {
      commitId,
      backupCreatedAt: createdAt,
      cleanupPending,
      obsoleteNoteCount: obsoleteKeys.length,
    };
  }

  /**
   * Get non-content metadata for the latest pre-import backup.
   * @returns {Promise<object|null>}
   */
  async getPreImportBackupInfo() {
    const result = await this.getLocal("ren_pre_import_backup_v1");
    const backup = result.ren_pre_import_backup_v1;
    if (
      !backup ||
      backup.version !== 1 ||
      typeof backup.createdAt !== "string" ||
      !backup.entries ||
      typeof backup.entries !== "object" ||
      Array.isArray(backup.entries)
    ) {
      return null;
    }
    return {
      createdAt: backup.createdAt,
      storedNoteCount: Object.keys(backup.entries).filter((key) =>
        key.startsWith("note_"),
      ).length,
    };
  }

  /**
   * Restore the exact note keys and selection saved before the latest import.
   * @returns {Promise<void>}
   */
  async restorePreImportBackup(expectedNotebook = undefined) {
    return this.withNotebookWriteLock(() =>
      this.restorePreImportBackupUnlocked(expectedNotebook),
    );
  }

  async restorePreImportBackupUnlocked(expectedNotebook = undefined) {
    const result = await this.getLocal("ren_pre_import_backup_v1");
    const backup = result.ren_pre_import_backup_v1;
    if (
      !backup ||
      backup.version !== 1 ||
      !backup.entries ||
      typeof backup.entries !== "object" ||
      Array.isArray(backup.entries)
    ) {
      throw new Error("No valid pre-import backup is available");
    }

    const current = await this.getLocal(null);
    if (expectedNotebook !== undefined) {
      this.assertNotebookUnchanged(current, expectedNotebook);
    }
    const keysToRemove = Object.keys(current).filter(
      (key) =>
        (key.startsWith("note_") &&
          !Object.prototype.hasOwnProperty.call(backup.entries, key)) ||
        (key === "sylva_notes_index" && !backup.hadNotesIndex) ||
        (key === "sylva_current_note" && !backup.hadCurrentNote) ||
        key === "ren_import_commit_v1",
    );

    if (Object.keys(backup.entries).length > 0) {
      await this.setLocal(backup.entries);
    }
    if (keysToRemove.length > 0) await this.removeLocal(keysToRemove);

    const restored = await this.getLocal(null);
    for (const [key, expected] of Object.entries(backup.entries)) {
      if (!this.storageValuesEqual(restored[key], expected)) {
        throw new Error("Pre-import backup could not be verified");
      }
    }
    const unexpectedNote = Object.keys(restored).some(
      (key) =>
        key.startsWith("note_") &&
        !Object.prototype.hasOwnProperty.call(backup.entries, key),
    );
    if (
      unexpectedNote ||
      Object.prototype.hasOwnProperty.call(restored, "ren_import_commit_v1") ||
      (!backup.hadNotesIndex &&
        Object.prototype.hasOwnProperty.call(restored, "sylva_notes_index")) ||
      (!backup.hadCurrentNote &&
        Object.prototype.hasOwnProperty.call(restored, "sylva_current_note"))
    ) {
      throw new Error("Pre-import backup cleanup could not be verified");
    }
  }

  async withNotebookWriteLock(operation) {
    if (globalThis.navigator?.locks?.request) {
      return globalThis.navigator.locks.request("ren-notebook-write", operation);
    }
    return operation();
  }

  assertNotebookIndex(current, expected) {
    if (!this.storageValuesEqual(current, expected)) {
      const error = new Error("The notebook changed in another Ren panel");
      error.name = "StorageConflictError";
      throw error;
    }
  }

  assertNotebookUnchanged(current, expected) {
    const index = current.sylva_notes_index || [];
    this.assertNotebookIndex(index, expected.index);
    for (const note of expected.notes) {
      if (!this.storageValuesEqual(current[`note_${note.id}`], note)) {
        const error = new Error("A note changed in another Ren panel");
        error.name = "StorageConflictError";
        throw error;
      }
    }
  }

  storageValuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) =>
          this.storageValuesEqual(value, right[index]),
        )
      );
    }
    if (
      !left ||
      !right ||
      typeof left !== "object" ||
      typeof right !== "object"
    ) {
      return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          this.storageValuesEqual(left[key], right[key]),
      )
    );
  }

  /**
   * Update notes index order
   * @param {Array} notesIndex - Array of note IDs in order
   * @returns {Promise<void>}
   */
  async updateNotesIndex(notesIndex) {
    await this.setLocal({ sylva_notes_index: notesIndex });
  }

  // ============================================
  // High-level API for settings (uses SYNC storage)
  // ============================================

  /**
   * Get settings (from SYNC storage - syncs across devices)
   * @returns {Promise<object>} - Settings object
   */
  async getSettings() {
    try {
      // Try sync first (for cross-device sync)
      if (this.useChromeSync) {
        const syncResult = await this.getSync("sylva_settings");
        if (syncResult.sylva_settings) {
          return syncResult.sylva_settings;
        }
      }
      // Fallback to local
      const localResult = await this.getLocal("sylva_settings");
      return (
        localResult.sylva_settings || {
          theme: "system",
          onboardingComplete: false,
        }
      );
    } catch (error) {
      console.error("Storage: Failed to get settings", error?.message || error);
      return {
        theme: "system",
        onboardingComplete: false,
      };
    }
  }

  /**
   * Save settings (to SYNC storage - syncs across devices)
   * @param {object} settings - Settings object (partial or full)
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    try {
      const current = await this.getSettings();
      const updated = { ...current, ...settings };

      // Save to sync (syncs across devices)
      if (this.useChromeSync) {
        await this.setSync({ sylva_settings: updated });
      }
      // Also save to local as backup
      await this.setLocal({ sylva_settings: updated });
    } catch (error) {
      console.error(
        "Storage: Failed to save settings",
        error?.message || error
      );
    }
  }

  /**
   * Get current note ID (from LOCAL storage)
   * @returns {Promise<string|null>}
   */
  async getCurrentNoteId() {
    const result = await this.getLocal("sylva_current_note");
    return result.sylva_current_note || null;
  }

  /**
   * Set current note ID (to LOCAL storage)
   * @param {string} noteId
   * @returns {Promise<void>}
   */
  async setCurrentNoteId(noteId, writeContext = null) {
    const items = { sylva_current_note: noteId };
    if (writeContext?.instanceId) {
      items.ren_last_write_v1 = writeContext;
    }
    await this.setLocal(items);
  }

  subscribeToLocalChanges(listener) {
    if (!this.useChromeLocal || !chrome.storage.onChanged?.addListener) {
      return () => {};
    }
    const handler = (changes, areaName) => {
      if (areaName === "local") listener(changes);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  /**
   * Get theme (syncs across devices)
   * @returns {Promise<string>}
   */
  async getTheme() {
    const settings = await this.getSettings();
    return settings.theme || "system";
  }

  /**
   * Set theme (syncs across devices)
   * @param {string} theme
   * @returns {Promise<void>}
   */
  async setTheme(theme) {
    await this.saveSettings({ theme });
  }

  /**
   * Check if onboarding is complete (syncs across devices)
   * @returns {Promise<boolean>}
   */
  async isOnboardingComplete() {
    const settings = await this.getSettings();
    return settings.onboardingComplete || false;
  }

  /**
   * Mark onboarding as complete (syncs across devices)
   * @returns {Promise<void>}
   */
  async completeOnboarding() {
    await this.saveSettings({ onboardingComplete: true });
  }

  /**
   * Inspect note storage without changing it or returning note content.
   * @returns {Promise<object>} A versioned summary of storage consistency.
   */
  async getStorageHealth() {
    const snapshot = await this.getLocal(null);
    const hasIndex = Object.prototype.hasOwnProperty.call(
      snapshot,
      "sylva_notes_index",
    );
    const rawIndex = hasIndex ? snapshot.sylva_notes_index : [];
    const indexIsArray = Array.isArray(rawIndex);
    const index = indexIsArray ? rawIndex : [];
    const invalidIndexEntries = [];
    const duplicateNoteIds = [];
    const seenIds = new Set();

    index.forEach((id, position) => {
      if (typeof id !== "string" || id.length === 0) {
        invalidIndexEntries.push(position);
        return;
      }
      if (seenIds.has(id)) duplicateNoteIds.push(id);
      seenIds.add(id);
    });

    const storedNotes = Object.entries(snapshot).filter(([key]) =>
      key.startsWith("note_"),
    );
    const missingNoteIds = [...seenIds].filter(
      (id) => !Object.prototype.hasOwnProperty.call(snapshot, `note_${id}`),
    );
    const orphanNoteIds = storedNotes
      .map(([key]) => key.slice("note_".length))
      .filter((id) => !seenIds.has(id));
    const malformedNotes = [];

    for (const [storageKey, note] of storedNotes) {
      const reasons = [];
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        reasons.push("record-not-object");
      } else {
        const expectedId = storageKey.slice("note_".length);
        if (typeof note.id !== "string" || note.id.length === 0) {
          reasons.push("invalid-id");
        } else if (note.id !== expectedId) {
          reasons.push("id-key-mismatch");
        }
        if (typeof note.title !== "string") reasons.push("invalid-title");
        if (typeof note.content !== "string") reasons.push("invalid-content");
        if (
          typeof note.createdAt !== "string" ||
          Number.isNaN(Date.parse(note.createdAt))
        ) {
          reasons.push("invalid-created-at");
        }
        if (
          typeof note.updatedAt !== "string" ||
          Number.isNaN(Date.parse(note.updatedAt))
        ) {
          reasons.push("invalid-updated-at");
        }
      }
      if (reasons.length > 0) malformedNotes.push({ storageKey, reasons });
    }

    const hasCurrentNote = Object.prototype.hasOwnProperty.call(
      snapshot,
      "sylva_current_note",
    );
    const currentNoteId = hasCurrentNote ? snapshot.sylva_current_note : null;
    const currentNoteValid =
      currentNoteId === null ||
      (typeof currentNoteId === "string" && seenIds.has(currentNoteId));
    const storageInfo = await this.getStorageInfo();
    const issueCount =
      (indexIsArray ? 0 : 1) +
      invalidIndexEntries.length +
      duplicateNoteIds.length +
      missingNoteIds.length +
      orphanNoteIds.length +
      malformedNotes.length +
      (currentNoteValid ? 0 : 1);

    return {
      version: 1,
      healthy: issueCount === 0,
      issueCount,
      bytesInUse: storageInfo?.bytesInUse ?? null,
      quotaBytes: storageInfo?.quota ?? null,
      indexValid: indexIsArray,
      indexedNoteCount: index.length,
      storedNoteCount: storedNotes.length,
      invalidIndexEntries,
      duplicateNoteIds,
      missingNoteIds,
      orphanNoteIds,
      malformedNotes,
      currentNoteId,
      currentNoteValid,
    };
  }

  /**
   * Get storage usage info
   * @returns {Promise<object|null>}
   */
  async getStorageInfo() {
    if (this.useChromeLocal) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          // QUOTA_BYTES stays at 10 MB even when Chrome does not enforce it.
          const unlimited = Boolean(chrome.runtime.getManifest?.()?.permissions?.includes("unlimitedStorage"));
          const quota = unlimited ? null : (chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024);
          resolve({
            bytesInUse,
            quota,
            percentUsed: unlimited ? null : ((bytesInUse / quota) * 100).toFixed(1),
            unlimited,
            type: "local",
          });
        });
      });
    }
    return null;
  }

  /**
   * Get sync storage usage info
   * @returns {Promise<object|null>}
   */
  async getSyncStorageInfo() {
    if (this.useChromeSync) {
      return new Promise((resolve) => {
        chrome.storage.sync.getBytesInUse(null, (bytesInUse) => {
          resolve({
            bytesInUse,
            quota: chrome.storage.sync.QUOTA_BYTES,
            percentUsed: (
              (bytesInUse / chrome.storage.sync.QUOTA_BYTES) *
              100
            ).toFixed(1),
            type: "sync",
          });
        });
      });
    }
    return null;
  }
}

// Export singleton instance
const renStorage = new RenStorage();
