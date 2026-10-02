// One lifecycle for every Ren dialog. No overlay class toggles or shared focus slot.
class RenModals {
  constructor(app) { this.app = app; this.bound = new WeakSet(); this.active = null; }

  open(dialog, { focus, dismissible = true, onClose = () => {} } = {}) {
    if (dialog.open) return;
    let returnFocus = this.active?.returnFocus;
    if (this.active) this.close(this.active.dialog, false);
    if (!this.app.sidebar.classList.contains("-translate-x-full")) this.app.toggleSidebar();
    returnFocus ??= document.activeElement;
    if (!this.bound.has(dialog)) {
      this.bound.add(dialog);
      dialog.addEventListener("keydown", event => {
        if (event.key === "Tab") this.app.trapFocus(event, dialog);
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (this.active?.dismissible) this.close(dialog);
        }
      });
      dialog.addEventListener("cancel", event => {
        event.preventDefault();
        if (this.active?.dismissible) this.close(dialog);
      });
      let pressedOutside = false;
      const outside = event => {
        const r = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom);
      };
      dialog.addEventListener("pointerdown", event => { pressedOutside = outside(event); });
      dialog.addEventListener("click", event => {
        if (pressedOutside && outside(event) && this.active?.dismissible) this.close(dialog);
        pressedOutside = false;
      });
      dialog.addEventListener("close", () => {
        if (!dialog.open && this.active?.dialog === dialog) this.finishClose(true);
      });
    }
    this.active = { dialog, returnFocus, dismissible, onClose };
    document.dispatchEvent(new Event("ren:modal-open"));
    dialog.classList.remove("hidden");
    dialog.setAttribute("aria-hidden", "false");
    dialog.showModal();
    (typeof focus === "string" ? dialog.querySelector(focus) : focus)?.focus();
  }

  close(dialog, restoreFocus = true) {
    if (!dialog || this.active?.dialog !== dialog) return;
    dialog.close();
    this.finishClose(restoreFocus);
  }

  async run(dialog, action) {
    if (this.busy) return;
    this.busy = true;
    const state = this.active;
    const error = dialog.querySelector(".modal-error");
    if (error) error.textContent = "";
    const buttons = [...dialog.querySelectorAll("button, input")];
    const disabled = buttons.map(button => button.disabled);
    buttons.forEach(button => { button.disabled = true; });
    if (state) state.dismissible = false;
    try {
      await action();
      this.close(dialog);
    } catch {
      if (error) error.textContent = "Could not save this change. Your notes are unchanged. Try again.";
    } finally {
      this.busy = false;
      buttons.forEach((button, index) => { button.disabled = disabled[index]; });
      if (state) state.dismissible = true;
    }
  }

  finishClose(restoreFocus) {
    const state = this.active;
    if (!state) return;
    this.active = null;
    state.dialog.setAttribute("aria-hidden", "true");
    state.onClose();
    if (restoreFocus) {
      const target = state.returnFocus;
      if (target?.isConnected && !target.closest("[inert]") && target.getClientRects().length) target.focus();
      else this.app.hamburgerBtn.focus();
    }
  }
}
window.RenModals = RenModals;
