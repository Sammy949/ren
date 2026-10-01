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
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener("keydown", event => {
      if (event.key === "Tab") this.app.trapFocus(event, this.dialog);
      // Keep application Escape handling from closing another surface too.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
    this.dialog.addEventListener("pointerdown", event => {
      this.backdropPress = this.outside(event);
    });
    this.dialog.addEventListener("click", event => {
      if (this.backdropPress && this.outside(event)) this.close();
      this.backdropPress = false;
    });
    this.dialog.addEventListener("close", () => {
      // A queued close event from an earlier opening must not affect a reopen.
      if (!this.dialog.open) this.finishClose();
    });
  }

  outside(event) {
    const rect = this.dialog.getBoundingClientRect();
    return event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }

  open() {
    if (this.dialog.open) return;
    if (!this.app.sidebar.classList.contains("-translate-x-full")) this.app.toggleSidebar();
    this.returnFocus = document.activeElement;
    this.status.textContent = this.savingTheme ? "Saving theme…" : "";
    this.dialog.querySelector("#settingsVersion").textContent = `Ren v${chrome.runtime.getManifest().version}`;
    this.renderTheme();
    const blocked = this.app.dataLoadFailed || this.app.importInProgress || this.app.storageConflict;
    this.dialog.querySelector("#settingsImportBtn").disabled = Boolean(blocked);
    this.dialog.querySelector("#settingsExportBtn").disabled = Boolean(this.app.dataLoadFailed);
    this.dialog.setAttribute("aria-hidden", "false");
    this.dialog.showModal();
    this.app.settingsModalVisible = true;
    this.dialog.querySelector("#closeSettings").focus();
    this.refreshBackup(++this.generation, blocked);
  }

  close() {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.finishClose();
  }

  finishClose() {
    this.generation++;
    this.dialog.setAttribute("aria-hidden", "true");
    this.app.settingsModalVisible = false;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected && !target.closest("[inert]")) target.focus();
  }

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
