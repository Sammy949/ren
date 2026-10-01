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
    if (this.savingTheme) return;
    this.savingTheme = true;
    this.status.textContent = "Saving theme…";
    this.renderTheme();
    try {
      await this.app.setTheme(theme);
      this.status.textContent = "Theme saved.";
    } catch {
      this.status.textContent = "Could not save the theme. Try again.";
    } finally {
      this.savingTheme = false;
      this.renderTheme();
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
        button.disabled = Boolean(blocked);
      }
    } catch {
      if (generation === this.generation && this.dialog.open) this.status.textContent = "Could not check for a recovery copy. Reopen Settings to retry.";
    }
  }
}
window.RenSettings = RenSettings;
