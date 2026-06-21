# Ren - Features & Offerings

> **Ren** is a minimalist notepad Chrome extension that lives in your browser sidebar, designed for quick thoughts, ideas, and seamless note-taking.

---

## 🌿 Core Features

### 📝 Rich Text Editor

- **Contenteditable-based editor** with a clean, distraction-free writing experience
- **Full formatting toolbar** with:
  - Undo/Redo functionality
  - Bold, Italic, Underline text formatting
  - Headings (H1, H2, H3)
  - Bullet lists and numbered lists
  - Checklists/Checkboxes
  - Strikethrough
  - Blockquotes
  - Inline code formatting
  - Horizontal rules/dividers

### ⌨️ Markdown Shortcuts

Type markdown syntax and it automatically converts to formatted text:

- `# `, `## `, `### ` + space → Headings (H1, H2, H3)
- `**text**` → **Bold**
- `*text*` or `_text_` → _Italic_
- `` `text` `` → `Inline code`
- `- ` or `* ` + space → Bullet list
- `1. ` + space → Numbered list
- `> ` + space → Blockquote
- `---` → Horizontal rule
- `[] ` + space → Unchecked checkbox
- `[x] ` + space → Checked checkbox
- `~~text~~` → ~~Strikethrough~~

---

## 📚 Note Management

### Multiple Notes

- Create **unlimited notes** with ease
- Each note has its own:
  - Custom title (click to edit)
  - Rich text content
  - Creation and last updated timestamps

### Notes Sidebar

- **Glassy, glassmorphism-styled sidebar** accessible via hamburger menu
- View all notes in a scrollable list
- Note cards display:
  - Title
  - Content preview snippet
  - Last modified date
- **Context menu** on each note with:
  - Rename option
  - Delete option with confirmation dialog

### 🔍 Search

- **Real-time search** through all notes
- Searches both titles and content
- Highlights matching text
- Clear search button for quick reset
- Keyboard shortcut: `Ctrl+F`

---

## 💾 Storage & Sync

### Hybrid Chrome Storage

- **Local storage** for notes (5MB+ capacity for lots of notes)
- **Sync storage** for settings (syncs across all Chrome-signed-in devices)

### Auto-Save

- Notes **save automatically** as you type
- Debounced saving to prevent excessive writes
- Visual status indicator shows save state: "Ready", "Saving...", "Saved"

### Data Management

- **Export all notes** to a JSON file for backup
- **Import notes** from a JSON backup file
- Settings stored separately from notes for optimal performance

---

## 🎨 Theming & Appearance

### Theme Options

- **Light mode** - Clean, bright interface
- **Dark mode** - Easy on the eyes for low-light environments
- **System mode** - Automatically follows your OS/browser preference

### Visual Design

- Modern, minimalist aesthetic
- Glassmorphism sidebar with blur effects
- Smooth transitions and animations
- Responsive toolbar that adapts to different widths
- Clean gradient branding (green-to-blue Ren logo)

---

## ⌨️ Keyboard Shortcuts

| Shortcut       | Action                       |
| -------------- | ---------------------------- |
| `Alt+Shift+S`  | Open Ren extension         |
| `Ctrl+Alt+N`   | Create new note              |
| `Ctrl+S`       | Save current note            |
| `Ctrl+Shift+E` | Export all notes             |
| `Ctrl+Shift+O` | Open/close sidebar           |
| `Ctrl+,`       | Open settings                |
| `Ctrl+F`       | Focus search                 |
| `Ctrl+/`       | Show keyboard shortcuts help |
| `Ctrl+Alt+C`   | Insert checkbox              |
| `Ctrl+Z`       | Undo                         |
| `Ctrl+Y`       | Redo                         |
| `Ctrl+B`       | Bold (in editor)             |
| `Ctrl+I`       | Italic (in editor)           |
| `Ctrl+U`       | Underline (in editor)        |

---

## ♿ Accessibility (a11y)

### Screen Reader Support

- Proper ARIA labels and roles throughout the interface
- Screen reader announcement region for important actions
- `aria-live` regions for dynamic content updates

### Keyboard Navigation

- Full keyboard navigation support
- **Focus trapping** in modal dialogs
- Notes list navigable with arrow keys
- Skip link to jump directly to editor
- Proper tab order throughout the application

### Modal Dialogs

- **Rename modal** with keyboard support (Enter to confirm, Escape to cancel)
- **Delete confirmation modal** with focus management
- **Settings modal** with keyboard-accessible controls
- **Shortcuts help modal** accessible via keyboard

---

## 🧩 Browser Integration

### Chrome Side Panel

- Lives in Chrome's native **side panel** (not a popup)
- Toggle visibility by clicking the extension icon
- Stays open while browsing - perfect for note-taking while researching
- Automatically enabled for web pages

### Permissions

- **Side Panel** - For the sidebar interface
- **Storage** - For saving notes and settings locally and synced

---

## 📊 Status & Statistics

### Footer Status Bar

- **Word count** - Live word count as you type
- **Character count** - Total characters in current note
- **Auto-save status** - Shows current save state
- **Shortcuts info button** - Quick access to keyboard shortcuts

---

## 🚀 Performance Optimizations

### Efficient Data Handling

- **Map-based cache** for O(1) note lookups instead of array searches
- **Debounced auto-save** to prevent performance issues while typing
- **Separate debounce** for UI sidebar updates
- Incremental DOM updates for note list (not full re-renders)
- Individual note storage keys for efficient partial updates

---

## 🎉 Onboarding

### First-Time User Experience

- **Welcome screen** for new users
- Introduction to key features
- Quick-start tips
- Auto-creates a sample welcome note with helpful tips

---

## 📋 Summary

Ren offers a complete, polished note-taking experience designed specifically for the browser environment:

✅ Rich text editing with markdown shortcuts  
✅ Multiple notes with search  
✅ Automatic saving  
✅ Cross-device settings sync  
✅ Light/Dark/System themes  
✅ Full keyboard shortcut support  
✅ Accessible design  
✅ Data export/import  
✅ Native Chrome side panel integration

---

_Version 1.0.0_
