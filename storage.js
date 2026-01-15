/**
 * Sylva Storage Module
 * Handles data persistence with chrome.storage.sync (with localStorage fallback)
 *
 * Storage structure:
 * - sylva_settings: { theme, onboardingComplete, currentNoteId }
 * - sylva_notes_index: [noteId1, noteId2, ...] (order preserved)
 * - note_<id>: { id, title, content, createdAt, updatedAt }
 */

class SylvaStorage {
  constructor() {
    // Check if chrome.storage is available
    this.useChrome =
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync;
    this.migrationKey = "sylva_migrated_v2";
  }

  /**
   * Initialize storage and migrate from localStorage if needed
   */
  async initialize() {
    if (this.useChrome) {
      await this.migrateFromLocalStorage();
    }
  }

  /**
   * Migrate existing localStorage data to chrome.storage.sync
   */
  async migrateFromLocalStorage() {
    try {
      // Check if migration already done
      const result = await this.get(this.migrationKey);
      if (result[this.migrationKey]) {
        console.log("Storage: Already migrated to chrome.storage");
        return;
      }

      // Check for existing localStorage data
      const notesData = localStorage.getItem("sylva-notes");
      const currentNoteId = localStorage.getItem("sylva-current-note");
      const theme = localStorage.getItem("sylva-theme");
      const onboarding = localStorage.getItem("sylva-onboarding-complete");

      if (!notesData && !currentNoteId) {
        console.log("Storage: No localStorage data to migrate");
        await this.set({ [this.migrationKey]: true });
        return;
      }

      console.log(
        "Storage: Migrating from localStorage to chrome.storage.sync..."
      );

      // Parse and migrate notes
      const notes = notesData ? JSON.parse(notesData) : [];
      const notesIndex = [];

      for (const note of notes) {
        notesIndex.push(note.id);
        await this.set({ [`note_${note.id}`]: note });
      }

      // Save notes index
      await this.set({ sylva_notes_index: notesIndex });

      // Save settings
      await this.set({
        sylva_settings: {
          theme: theme || "system",
          onboardingComplete: onboarding === "true",
          currentNoteId: currentNoteId || null,
        },
      });

      // Mark migration complete
      await this.set({ [this.migrationKey]: true });

      console.log(
        `Storage: Migration complete. Migrated ${notes.length} notes.`
      );

      // Optionally clear localStorage after successful migration
      // localStorage.removeItem('sylva-notes');
      // localStorage.removeItem('sylva-current-note');
      // localStorage.removeItem('sylva-theme');
      // localStorage.removeItem('sylva-onboarding-complete');
    } catch (error) {
      console.error("Storage: Migration failed", error);
    }
  }

  /**
   * Get data from storage
   * @param {string|string[]} keys - Key(s) to retrieve
   * @returns {Promise<object>} - Object with key-value pairs
   */
  async get(keys) {
    if (this.useChrome) {
      return new Promise((resolve) => {
        chrome.storage.sync.get(keys, resolve);
      });
    } else {
      // Fallback to localStorage
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
  }

  /**
   * Set data in storage
   * @param {object} items - Object with key-value pairs to store
   * @returns {Promise<void>}
   */
  async set(items) {
    if (this.useChrome) {
      return new Promise((resolve, reject) => {
        chrome.storage.sync.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    } else {
      // Fallback to localStorage
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  }

  /**
   * Remove data from storage
   * @param {string|string[]} keys - Key(s) to remove
   * @returns {Promise<void>}
   */
  async remove(keys) {
    if (this.useChrome) {
      return new Promise((resolve) => {
        chrome.storage.sync.remove(keys, resolve);
      });
    } else {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        localStorage.removeItem(key);
      }
    }
  }

  // ============================================
  // High-level API for notes
  // ============================================

  /**
   * Get all notes
   * @returns {Promise<Array>} - Array of notes
   */
  async getAllNotes() {
    try {
      // Get notes index
      const indexResult = await this.get("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];

      if (notesIndex.length === 0) {
        return [];
      }

      // Get all notes by their IDs
      const noteKeys = notesIndex.map((id) => `note_${id}`);
      const notesResult = await this.get(noteKeys);

      // Reconstruct notes array in order
      const notes = [];
      for (const id of notesIndex) {
        const note = notesResult[`note_${id}`];
        if (note) {
          notes.push(note);
        }
      }

      return notes;
    } catch (error) {
      console.error("Storage: Failed to get notes", error);
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
      await this.set({ [`note_${note.id}`]: note });

      // Ensure note is in index
      const indexResult = await this.get("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];

      if (!notesIndex.includes(note.id)) {
        notesIndex.unshift(note.id); // Add to beginning
        await this.set({ sylva_notes_index: notesIndex });
      }
    } catch (error) {
      console.error("Storage: Failed to save note", error);
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
      // Remove note
      await this.remove(`note_${noteId}`);

      // Update index
      const indexResult = await this.get("sylva_notes_index");
      const notesIndex = indexResult.sylva_notes_index || [];
      const updatedIndex = notesIndex.filter((id) => id !== noteId);
      await this.set({ sylva_notes_index: updatedIndex });
    } catch (error) {
      console.error("Storage: Failed to delete note", error);
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
      // Save each note
      const items = {};
      const notesIndex = [];

      for (const note of notes) {
        items[`note_${note.id}`] = note;
        notesIndex.push(note.id);
      }

      items.sylva_notes_index = notesIndex;
      await this.set(items);
    } catch (error) {
      console.error("Storage: Failed to save all notes", error);
      throw error;
    }
  }

  /**
   * Update notes index order
   * @param {Array} notesIndex - Array of note IDs in order
   * @returns {Promise<void>}
   */
  async updateNotesIndex(notesIndex) {
    await this.set({ sylva_notes_index: notesIndex });
  }

  // ============================================
  // High-level API for settings
  // ============================================

  /**
   * Get settings
   * @returns {Promise<object>} - Settings object
   */
  async getSettings() {
    const result = await this.get("sylva_settings");
    return (
      result.sylva_settings || {
        theme: "system",
        onboardingComplete: false,
        currentNoteId: null,
      }
    );
  }

  /**
   * Save settings
   * @param {object} settings - Settings object (partial or full)
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await this.set({ sylva_settings: updated });
  }

  /**
   * Get current note ID
   * @returns {Promise<string|null>}
   */
  async getCurrentNoteId() {
    const settings = await this.getSettings();
    return settings.currentNoteId;
  }

  /**
   * Set current note ID
   * @param {string} noteId
   * @returns {Promise<void>}
   */
  async setCurrentNoteId(noteId) {
    await this.saveSettings({ currentNoteId: noteId });
  }

  /**
   * Get theme
   * @returns {Promise<string>}
   */
  async getTheme() {
    const settings = await this.getSettings();
    return settings.theme || "system";
  }

  /**
   * Set theme
   * @param {string} theme
   * @returns {Promise<void>}
   */
  async setTheme(theme) {
    await this.saveSettings({ theme });
  }

  /**
   * Check if onboarding is complete
   * @returns {Promise<boolean>}
   */
  async isOnboardingComplete() {
    const settings = await this.getSettings();
    return settings.onboardingComplete || false;
  }

  /**
   * Mark onboarding as complete
   * @returns {Promise<void>}
   */
  async completeOnboarding() {
    await this.saveSettings({ onboardingComplete: true });
  }

  /**
   * Get storage usage info (chrome.storage.sync only)
   * @returns {Promise<object|null>}
   */
  async getStorageInfo() {
    if (this.useChrome) {
      return new Promise((resolve) => {
        chrome.storage.sync.getBytesInUse(null, (bytesInUse) => {
          resolve({
            bytesInUse,
            quota: chrome.storage.sync.QUOTA_BYTES,
            percentUsed: (
              (bytesInUse / chrome.storage.sync.QUOTA_BYTES) *
              100
            ).toFixed(1),
          });
        });
      });
    }
    return null;
  }
}

// Export singleton instance
const sylvaStorage = new SylvaStorage();
