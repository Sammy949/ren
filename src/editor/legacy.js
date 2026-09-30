import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

const allowedTags = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "H1", "H2",
  "H3", "HR", "I", "INPUT", "LI", "OL", "P", "S", "SPAN", "STRIKE",
  "STRONG", "U", "UL",
]);
const inlineTags = new Set([
  "A", "B", "BR", "CODE", "EM", "I", "S", "SPAN", "STRIKE", "STRONG", "U",
]);

function normalizeText(text) {
  return text.replace(/\s+/g, "").trim();
}

function quarantine(originalHtml, reason) {
  return { ok: false, originalHtml, reason };
}

/** Convert one legacy note without changing any stored record. */
export function convertLegacyNote(editor, note) {
  const originalHtml = note?.content;
  if (typeof originalHtml !== "string") {
    return quarantine(originalHtml, "Content is not a string");
  }

  const template = document.createElement("template");
  if (/<[a-z][^>]*>/i.test(originalHtml)) {
    template.innerHTML = originalHtml;
  } else {
    const paragraph = document.createElement("p");
    const lines = originalHtml.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement("br"));
      paragraph.append(document.createTextNode(line));
    });
    template.content.append(paragraph);
  }

  const warnings = [];
  for (const element of template.content.querySelectorAll("*")) {
    if (!allowedTags.has(element.tagName)) {
      warnings.push(`Unsupported element: ${element.tagName.toLowerCase()}`);
    }
    for (const attribute of element.attributes) {
      const allowed =
        (element.tagName === "A" && ["href", "target", "rel"].includes(attribute.name)) ||
        (element.tagName === "OL" && attribute.name === "start" &&
          /^-?\d+$/.test(attribute.value) && Number.isSafeInteger(Number(attribute.value))) ||
        (element.tagName === "OL" && attribute.name === "type" && /^[1aAiI]$/.test(attribute.value)) ||
        (element.tagName === "DIV" && ["class", "contenteditable"].includes(attribute.name)) ||
        (element.tagName === "INPUT" && ["class", "type", "checked"].includes(attribute.name)) ||
        (element.tagName === "SPAN" && ["class", "contenteditable"].includes(attribute.name));
      if (!allowed) warnings.push(`Unsupported attribute: ${attribute.name}`);
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") || "";
      if (!/^(https?:|mailto:)/i.test(href.trim())) {
        warnings.push("Unsupported link destination");
      }
    }
    if (element.tagName === "CODE" && (
      element.querySelector("b,strong,i,em,u,s,strike,a") ||
      element.parentElement?.closest("b,strong,i,em,u,s,strike,a")
    )) warnings.push("Unsupported formatting combined with code");
    if (["DIV", "SPAN", "INPUT"].includes(element.tagName)) {
      const classes = [...element.classList];
      const expected = {
        DIV: ["editor-checkbox-item", "checked"],
        SPAN: ["checkbox-text"],
        INPUT: ["checkbox-input"],
      }[element.tagName];
      if (classes.some((name) => !expected.includes(name))) {
        warnings.push("Unsupported class");
      }
      if (
        classes.length > 0 &&
        ((element.tagName === "DIV" && !classes.includes("editor-checkbox-item")) ||
          (element.tagName === "SPAN" && !classes.includes("checkbox-text")) ||
          (element.tagName === "INPUT" && !classes.includes("checkbox-input")))
      ) {
        warnings.push("Unsupported class structure");
      }
    }
  }
  if (warnings.length) return quarantine(originalHtml, [...new Set(warnings)].join("; "));

  const originalText = normalizeText(template.content.textContent || "");
  const taskContainers = [...template.content.querySelectorAll("div.editor-checkbox-item")];
  for (const container of taskContainers) {
    const children = [...container.children];
    const checkbox = children.find((element) => element.matches("input.checkbox-input[type=checkbox]"));
    const label = children.find((element) => element.matches("span.checkbox-text"));
    if (
      !checkbox || !label || children.length !== 2 ||
      [...label.querySelectorAll("*")].some((element) => !inlineTags.has(element.tagName))
    ) {
      return quarantine(originalHtml, "Unsupported task structure");
    }
    const checked = checkbox.hasAttribute("checked") ||
      container.classList.contains("checked");
    const list = document.createElement("ul");
    list.setAttribute("data-type", "taskList");
    const item = document.createElement("li");
    item.setAttribute("data-type", "taskItem");
    item.setAttribute("data-checked", String(checked));
    const paragraph = document.createElement("p");
    paragraph.append(...label.childNodes);
    item.append(paragraph);
    list.append(item);
    container.replaceWith(list);
  }

  if (template.content.querySelector("input")) {
    return quarantine(originalHtml, "Checkbox outside a task");
  }
  for (const element of [...template.content.querySelectorAll("div")]) {
    if ([...element.children].some((child) => !inlineTags.has(child.tagName))) {
      return quarantine(originalHtml, "Unsupported block inside a div");
    }
    const paragraph = document.createElement("p");
    paragraph.append(...element.childNodes);
    element.replaceWith(paragraph);
  }
  for (const element of template.content.querySelectorAll("span")) {
    element.replaceWith(...element.childNodes);
  }

  // Parse against the production schema without touching the open document,
  // selection, or undo history. Conversion remains a read-only decision.
  const parsed = ProseMirrorDOMParser.fromSchema(editor.schema).parse(template.content, { preserveWhitespace: "full" });
  if (normalizeText(parsed.textContent) !== originalText) {
    return quarantine(originalHtml, "Converted text differs from the original");
  }
  // StarterKit's trailing-node extension adds a paragraph after a final
  // non-paragraph block. Include it now so the first open is a stable round trip.
  const doc = parsed.lastChild?.type.name === "paragraph"
    ? parsed
    : parsed.copy(parsed.content.addToEnd(editor.schema.nodes.paragraph.create()));
  return { ok: true, version: 2, doc: doc.toJSON(), originalHtml };
}
