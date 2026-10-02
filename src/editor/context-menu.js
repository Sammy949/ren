export function installContextMenu(adapter) {
  const editor = adapter.engine;
  const menu = document.createElement("div");
  menu.id = "editorContextMenu";
  menu.className = "ren-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Text actions");
  menu.hidden = true;
  document.body.append(menu);
  let anchor, submenu = false;
  const main = [
    ["Undo", "undo"], ["Redo", "redo"], null,
    ["Bold", "toggleBold", [], "bold"], ["Italic", "toggleItalic", [], "italic"],
    ["Underline", "toggleUnderline", [], "underline"], ["Strikethrough", "toggleStrike", [], "strike"],
    ["Inline code", "toggleCode", [], "code"], null,
    ["Turn into…", "submenu"], ["Clear formatting", "unsetAllMarks"],
  ];
  const blocks = [
    ["Back", "back"], null, ["Paragraph", "setParagraph", [], "paragraph"],
    ...[1,2,3].map(level => [`Heading ${level}`, "toggleHeading", [{level}], "heading", {level}]),
    ["Bullet list", "toggleBulletList", [], "bulletList"],
    ["Numbered list", "toggleOrderedList", [], "orderedList"],
    ["Task list", "toggleTaskList", [], "taskList"],
    ["Quote", "toggleBlockquote", [], "blockquote"],
  ];
  const close = (focus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    if (focus && editor.isEditable) editor.view.focus();
  };
  const place = () => {
    menu.style.left = "8px"; menu.style.top = "8px";
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth-r.width-8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight-r.height-8))}px`;
  };
  const render = () => {
    menu.replaceChildren();
    for (const item of submenu ? blocks : main) {
      if (!item) { const separator = document.createElement("div"); separator.setAttribute("role", "separator"); menu.append(separator); continue; }
      const [label, command, args = [], type, attrs] = item;
      const button = document.createElement("button");
      button.type = "button"; button.textContent = label; button.dataset.command = command;
      button.tabIndex = -1;
      button.setAttribute("role", type ? "menuitemcheckbox" : "menuitem");
      if (type) button.setAttribute("aria-checked", String(editor.isActive(type, attrs)));
      if (command === "submenu") { button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false"); }
      if (!["submenu", "back"].includes(command)) button.disabled = !editor.can()[command](...args);
      button.addEventListener("click", () => {
        if (command === "submenu" || command === "back") { submenu = command === "submenu"; render(); return; }
        close(true);
        adapter.command(command, ...args);
      });
      menu.append(button);
    }
    const hint = document.createElement("p"); hint.className = "context-hint";
    hint.textContent = "Shift + right-click for the browser menu"; menu.append(hint);
    place(); menu.querySelector("button:not(:disabled)")?.focus();
  };
  const open = (x, y) => {
    if (adapter.readOnly || !editor.isEditable || document.querySelector("dialog[open]")) return;
    anchor = {x,y}; submenu = false; menu.hidden = false; render();
  };
  editor.view.dom.addEventListener("contextmenu", event => {
    if (event.shiftKey || adapter.readOnly || !editor.isEditable) { close(); return; }
    event.preventDefault();
    const hit = editor.view.posAtCoords({left:event.clientX, top:event.clientY});
    const {from,to} = editor.state.selection;
    // Retain an existing selection when the click lands within it.
    if (hit && (hit.pos < from || hit.pos > to || from === to)) editor.commands.setTextSelection(hit.pos);
    open(event.clientX, event.clientY);
  });
  editor.view.dom.addEventListener("keydown", event => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      if (adapter.readOnly || !editor.isEditable) return;
      event.preventDefault(); event.stopPropagation();
      const r = editor.view.coordsAtPos(editor.state.selection.from); open(r.left, r.bottom);
    }
  });
  menu.addEventListener("mousedown", event => event.preventDefault());
  menu.addEventListener("keydown", event => {
    event.stopPropagation();
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (index+(event.key === "ArrowDown" ? 1 : -1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(true); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); document.activeElement?.click(); }
    else if (event.key === "ArrowLeft" && submenu) { event.preventDefault(); submenu = false; render(); }
    else if (event.key === "ArrowRight" && document.activeElement?.dataset.command === "submenu") { event.preventDefault(); submenu = true; render(); }
  });
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener("ren:modal-open", () => close());
  window.addEventListener("resize", () => close());
  window.addEventListener("blur", () => close());
  editor.view.dom.addEventListener("scroll", () => close());
  editor.on("update", () => close());
  return {close};
}
