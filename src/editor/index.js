import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Code } from "@tiptap/extension-code";
import { EditorState } from "@tiptap/pm/state";
import { undoDepth, redoDepth } from "@tiptap/pm/history";
import { convertLegacyNote } from "./legacy.js";
import { installContextMenu } from "./context-menu.js";

// The adapter keeps the v1 HTML backup shape while all editing and history
// run through ProseMirror transactions. Persistent JSON is a separate migration.
class RenEditor {
  constructor(host, options = {}) {
    this.options = options;
    this.host = host;
    this.sourceHTML = "";
    this.changed = false;
    this.readOnly = false;
    host.removeAttribute("id");
    host.className = "editor-host";
    for (const name of ["role", "aria-label", "aria-describedby", "aria-multiline"]) host.removeAttribute(name);
    this.engine = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ heading: { levels: [1,2,3] }, code: false, codeBlock: false,
          link: { openOnClick: false, autolink: false } }),
        Code.extend({ inclusive: false }), TaskList,
        TaskItem.extend({ content: "paragraph+" }),
      ],
      editorProps: { attributes: { id: "noteContent", class: "ren-editor", role: "textbox",
        "aria-label": "Note content editor", "aria-describedby": "editorStatus", "aria-multiline": "true",
        "data-placeholder": options.placeholder || "Start writing..." } },
      content: "<p></p>",
      onUpdate: () => {
        this.changed = true;
        this.options.onInput?.();
        this.options.onChange?.();
      },
      onTransaction: () => this.notifyHistory(),
    });
    this.element = this.engine.view.dom;
    this.preview = document.getElementById("legacyNotePreview");
    this.notice = document.getElementById("editorRecoveryNotice");
    this.contextMenu = installContextMenu(this);
  }
  notifyHistory() {
    if (!this.engine) return;
    this.options.onHistoryChange?.({
      canUndo: !this.readOnly && undoDepth(this.engine.state) > 0,
      canRedo: !this.readOnly && redoDepth(this.engine.state) > 0,
    });
  }
  setHTML(html, safePreview = "") {
    this.contextMenu.close();
    const result = convertLegacyNote(this.engine, {content: html});
    this.sourceHTML = html;
    this.changed = false;
    this.readOnly = !result.ok;
    this.element.hidden = this.readOnly;
    this.host.hidden = this.readOnly;
    if (this.preview) {
      this.preview.hidden = !this.readOnly;
      this.preview.innerHTML = this.readOnly ? safePreview : "";
      for (const element of this.preview.querySelectorAll("[contenteditable]")) element.setAttribute("contenteditable", "false");
      for (const input of this.preview.querySelectorAll("input")) input.disabled = true;
    }
    if (this.notice) this.notice.hidden = !this.readOnly;
    this.engine.setEditable(!this.readOnly, false);
    const doc = this.engine.schema.nodeFromJSON(result.ok ? result.doc : {type:"doc",content:[{type:"paragraph"}]});
    // A fresh state resets history and selection when changing notes. setContent
    // alone keeps the previous note's history plugin state.
    this.engine.view.updateState(EditorState.create({ schema:this.engine.schema, doc, plugins:this.engine.state.plugins }));
    this.notifyHistory();
    return result.ok;
  }
  getHTML() {
    if (!this.changed || this.readOnly) return this.sourceHTML;
    const template = document.createElement("template");
    template.innerHTML = this.engine.getHTML();
    // Write task nodes using Ren's existing portable checkbox shape.
    for (const list of [...template.content.querySelectorAll('ul[data-type="taskList"]')].reverse()) {
      const items = [...list.children].map(item => {
        const container = document.createElement("div");
        container.className = "editor-checkbox-item";
        container.setAttribute("contenteditable", "false");
        const checked = item.getAttribute("data-checked") === "true";
        if (checked) container.classList.add("checked");
        const input = document.createElement("input");
        input.type = "checkbox"; input.className = "checkbox-input";
        if (checked) input.setAttribute("checked", "");
        const label = document.createElement("span");
        label.className = "checkbox-text"; label.setAttribute("contenteditable", "true");
        const paragraphs = [...item.querySelectorAll(":scope > div > p")];
        paragraphs.forEach((paragraph,index) => {
          if (index) label.append(document.createElement("br"));
          label.append(...paragraph.childNodes);
        });
        container.append(input,label);
        return container;
      });
      list.replaceWith(...items);
    }
    return template.innerHTML;
  }
  getText() { return this.readOnly ? this.preview?.textContent || "" : this.engine.getText(); }
  focus() { if (this.readOnly) this.preview?.focus(); else this.engine.commands.focus(); }
  setEditable(value) { this.engine.setEditable(Boolean(value) && !this.readOnly, false); }
  command(name, ...args) {
    if (this.readOnly || !this.engine.isEditable) return false;
    return this.engine.chain().focus()[name](...args).run();
  }
  execUndo() { return this.command("undo"); }
  execRedo() { return this.command("redo"); }
  execBold() { return this.command("toggleBold"); }
  execItalic() { return this.command("toggleItalic"); }
  execUnderline() { return this.command("toggleUnderline"); }
  execStrikethrough() { return this.command("toggleStrike"); }
  execHeading(level) { return this.command("toggleHeading", {level}); }
  execBulletList() { return this.command("toggleBulletList"); }
  execNumberedList() { return this.command("toggleOrderedList"); }
  execBlockquote() { return this.command("toggleBlockquote"); }
  execCode() { return this.command("toggleCode"); }
  execHR() { return this.command("setHorizontalRule"); }
  execCheckbox() { return this.command("toggleTaskList"); }
}
window.RenEditor = RenEditor;
