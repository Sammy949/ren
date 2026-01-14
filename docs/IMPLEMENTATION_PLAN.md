# Sylva v2.0 - Implementation Plan

## Overview

Comprehensive improvements to Sylva Notepad covering performance, accessibility, UX, and feature enhancements.

---

## 🎯 Milestones

### Milestone 1: Performance Optimization

**Branch:** `perf/optimize-rendering`
**Commits:**

- `perf: implement targeted DOM updates instead of full re-renders`
- `perf: add note caching layer for faster switching`
- `perf: debounce sidebar updates separately from save`

**Changes:**

1. Replace `renderNotesList()` full re-render with targeted updates
2. Only update changed note items in the DOM
3. Add a Map-based cache for quick note lookups
4. Separate debounce timers for UI updates vs. storage saves

---

### Milestone 2: Accessibility (a11y)

**Branch:** `a11y/improve-accessibility`
**Commits:**

- `a11y: add ARIA labels and roles to interactive elements`
- `a11y: implement keyboard navigation for sidebar`
- `a11y: add focus management for modals`
- `a11y: add screen reader announcements for actions`

**Changes:**

1. Add `role`, `aria-label`, `aria-describedby` to buttons, modals, inputs
2. Add `aria-live` region for notifications (screen reader announcements)
3. Implement focus trap in modals
4. Add keyboard navigation (arrow keys) in notes list
5. Ensure proper focus restoration when closing modals/sidebar
6. Add skip links and landmark roles

---

### Milestone 3: Keyboard Shortcuts

**Branch:** `feat/keyboard-shortcuts`
**Commits:**

- `feat: add keyboard shortcut system with handler`
- `feat: implement core shortcuts (new note, save, search)`
- `feat: add shortcut hints in UI`
- `docs: add keyboard shortcuts help modal`

**Shortcuts to Implement:**
| Shortcut | Action | Notes |
|----------|--------|-------|
| `Ctrl+Shift+N` | New Note | Avoids browser's Ctrl+N |
| `Ctrl+S` | Force Save | Standard save shortcut |
| `Ctrl+Shift+F` | Focus Search | Avoids browser's Ctrl+F |
| `Ctrl+Shift+E` | Export Notes | |
| `Escape` | Close Sidebar/Modal | Already partial |
| `Ctrl+Shift+,` | Open Settings (future) | |

**Changes:**

1. Create `KeyboardShortcutManager` class
2. Register shortcuts with conflict detection
3. Add visual shortcut hints in buttons/menus
4. Create help modal showing all shortcuts (`Ctrl+/` or `?`)

---

### Milestone 4: Categories/Tags System

**Branch:** `feat/categories`
**Commits:**

- `feat: add category data model to notes`
- `feat: implement category creation and management UI`
- `feat: add category filter in sidebar`
- `feat: add color-coded category badges`
- `style: add category color picker`

**Data Model Changes:**

```javascript
// Note object
{
  id: string,
  title: string,
  content: string,
  categoryId: string | null,  // NEW
  createdAt: string,
  updatedAt: string
}

// New Category object
{
  id: string,
  name: string,
  color: string,  // hex color
  createdAt: string
}
```

**UI Changes:**

1. Add category dropdown in note editor header
2. Add category section in sidebar (collapsible)
3. Add category filter chips
4. Add "Manage Categories" modal
5. Color-coded badges on note items

---

### Milestone 5: Empty States & Onboarding

**Branch:** `ux/empty-states`
**Commits:**

- `ux: add beautiful empty state for no notes`
- `ux: add empty state for filtered results`
- `ux: add first-time user onboarding`
- `style: add illustrations for empty states`

**Changes:**

1. Design and implement empty state component
2. Empty state for: no notes, no search results, empty category
3. First-launch welcome screen with quick tips
4. Subtle animations for empty states
5. Clear CTAs (Call-to-Action) in empty states

---

### Milestone 6: Chrome Storage Migration

**Branch:** `feat/chrome-storage`
**Commits:**

- `feat: migrate from localStorage to chrome.storage.sync`
- `feat: add storage quota management`
- `feat: add sync status indicator`

**Changes:**

1. Replace `localStorage` with `chrome.storage.sync`
2. Handle storage quota limits (sync has ~100KB limit)
3. Implement chunking for large data
4. Add sync status in UI
5. Graceful fallback to local storage if sync fails

---

### Milestone 7: Search Functionality

**Branch:** `feat/search`
**Commits:**

- `feat: add search input in sidebar`
- `feat: implement fuzzy search across notes`
- `feat: add search result highlighting`
- `perf: add search debouncing`

**Changes:**

1. Add search input in sidebar header
2. Filter notes as user types (debounced)
3. Highlight matching text in results
4. Search across title and content
5. Keyboard shortcut to focus search

---

### Milestone 8: Dark Mode

**Branch:** `feat/dark-mode`
**Commits:**

- `feat: add CSS custom properties for theming`
- `feat: implement dark mode theme`
- `feat: add theme toggle in UI`
- `feat: respect system preference`

**Changes:**

1. Convert colors to CSS custom properties
2. Create dark theme color palette
3. Add theme toggle button
4. Detect and respect `prefers-color-scheme`
5. Persist theme preference

---

### Milestone 9: CSS Refactoring

**Branch:** `refactor/css-architecture`
**Commits:**

- `refactor: extract inline CSS to external stylesheet`
- `refactor: organize CSS with BEM or utility patterns`
- `style: add CSS custom properties for design tokens`

**Changes:**

1. Create `styles.css` file
2. Move all inline styles to external file
3. Organize with clear sections
4. Add design tokens (colors, spacing, typography)

---

## 📋 Implementation Order

| Priority | Milestone          | Rationale                          |
| -------- | ------------------ | ---------------------------------- |
| 1        | CSS Refactoring    | Foundation for all style changes   |
| 2        | Performance        | Better UX foundation               |
| 3        | Accessibility      | Core requirement                   |
| 4        | Keyboard Shortcuts | Power user feature, builds on a11y |
| 5        | Empty States       | Quick UX win                       |
| 6        | Categories/Tags    | Major feature                      |
| 7        | Search             | Complements categories             |
| 8        | Dark Mode          | Popular feature                    |
| 9        | Chrome Storage     | Final polish for cross-device      |

---

## 🏷️ Commit Convention

```
<type>(<scope>): <description>

Types:
- feat: New feature
- fix: Bug fix
- perf: Performance improvement
- a11y: Accessibility improvement
- ux: User experience improvement
- style: CSS/styling changes
- refactor: Code refactoring
- docs: Documentation
- chore: Maintenance tasks
```

---

## ✅ Definition of Done

Each milestone is complete when:

- [ ] All commits are made with conventional format
- [ ] Code works without console errors
- [ ] Changes are tested in Chrome extension
- [ ] Branch is merged to main
- [ ] Version number bumped if needed
