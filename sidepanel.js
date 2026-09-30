class RenNotePad {
  constructor() {
    this.notes = [];
    this.currentNoteId = null;
    this.dataLoadFailed = false;
    this.importInProgress = false;
    this.autoSaveTimeout = null;
    this.editRevision = 0;
    this.savedRevision = 0;
    this.flushSavePromise = null;
    this.instanceId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.storageConflict = false;
    this.saveQueue = Promise.resolve();
    this.sidebarUpdateTimeout = null; // Separate debounce for UI updates
    this.noteToDelete = null;

    // Performance: Map-based cache for O(1) note lookups
    this.notesCache = new Map();
    this.persistedNotes = new Map();
    // Performance: Track rendered DOM elements by note ID
    this.renderedNoteElements = new Map();

    // Storage module
    this.storage = renStorage;

    // Keyboard shortcuts configuration
    this.keyboardShortcuts = [
      {
        keys: "Alt+Shift+S",
        action: "openExtension",
        description: "Open Ren",
        scope: "browser",
      },
      {
        keys: "Ctrl+Alt+N",
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
      { keys: "Ctrl+,", action: "openSettings", description: "Open settings" },
      { keys: "Ctrl+F", action: "focusSearch", description: "Search notes" },
      {
        keys: "Ctrl+/",
        action: "showShortcutsHelp",
        description: "Show keyboard shortcuts",
      },
      {
        keys: "Ctrl+Alt+C",
        action: "insertCheckbox",
        description: "Insert checkbox",
      },
      { keys: "Ctrl+Z", action: "undo", description: "Undo" },
      { keys: "Ctrl+Y", action: "redo", description: "Redo" },
      { keys: "Ctrl+Shift+Z", action: "redo", description: "Redo" },
    ];
    this.shortcutsHelpVisible = false;

    // Theme (will be loaded async)
    this.currentTheme = "system";

    this.initializeElements();
    this.bindEvents();
    this.initializeSidebarResize();
    this.bindKeyboardShortcuts();

    // Async initialization
    this.init().catch((error) => {
      console.error("Error initializing Ren:", error);
      this.handleLoadFailure();
    });
  }

  handleLoadFailure() {
    this.dataLoadFailed = true;
    this.autoSaveStatus.textContent = "Could not load notes";
    this.noteContent.setAttribute("contenteditable", "false");
    this.editor?.setEditable?.(false);
    this.newNoteBtn.disabled = true;
    this.showNotification("Could not load notes. Reopen Ren to retry.", "error");
  }

  async init() {
    // Initialize storage (handles migration)
    await this.storage.initialize();

    // Load theme from storage
    this.currentTheme = await this.storage.getTheme();
    this.initializeTheme();

    // Load data
    await this.loadData();
    this.unsubscribeStorageChanges = this.storage.subscribeToLocalChanges(
      (changes) => {
        this.handleStorageChanges(changes).catch((error) => {
          console.error("Could not process external storage change:", error);
        });
      },
    );
  }

  initializeElements() {
    this.hamburgerBtn = document.getElementById("hamburgerBtn");
    this.sidebar = document.getElementById("sidebar");
    this.sidebarOverlay = document.getElementById("sidebarOverlay");
    this.closeSidebar = document.getElementById("closeSidebar");
    this.noteContent = document.getElementById("noteContent");
    this.noteTitle = document.getElementById("noteTitle");
    this.noteTitleInput = document.getElementById("noteTitleInput");
    this.wordCount = document.getElementById("wordCount");
    this.charCount = document.getElementById("charCount");
    this.autoSaveStatus = document.getElementById("autoSaveStatus");
    this.saveRecoveryExportBtn = document.getElementById("saveRecoveryExportBtn");
    this.notesList = document.getElementById("notesList");
    this.newNoteBtn = document.getElementById("newNoteBtn");

    // Rich editor toolbar
    this.editorToolbar = document.querySelector(".editor-toolbar");

    // Undo/Redo buttons
    this.undoBtn = this.editorToolbar?.querySelector('[data-action="undo"]');
    this.redoBtn = this.editorToolbar?.querySelector('[data-action="redo"]');

    // Undo/Redo state tracking
    this.canUndo = false;
    this.canRedo = false;

    // Initialize rich editor
    if (this.noteContent && typeof RenEditor !== "undefined") {
      this.editor = new RenEditor(this.noteContent, {
        placeholder:
          "Start writing... (Try # for headings, ** for bold, - for lists)",
        onInput: () => this.updateWordCount(),
        onChange: () => {
          this.scheduleAutoSave();
        },
        onHistoryChange: ({ canUndo, canRedo }) => {
          this.canUndo = canUndo;
          this.canRedo = canRedo;
          this.updateUndoRedoButtons();
        },
      });
      this.noteContent = this.editor.element;
    }

    // Initialize undo/redo button states
    this.updateUndoRedoButtons();

    // Settings and import elements
    this.settingsBtn = document.getElementById("settingsBtn");
    this.importFileInput = document.getElementById("importFileInput");
    this.shortcutsInfoBtn = document.getElementById("shortcutsInfoBtn");

    // Search elements
    this.searchInput = document.getElementById("searchInput");
    this.clearSearchBtn = document.getElementById("clearSearchBtn");
    this.searchQuery = "";

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
      "notificationContainer",
    );

    // Settings modal state
    this.settingsModalVisible = false;
  }

  bindEvents() {
    this.hamburgerBtn.addEventListener("click", () => this.toggleSidebar());
    this.closeSidebar.addEventListener("click", () => this.toggleSidebar());
    this.sidebarOverlay.addEventListener("click", () => this.toggleSidebar());

    // Note: Input events are handled by RenEditor's onChange callback
    // But we still need keydown for Tab handling etc.
    this.noteContent.addEventListener("keydown", (e) => this.handleKeydown(e));

    this.newNoteBtn.addEventListener("click", () => {
      this.createNewNote();
      this.toggleSidebar();
    });

    // Editor toolbar actions
    if (this.editorToolbar && this.editor) {
      this.editorToolbar
        .querySelectorAll(".editor-toolbar-btn")
        .forEach((btn) => {
          btn.addEventListener("mousedown", (event) => event.preventDefault());
          btn.addEventListener("click", (e) => {
            const action = btn.dataset.action;
            // Handle the "More" button separately
            if (btn.id === "toolbarMoreBtn") {
              e.stopPropagation();
              this.toggleToolbarDropdown();
              this.hideHeadingsDropdown();
              this.hideListsDropdown();
              return;
            }
            // Handle the "Headings" button separately
            if (btn.id === "toolbarHeadingsBtn") {
              e.stopPropagation();
              this.toggleHeadingsDropdown();
              this.hideToolbarDropdown();
              this.hideListsDropdown();
              return;
            }
            // Handle the "Lists" button separately
            if (btn.id === "toolbarListsBtn") {
              e.stopPropagation();
              this.toggleListsDropdown();
              this.hideToolbarDropdown();
              this.hideHeadingsDropdown();
              return;
            }
            this.handleToolbarAction(action);
            this.noteContent.focus();
          });
        });

      // Handle toolbar dropdown items (More, Headings, and Lists)
      const dropdownItems = this.editorToolbar.querySelectorAll(
        ".toolbar-dropdown-item",
      );
      dropdownItems.forEach((item) => {
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("click", () => {
          const action = item.dataset.action;
          this.handleToolbarAction(action);
          this.hideToolbarDropdown();
          this.hideHeadingsDropdown();
          this.hideListsDropdown();
          this.noteContent.focus();
        });
      });

      // Close dropdowns when clicking outside
      document.addEventListener("click", (e) => {
        const moreBtn = document.getElementById("toolbarMoreBtn");
        const moreMenu = document.getElementById("toolbarMoreMenu");
        const headingsBtn = document.getElementById("toolbarHeadingsBtn");
        const headingsMenu = document.getElementById("toolbarHeadingsMenu");
        const listsBtn = document.getElementById("toolbarListsBtn");
        const listsMenu = document.getElementById("toolbarListsMenu");

        // Close More dropdown
        if (
          moreBtn &&
          moreMenu &&
          !moreBtn.contains(e.target) &&
          !moreMenu.contains(e.target)
        ) {
          this.hideToolbarDropdown();
        }

        // Close Headings dropdown
        if (
          headingsBtn &&
          headingsMenu &&
          !headingsBtn.contains(e.target) &&
          !headingsMenu.contains(e.target)
        ) {
          this.hideHeadingsDropdown();
        }

        // Close Lists dropdown
        if (
          listsBtn &&
          listsMenu &&
          !listsBtn.contains(e.target) &&
          !listsMenu.contains(e.target)
        ) {
          this.hideListsDropdown();
        }
      });
    }

    // Settings button (with null check)
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener("click", () => {
        this.showSettingsModal();
        this.toggleSidebar();
      });
    }

    // Import file input
    this.importFileInput.addEventListener("change", (e) => this.importNotes(e));

    // Shortcuts info button (with null check)
    if (this.shortcutsInfoBtn) {
      this.shortcutsInfoBtn.addEventListener("click", () =>
        this.showShortcutsHelp(),
      );
    }
    this.saveRecoveryExportBtn?.addEventListener("click", () =>
      this.exportNotes(),
    );

    // Editable title - click to edit (with null check)
    if (this.noteTitle && this.noteTitleInput) {
      this.noteTitle.addEventListener("click", () => this.startEditingTitle());
      this.noteTitle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.startEditingTitle();
        }
      });
      this.noteTitleInput.addEventListener("blur", () =>
        this.finishEditingTitle(),
      );
      this.noteTitleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.finishEditingTitle();
          this.noteTitle.focus();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.cancelEditingTitle();
          this.noteTitle.focus();
        }
      });
    }

    // Search events
    if (this.searchInput) {
      this.searchInput.addEventListener("input", () => this.handleSearch());
      this.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.clearSearch();
          this.searchInput.blur();
        }
      });
    }
    if (this.clearSearchBtn) {
      this.clearSearchBtn.addEventListener("click", () => this.clearSearch());
    }

    // Rename modal events
    this.cancelRename.addEventListener("click", () => this.hideRenameModal());
    this.confirmRename.addEventListener("click", () =>
      this.confirmRenameNote(),
    );
    this.renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.confirmRenameNote();
      if (e.key === "Escape") { e.preventDefault(); this.hideRenameModal(); }
    });

    // Delete modal events
    this.cancelDelete.addEventListener("click", () => this.hideDeleteModal());
    this.confirmDelete.addEventListener("click", () =>
      this.confirmDeleteNote(),
    );

    // a11y: Delete modal keyboard handling
    this.deleteModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.hideDeleteModal(); }
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
      this.handleNotesListKeydown(e),
    );

    // a11y: Global Escape key to close sidebar
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (this.shortcutsHelpVisible) {
          this.hideShortcutsHelp();
        } else if (this.settingsModalVisible) {
          this.hideSettingsModal();
        } else if (!this.renameModal.classList.contains("hidden")) {
          this.hideRenameModal();
        } else if (!this.deleteModal.classList.contains("hidden")) {
          this.hideDeleteModal();
        } else if (!this.sidebar.classList.contains("-translate-x-full")) {
          this.toggleSidebar();
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushPendingSave();
    });
    window.addEventListener("pagehide", () => this.flushPendingSave());
  }

  // a11y: Focus trap for modals
  trapFocus(e, container) {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
        item === document.activeElement ||
        item.contains(document.activeElement),
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
    if (e.defaultPrevented || e.isComposing || e.getModifierState?.("AltGraph")) return;
    const target = document.activeElement;
    const inEditor = target === this.noteContent || this.noteContent.contains(target);
    if (document.querySelector('[role="dialog"]:not(.hidden):not([aria-hidden="true"])')) return;
    // Build the key combination string
    const combo = [];
    if (e.ctrlKey || e.metaKey) combo.push("Ctrl");
    if (e.shiftKey) combo.push("Shift");
    if (e.altKey) combo.push("Alt");

    // Normalize key - handle special characters properly
    let key = e.altKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : e.key;
    if (key === " ") key = "Space";
    // Keep special keys as-is, uppercase letters
    if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      key = key.toUpperCase();
    }
    combo.push(key);

    const pressedCombo = combo.join("+");

    // Debug: uncomment to see what's being pressed
    // console.log("Pressed:", pressedCombo);

    // Find matching shortcut
    const shortcut = this.keyboardShortcuts.find((s) => {
      const normalizedKeys = s.keys.replace(/\s/g, "");
      return s.scope !== "browser" && normalizedKeys.toLowerCase() === pressedCombo.toLowerCase();
    });

    if (shortcut) {
      if (["undo", "redo", "insertCheckbox"].includes(shortcut.action) && !inEditor) return;
      // Check if typing in an input
      const isTyping = ["INPUT", "TEXTAREA"].includes(
        document.activeElement.tagName,
      );

      // Always allow these shortcuts, even when typing
      const alwaysAllowed = [
        "forceSave",
        "showShortcutsHelp",
        "toggleSidebar",
        "openSettings",
        "focusSearch",
        "insertCheckbox",
        "undo",
        "redo",
      ];

      if (isTyping && !alwaysAllowed.includes(shortcut.action)) {
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
        if (this.dataLoadFailed) return;
        if (document.activeElement === this.noteTitleInput) {
          this.finishEditingTitle();
          this.noteTitle.focus();
        }
        clearTimeout(this.autoSaveTimeout);
        this.saveCurrentNoteWithStatus({ notifySuccess: true });
        break;
      case "exportNotes":
        this.exportNotes();
        break;
      case "toggleSidebar":
        this.toggleSidebar();
        break;
      case "openSettings":
        this.showSettingsModal();
        break;
      case "focusSearch":
        this.focusSearch();
        break;
      case "showShortcutsHelp":
        this.toggleShortcutsHelp();
        break;
      case "insertCheckbox":
        if (this.editor) {
          this.editor.execCheckbox();
        }
        break;
      case "undo":
        this.editor?.execUndo();
        break;
      case "redo":
        this.editor?.execRedo();
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
      modal.className = "shortcuts-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "shortcutsHelpTitle");

      const shortcuts = this.keyboardShortcuts
        .map(
          (s) => `
          <div class="shortcut-item">
            <span class="shortcut-description">${s.description}</span>
            <kbd class="shortcut-keys">${s.keys}</kbd>
          </div>
        `,
        )
        .join("");

      modal.innerHTML = `
        <div class="shortcuts-modal-content" role="document">
          <div class="shortcuts-modal-header">
            <h3 id="shortcutsHelpTitle" class="shortcuts-modal-title">Keyboard Shortcuts</h3>
            <button id="closeShortcutsHelp" class="shortcuts-modal-close" aria-label="Close shortcuts help">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="shortcuts-list">
            ${shortcuts}
          </div>
          <div class="shortcuts-modal-footer">
            <p class="shortcuts-modal-hint">Press Escape to close</p>
          </div>
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
        if (e.key === "Escape") { e.preventDefault(); this.hideShortcutsHelp(); }
      });
    }

    modal.classList.add("visible");
    modal.setAttribute("aria-hidden", "false");
    this.shortcutsHelpVisible = true;
    this.lastFocusedElement = document.activeElement;

    // Focus close button
    modal.querySelector("#closeShortcutsHelp").focus();
  }

  // Keyboard Shortcuts: Hide help modal
  hideShortcutsHelp() {
    const modal = document.getElementById("shortcutsHelpModal");
    if (modal) {
      modal.classList.remove("visible");
      modal.setAttribute("aria-hidden", "true");
    }
    this.shortcutsHelpVisible = false;

    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
    }
  }

  // Editable Title: Start editing the note title
  startEditingTitle() {
    if (!this.noteTitle || !this.noteTitleInput) return;
    this.noteTitle.classList.add("hidden");
    this.noteTitleInput.classList.remove("hidden");
    this.noteTitleInput.value = this.noteTitle.textContent;
    this.noteTitleInput.focus();
    this.noteTitleInput.select();
  }

  // Editable Title: Finish editing and save
  finishEditingTitle() {
    if (!this.noteTitle || !this.noteTitleInput) return;
    if (this.noteTitleInput.classList.contains("hidden")) return;
    const newTitle = this.noteTitleInput.value.trim() || "Untitled";
    if (this.currentNoteId) {
      const note = this.getNoteById(this.currentNoteId);
      if (note && (
        newTitle !== note.title ||
        note.titleSource === "suggested" ||
        (note.titleSource === "default" && !this.noteTitleInput.value.trim())
      )) {
        note.title = newTitle;
        note.titleSource = "manual";
        note.updatedAt = new Date().toISOString();
        this.noteTitle.textContent = newTitle;
        const revision = ++this.editRevision;
        this.setSaveStatus("Saving...");
        this.saveNoteData(note)
          .then(() => {
            this.savedRevision = Math.max(this.savedRevision, revision);
            if (revision === this.editRevision) {
              this.setSaveStatus("Saved");
            }
            this.showNotification("Title updated", "success");
          })
          .catch(() => {
            if (revision === this.editRevision) {
              this.setSaveStatus(this.storageConflict
                ? "Changed elsewhere"
                : "Could not save");
            }
          });
        this.updateNoteItemInDOM(note);
      }
    }
    this.noteTitleInput.classList.add("hidden");
    this.noteTitle.classList.remove("hidden");
  }

  // Editable Title: Cancel editing
  cancelEditingTitle() {
    if (!this.noteTitle || !this.noteTitleInput) return;
    if (this.noteTitleInput.classList.contains("hidden")) return;
    this.noteTitleInput.classList.add("hidden");
    this.noteTitle.classList.remove("hidden");
    this.noteTitleInput.blur();
  }

  // Search: Handle search input
  handleSearch() {
    this.searchQuery = this.searchInput.value.trim().toLowerCase();

    // Show/hide clear button
    if (this.clearSearchBtn) {
      if (this.searchQuery) {
        this.clearSearchBtn.classList.remove("hidden");
      } else {
        this.clearSearchBtn.classList.add("hidden");
      }
    }

    this.renderNotesList();
  }

  // Search: Clear search input and results
  clearSearch() {
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    if (this.clearSearchBtn) {
      this.clearSearchBtn.classList.add("hidden");
    }
    this.renderNotesList();
  }

  // Search: Filter notes based on query
  filterNotes() {
    if (!this.searchQuery) {
      return this.notes;
    }

    return this.notes.filter((note) => {
      const titleMatch = note.title.toLowerCase().includes(this.searchQuery);
      const contentMatch = note.content
        .toLowerCase()
        .includes(this.searchQuery);
      return titleMatch || contentMatch;
    });
  }

  // Search: Highlight matching text without parsing it as markup.
  appendHighlightedText(element, text, query) {
    element.textContent = "";
    if (!query) {
      element.textContent = text;
      return;
    }

    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    let cursor = 0;
    while (cursor < text.length) {
      const match = normalizedText.indexOf(normalizedQuery, cursor);
      if (match === -1) {
        element.appendChild(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (match > cursor) {
        element.appendChild(document.createTextNode(text.slice(cursor, match)));
      }
      const highlight = document.createElement("span");
      highlight.className = "search-highlight";
      highlight.textContent = text.slice(match, match + query.length);
      element.appendChild(highlight);
      cursor = match + query.length;
    }
  }

  // Search: Focus search input (opens sidebar if closed)
  focusSearch() {
    // Open sidebar if closed
    if (this.sidebar.classList.contains("-translate-x-full")) {
      this.toggleSidebar();
    }
    // Focus search input
    if (this.searchInput) {
      setTimeout(() => {
        this.searchInput.focus();
        this.searchInput.select();
      }, 150);
    }
  }

  // Settings Modal: Show settings
  showSettingsModal() {
    let modal = document.getElementById("settingsModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "settingsModal";
      modal.className =
        "fixed inset-0 bg-black bg-opacity-50 z-60 flex items-center justify-center";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "settingsTitle");

      modal.innerHTML = `
        <div class="settings-modal-content" role="document">
          <div class="settings-header">
            <h3 id="settingsTitle" class="settings-title">Settings</h3>
            <button id="closeSettings" class="settings-close-btn" aria-label="Close settings">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <!-- Theme Toggle -->
          <div class="settings-section">
            <label class="settings-label">Theme</label>
            <div class="theme-toggle-group">
              <button id="themeLight" class="theme-btn ${
                this.currentTheme === "light" ? "active" : ""
              }" data-theme="light">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
                </svg>
                Light
              </button>
              <button id="themeDark" class="theme-btn ${
                this.currentTheme === "dark" ? "active" : ""
              }" data-theme="dark">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
                </svg>
                Dark
              </button>
              <button id="themeSystem" class="theme-btn ${
                this.currentTheme === "system" ? "active" : ""
              }" data-theme="system">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
                System
              </button>
            </div>
          </div>
          
          <div class="settings-section">
            <label class="settings-label">Data</label>
            <div class="settings-buttons">
              <button id="settingsExportBtn" class="settings-action-btn">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg>
                <div>
                  <div class="settings-btn-title">Export Notes</div>
                  <div class="settings-btn-desc">Download a copy of your notes</div>
                </div>
              </button>
              <button id="settingsImportBtn" class="settings-action-btn">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                </svg>
                <div>
                  <div class="settings-btn-title">Import Notes</div>
                  <div class="settings-btn-desc">Load notes from a JSON file</div>
                </div>
              </button>
              <button id="settingsRestoreImportBtn" class="settings-action-btn hidden">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h11a4 4 0 014 4v1m-15-5l4-4m-4 4l4 4m11 3v.01"></path>
                </svg>
                <div>
                  <div class="settings-btn-title">Restore Before Import</div>
                  <div class="settings-btn-desc">Restore notes saved before the latest import</div>
                </div>
              </button>
            </div>
            <p class="settings-backup-reminder">Notes are stored in this browser. Export a copy regularly and keep the file somewhere safe.</p>
          </div>
          
          <div class="settings-footer">
            <p class="settings-version">
              Ren v${chrome.runtime.getManifest().version} • <button id="settingsShortcutsBtn" class="settings-link">Keyboard Shortcuts</button>
            </p>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Bind events
      modal
        .querySelector("#closeSettings")
        .addEventListener("click", () => this.hideSettingsModal());
      modal
        .querySelector("#settingsExportBtn")
        .addEventListener("click", () => {
          this.exportNotes();
          this.hideSettingsModal();
        });
      modal
        .querySelector("#settingsImportBtn")
        .addEventListener("click", () => {
          this.importFileInput.click();
          this.hideSettingsModal();
        });
      modal
        .querySelector("#settingsRestoreImportBtn")
        .addEventListener("click", () => {
          this.hideSettingsModal();
          this.restoreImportBackup();
        });
      modal
        .querySelector("#settingsShortcutsBtn")
        .addEventListener("click", () => {
          this.hideSettingsModal();
          this.showShortcutsHelp();
        });

      // Theme toggle buttons
      modal.querySelectorAll(".theme-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const theme = btn.dataset.theme;
          this.setTheme(theme);
          // Update active state
          modal
            .querySelectorAll(".theme-btn")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.hideSettingsModal();
      });
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); this.hideSettingsModal(); }
      });
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    this.updateImportBackupControl(modal);
    this.settingsModalVisible = true;
    this.lastFocusedElement = document.activeElement;

    modal.querySelector("#closeSettings").focus();
  }

  // Settings Modal: Hide settings
  hideSettingsModal() {
    const modal = document.getElementById("settingsModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
    this.settingsModalVisible = false;

    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
    }
  }

  async updateImportBackupControl(modal) {
    const button = modal?.querySelector("#settingsRestoreImportBtn");
    if (!button) return;
    button.disabled = true;
    try {
      const backup = await this.storage.getPreImportBackupInfo();
      button.classList.toggle("hidden", !backup);
      if (backup) {
        const description = button.querySelector(".settings-btn-desc");
        description.textContent = `Restore ${backup.storedNoteCount} note${
          backup.storedNoteCount === 1 ? "" : "s"
        } saved before the latest import`;
      }
    } catch (error) {
      console.error("Could not read import backup metadata:", error);
      button.classList.add("hidden");
    } finally {
      button.disabled = false;
    }
  }

  async restoreImportBackup() {
    if (this.dataLoadFailed || this.importInProgress || this.storageConflict) return;
    if (!confirm("Restore the notes saved before your latest import?")) return;

    clearTimeout(this.autoSaveTimeout);
    this.importInProgress = true;
    const previousEditable =
      this.noteContent?.getAttribute?.("contenteditable") ?? "true";
    this.noteContent?.setAttribute?.("contenteditable", "false");
    this.editor?.setEditable?.(false);
    try {
      await this.queueStorageSave(() =>
        this.storage.restorePreImportBackup(this.persistedNotebook()),
      );
      const restoredNotes = await this.storage.getAllNotes();
      const restoredCurrentNoteId = await this.storage.getCurrentNoteId();
      this.notes = restoredNotes;
      this.currentNoteId = restoredCurrentNoteId;
      this.editRevision++;
      this.savedRevision = this.editRevision;
      this.recordPersistedNotes(restoredNotes);
      this.rebuildCache();
      this.loadCurrentNote();
      this.renderNotesList();
      this.showNotification("Restored the pre-import backup.", "success");
    } catch (error) {
      console.error("Pre-import restore error:", error);
      this.showNotification("Could not restore the pre-import backup.", "error");
    } finally {
      this.importInProgress = false;
      this.noteContent?.setAttribute?.("contenteditable", previousEditable);
      this.editor?.setEditable?.(previousEditable !== "false");
    }
  }

  // Theme: Initialize theme on load
  initializeTheme() {
    this.applyTheme(this.currentTheme);

    // Listen for system preference changes
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (this.currentTheme === "system") {
          this.applyTheme("system");
        }
      });
  }

  // Theme: Set and persist theme preference
  async setTheme(theme) {
    this.currentTheme = theme;
    await this.storage.setTheme(theme);
    this.applyTheme(theme);
    this.showNotification(`Theme set to ${theme}`, "success");
  }

  // Theme: Apply theme to document
  applyTheme(theme) {
    const root = document.documentElement;

    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }

  // Onboarding: Show welcome screen for first-time users
  showWelcomeScreen() {
    let modal = document.getElementById("welcomeModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "welcomeModal";
      modal.className =
        "fixed inset-0 bg-black bg-opacity-50 z-60 flex items-center justify-center";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "welcomeTitle");

      modal.innerHTML = `
        <div class="welcome-modal-content" role="document">
          <div class="welcome-logo" role="img" aria-label="Ren"></div>
          <h2 id="welcomeTitle" class="welcome-title">Welcome to Ren</h2>
          <p class="welcome-subtitle">Your minimalist notepad for quick thoughts, ideas, and more.</p>
          
          <div class="welcome-features">
            <div class="welcome-feature-item">
              <div class="welcome-feature-icon">
                <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <p class="welcome-feature-text"><strong>Auto-save</strong> - Your notes save automatically as you type</p>
            </div>
            <div class="welcome-feature-item">
              <div class="welcome-feature-icon">
                <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path>
                </svg>
              </div>
              <p class="welcome-feature-text"><strong>Multiple notes</strong> - Create and organize unlimited notes</p>
            </div>
            <div class="welcome-feature-item">
              <div class="welcome-feature-icon">
                <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
                </svg>
              </div>
              <p class="welcome-feature-text"><strong>Keyboard shortcuts</strong> - Press <kbd class="welcome-kbd">Ctrl+/</kbd> anytime</p>
            </div>
          </div>
          
          <button id="startWritingBtn" class="welcome-btn">
            Start Writing
          </button>
        </div>
      `;

      document.body.appendChild(modal);

      // Bind start button
      modal.querySelector("#startWritingBtn").addEventListener("click", () => {
        this.completeOnboarding();
      });
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    setTimeout(() => modal.querySelector("#startWritingBtn").focus(), 100);
  }

  // Onboarding: Complete onboarding and create first note
  async completeOnboarding() {
    await this.storage.completeOnboarding();

    const modal = document.getElementById("welcomeModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }

    // Create the first note with welcome content
    const welcomeNote = {
      id: this.createNoteId(),
      title: "Welcome to Ren! 🌿",
      content: `Welcome to Ren! 🌿

This is your first note. Here are some tips to get started:

• Start typing to capture your thoughts
• Your notes auto-save as you write
• Click the ☰ menu to see all your notes
• Click on the note title above to edit it
• Your notes sync across devices!

Keyboard shortcuts:
• Ctrl+Alt+N - Create new note
• Ctrl+S - Save note
• Ctrl+/ - View all shortcuts

Happy writing! ✨`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.notes.unshift(welcomeNote);
    this.notesCache.set(welcomeNote.id, welcomeNote);
    this.currentNoteId = welcomeNote.id;
    await this.saveData();
    this.loadCurrentNote();
    this.renderNotesList();

    setTimeout(() => this.noteContent.focus(), 100);
  }

  async loadData() {
    try {
      // Check if first-time user
      const hasSeenOnboarding = await this.storage.isOnboardingComplete();

      // Load notes from chrome.storage
      this.notes = await this.storage.getAllNotes();
      this.currentNoteId = await this.storage.getCurrentNoteId();
      this.recordPersistedNotes(this.notes);

      // Performance: Rebuild cache after loading
      this.rebuildCache();

      if (this.notes.length === 0) {
        // First time user or no notes
        if (!hasSeenOnboarding) {
          this.showWelcomeScreen();
        } else {
          await this.createNewNote();
        }
      } else {
        this.loadCurrentNote();
      }
      this.renderNotesList();
      this.savedRevision = this.editRevision;
    } catch (error) {
      console.error("Error loading data:", error);
      this.handleLoadFailure();
    }
  }

  captureCurrentEditorContent() {
    if (!this.currentNoteId) return;
    const note = this.getNoteById(this.currentNoteId);
    if (!note) return;
    if (this.editor?.changed && typeof note.originalContent !== "string") {
      note.originalContent = this.editor.sourceHTML;
    }
    note.content = this.editor
      ? (this.editor.getHTML?.() ?? this.noteContent.innerHTML)
      : this.noteContent.value;
  }

  enterStorageConflict() {
    this.captureCurrentEditorContent();
    if (this.storageConflict) return;
    clearTimeout(this.autoSaveTimeout);
    this.storageConflict = true;
    this.setSaveStatus("Changed elsewhere");
    this.showNotification(
      "This notebook changed in another Ren panel. Export or copy your open edits, then reopen Ren.",
      "warning",
    );
  }

  async handleStorageChanges(changes) {
    const changedKeys = Object.keys(changes);
    const notebookChanged = changedKeys.some(
      (key) => key === "sylva_notes_index" || key.startsWith("note_"),
    );
    if (!notebookChanged || this.importInProgress) return;

    const writer = changes.ren_last_write_v1?.newValue;
    if (writer?.instanceId === this.instanceId) return;

    if (this.editRevision > this.savedRevision) {
      this.enterStorageConflict();
      return;
    }

    const previousCurrentNoteId = this.currentNoteId;
    const notes = await this.storage.getAllNotes();
    const storedCurrentNoteId = await this.storage.getCurrentNoteId();
    this.notes = notes;
    this.currentNoteId = notes.some(({ id }) => id === previousCurrentNoteId)
      ? previousCurrentNoteId
      : storedCurrentNoteId;
    this.rebuildCache();
    this.recordPersistedNotes(notes);
    this.loadCurrentNote();
    this.renderNotesList();
    this.savedRevision = this.editRevision;
  }

  // Performance: Rebuild the notes cache from the array
  rebuildCache() {
    this.notesCache.clear();
    this.notes.forEach((note) => this.notesCache.set(note.id, note));
  }

  recordPersistedNotes(notes) {
    this.persistedNoteIds = notes.map(({ id }) => id);
    this.persistedNotes = new Map(
      notes.map((note) => [note.id, { ...note }]),
    );
  }

  setSaveStatus(status) {
    this.autoSaveStatus.textContent = status;
    if (this.saveRecoveryExportBtn) {
      this.saveRecoveryExportBtn.hidden =
        status !== "Could not save" && status !== "Changed elsewhere";
    }
  }

  persistedNotebook() {
    return {
      index: [...(this.persistedNoteIds || [])],
      notes: Array.from(this.persistedNotes?.values() || [], (note) => ({ ...note })),
    };
  }

  assertNoStorageConflict() {
    if (this.storageConflict) {
      const error = new Error("Another Ren panel changed the notebook");
      error.name = "StorageConflictError";
      throw error;
    }
  }

  // Performance: O(1) note lookup instead of O(n) array.find()
  getNoteById(noteId) {
    return this.notesCache.get(noteId) || null;
  }

  createWriteContext() {
    // Chrome omits unchanged keys from onChanged. Reusing a marker for two
    // writes at the same edit revision makes our second write look external.
    this.writeSequence = (this.writeSequence || 0) + 1;
    return { instanceId: this.instanceId, revision: this.editRevision, sequence: this.writeSequence };
  }

  async saveData() {
    if (this.dataLoadFailed) {
      throw new Error("Cannot save while notes have not loaded");
    }
    this.assertNoStorageConflict();

    // Snapshot at queue time so a later edit cannot change an earlier write.
    const notes = this.notes.map((note) => ({ ...note }));
    const currentNoteId = this.currentNoteId;
    const writeContext = this.createWriteContext();
    return this.queueStorageSave(async () => {
      this.assertNoStorageConflict();
      try {
        await this.storage.saveAllNotes(
          notes, currentNoteId, writeContext, this.persistedNotebook(),
        );
      } catch (error) {
        if (error.name === "StorageConflictError") this.enterStorageConflict();
        throw error;
      }
      this.recordPersistedNotes(notes);
    });
  }

  async saveNoteData(note) {
    if (this.dataLoadFailed) {
      throw new Error("Cannot save while notes have not loaded");
    }
    this.assertNoStorageConflict();

    const noteSnapshot = { ...note };
    const notesIndex = this.notes.map(({ id }) => id);
    const currentNoteId = this.currentNoteId;
    const writeContext = this.createWriteContext();
    return this.queueStorageSave(async () => {
      this.assertNoStorageConflict();
      const expectedNote = this.persistedNotes?.get(noteSnapshot.id);
      try {
        await this.storage.saveNote(
          noteSnapshot,
          notesIndex,
          currentNoteId,
          writeContext,
          expectedNote,
          this.persistedNoteIds,
        );
      } catch (error) {
        if (error.name === "StorageConflictError") this.enterStorageConflict();
        throw error;
      }
      if (!this.persistedNotes) this.persistedNotes = new Map();
      this.persistedNotes.set(noteSnapshot.id, { ...noteSnapshot });
      this.persistedNoteIds = [...notesIndex];
    });
  }

  async saveCurrentNoteSelection() {
    if (this.dataLoadFailed) {
      throw new Error("Cannot save while notes have not loaded");
    }

    const currentNoteId = this.currentNoteId;
    const writeContext = this.createWriteContext();
    return this.queueStorageSave(() => {
      this.assertNoStorageConflict();
      return this.storage.setCurrentNoteId(currentNoteId, writeContext);
    });
  }

  async queueStorageSave(operation) {
    const previousSave = this.saveQueue || Promise.resolve();
    const save = previousSave.catch(() => {}).then(operation);

    this.saveQueue = save;

    try {
      return await save;
    } catch (error) {
      console.error("Error saving data:", error);
      if (error?.name === "StorageConflictError") {
        this.enterStorageConflict();
      } else {
        this.setSaveStatus("Could not save");
        this.showNotification("Could not save. Export your open edits or try again.", "error");
      }
      throw error;
    }
  }

  initializeSidebarResize() {
    const handle = document.getElementById("sidebarResizeHandle");
    if (!handle) return;
    this.sidebarPreferredWidth = 288;
    try {
      const stored = Number(localStorage.getItem("ren-sidebar-width"));
      if (Number.isFinite(stored) && stored >= 160) this.sidebarPreferredWidth = stored;
    } catch { /* Layout preferences must never block note loading. */ }
    const apply = () => {
      const max = Math.max(160, Math.min(480, window.innerWidth - (window.innerWidth >= 760 ? 320 : 32)));
      const min = Math.min(220, max);
      this.sidebarWidth = Math.max(min, Math.min(max, this.sidebarPreferredWidth));
      document.documentElement.style.setProperty("--sidebar-width", `${this.sidebarWidth}px`);
      handle.setAttribute("aria-valuemin", String(min));
      handle.setAttribute("aria-valuemax", String(max));
      handle.setAttribute("aria-valuenow", String(this.sidebarWidth));
      handle.setAttribute("aria-valuetext", `${this.sidebarWidth} pixels`);
    };
    const remember = () => {
      this.sidebarPreferredWidth = this.sidebarWidth;
      try { localStorage.setItem("ren-sidebar-width", String(this.sidebarWidth)); } catch {}
    };
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.focus();
      drag = { id: event.pointerId, x: event.clientX, width: this.sidebarWidth };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("resizing-sidebar");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      this.sidebarPreferredWidth = drag.width + event.clientX - drag.x;
      apply();
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove("resizing-sidebar");
      remember();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 48 : 16;
      this.sidebarPreferredWidth = event.key === "Home" ? Number(handle.getAttribute("aria-valuemin"))
        : event.key === "End" ? Number(handle.getAttribute("aria-valuemax"))
        : this.sidebarWidth + (event.key === "ArrowRight" ? step : -step);
      apply();
      remember();
    });
    handle.addEventListener("dblclick", () => {
      this.sidebarPreferredWidth = 288;
      apply();
      remember();
    });
    window.addEventListener("resize", apply);
    apply();
  }

  toggleSidebar() {
    const isVisible = !this.sidebar.classList.contains("-translate-x-full");

    if (isVisible) {
      this.sidebar.classList.add("-translate-x-full");
      this.sidebarOverlay.classList.add("opacity-0", "pointer-events-none");
      // a11y: Update ARIA states
      this.hamburgerBtn.setAttribute("aria-expanded", "false");
      this.sidebar.setAttribute("aria-hidden", "true");
      this.sidebar.inert = true;
      document.body.classList.remove("sidebar-open");
      // a11y: Return focus to trigger
      this.hamburgerBtn.focus();
    } else {
      this.sidebar.classList.remove("-translate-x-full");
      this.sidebarOverlay.classList.remove("opacity-0", "pointer-events-none");
      // a11y: Update ARIA states
      this.hamburgerBtn.setAttribute("aria-expanded", "true");
      this.sidebar.setAttribute("aria-hidden", "false");
      this.sidebar.inert = false;
      document.body.classList.add("sidebar-open");
      // a11y: Focus first interactive element in sidebar
      this.newNoteBtn.focus();
    }
  }

  handleInput() {
    this.updateWordCount();
    this.scheduleAutoSave();
  }

  /**
   * Toggle the toolbar "More" dropdown
   */
  toggleToolbarDropdown() {
    const moreBtn = document.getElementById("toolbarMoreBtn");
    const moreMenu = document.getElementById("toolbarMoreMenu");
    if (!moreBtn || !moreMenu) return;

    const isHidden = moreMenu.classList.contains("hidden");
    if (isHidden) {
      this.showToolbarDropdown();
    } else {
      this.hideToolbarDropdown();
    }
  }

  showToolbarDropdown() {
    const moreBtn = document.getElementById("toolbarMoreBtn");
    const moreMenu = document.getElementById("toolbarMoreMenu");
    if (!moreBtn || !moreMenu) return;

    moreMenu.classList.remove("hidden");
    moreBtn.setAttribute("aria-expanded", "true");
  }

  hideToolbarDropdown() {
    const moreBtn = document.getElementById("toolbarMoreBtn");
    const moreMenu = document.getElementById("toolbarMoreMenu");
    if (!moreBtn || !moreMenu) return;

    moreMenu.classList.add("hidden");
    moreBtn.setAttribute("aria-expanded", "false");
  }

  /**
   * Toggle the toolbar "Headings" dropdown
   */
  toggleHeadingsDropdown() {
    const headingsBtn = document.getElementById("toolbarHeadingsBtn");
    const headingsMenu = document.getElementById("toolbarHeadingsMenu");
    if (!headingsBtn || !headingsMenu) return;

    const isHidden = headingsMenu.classList.contains("hidden");
    if (isHidden) {
      this.showHeadingsDropdown();
    } else {
      this.hideHeadingsDropdown();
    }
  }

  showHeadingsDropdown() {
    const headingsBtn = document.getElementById("toolbarHeadingsBtn");
    const headingsMenu = document.getElementById("toolbarHeadingsMenu");
    if (!headingsBtn || !headingsMenu) return;

    headingsMenu.classList.remove("hidden");
    headingsBtn.setAttribute("aria-expanded", "true");
  }

  hideHeadingsDropdown() {
    const headingsBtn = document.getElementById("toolbarHeadingsBtn");
    const headingsMenu = document.getElementById("toolbarHeadingsMenu");
    if (!headingsBtn || !headingsMenu) return;

    headingsMenu.classList.add("hidden");
    headingsBtn.setAttribute("aria-expanded", "false");
  }

  /**
   * Toggle the toolbar "Lists" dropdown
   */
  toggleListsDropdown() {
    const listsBtn = document.getElementById("toolbarListsBtn");
    const listsMenu = document.getElementById("toolbarListsMenu");
    if (!listsBtn || !listsMenu) return;

    const isHidden = listsMenu.classList.contains("hidden");
    if (isHidden) {
      this.showListsDropdown();
    } else {
      this.hideListsDropdown();
    }
  }

  showListsDropdown() {
    const listsBtn = document.getElementById("toolbarListsBtn");
    const listsMenu = document.getElementById("toolbarListsMenu");
    if (!listsBtn || !listsMenu) return;

    listsMenu.classList.remove("hidden");
    listsBtn.setAttribute("aria-expanded", "true");
  }

  hideListsDropdown() {
    const listsBtn = document.getElementById("toolbarListsBtn");
    const listsMenu = document.getElementById("toolbarListsMenu");
    if (!listsBtn || !listsMenu) return;

    listsMenu.classList.add("hidden");
    listsBtn.setAttribute("aria-expanded", "false");
  }

  /**
   * Update undo/redo button states based on availability
   */
  updateUndoRedoButtons() {
    this.editorToolbar?.querySelectorAll("button").forEach((button) => {
      if (!["undo", "redo"].includes(button.dataset.action)) button.disabled = Boolean(this.editor?.readOnly);
    });
    if (this.undoBtn) {
      this.undoBtn.disabled = !this.canUndo;
      this.undoBtn.classList.toggle("disabled", !this.canUndo);
    }
    if (this.redoBtn) {
      this.redoBtn.disabled = !this.canRedo;
      this.redoBtn.classList.toggle("disabled", !this.canRedo);
    }
  }

  /**
   * Reset undo/redo state (called when switching notes)
   */
  resetUndoRedoState() {
    this.canUndo = false;
    this.canRedo = false;
    this.updateUndoRedoButtons();
  }

  handleKeydown(e) {
    // Tab is handled by the editor itself for contenteditable
    // This is only for textarea fallback
    if (!this.editor && e.key === "Tab") {
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

  // Handle toolbar button actions
  handleToolbarAction(action) {
    if (!this.editor) return;

    switch (action) {
      case "undo":
        this.editor.execUndo();
        return;
      case "redo":
        this.editor.execRedo();
        return;
      case "bold":
        this.editor.execBold();
        break;
      case "italic":
        this.editor.execItalic();
        break;
      case "underline":
        this.editor.execUnderline();
        break;
      case "strikethrough":
        this.editor.execStrikethrough();
        break;
      case "h1":
        this.editor.execHeading(1);
        break;
      case "h2":
        this.editor.execHeading(2);
        break;
      case "h3":
        this.editor.execHeading(3);
        break;
      case "bulletList":
        this.editor.execBulletList();
        break;
      case "numberedList":
        this.editor.execNumberedList();
        break;
      case "blockquote":
        this.editor.execBlockquote();
        break;
      case "code":
        this.editor.execCode();
        break;
      case "hr":
        this.editor.execHR();
        break;
      case "insertCheckbox":
        this.editor.execCheckbox();
        break;
    }

    // The editor update transaction schedules the save.
  }

  updateWordCount() {
    // Use textContent for contenteditable, fallback to value for textarea
    const text = this.editor
      ? (this.editor.getText?.() ?? this.noteContent.textContent)
      : this.noteContent.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;

    this.wordCount.textContent = `${words} word${words !== 1 ? "s" : ""}`;
    this.charCount.textContent = `${chars} character${chars !== 1 ? "s" : ""}`;
  }

  scheduleAutoSave() {
    if (this.dataLoadFailed || this.importInProgress) return;
    if (this.storageConflict) {
      this.captureCurrentEditorContent();
      this.setSaveStatus("Changed elsewhere");
      return;
    }
    clearTimeout(this.autoSaveTimeout);
    const revision = ++this.editRevision;
    this.setSaveStatus("Saving...");

    this.autoSaveTimeout = setTimeout(() => {
      this.saveCurrentNoteWithStatus({ revision });
    }, 1000);
  }

  async saveCurrentNoteWithStatus({
    revision = this.editRevision,
    notifySuccess = false,
  } = {}) {
    this.setSaveStatus("Saving...");

    try {
      await this.saveCurrentNote();
      this.savedRevision = Math.max(this.savedRevision, revision);

      // A newer edit may have arrived while this write was in flight.
      if (revision === this.editRevision) {
        this.setSaveStatus("Saved");
        if (notifySuccess) {
          this.showNotification("Note saved", "success");
          this.announceToScreenReader("Note saved");
        }
      }
      return true;
    } catch (error) {
      if (revision === this.editRevision) {
        this.setSaveStatus(this.storageConflict
          ? "Changed elsewhere"
          : "Could not save");
      }
      return false;
    }
  }

  flushPendingSave() {
    if (this.storageConflict) return Promise.resolve(false);
    if (
      this.dataLoadFailed ||
      this.importInProgress ||
      this.editRevision <= this.savedRevision
    ) {
      return Promise.resolve(true);
    }
    if (this.flushSavePromise) return this.flushSavePromise;
    clearTimeout(this.autoSaveTimeout);
    this.flushSavePromise = this.saveCurrentNoteWithStatus({
      revision: this.editRevision,
    }).then((saved) => {
      this.flushSavePromise = null;
      if (saved && this.editRevision > this.savedRevision) {
        return this.flushPendingSave();
      }
      return saved;
    });
    return this.flushSavePromise;
  }

  createNoteId() {
    const base = globalThis.crypto?.randomUUID?.() || Date.now().toString();
    let id = base;
    let suffix = 0;
    while (this.notes.some((note) => note.id === id)) id = `${base}-${++suffix}`;
    return id;
  }

  async createNewNote() {
    if (this.dataLoadFailed || this.storageConflict) return;
    // Store previous note ID and save it before creating new
    const previousNoteId = this.currentNoteId;
    await this.saveCurrentNote();

    // Clean up previous empty note if applicable
    if (previousNoteId) {
      await this.removeEmptyNote(previousNoteId);
    }

    const newNote = {
      id: this.createNoteId(),
      title: "Untitled",
      titleSource: "default",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.notes.unshift(newNote);
    // Performance: Add to cache immediately
    this.notesCache.set(newNote.id, newNote);
    this.currentNoteId = newNote.id;
    await this.saveData();
    this.loadCurrentNote();
    this.renderNotesList();
    this.showNotification("New note created", "success");

    setTimeout(() => this.noteContent.focus(), 100);
  }

  async saveCurrentNote() {
    if (this.editor?.readOnly) return;
    if (this.dataLoadFailed) return;
    if (this.storageConflict) {
      throw new Error("Cannot save while another panel has changed the notebook");
    }
    if (!this.currentNoteId) return;

    // Performance: O(1) lookup instead of O(n) find()
    const note = this.getNoteById(this.currentNoteId);
    if (note) {
      // Use innerHTML for rich editor, value for textarea
      if (this.editor?.changed && typeof note.originalContent !== "string") {
        note.originalContent = this.editor.sourceHTML;
      }
      note.content = this.editor
        ? (this.editor.getHTML?.() ?? this.noteContent.innerHTML)
        : this.noteContent.value;
      note.updatedAt = new Date().toISOString();

      // Only a new, unnamed note can take one title suggestion from its body.
      // Older notes without titleSource keep their existing titles.
      if (note.titleSource === "default") {
        const plainText = (
          this.noteContent.innerText ??
          this.noteContent.textContent ??
          this.noteContent.value ??
          ""
        ).replace(/\u00A0/g, " ");
        const firstMeaningfulLine = plainText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        if (firstMeaningfulLine) {
          note.title = firstMeaningfulLine.substring(0, 50);
          note.titleSource = "suggested";
          this.noteTitle.textContent = note.title;
        }
      }

      // Move the note to the top of the list (most recently edited first)
      const currentIndex = this.notes.findIndex(
        (n) => n.id === this.currentNoteId,
      );
      if (currentIndex > 0) {
        // Remove from current position and add to the beginning
        this.notes.splice(currentIndex, 1);
        this.notes.unshift(note);
        // Re-render the notes list to reflect new order
        this.renderNotesList();
      } else {
        // Just update the DOM for this note
        this.updateNoteItemInDOM(note);
      }

      await this.saveNoteData(note);
    }
  }

  loadCurrentNote() {
    if (!this.currentNoteId && this.notes.length > 0) {
      this.currentNoteId = this.notes[0].id;
    }

    // Performance: O(1) lookup instead of O(n) find()
    const note = this.getNoteById(this.currentNoteId);
    if (note) {
      // Use innerHTML for rich editor, value for textarea
      // Convert plain text to HTML to preserve line breaks
      if (this.editor) {
        this.editor.setHTML(note.content || "", this.convertPlainTextToHTML(note.content || ""));
      } else {
        this.noteContent.value = note.content;
      }
      this.noteTitle.textContent = note.title;
      this.updateWordCount();
      this.setSaveStatus("Ready");
    }
  }

  async switchToNote(noteId) {
    if (this.storageConflict) return;
    // Store the previous note ID before switching
    const previousNoteId = this.currentNoteId;

    await this.saveCurrentNote();

    // Check if the previous note should be auto-removed (empty + default title)
    if (previousNoteId && previousNoteId !== noteId) {
      await this.removeEmptyNote(previousNoteId);
    }

    this.currentNoteId = noteId;
    this.loadCurrentNote();
    // Reset undo/redo state for the new note
    this.resetUndoRedoState();
    // Performance: Update only active states, not full re-render
    this.updateActiveNoteState();
    await this.saveCurrentNoteSelection();
  }

  /**
   * Check if a note is empty and has default title, then remove it
   * This prevents clutter from accidentally created notes
   */
  async removeEmptyNote(noteId) {
    const note = this.getNoteById(noteId);
    if (!note) return;
    if (noteId === this.currentNoteId && this.editor?.readOnly) return;
    if (note.titleSource === "manual") return;

    // Check if note has default title (starts with "Untitled")
    const hasDefaultTitle =
      note.title === "Untitled" || note.title.match(/^Untitled \d+$/);

    // Check if content is empty (strip HTML tags and whitespace)
    const textContent = note.content
      .replace(/<\/?(?:p|div|br)\s*\/?>/gi, "") // Only empty text blocks count as empty
      .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
      .replace(/\s+/g, "") // Remove all whitespace
      .trim();

    const isEmpty = textContent.length === 0;

    // Only auto-remove if both conditions are true AND it's not the last note
    if (hasDefaultTitle && isEmpty && this.notes.length > 1) {
      // Remove from notes array
      const noteIndex = this.notes.findIndex((n) => n.id === noteId);
      if (noteIndex !== -1) {
        this.notes.splice(noteIndex, 1);
        this.notesCache.delete(noteId);

        // Remove from DOM
        this.removeNoteItemFromDOM(noteId);

        // Save silently (no notification)
        await this.saveData();
      }
    }
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
        note.titleSource = "manual";
        note.updatedAt = new Date().toISOString();
        await this.saveNoteData(note);
        // Performance: Update only the changed note in DOM
        this.updateNoteItemInDOM(note);

        if (noteId === this.currentNoteId) {
          this.noteTitle.textContent = newTitle;
        }

        this.showNotification(
          `Note renamed from "${oldTitle}" to "${newTitle}"`,
          "success",
        );
      }
    } catch (error) {
      this.showNotification("Error renaming note", "error");
    }

    this.hideRenameModal();
  }

  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;

    const iconSvg = {
      success: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>`,
      error: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>`,
      warning: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
      </svg>`,
      info: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>`,
    };

    notification.innerHTML = `
      <div class="notification-icon">${iconSvg[type] || iconSvg.info}</div>
      <span class="notification-message"></span>
      <button class="notification-close" aria-label="Dismiss notification">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    `;
    notification.querySelector(".notification-message").textContent = String(message);

    // Add close button functionality
    const closeBtn = notification.querySelector(".notification-close");
    closeBtn.addEventListener("click", () =>
      this.hideNotification(notification),
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

  /**
   * Convert plain text content to HTML-safe format
   * Detects if content is plain text (no HTML tags) and converts newlines to <br> tags
   * This preserves line spacing when importing notes from older exports or plain text
   * @param {string} content - The content to convert
   * @returns {string} - HTML-formatted content
   */
  convertPlainTextToHTML(content) {
    if (!content) return "";

    // Check if content appears to be HTML (contains HTML tags)
    // Look for common HTML tags used by the editor
    const htmlTagPattern =
      /<(p|div|br|h[1-6]|ul|ol|li|blockquote|strong|em|code|s|hr|span|a)[^>]*>/i;

    if (htmlTagPattern.test(content)) {
      return this.sanitizeNoteHTML(content);
    }

    // Content is plain text - convert newlines to <br> tags
    // First escape any HTML entities to prevent XSS
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Convert newlines to <br> tags
    // Handle both \r\n (Windows) and \n (Unix) line endings
    return escaped.replace(/\r\n/g, "<br>").replace(/\n/g, "<br>");
  }

  sanitizeNoteHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const allowedTags = new Set([
      "A",
      "B",
      "BLOCKQUOTE",
      "BR",
      "CODE",
      "DIV",
      "EM",
      "H1",
      "H2",
      "H3",
      "HR",
      "I",
      "INPUT",
      "LI",
      "OL",
      "P",
      "S",
      "SPAN",
      "STRIKE",
      "STRONG",
      "U",
      "UL",
    ]);
    const droppedTags = new Set([
      "AUDIO",
      "EMBED",
      "IFRAME",
      "IMG",
      "MATH",
      "OBJECT",
      "SCRIPT",
      "STYLE",
      "SVG",
      "VIDEO",
    ]);

    const sanitizeChildren = (parent) => {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === 8) {
          node.remove();
          continue;
        }
        if (node.nodeType !== 1) continue;

        const tagName = node.tagName;
        if (droppedTags.has(tagName)) {
          node.remove();
          continue;
        }
        if (!allowedTags.has(tagName)) {
          sanitizeChildren(node);
          node.replaceWith(...Array.from(node.childNodes));
          continue;
        }

        const original = {
          checked: node.hasAttribute("checked"),
          className: node.getAttribute("class") || "",
          href: node.getAttribute("href"),
          type: node.getAttribute("type"),
          start: node.getAttribute("start"),
        };
        for (const attribute of Array.from(node.attributes)) {
          node.removeAttribute(attribute.name);
        }

        if (tagName === "A" && original.href) {
          const href = original.href.trim();
          if (/^(https?:|mailto:)/i.test(href)) {
            node.setAttribute("href", href);
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
          }
        }
        if (tagName === "OL") {
          if (/^-?\d+$/.test(original.start || "") && Number.isSafeInteger(Number(original.start))) {
            node.setAttribute("start", original.start);
          }
          if (/^[1aAiI]$/.test(original.type || "")) node.setAttribute("type", original.type);
        }
        if (tagName === "INPUT") {
          if (
            original.type?.toLowerCase() !== "checkbox" ||
            !node.parentElement?.classList.contains("editor-checkbox-item")
          ) {
            node.remove();
            continue;
          }
          node.setAttribute("type", "checkbox");
          node.className = "checkbox-input";
          if (original.checked) node.setAttribute("checked", "");
        }
        if (
          tagName === "DIV" &&
          original.className.split(/\s+/).includes("editor-checkbox-item")
        ) {
          node.className = "editor-checkbox-item";
          if (original.className.split(/\s+/).includes("checked")) {
            node.classList.add("checked");
          }
          node.setAttribute("contenteditable", "false");
        }
        if (
          tagName === "SPAN" &&
          original.className.split(/\s+/).includes("checkbox-text")
        ) {
          node.className = "checkbox-text";
          node.setAttribute("contenteditable", "true");
        }

        sanitizeChildren(node);
      }
    };

    sanitizeChildren(template.content);
    return template.innerHTML;
  }

  exportNotes() {
    if (this.dataLoadFailed) return;
    try {
      const exportData = this.createExportData();

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `ren-notes-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showNotification(`Backup download started for ${this.notes.length} notes.`, "success");
    } catch (error) {
      console.error("Export error:", error);
      this.showNotification("Failed to export notes", "error");
    }
  }

  createExportData() {
    if (this.dataLoadFailed) {
      throw new Error("Cannot export while notes have not loaded");
    }
    if (this.editRevision > this.savedRevision || this.storageConflict) {
      this.captureCurrentEditorContent();
    }
    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      notes: this.notes.map((note) => ({ ...note })),
      currentNoteId: this.currentNoteId,
    };
  }

  prepareImportedNotebook(importData) {
    if (
      !importData ||
      typeof importData !== "object" ||
      Array.isArray(importData) ||
      !Array.isArray(importData.notes)
    ) {
      throw new Error("Invalid backup file: missing notes array");
    }
    if (importData.notes.length === 0) {
      throw new Error("Invalid backup file: no notes found");
    }
    if (importData.notes.length > 10_000) {
      throw new Error("Invalid backup file: too many notes");
    }

    const notes = [];
    const noteIds = new Set();
    for (let index = 0; index < importData.notes.length; index++) {
      const note = importData.notes[index];
      const position = index + 1;
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        throw new Error(`Invalid backup file: note ${position} is not an object`);
      }
      if (
        typeof note.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(note.id)
      ) {
        throw new Error(`Invalid backup file: note ${position} has an invalid ID`);
      }
      if (noteIds.has(note.id)) {
        throw new Error("Invalid backup file: duplicate note IDs");
      }
      if (typeof note.title !== "string" || note.title.length > 500) {
        throw new Error(`Invalid backup file: note ${position} has an invalid title`);
      }
      if (typeof note.content !== "string") {
        throw new Error(`Invalid backup file: note ${position} has invalid content`);
      }
      if (
        typeof note.createdAt !== "string" ||
        Number.isNaN(Date.parse(note.createdAt)) ||
        typeof note.updatedAt !== "string" ||
        Number.isNaN(Date.parse(note.updatedAt))
      ) {
        throw new Error(`Invalid backup file: note ${position} has an invalid date`);
      }

      noteIds.add(note.id);
      notes.push({
        id: note.id,
        title: note.title,
        ...(["default", "suggested", "manual"].includes(note.titleSource)
          ? { titleSource: note.titleSource }
          : {}),
        content: this.convertPlainTextToHTML(note.content),
        ...(typeof note.originalContent === "string" ? { originalContent: note.originalContent } : {}),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });
    }

    const currentNoteId =
      typeof importData.currentNoteId === "string" &&
      noteIds.has(importData.currentNoteId)
        ? importData.currentNoteId
        : notes[0].id;
    return { notes, currentNoteId };
  }

  async importNotes(event) {
    if (this.dataLoadFailed || this.storageConflict) {
      this.importFileInput.value = "";
      return;
    }
    const file = event.target.files[0];
    if (!file) return;

    let previousEditable;
    try {
      if (typeof file.size === "number" && file.size > 10 * 1024 * 1024) {
        throw new Error("Invalid backup file: file is larger than 10 MB");
      }
      const text = await file.text();
      const importData = JSON.parse(text);
      const prepared = this.prepareImportedNotebook(importData);

      // Confirm before overwriting
      const noteCount = prepared.notes.length;
      const confirmImport = confirm(
        `This will replace your current notes with ${noteCount} imported notes. Ren will keep a restorable pre-import backup. Continue?`,
      );

      if (!confirmImport) {
        return;
      }

      clearTimeout(this.autoSaveTimeout);
      this.importInProgress = true;
      previousEditable = this.noteContent?.getAttribute?.("contenteditable");
      this.noteContent?.setAttribute?.("contenteditable", "false");
      this.editor?.setEditable?.(false);

      // Include the latest editor contents in the recovery snapshot.
      await this.saveCurrentNote();
      const result = await this.queueStorageSave(() =>
        this.storage.replaceAllNotesWithBackup(
          prepared.notes,
          prepared.currentNoteId,
          this.persistedNotebook(),
        ),
      );

      // Switch the live state only after storage has verified the replacement.
      this.notes = prepared.notes;
      this.currentNoteId = prepared.currentNoteId;
      this.editRevision++;
      this.savedRevision = this.editRevision;
      this.recordPersistedNotes(prepared.notes);

      // Rebuild the cache to sync with new notes
      this.rebuildCache();
      this.loadCurrentNote();
      this.renderNotesList();

      this.showNotification(
        result.cleanupPending
          ? `Imported ${noteCount} notes. The backup is safe, but old storage cleanup is still pending.`
          : `Imported ${noteCount} notes. A pre-import backup is available.`,
        result.cleanupPending ? "info" : "success",
      );
    } catch (error) {
      console.error("Import error:", error);
      this.showNotification("Import failed. Your current notes remain open.", "error");
    } finally {
      this.importInProgress = false;
      if (previousEditable !== undefined) {
        this.noteContent?.setAttribute?.(
          "contenteditable",
          previousEditable ?? "true",
        );
        this.editor?.setEditable?.(previousEditable !== "false");
      }
      this.importFileInput.value = "";
    }
  }

  renderNotesList() {
    this.notesList.innerHTML = "";
    // Performance: Clear element tracking
    this.renderedNoteElements.clear();

    // Show empty state if no notes
    if (this.notes.length === 0) {
      this.notesList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <p class="empty-state-title">No notes yet</p>
          <p class="empty-state-text">Create your first note to get started</p>
        </div>
      `;
      return;
    }

    // Filter notes based on search
    const filteredNotes = this.filterNotes();

    // Show no results state
    if (filteredNotes.length === 0 && this.searchQuery) {
      this.notesList.innerHTML = `
        <div class="no-results">
          <svg class="no-results-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <p class="no-results-text"></p>
        </div>
      `;
      this.notesList.querySelector(".no-results-text").textContent =
        `No notes match "${this.searchQuery}"`;
      return;
    }

    filteredNotes.forEach((note) => {
      const noteItem = this.createNoteElement(note);
      // Performance: Track rendered element
      this.renderedNoteElements.set(note.id, noteItem);
      this.notesList.appendChild(noteItem);
    });
  }

  // Performance: Create a single note DOM element (reusable)
  createNoteElement(note) {
    const noteItem = document.createElement("div");
    noteItem.className = `note-item${
      note.id === this.currentNoteId ? " active" : ""
    }`;
    noteItem.dataset.noteId = note.id;
    // a11y: Make note item focusable and add listbox role
    noteItem.setAttribute("tabindex", "0");
    noteItem.setAttribute("role", "option");
    noteItem.setAttribute(
      "aria-selected",
      note.id === this.currentNoteId ? "true" : "false",
    );

    // Get plain text preview (strip HTML tags)
    const textContent = note.content
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const preview = textContent.substring(0, 40) || "Empty note";
    const updatedDate = new Date(note.updatedAt).toLocaleDateString();

    noteItem.innerHTML = `
      <div class="note-content-area">
        <div class="note-title"></div>
        <div class="note-preview"></div>
        <div class="note-date"></div>
      </div>
      <div class="note-icons">
        <button class="rename-note-btn menu-item">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
        </button>
        <button class="delete-note-btn menu-item">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
          </svg>
        </button>
      </div>
    `;

    // Bind events
    const noteContentArea = noteItem.querySelector(".note-content-area");
    const titleElement = noteItem.querySelector(".note-title");
    const previewElement = noteItem.querySelector(".note-preview");
    noteContentArea.dataset.noteId = note.id;
    this.appendHighlightedText(titleElement, note.title, this.searchQuery);
    this.appendHighlightedText(previewElement, preview, this.searchQuery);
    noteItem.querySelector(".note-date").textContent = updatedDate;
    noteContentArea.addEventListener("click", () => {
      this.switchToNote(note.id);
      this.toggleSidebar();
    });

    const renameBtn = noteItem.querySelector(".rename-note-btn");
    const deleteBtn = noteItem.querySelector(".delete-note-btn");
    renameBtn.dataset.noteId = note.id;
    renameBtn.setAttribute("aria-label", `Rename note: ${note.title}`);
    deleteBtn.dataset.noteId = note.id;
    deleteBtn.setAttribute("aria-label", `Delete note: ${note.title}`);

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
      // Strip HTML tags for plain text preview
      const textContent = note.content
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const preview = textContent.substring(0, 40) || "Empty note";
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
  new RenNotePad();
});
