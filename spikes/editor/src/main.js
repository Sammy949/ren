import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Code } from "@tiptap/extension-code";
import { convertLegacyNote } from "./legacy.js";

const state = document.querySelector("#state");
const editor = new Editor({
  element: document.querySelector("#editor"),
  extensions: [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false }),
    Code.extend({ inclusive: false }),
    TaskList,
    TaskItem,
  ],
  content: "<p>Choose a phrase, format it, and keep typing.</p>",
  onUpdate: ({ editor: updated }) => {
    state.textContent = `${updated.getText().length} characters`;
  },
});

const commands = {
  bold: () => editor.chain().focus().toggleBold().run(),
  code: () => editor.chain().focus().toggleCode().run(),
  task: () => editor.chain().focus().toggleTaskList().run(),
  undo: () => editor.chain().focus().undo().run(),
  redo: () => editor.chain().focus().redo().run(),
};

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => commands[button.dataset.command]());
});

// Exposed only in this disposable extension for browser verification.
globalThis.renEditorProof = editor;
globalThis.renEditorProofConvert = (note) => convertLegacyNote(editor, note);
state.textContent = `${editor.getText().length} characters`;
