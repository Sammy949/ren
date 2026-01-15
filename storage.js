/**
 * Sylva Storage Module
 * Handles data persistence with hybrid chrome.storage strategy
 *
 * Storage Strategy (Hybrid):
 * - chrome.storage.SYNC for settings (small data, syncs across devices)
 * - chrome.storage.LOCAL for notes (large data, 5MB+ quota)
 *
 * This ensures:
 * - Settings sync across devices where user is logged into Chrome
 * - Notes have ample storage space (sync has only 100KB limit)
 *
 * Storage structure:
 * - [SYNC] sylva_settings: { theme, onboardingComplete }
 * - [LOCAL] sylva_notes_index: [noteId1, noteId2, ...] (order preserved)
 * - [LOCAL] note_<id>: { id, title, content, createdAt, updatedAt }
 * - [LOCAL] sylva_current_note: noteId
 */

class SylvaStorage {
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
      console.error(
        "Storage: Migration failed",
        error?.message || JSON.stringify(error)
      );
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
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
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
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, resolve);
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
      return new Promise((resolve) => {
        chrome.storage.sync.get(keys, resolve);
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
        if (note) {
          notes.push(note);
        }
      }

      return notes;
    } catch (error) {
      console.error("Storage: Failed to get notes", error?.message || error);
      return [];
    }
  }

  /**
   * Save a single note
   * @param {object} note - Note object
   * @returns {Promise<void>}
   */
  async saveNote(note) {
    try {
      await this.setLocal({ [`note_${note.id}`]: note });

      const indexResult = await this.getLocal("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];

      if (!notesIndex.includes(note.id)) {
        notesIndex.unshift(note.id);
        await this.setLocal({ sylva_notes_index: notesIndex });
      }
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
   * @returns {Promise<void>}
   */
  async saveAllNotes(notes) {
    try {
      const items = {};
      const notesIndex = [];

      for (const note of notes) {
        items[`note_${note.id}`] = note;
        notesIndex.push(note.id);
      }

      items.sylva_notes_index = notesIndex;
      await this.setLocal(items);
    } catch (error) {
      console.error(
        "Storage: Failed to save all notes",
        error?.message || error
      );
      throw error;
    }
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
  async setCurrentNoteId(noteId) {
    await this.setLocal({ sylva_current_note: noteId });
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
   * Get storage usage info
   * @returns {Promise<object|null>}
   */
  async getStorageInfo() {
    if (this.useChromeLocal) {
      return new Promise((resolve) => {
        chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
          const quota = 5242880; // ~5MB for local storage
          resolve({
            bytesInUse,
            quota,
            percentUsed: ((bytesInUse / quota) * 100).toFixed(1),
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
const sylvaStorage = new SylvaStorage();
