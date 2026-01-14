class SylvaNotePad {
  constructor() {
    this.notes = [];
    this.currentNoteId = null;
    this.autoSaveTimeout = null;
    this.sidebarUpdateTimeout = null; // Separate debounce for UI updates
    this.noteToDelete = null;

    // Performance: Map-based cache for O(1) note lookups
    this.notesCache = new Map();
    // Performance: Track rendered DOM elements by note ID
    this.renderedNoteElements = new Map();

    // Keyboard shortcuts configuration
    this.keyboardShortcuts = [
      {
        keys: "Ctrl+Shift+N",
        action: "createNewNote",
        description: "Create new note",
      },
      { keys: "Ctrl+S", action: "forceSave", description: "Save current note" },
      {
        keys: "Ctrl+Shift+E",
        action: "exportNotes",
        description: "Export all notes",
      },
      {
        keys: "Ctrl+Shift+O",
        action: "toggleSidebar",
        description: "Open/close sidebar",
      },
      {
        keys: "Ctrl+/",
        action: "showShortcutsHelp",
        description: "Show keyboard shortcuts",
      },
    ];
    this.shortcutsHelpVisible = false;

    this.initializeElements();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.loadData();
  }

  initializeElements() {
    this.hamburgerBtn = document.getElementById("hamburgerBtn");
    this.sidebar = document.getElementById("sidebar");
    this.sidebarOverlay = document.getElementById("sidebarOverlay");
    this.closeSidebar = document.getElementById("closeSidebar");
    this.noteContent = document.getElementById("noteContent");
    this.noteTitle = document.getElementById("noteTitle");
    this.wordCount = document.getElementById("wordCount");
    this.charCount = document.getElementById("charCount");
    this.autoSaveStatus = document.getElementById("autoSaveStatus");
    this.notesList = document.getElementById("notesList");
    this.newNoteBtn = document.getElementById("newNoteBtn");

    // Export/Import elements
    this.exportNotesBtn = document.getElementById("exportNotesBtn");
    this.importNotesBtn = document.getElementById("importNotesBtn");
    this.importFileInput = document.getElementById("importFileInput");

    // Rename modal elements
    this.renameModal = document.getElementById("renameModal");
    this.renameInput = document.getElementById("renameInput");
    this.cancelRename = document.getElementById("cancelRename");
    this.confirmRename = document.getElementById("confirmRename");

    // Delete modal elements
    this.deleteModal = document.getElementById("deleteModal");
    this.deleteNoteTitle = document.getElementById("deleteNoteTitle");
    this.cancelDelete = document.getElementById("cancelDelete");
    this.confirmDelete = document.getElementById("confirmDelete");

    // Notification container
    this.notificationContainer = document.getElementById(
      "notificationContainer"
    );
  }

  bindEvents() {
    this.hamburgerBtn.addEventListener("click", () => this.toggleSidebar());
    this.closeSidebar.addEventListener("click", () => this.toggleSidebar());
    this.sidebarOverlay.addEventListener("click", () => this.toggleSidebar());

    this.noteContent.addEventListener("input", () => this.handleInput());
    this.noteContent.addEventListener("keydown", (e) => this.handleKeydown(e));

    this.newNoteBtn.addEventListener("click", () => {
      this.createNewNote();
      this.toggleSidebar();
    });

    // Export/Import events
    this.exportNotesBtn.addEventListener("click", () => this.exportNotes());
    this.importNotesBtn.addEventListener("click", () =>
      this.importFileInput.click()
    );
    this.importFileInput.addEventListener("change", (e) => this.importNotes(e));

    // Rename modal events
    this.cancelRename.addEventListener("click", () => this.hideRenameModal());
    this.confirmRename.addEventListener("click", () =>
      this.confirmRenameNote()
    );
    this.renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.confirmRenameNote();
      if (e.key === "Escape") this.hideRenameModal();
    });

    // Delete modal events
    this.cancelDelete.addEventListener("click", () => this.hideDeleteModal());
    this.confirmDelete.addEventListener("click", () =>
      this.confirmDeleteNote()
    );

    // a11y: Delete modal keyboard handling
    this.deleteModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hideDeleteModal();
      // Focus trap within modal
      if (e.key === "Tab") {
        this.trapFocus(e, this.deleteModal);
      }
    });

    // a11y: Rename modal focus trap
    this.renameModal.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        this.trapFocus(e, this.renameModal);
      }
    });

    // a11y: Keyboard navigation for notes list
    this.notesList.addEventListener("keydown", (e) =>
      this.handleNotesListKeydown(e)
    );

    // a11y: Global Escape key to close sidebar
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!this.renameModal.classList.contains("hidden")) {
          this.hideRenameModal();
        } else if (!this.deleteModal.classList.contains("hidden")) {
          this.hideDeleteModal();
        } else if (!this.sidebar.classList.contains("-translate-x-full")) {
          this.toggleSidebar();
        }
      }
    });
  }

  // a11y: Focus trap for modals
  trapFocus(e, container) {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }

  // a11y: Keyboard navigation for notes list
  handleNotesListKeydown(e) {
    const noteItems = Array.from(this.notesList.querySelectorAll(".note-item"));
    const currentIndex = noteItems.findIndex(
      (item) =>
        item === document.activeElement || item.contains(document.activeElement)
    );

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (currentIndex < noteItems.length - 1) {
          noteItems[currentIndex + 1].focus();
        } else if (noteItems.length > 0) {
          noteItems[0].focus();
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (currentIndex > 0) {
          noteItems[currentIndex - 1].focus();
        } else if (noteItems.length > 0) {
          noteItems[noteItems.length - 1].focus();
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (currentIndex >= 0) {
          const noteId = noteItems[currentIndex].dataset.noteId;
          if (noteId) {
            this.switchToNote(noteId);
            this.toggleSidebar();
          }
        }
        break;
      case "Home":
        e.preventDefault();
        if (noteItems.length > 0) noteItems[0].focus();
        break;
      case "End":
        e.preventDefault();
        if (noteItems.length > 0) noteItems[noteItems.length - 1].focus();
        break;
    }
  }

  // a11y: Announce message to screen readers
  announceToScreenReader(message) {
    const announcer = document.getElementById("srAnnouncements");
    if (announcer) {
      announcer.textContent = message;
      // Clear after announcement to allow repeat announcements
      setTimeout(() => {
        announcer.textContent = "";
      }, 1000);
    }
  }

  // Keyboard Shortcuts: Bind global keyboard shortcuts
  bindKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => this.handleKeyboardShortcut(e));
  }

  // Keyboard Shortcuts: Handle keyboard shortcut events
  handleKeyboardShortcut(e) {
    // Don't trigger shortcuts when typing in inputs (except for Escape and specific combos)
    const isTyping = ["INPUT", "TEXTAREA"].includes(
      document.activeElement.tagName
    );

    // Build the key combination string
    const combo = [];
    if (e.ctrlKey || e.metaKey) combo.push("Ctrl");
    if (e.shiftKey) combo.push("Shift");
    if (e.altKey) combo.push("Alt");

    // Normalize key
    let key = e.key;
    if (key === " ") key = "Space";
    if (key.length === 1) key = key.toUpperCase();
    combo.push(key);

    const pressedCombo = combo.join("+");

    // Find matching shortcut
    const shortcut = this.keyboardShortcuts.find((s) => {
      const normalizedKeys = s.keys.toUpperCase().replace(/\s/g, "");
      const normalizedPressed = pressedCombo.toUpperCase();
      return normalizedKeys === normalizedPressed;
    });

    if (shortcut) {
      // Allow Ctrl+S even when typing (common save expectation)
      if (isTyping && shortcut.action !== "forceSave") {
        return;
      }

      e.preventDefault();
      this.executeShortcutAction(shortcut.action);
    }
  }

  // Keyboard Shortcuts: Execute action based on shortcut
  executeShortcutAction(action) {
    switch (action) {
      case "createNewNote":
        this.createNewNote();
        this.announceToScreenReader("New note created");
        break;
      case "forceSave":
        this.saveCurrentNote();
        this.autoSaveStatus.textContent = "Saved";
        this.showNotification("Note saved", "success");
        this.announceToScreenReader("Note saved");
        break;
      case "exportNotes":
        this.exportNotes();
        break;
      case "toggleSidebar":
        this.toggleSidebar();
        break;
      case "showShortcutsHelp":
        this.toggleShortcutsHelp();
        break;
    }
  }

  // Keyboard Shortcuts: Toggle shortcuts help modal
  toggleShortcutsHelp() {
    if (this.shortcutsHelpVisible) {
      this.hideShortcutsHelp();
    } else {
      this.showShortcutsHelp();
    }
  }

  // Keyboard Shortcuts: Show help modal
  showShortcutsHelp() {
    // Create modal if it doesn't exist
    let modal = document.getElementById("shortcutsHelpModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "shortcutsHelpModal";
      modal.className =
        "fixed inset-0 bg-black bg-opacity-50 z-60 flex items-center justify-center";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "shortcutsHelpTitle");

      const shortcuts = this.keyboardShortcuts
        .map(
          (s) => `
        <div class="flex justify-between items-center py-2 border-b border-gray-100">
          <span class="text-sm text-gray-700">${s.description}</span>
          <kbd class="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded font-mono">${s.keys}</kbd>
        </div>
      `
        )
        .join("");

      modal.innerHTML = `
        <div class="bg-white rounded-lg p-4 w-80 mx-4 shadow-xl" role="document">
          <div class="flex items-center justify-between mb-4">
            <h3 id="shortcutsHelpTitle" class="text-base font-semibold text-gray-900">Keyboard Shortcuts</h3>
            <button id="closeShortcutsHelp" class="p-1 hover:bg-gray-100 rounded" aria-label="Close shortcuts help">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="space-y-1">
            ${shortcuts}
          </div>
          <p class="text-xs text-gray-400 mt-4 text-center">Press Escape to close</p>
        </div>
      `;

      document.body.appendChild(modal);

      // Bind close events
      modal
        .querySelector("#closeShortcutsHelp")
        .addEventListener("click", () => this.hideShortcutsHelp());
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.hideShortcutsHelp();
      });
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.hideShortcutsHelp();
      });
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    this.shortcutsHelpVisible = true;
    this.lastFocusedElement = document.activeElement;

    // Focus close button
    setTimeout(() => modal.querySelector("#closeShortcutsHelp").focus(), 100);
  }

  // Keyboard Shortcuts: Hide help modal
  hideShortcutsHelp() {
    const modal = document.getElementById("shortcutsHelpModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
    this.shortcutsHelpVisible = false;

    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
    }
  }

  async loadData() {
    try {
      // Simulating chrome.storage.local with localStorage for this demo
      const notesData = localStorage.getItem("sylva-notes");
      const currentNoteData = localStorage.getItem("sylva-current-note");

      this.notes = notesData ? JSON.parse(notesData) : [];
      this.currentNoteId = currentNoteData || null;

      // Performance: Rebuild cache after loading
      this.rebuildCache();

      if (this.notes.length === 0) {
        this.createNewNote();
      } else {
        this.loadCurrentNote();
      }
      this.renderNotesList();
    } catch (error) {
      console.error("Error loading data:", error);
      this.showNotification("Error loading notes", "error");
      this.createNewNote();
    }
  }

  // Performance: Rebuild the notes cache from the array
  rebuildCache() {
    this.notesCache.clear();
    this.notes.forEach((note) => this.notesCache.set(note.id, note));
  }

  // Performance: O(1) note lookup instead of O(n) array.find()
  getNoteById(noteId) {
    return this.notesCache.get(noteId) || null;
  }

  async saveData() {
    try {
      // Simulating chrome.storage.local with localStorage for this demo
      localStorage.setItem("sylva-notes", JSON.stringify(this.notes));
      localStorage.setItem("sylva-current-note", this.currentNoteId);
    } catch (error) {
      console.error("Error saving data:", error);
      this.showNotification("Error saving notes", "error");
    }
  }

  toggleSidebar() {
    const isVisible = !this.sidebar.classList.contains("-translate-x-full");

    if (isVisible) {
      this.sidebar.classList.add("-translate-x-full");
      this.sidebarOverlay.classList.add("opacity-0", "pointer-events-none");
      // a11y: Update ARIA states
      this.hamburgerBtn.setAttribute("aria-expanded", "false");
      this.sidebar.setAttribute("aria-hidden", "true");
      // a11y: Return focus to trigger
      this.hamburgerBtn.focus();
    } else {
      this.sidebar.classList.remove("-translate-x-full");
      this.sidebarOverlay.classList.remove("opacity-0", "pointer-events-none");
      // a11y: Update ARIA states
      this.hamburgerBtn.setAttribute("aria-expanded", "true");
      this.sidebar.setAttribute("aria-hidden", "false");
      // a11y: Focus first interactive element in sidebar
      setTimeout(() => this.newNoteBtn.focus(), 100);
    }
  }

  handleInput() {
    this.updateWordCount();
    this.scheduleAutoSave();
  }

  handleKeydown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = this.noteContent.selectionStart;
      const end = this.noteContent.selectionEnd;
      this.noteContent.value =
        this.noteContent.value.substring(0, start) +
        "    " +
        this.noteContent.value.substring(end);
      this.noteContent.selectionStart = this.noteContent.selectionEnd =
        start + 4;
    }
  }

  updateWordCount() {
    const text = this.noteContent.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;

    this.wordCount.textContent = `${words} word${words !== 1 ? "s" : ""}`;
    this.charCount.textContent = `${chars} character${chars !== 1 ? "s" : ""}`;
  }

  scheduleAutoSave() {
    clearTimeout(this.autoSaveTimeout);
    this.autoSaveStatus.textContent = "Saving...";

    this.autoSaveTimeout = setTimeout(() => {
      this.saveCurrentNote();
      this.autoSaveStatus.textContent = "Saved";
    }, 1000);
  }

  createNewNote() {
    const newNote = {
      id: Date.now().toString(),
      title: "Untitled Note",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.notes.unshift(newNote);
    // Performance: Add to cache immediately
    this.notesCache.set(newNote.id, newNote);
    this.currentNoteId = newNote.id;
    this.saveData();
    this.loadCurrentNote();
    this.renderNotesList();
    this.showNotification("New note created", "success");

    setTimeout(() => this.noteContent.focus(), 100);
  }

  async saveCurrentNote() {
    if (!this.currentNoteId) return;

    // Performance: O(1) lookup instead of O(n) find()
    const note = this.getNoteById(this.currentNoteId);
    if (note) {
      note.content = this.noteContent.value;
      note.updatedAt = new Date().toISOString();

      const firstLine = note.content.split("\n")[0].trim();
      if (firstLine && firstLine !== note.title && firstLine.length > 0) {
        note.title = firstLine.substring(0, 50) || "Untitled Note";
        this.noteTitle.textContent = note.title;
      }

      await this.saveData();
      // Performance: Update only the changed note in DOM
      this.updateNoteItemInDOM(note);
    }
  }

  loadCurrentNote() {
    if (!this.currentNoteId && this.notes.length > 0) {
      this.currentNoteId = this.notes[0].id;
    }

    // Performance: O(1) lookup instead of O(n) find()
    const note = this.getNoteById(this.currentNoteId);
    if (note) {
      this.noteContent.value = note.content;
      this.noteTitle.textContent = note.title;
      this.updateWordCount();
      this.autoSaveStatus.textContent = "Ready";
    }
  }

  async switchToNote(noteId) {
    await this.saveCurrentNote();
    this.currentNoteId = noteId;
    this.loadCurrentNote();
    // Performance: Update only active states, not full re-render
    this.updateActiveNoteState();
    await this.saveData();
  }

  showDeleteModal(noteId) {
    if (this.notes.length <= 1) {
      this.showNotification("Cannot delete the last note", "error");
      return;
    }

    // Performance: O(1) lookup
    const note = this.getNoteById(noteId);
    if (note) {
      // a11y: Store focus to restore later
      this.lastFocusedElement = document.activeElement;
      this.noteToDelete = noteId;
      this.deleteNoteTitle.textContent = note.title;
      this.deleteModal.classList.remove("hidden");
      // a11y: Update ARIA state
      this.deleteModal.setAttribute("aria-hidden", "false");
      // a11y: Focus the cancel button (safer default)
      setTimeout(() => this.cancelDelete.focus(), 100);
    }
  }

  hideDeleteModal() {
    this.deleteModal.classList.add("hidden");
    // a11y: Update ARIA state
    this.deleteModal.setAttribute("aria-hidden", "true");
    this.noteToDelete = null;
    // a11y: Restore focus
    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
      this.lastFocusedElement = null;
    }
  }

  async confirmDeleteNote() {
    if (!this.noteToDelete) return;

    try {
      // Performance: O(1) lookup
      const noteTitle = this.getNoteById(this.noteToDelete)?.title || "Note";

      // Performance: Remove from cache
      this.notesCache.delete(this.noteToDelete);

      // Performance: Remove DOM element directly
      this.removeNoteItemFromDOM(this.noteToDelete);

      this.notes = this.notes.filter((n) => n.id !== this.noteToDelete);

      if (this.currentNoteId === this.noteToDelete) {
        this.currentNoteId = this.notes[0]?.id || null;
        this.loadCurrentNote();
      }

      await this.saveData();
      // Update active state on remaining notes
      this.updateActiveNoteState();
      this.showNotification(`"${noteTitle}" deleted successfully`, "success");
    } catch (error) {
      this.showNotification("Error deleting note", "error");
    }

    this.hideDeleteModal();
  }

  showRenameModal(noteId) {
    // Performance: O(1) lookup
    const note = this.getNoteById(noteId);
    if (note) {
      // a11y: Store focus to restore later
      this.lastFocusedElement = document.activeElement;
      this.renameInput.value = note.title;
      this.renameInput.dataset.noteId = noteId;
      this.renameModal.classList.remove("hidden");
      // a11y: Update ARIA state
      this.renameModal.setAttribute("aria-hidden", "false");
      this.renameInput.focus();
      this.renameInput.select();
    }
  }

  hideRenameModal() {
    this.renameModal.classList.add("hidden");
    // a11y: Update ARIA state
    this.renameModal.setAttribute("aria-hidden", "true");
    delete this.renameInput.dataset.noteId;
    // a11y: Restore focus
    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
      this.lastFocusedElement = null;
    }
  }

  async confirmRenameNote() {
    const newTitle = this.renameInput.value.trim();
    const noteId = this.renameInput.dataset.noteId;

    if (!newTitle || !noteId) return;

    try {
      // Performance: O(1) lookup
      const note = this.getNoteById(noteId);
      if (note) {
        const oldTitle = note.title;
        note.title = newTitle;
        note.updatedAt = new Date().toISOString();
        await this.saveData();
        // Performance: Update only the changed note in DOM
        this.updateNoteItemInDOM(note);

        if (noteId === this.currentNoteId) {
          this.noteTitle.textContent = newTitle;
        }

        this.showNotification(
          `Note renamed from "${oldTitle}" to "${newTitle}"`,
          "success"
        );
      }
    } catch (error) {
      this.showNotification("Error renaming note", "error");
    }

    this.hideRenameModal();
  }

  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification flex items-center p-3 rounded-lg shadow-lg max-w-sm ${
      type === "success"
        ? "bg-green-500 text-white"
        : type === "error"
        ? "bg-red-500 text-white"
        : type === "warning"
        ? "bg-yellow-500 text-white"
        : "bg-blue-500 text-white"
    }`;

    const icon =
      type === "success"
        ? `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>`
        : type === "error"
        ? `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>`
        : type === "warning"
        ? `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                    </svg>`
        : `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>`;

    notification.innerHTML = `
                    ${icon}
                    <span class="text-sm font-medium message">${message}</span>
                    <button class="ml-auto hover:bg-black hover:bg-opacity-20 rounded p-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                `;

    // Add close button functionality
    const closeBtn = notification.querySelector("button");
    closeBtn.addEventListener("click", () =>
      this.hideNotification(notification)
    );

    this.notificationContainer.appendChild(notification);

    // Show notification with animation
    setTimeout(() => {
      notification.classList.add("show");
    }, 10);

    // Auto-hide after 4 seconds
    setTimeout(() => {
      this.hideNotification(notification);
    }, 4000);
  }

  hideNotification(notification) {
    notification.classList.add("hide");
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  exportNotes() {
    try {
      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        notes: this.notes,
        currentNoteId: this.currentNoteId,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `sylva-notes-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showNotification(
        `Exported ${this.notes.length} notes successfully!`,
        "success"
      );
      this.toggleSidebar();
    } catch (error) {
      console.error("Export error:", error);
      this.showNotification("Failed to export notes", "error");
    }
  }

  async importNotes(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // Validate the import data
      if (!importData.notes || !Array.isArray(importData.notes)) {
        throw new Error("Invalid backup file format");
      }

      // Confirm before overwriting
      const noteCount = importData.notes.length;
      const confirmImport = confirm(
        `This will import ${noteCount} notes and replace your current notes. Continue?`
      );

      if (!confirmImport) {
        this.importFileInput.value = "";
        return;
      }

      // Import the notes
      this.notes = importData.notes;
      this.currentNoteId =
        importData.currentNoteId || this.notes[0]?.id || null;

      await this.saveData();
      this.loadCurrentNote();
      this.renderNotesList();

      this.showNotification(
        `Imported ${noteCount} notes successfully!`,
        "success"
      );
      this.toggleSidebar();
    } catch (error) {
      console.error("Import error:", error);
      this.showNotification(
        "Failed to import notes. Invalid file format.",
        "error"
      );
    }

    // Reset the file input
    this.importFileInput.value = "";
  }

  renderNotesList() {
    this.notesList.innerHTML = "";
    // Performance: Clear element tracking
    this.renderedNoteElements.clear();

    this.notes.forEach((note) => {
      const noteItem = this.createNoteElement(note);
      // Performance: Track rendered element
      this.renderedNoteElements.set(note.id, noteItem);
      this.notesList.appendChild(noteItem);
    });
  }

  // Performance: Create a single note DOM element (reusable)
  createNoteElement(note) {
    const noteItem = document.createElement("div");
    noteItem.className = `p-2 rounded-lg cursor-pointer transition-colors note-item ${
      note.id === this.currentNoteId ? "active border" : "hover:bg-gray-100"
    }`;
    noteItem.dataset.noteId = note.id;
    // a11y: Make note item focusable and add listbox role
    noteItem.setAttribute("tabindex", "0");
    noteItem.setAttribute("role", "option");
    noteItem.setAttribute(
      "aria-selected",
      note.id === this.currentNoteId ? "true" : "false"
    );

    const preview =
      note.content.substring(0, 40).replace(/\n/g, " ") || "Empty note";
    const updatedDate = new Date(note.updatedAt).toLocaleDateString();

    noteItem.innerHTML = `
      <div class="flex justify-between">
        <div class="flex-1 min-w-0 note-content-area" data-note-id="${note.id}">
          <div class="text-sm font-medium text-gray-800 truncate note-title">${note.title}</div>
          <div class="text-xs text-gray-500 mt-1 truncate subtitle note-preview">${preview}</div>
          <div class="text-xs text-gray-400 mt-1 note-date">${updatedDate}</div>
        </div>
        <div class="flex justify-center items-center gap-2 note-icons ml-2">
          <button class="rename-note-btn w-fit p-2 text-left hover:bg-gray-100 rounded-lg transition-colors menu-item flex items-center space-x-2" data-note-id="${note.id}" aria-label="Rename note: ${note.title}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
          <button class="delete-note-btn w-fit p-2 text-left hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors menu-item flex items-center space-x-2" data-note-id="${note.id}" aria-label="Delete note: ${note.title}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Bind events
    const noteContentArea = noteItem.querySelector(".note-content-area");
    noteContentArea.addEventListener("click", () => {
      this.switchToNote(note.id);
      this.toggleSidebar();
    });

    const renameBtn = noteItem.querySelector(".rename-note-btn");
    const deleteBtn = noteItem.querySelector(".delete-note-btn");

    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showRenameModal(note.id);
      this.toggleSidebar();
    });

    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showDeleteModal(note.id);
      this.toggleSidebar();
    });

    return noteItem;
  }

  // Performance: Update only the specific note's content in DOM
  updateNoteItemInDOM(note) {
    const existingElement = this.renderedNoteElements.get(note.id);
    if (!existingElement) return;

    // Update text content only, not the entire element
    const titleEl = existingElement.querySelector(".note-title");
    const previewEl = existingElement.querySelector(".note-preview");
    const dateEl = existingElement.querySelector(".note-date");

    if (titleEl) titleEl.textContent = note.title;
    if (previewEl) {
      const preview =
        note.content.substring(0, 40).replace(/\n/g, " ") || "Empty note";
      previewEl.textContent = preview;
    }
    if (dateEl) {
      dateEl.textContent = new Date(note.updatedAt).toLocaleDateString();
    }
  }

  // Performance: Remove a single note from DOM without re-rendering
  removeNoteItemFromDOM(noteId) {
    const element = this.renderedNoteElements.get(noteId);
    if (element) {
      element.remove();
      this.renderedNoteElements.delete(noteId);
    }
  }

  // Performance: Update active state on all notes (when switching notes)
  updateActiveNoteState() {
    this.renderedNoteElements.forEach((element, noteId) => {
      if (noteId === this.currentNoteId) {
        element.classList.add("active", "border");
        element.classList.remove("hover:bg-gray-100");
      } else {
        element.classList.remove("active", "border");
        element.classList.add("hover:bg-gray-100");
      }
    });
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  new SylvaNotePad();
});
