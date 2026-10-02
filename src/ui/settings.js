/* Settings is a native modal: the browser owns top-layer placement and focus. */
class RenSettings {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById("settingsModal");
    this.status = this.dialog.querySelector("#settingsStatus");
    this.themes = [...this.dialog.querySelectorAll("[data-theme]")];
    this.generation = 0;
    this.savingTheme = false;
    const on = (id, action) => this.dialog.querySelector(`#${id}`).addEventListener("click", action);
    on("closeSettings", () => this.close());
    on("settingsFolderBackupBtn", () => this.backupToFolder());
    on("settingsExportBtn", () => { this.close(); this.app.exportNotes(); });
    on("settingsImportBtn", () => { this.close(); this.app.importFileInput.click(); });
    on("settingsRestoreImportBtn", () => { this.close(); this.app.restoreImportBackup(); });
    on("settingsShortcutsBtn", () => { this.close(); this.app.showShortcutsHelp(); });
    this.themes.forEach(button => button.addEventListener("click", () => this.saveTheme(button.dataset.theme)));
  }

  open() {
    if (this.dialog.open) return;
    this.status.textContent = this.savingTheme ? "Saving theme…" : "";
    this.dialog.querySelector("#settingsVersion").textContent = `Ren v${chrome.runtime.getManifest().version}`;
    this.renderTheme();
    const blocked = this.app.dataLoadFailed || this.app.importInProgress || this.app.storageConflict;
    this.dialog.querySelector("#settingsImportBtn").disabled = Boolean(blocked);
    this.dialog.querySelector("#settingsExportBtn").disabled = Boolean(this.app.dataLoadFailed);
    const folderButton = this.dialog.querySelector("#settingsFolderBackupBtn");
    folderButton.hidden = typeof window.showDirectoryPicker !== "function";
    folderButton.disabled = Boolean(this.app.dataLoadFailed || this.app.importInProgress);
    this.app.modals.open(this.dialog, {
      focus: "#closeSettings",
      onClose: () => { this.generation++; this.app.settingsModalVisible = false; },
    });
    this.app.settingsModalVisible = true;
    this.refreshBackup(++this.generation, blocked);
  }

  close() { this.app.modals.close(this.dialog); }

  renderTheme() {
    for (const button of this.themes) {
      const selected = button.dataset.theme === this.app.currentTheme;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = this.savingTheme;
    }
  }

  async saveTheme(theme) {
    if (this.savingTheme || this.backingUp) return;
    this.savingTheme = true;
    this.status.textContent = "Saving theme…";
    this.renderTheme();
    try {
      await this.app.setTheme(theme);
      this.status.textContent = "";
    } catch {
      this.status.textContent = "Could not save the theme. Try again.";
    } finally {
      this.savingTheme = false;
      this.renderTheme();
    }
  }

  async backupToFolder() {
    if (this.backingUp || this.savingTheme || this.app.dataLoadFailed || this.app.importInProgress) return;
    this.backingUp = true;
    const state = this.app.modals.active;
    const controls = [...this.dialog.querySelectorAll("button")];
    const disabled = controls.map(button => button.disabled);
    controls.forEach(button => { button.disabled = true; });
    if (state) state.dismissible = false;
    let selected = false;
    this.status.textContent = "";
    try {
      // Capture pending edits too, without depending on a successful local save.
      const serialized = JSON.stringify(this.app.createExportData(), null, 2);
      // Keep the picker inside the original click's user activation.
      const directory = await window.showDirectoryPicker({ id: "ren-backups", mode: "readwrite", startIn: "documents" });
      selected = true;
      this.status.textContent = "Writing backup…";
      await RenBackups.write(directory, serialized);
      this.status.textContent = `Backup saved to ${directory.name}.`;
    } catch (error) {
      if (selected || error.name !== "AbortError") {
        this.status.textContent = "Could not save to that folder. Try again or use Export notes.";
      }
    } finally {
      this.backingUp = false;
      controls.forEach((button, index) => { button.disabled = disabled[index]; });
      if (state) state.dismissible = true;
      this.dialog.querySelector("#settingsFolderBackupBtn").focus();
      this.refreshBackup(++this.generation, Boolean(this.app.dataLoadFailed || this.app.importInProgress || this.app.storageConflict));
    }
  }

  async refreshBackup(generation, blocked) {
    const button = this.dialog.querySelector("#settingsRestoreImportBtn");
    button.hidden = true;
    button.disabled = true;
    try {
      const backup = await this.app.storage.getPreImportBackupInfo();
      if (generation !== this.generation || !this.dialog.open) return;
      if (backup) {
        button.querySelector(".settings-btn-desc").textContent = `Restore ${backup.storedNoteCount} note${backup.storedNoteCount === 1 ? "" : "s"} saved before the latest import`;
        button.hidden = false;
        button.disabled = Boolean(blocked || this.backingUp);
      }
    } catch {
      if (generation === this.generation && this.dialog.open) this.status.textContent = "Could not check for a recovery copy. Reopen Settings to retry.";
    }
  }
}
window.RenSettings = RenSettings;
