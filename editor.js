/**
 * Sylva Rich Editor
 * A lightweight contenteditable editor with markdown shortcuts
 *
 * Supported shortcuts:
 * - # , ## , ### + space → Headings
 * - **text** → Bold
 * - *text* or _text_ → Italic
 * - `text` → Inline code
 * - - or * + space → Bullet list
 * - 1. + space → Numbered list
 * - > + space → Blockquote
 * - --- → Horizontal rule
 * - [] + space → Checkbox (unchecked)
 * - [x] + space → Checkbox (checked)
 */

class SylvaEditor {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      placeholder: options.placeholder || "Start writing...",
      onChange: options.onChange || (() => {}),
      onInput: options.onInput || (() => {}),
      ...options,
    };

    this.init();
  }

  init() {
    // Make element editable
    this.element.setAttribute("contenteditable", "true");
    this.element.setAttribute("spellcheck", "true");
    this.element.classList.add("sylva-editor");

    // Set placeholder
    this.element.dataset.placeholder = this.options.placeholder;

    // Bind events
    this.bindEvents();
  }

  bindEvents() {
    // Handle input for markdown shortcuts
    this.element.addEventListener("input", (e) => this.handleInput(e));

    // Handle keydown for special keys
    this.element.addEventListener("keydown", (e) => this.handleKeydown(e));

    // Handle paste to clean HTML
    this.element.addEventListener("paste", (e) => this.handlePaste(e));

    // Notify parent of changes
    this.element.addEventListener("input", () => {
      this.options.onInput();
      this.options.onChange(this.getHTML());
    });
  }

  handleInput(e) {
    // Check for markdown patterns after space or enter
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;
    const cursorPos = range.startOffset;

    // Only process on space (for block patterns)
    if (e.inputType === "insertText" && e.data === " ") {
      this.processBlockShortcuts(node, text, cursorPos);
    }

    // Process inline formatting (bold, italic, code)
    this.processInlineShortcuts(node);
  }

  processBlockShortcuts(node, text, cursorPos) {
    const lineStart = text.lastIndexOf("\n", cursorPos - 2) + 1;
    const lineText = text.substring(lineStart, cursorPos);

    // Heading patterns
    if (lineText === "# ") {
      this.convertToBlock(node, lineStart, cursorPos, "h1");
      return;
    }
    if (lineText === "## ") {
      this.convertToBlock(node, lineStart, cursorPos, "h2");
      return;
    }
    if (lineText === "### ") {
      this.convertToBlock(node, lineStart, cursorPos, "h3");
      return;
    }

    // Bullet list
    if (lineText === "- " || lineText === "* ") {
      this.convertToList(node, lineStart, cursorPos, "ul");
      return;
    }

    // Numbered list
    if (/^\d+\. $/.test(lineText)) {
      this.convertToList(node, lineStart, cursorPos, "ol");
      return;
    }

    // Blockquote
    if (lineText === "> ") {
      this.convertToBlock(node, lineStart, cursorPos, "blockquote");
      return;
    }

    // Checkbox unchecked
    if (lineText === "[] ") {
      this.convertToCheckbox(node, lineStart, cursorPos, false);
      return;
    }

    // Checkbox checked
    if (lineText === "[x] " || lineText === "[X] ") {
      this.convertToCheckbox(node, lineStart, cursorPos, true);
      return;
    }
  }

  processInlineShortcuts(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;

    const text = node.textContent;

    // Bold: **text**
    const boldMatch = text.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      this.wrapInline(node, boldMatch, "strong");
      return;
    }

    // Italic: *text* or _text_
    const italicMatch =
      text.match(/(?<!\*)\*([^*]+)\*(?!\*)/) || text.match(/_([^_]+)_/);
    if (italicMatch) {
      this.wrapInline(node, italicMatch, "em");
      return;
    }

    // Code: `text`
    const codeMatch = text.match(/`([^`]+)`/);
    if (codeMatch) {
      this.wrapInline(node, codeMatch, "code");
      return;
    }

    // Strikethrough: ~~text~~
    const strikeMatch = text.match(/~~(.+?)~~/);
    if (strikeMatch) {
      this.wrapInline(node, strikeMatch, "s");
      return;
    }

    // Horizontal rule: ---
    if (text.trim() === "---") {
      this.convertToHR(node);
      return;
    }
  }

  convertToBlock(textNode, start, end, tagName) {
    const text = textNode.textContent;
    const before = text.substring(0, start);
    const after = text.substring(end);

    // Create the new block element
    const block = document.createElement(tagName);
    block.innerHTML = "<br>"; // Empty with cursor placeholder

    // Handle the conversion
    const parent = textNode.parentNode;

    if (before) {
      textNode.textContent = before;
      parent.insertBefore(block, textNode.nextSibling);
    } else {
      parent.insertBefore(block, textNode);
      textNode.textContent = "";
    }

    if (after.trim()) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, block.nextSibling);
    }

    // Focus the new block
    this.focusElement(block);
  }

  convertToList(textNode, start, end, listType) {
    const text = textNode.textContent;
    const before = text.substring(0, start);
    const after = text.substring(end);

    const list = document.createElement(listType);
    const li = document.createElement("li");
    li.innerHTML = "<br>";
    list.appendChild(li);

    const parent = textNode.parentNode;

    if (before) {
      textNode.textContent = before;
      parent.insertBefore(list, textNode.nextSibling);
    } else {
      parent.insertBefore(list, textNode);
      textNode.textContent = "";
    }

    if (after.trim()) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, list.nextSibling);
    }

    this.focusElement(li);
  }

  convertToCheckbox(textNode, start, end, checked) {
    const text = textNode.textContent;
    const before = text.substring(0, start);
    const after = text.substring(end);

    const label = document.createElement("label");
    label.className = "editor-checkbox";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;

    const span = document.createElement("span");
    span.innerHTML = "<br>";

    label.appendChild(checkbox);
    label.appendChild(span);

    const parent = textNode.parentNode;

    if (before) {
      textNode.textContent = before;
      parent.insertBefore(label, textNode.nextSibling);
    } else {
      parent.insertBefore(label, textNode);
      textNode.textContent = "";
    }

    if (after.trim()) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, label.nextSibling);
    }

    this.focusElement(span);
  }

  convertToHR(textNode) {
    const hr = document.createElement("hr");
    const br = document.createElement("br");

    const parent = textNode.parentNode;
    parent.insertBefore(hr, textNode);
    parent.insertBefore(br, textNode);
    textNode.textContent = "";

    // Move cursor after HR
    const range = document.createRange();
    range.setStartAfter(br);
    range.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  wrapInline(textNode, match, tagName) {
    const text = textNode.textContent;
    const matchStart = text.indexOf(match[0]);
    const matchEnd = matchStart + match[0].length;

    const before = text.substring(0, matchStart);
    const inner = match[1];
    const after = text.substring(matchEnd);

    const parent = textNode.parentNode;

    // Create nodes
    const beforeNode = document.createTextNode(before);
    const element = document.createElement(tagName);
    element.textContent = inner;
    const afterNode = document.createTextNode(after);

    // Replace
    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(element, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    // Position cursor after the element
    const range = document.createRange();
    range.setStartAfter(element);
    range.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  focusElement(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  handleKeydown(e) {
    // Handle Tab for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "    ");
    }

    // Handle Enter in lists
    if (e.key === "Enter") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const li = selection.anchorNode.parentElement?.closest("li");
      if (li && li.textContent.trim() === "") {
        // Empty list item - exit list
        e.preventDefault();
        const list = li.parentElement;
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        list.parentNode.insertBefore(p, list.nextSibling);
        li.remove();
        if (list.children.length === 0) {
          list.remove();
        }
        this.focusElement(p);
      }
    }

    // Handle Backspace at start of formatted block
    if (e.key === "Backspace") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      if (range.startOffset === 0) {
        const block = selection.anchorNode.parentElement?.closest(
          "h1, h2, h3, blockquote"
        );
        if (block && block.textContent === "") {
          e.preventDefault();
          const p = document.createElement("p");
          p.innerHTML = "<br>";
          block.parentNode.insertBefore(p, block);
          block.remove();
          this.focusElement(p);
        }
      }
    }
  }

  handlePaste(e) {
    e.preventDefault();

    // Get plain text from clipboard
    const text = e.clipboardData.getData("text/plain");

    // Insert as plain text
    document.execCommand("insertText", false, text);
  }

  // Public API
  getHTML() {
    return this.element.innerHTML;
  }

  setHTML(html) {
    this.element.innerHTML = html || "";
  }

  getText() {
    return this.element.textContent;
  }

  setText(text) {
    this.element.textContent = text || "";
  }

  focus() {
    this.element.focus();
  }

  clear() {
    this.element.innerHTML = "";
  }

  // Toolbar actions (can be called from external toolbar)
  execBold() {
    document.execCommand("bold", false, null);
  }

  execItalic() {
    document.execCommand("italic", false, null);
  }

  execUnderline() {
    document.execCommand("underline", false, null);
  }

  execStrikethrough() {
    document.execCommand("strikeThrough", false, null);
  }

  execHeading(level) {
    document.execCommand("formatBlock", false, `h${level}`);
  }

  execBulletList() {
    document.execCommand("insertUnorderedList", false, null);
  }

  execNumberedList() {
    document.execCommand("insertOrderedList", false, null);
  }

  execBlockquote() {
    document.execCommand("formatBlock", false, "blockquote");
  }

  execCode() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const code = document.createElement("code");
      code.textContent = range.toString();
      range.deleteContents();
      range.insertNode(code);
    }
  }

  execLink(url) {
    document.execCommand("createLink", false, url);
  }

  execHR() {
    document.execCommand("insertHorizontalRule", false, null);
  }
}

// Export for use
window.SylvaEditor = SylvaEditor;
