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

    this.initializeElements();
    this.bindEvents();
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
    } else {
      this.sidebar.classList.remove("-translate-x-full");
      this.sidebarOverlay.classList.remove("opacity-0", "pointer-events-none");
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
    await this.saveData();
  }

  showDeleteModal(noteId) {
    if (this.notes.length <= 1) {
      this.showNotification("Cannot delete the last note", "error");
      return;
    }

    const note = this.notes.find((n) => n.id === noteId);
    if (note) {
      this.noteToDelete = noteId;
      this.deleteNoteTitle.textContent = note.title;
      this.deleteModal.classList.remove("hidden");
    }
  }

  hideDeleteModal() {
    this.deleteModal.classList.add("hidden");
    this.noteToDelete = null;
  }

  async confirmDeleteNote() {
    if (!this.noteToDelete) return;

    try {
      const noteTitle =
        this.notes.find((n) => n.id === this.noteToDelete)?.title || "Note";
      this.notes = this.notes.filter((n) => n.id !== this.noteToDelete);

      if (this.currentNoteId === this.noteToDelete) {
        this.currentNoteId = this.notes[0]?.id || null;
        this.loadCurrentNote();
      }

      await this.saveData();
      this.renderNotesList();
      this.showNotification(`"${noteTitle}" deleted successfully`, "success");
    } catch (error) {
      this.showNotification("Error deleting note", "error");
    }

    this.hideDeleteModal();
  }

  showRenameModal(noteId) {
    const note = this.notes.find((n) => n.id === noteId);
    if (note) {
      this.renameInput.value = note.title;
      this.renameInput.dataset.noteId = noteId;
      this.renameModal.classList.remove("hidden");
      this.renameInput.focus();
      this.renameInput.select();
    }
  }

  hideRenameModal() {
    this.renameModal.classList.add("hidden");
    delete this.renameInput.dataset.noteId;
  }

  async confirmRenameNote() {
    const newTitle = this.renameInput.value.trim();
    const noteId = this.renameInput.dataset.noteId;

    if (!newTitle || !noteId) return;

    try {
      const note = this.notes.find((n) => n.id === noteId);
      if (note) {
        const oldTitle = note.title;
        note.title = newTitle;
        note.updatedAt = new Date().toISOString();
        await this.saveData();
        this.renderNotesList();

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

    this.notes.forEach((note) => {
      const noteItem = document.createElement("div");
      noteItem.className = `p-2 rounded-lg cursor-pointer transition-colors note-item ${
        note.id === this.currentNoteId ? "active border" : "hover:bg-gray-100"
      }`;

      const preview =
        note.content.substring(0, 40).replace(/\n/g, " ") || "Empty note";
      const updatedDate = new Date(note.updatedAt).toLocaleDateString();

      noteItem.innerHTML = `
                        <div class="flex justify-between">
                            <div class="flex-1 min-w-0" data-note-id="${note.id}">
                                <div class="text-sm font-medium text-gray-800 truncate">${note.title}</div>
                                <div class="text-xs text-gray-500 mt-1 truncate subtitle">${preview}</div>
                                <div class="text-xs text-gray-400 mt-1">${updatedDate}</div>
                            </div>

                            <div class="flex justify-center items-center gap-2 note-icons ml-2">
                                <button class="rename-note-btn w-fit p-2 text-left hover:bg-gray-100 rounded-lg transition-colors menu-item flex items-center space-x-2" data-note-id="${note.id}">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                                    </svg>
                                </button>
                                <button class="delete-note-btn w-fit p-2 text-left hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors menu-item flex items-center space-x-2" data-note-id="${note.id}">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;

      const noteContentArea = noteItem.querySelector("[data-note-id]");
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

      this.notesList.appendChild(noteItem);
    });
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  new SylvaNotePad();
});
