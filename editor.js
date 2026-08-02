/**
 * Ren Rich Editor
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

class RenEditor {
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
    this.element.classList.add("ren-editor");

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

    // Checkbox toggling via event delegation.
    // The per-checkbox listener set at creation time is lost as soon as a
    // note is serialized to innerHTML and reloaded, so we listen on the
    // editor root instead — this survives content reloads. It also fires the
    // change notification, which a checkbox inside a contenteditable=false
    // container would otherwise never do.
    this.element.addEventListener("change", (e) => {
      const checkbox = e.target;
      if (!checkbox.classList || !checkbox.classList.contains("checkbox-input"))
        return;

      const container = checkbox.closest(".editor-checkbox-item");
      if (container) container.classList.toggle("checked", checkbox.checked);

      // Reflect the property onto the attribute so the checked state
      // survives innerHTML serialization (property alone does not).
      if (checkbox.checked) checkbox.setAttribute("checked", "");
      else checkbox.removeAttribute("checked");

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
    let convertedBlock = false;
    if (e.inputType === "insertText" && e.data === " ") {
      convertedBlock = this.processBlockShortcuts(node, text, cursorPos);
    }

    // Process inline formatting (bold, italic, code) — skip if we just
    // converted the line to a block, since `node` may now be detached.
    if (!convertedBlock) {
      this.processInlineShortcuts(node);
    }
  }

  processBlockShortcuts(node, text, cursorPos) {
    const lineStart = text.lastIndexOf("\n", cursorPos - 2) + 1;
    const lineText = text.substring(lineStart, cursorPos);

    // Normalize: replace non-breaking space (160) with regular space (32)
    // contenteditable often inserts NBSP instead of regular space
    const normalizedLineText = lineText.replace(/\u00A0/g, " ");

    // Heading patterns
    if (normalizedLineText === "# ") {
      this.convertToBlock(node, lineStart, cursorPos, "h1");
      return true;
    }
    if (normalizedLineText === "## ") {
      this.convertToBlock(node, lineStart, cursorPos, "h2");
      return true;
    }
    if (normalizedLineText === "### ") {
      this.convertToBlock(node, lineStart, cursorPos, "h3");
      return true;
    }

    // Bullet list
    if (normalizedLineText === "- " || normalizedLineText === "* ") {
      this.convertToList(node, lineStart, cursorPos, "ul");
      return true;
    }

    // Numbered list
    if (/^\d+\. $/.test(normalizedLineText)) {
      this.convertToList(node, lineStart, cursorPos, "ol");
      return true;
    }

    // Blockquote
    if (normalizedLineText === "> ") {
      this.convertToBlock(node, lineStart, cursorPos, "blockquote");
      return true;
    }

    // Checkbox unchecked (accept both "[] " and GitHub-style "[ ] ")
    if (normalizedLineText === "[] " || normalizedLineText === "[ ] ") {
      this.convertToCheckbox(node, lineStart, cursorPos, false);
      return true;
    }

    // Checkbox checked (accept "[x] " and GitHub-style "[ x ] ")
    if (
      normalizedLineText === "[x] " ||
      normalizedLineText === "[X] " ||
      normalizedLineText === "[ x ] " ||
      normalizedLineText === "[ X ] "
    ) {
      this.convertToCheckbox(node, lineStart, cursorPos, true);
      return true;
    }

    return false;
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
      text.match(/(?<!\*)\*([^*]+)\*(?!\*)/) ||
      // Underscore italics only at word boundaries, so intra-word
      // underscores (e.g. snake_case_name) are left alone.
      text.match(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/);
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

    // Create new checkbox structure
    const checkboxItem = this.createCheckboxElement(checked, "");

    const parent = textNode.parentNode;

    if (before) {
      textNode.textContent = before;
      parent.insertBefore(checkboxItem, textNode.nextSibling);
    } else {
      parent.insertBefore(checkboxItem, textNode);
      textNode.textContent = "";
    }

    if (after.trim()) {
      const afterNode = document.createTextNode(after);
      parent.insertBefore(afterNode, checkboxItem.nextSibling);
    }

    // Focus the text span
    const textSpan = checkboxItem.querySelector(".checkbox-text");
    this.focusElement(textSpan);
  }

  /**
   * Creates a checkbox element with consistent structure
   * @param {boolean} checked - Whether the checkbox is checked
   * @param {string} text - The text content for the checkbox
   * @returns {HTMLElement} The checkbox container element
   */
  createCheckboxElement(checked, text) {
    const container = document.createElement("div");
    container.className = "editor-checkbox-item";
    container.setAttribute("contenteditable", "false");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.className = "checkbox-input";
    // Reflect as an attribute so the state survives innerHTML serialization.
    // Live toggling is handled by the delegated listener on the editor root.
    if (checked) checkbox.setAttribute("checked", "");

    const textSpan = document.createElement("span");
    textSpan.className = "checkbox-text";
    textSpan.setAttribute("contenteditable", "true");
    textSpan.textContent = text || "";
    if (!text) {
      textSpan.innerHTML = "<br>"; // Placeholder for empty checkbox
    }

    container.appendChild(checkbox);
    container.appendChild(textSpan);

    if (checked) {
      container.classList.add("checked");
    }

    return container;
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

    // Position the caret inside the trailing text node, not at the boundary
    // right after the inline element. A caret at the trailing edge of an
    // inline element has affinity to that element, so typed characters land
    // *inside* it and inherit the formatting ("spilling"). Placing the caret
    // at offset 0 of the sibling text node keeps new text outside the mark.
    const range = document.createRange();
    range.setStart(afterNode, 0);
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

    // Handle Enter in checkboxes - create a new line after
    if (e.key === "Enter") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      // Check if we're inside a checkbox
      const checkboxItem = selection.anchorNode.parentElement?.closest(
        ".editor-checkbox-item",
      );
      if (checkboxItem) {
        e.preventDefault();
        // Insert a new paragraph after the checkbox
        const p = document.createElement("div");
        p.innerHTML = "<br>";
        checkboxItem.parentNode.insertBefore(p, checkboxItem.nextSibling);
        this.focusElement(p);
        return;
      }

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

    // Handle Backspace
    if (e.key === "Backspace") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);

      // Check if we're at the start of a checkbox text area
      const checkboxItem = selection.anchorNode.parentElement?.closest(
        ".editor-checkbox-item",
      );
      if (checkboxItem) {
        const textSpan = checkboxItem.querySelector(".checkbox-text");
        // If we're in the text span and at the start, or the text is empty, delete the whole checkbox
        if (
          textSpan &&
          (range.startOffset === 0 || textSpan.textContent.trim() === "")
        ) {
          e.preventDefault();
          // Create a paragraph with any remaining text
          const remainingText = textSpan.textContent.trim();
          const p = document.createElement("div");
          // Use textContent (not innerHTML) so characters like < or & in the
          // task text aren't reinterpreted as markup.
          if (remainingText) p.textContent = remainingText;
          else p.innerHTML = "<br>";
          checkboxItem.parentNode.insertBefore(p, checkboxItem);
          checkboxItem.remove();
          this.focusElement(p);
          return;
        }
      }

      // Check if we're right after a checkbox (previous sibling is a checkbox)
      if (range.startOffset === 0) {
        const node = selection.anchorNode;
        let prevSibling = node.previousSibling;

        // If the current node is inside an element, check the element's previous sibling
        if (!prevSibling && node.parentElement) {
          prevSibling = node.parentElement.previousSibling;
        }

        if (
          prevSibling &&
          prevSibling.classList?.contains("editor-checkbox-item")
        ) {
          e.preventDefault();
          prevSibling.remove();
          return;
        }

        // Check if previous sibling is a BR that follows an HR (from --- shortcut)
        if (prevSibling && prevSibling.nodeName === "BR") {
          const beforeBr = prevSibling.previousSibling;
          if (beforeBr && beforeBr.nodeName === "HR") {
            e.preventDefault();
            beforeBr.remove(); // Remove the HR
            prevSibling.remove(); // Remove the BR
            return;
          }
        }

        // Check if previous sibling is directly an HR
        if (prevSibling && prevSibling.nodeName === "HR") {
          e.preventDefault();
          prevSibling.remove();
          return;
        }

        const block = selection.anchorNode.parentElement?.closest(
          "h1, h2, h3, blockquote",
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
    this.normalizeCheckboxes();
  }

  /**
   * Reconcile checkbox state after loading serialized content.
   * Old notes stored the checked state only as a `.checked` class on the
   * container; new notes also carry the `checked` attribute on the input.
   * Treat either as authoritative and make input, attribute, and class agree
   * so reloaded checkboxes render and toggle correctly.
   */
  normalizeCheckboxes() {
    const items = this.element.querySelectorAll(".editor-checkbox-item");
    items.forEach((container) => {
      const checkbox = container.querySelector(".checkbox-input");
      if (!checkbox) return;

      const checked =
        checkbox.hasAttribute("checked") ||
        container.classList.contains("checked");

      checkbox.checked = checked;
      if (checked) checkbox.setAttribute("checked", "");
      else checkbox.removeAttribute("checked");
      container.classList.toggle("checked", checked);
    });
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
  execUndo() {
    document.execCommand("undo", false, null);
  }

  execRedo() {
    document.execCommand("redo", false, null);
  }

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

  /**
   * Convert the current line to a checkbox (Ctrl+Alt+C)
   */
  execCheckbox() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    let node = range.startContainer;

    // If we're in a text node, get its content
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const cursorPos = range.startOffset;

      // Find line boundaries
      let lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
      let lineEnd = text.indexOf("\n", cursorPos);
      if (lineEnd === -1) lineEnd = text.length;

      const lineContent = text.substring(lineStart, lineEnd).trim();

      // Create the checkbox using the helper
      const checkboxItem = this.createCheckboxElement(false, lineContent);

      // Replace the line content
      const before = text.substring(0, lineStart);
      const after = text.substring(lineEnd);
      const parent = node.parentNode;

      if (before) {
        node.textContent = before;
        parent.insertBefore(checkboxItem, node.nextSibling);
        if (after.trim()) {
          const afterNode = document.createTextNode(after);
          parent.insertBefore(afterNode, checkboxItem.nextSibling);
        }
      } else {
        parent.insertBefore(checkboxItem, node);
        if (after.trim()) {
          node.textContent = after;
        } else {
          node.textContent = "";
        }
      }

      // Focus the text span
      const textSpan = checkboxItem.querySelector(".checkbox-text");
      this.focusElement(textSpan);
    } else {
      // We're in an element node - insert checkbox at cursor
      const checkboxItem = this.createCheckboxElement(false, "");
      range.insertNode(checkboxItem);

      // Focus the text span
      const textSpan = checkboxItem.querySelector(".checkbox-text");
      this.focusElement(textSpan);
    }
  }
}

// Export for use
window.RenEditor = RenEditor;
