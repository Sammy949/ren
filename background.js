// Background script for Sylva Chrome Extension

// This listener is called when the extension is first installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  console.log("Sylva extension installed");

  // Set the default panel behavior: when the action button is clicked,
  // it should attempt to open the side panel. This is a one-time setup.
  // This line is essential for the *action button* to implicitly open the side panel
  // without needing a complex 'onClicked' handler that just opens it.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error)); // Add error handling for safety
});

// This listener handles when the extension's toolbar icon is clicked.
// Its primary purpose is now to *toggle* the side panel's visibility
// for the current tab, rather than just opening it.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Get the current side panel options for the specific tab
    const options = await chrome.sidePanel.getOptions({ tabId: tab.id });

    // If the side panel is currently enabled (and thus potentially open) for this tab
    if (options && options.enabled) {
      // Disable it to effectively close/hide it
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        enabled: false, // Disables the side panel for the current tab, hiding it
      });
    } else {
      // If the side panel is not enabled for this tab (or globally), open it.
      // Calling chrome.sidePanel.open() implicitly enables it for the tab.
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (error) {
    console.error("Error toggling side panel on action click:", error);
    // You might want to provide user feedback here, e.g., a notification if it failed to open.
  }
});

// Ensure the side panel is enabled for every new or updated tab,
// as the `_execute_side_panel` command can only open it if it's enabled for the context.
// This also ensures it's available as users navigate between pages.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // Only act when the tab has finished loading and it's a valid web URL.
  // Exclude internal Chrome pages (chrome://), about: pages, and local file:// URLs,
  // where side panels generally cannot be opened.
  if (
    info.status === "complete" &&
    tab.url &&
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("about:") &&
    !tab.url.startsWith("file://")
  ) {
    try {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: "sidepanel.html", // Ensure this path is correct to your side panel HTML
        enabled: true, // Enable the side panel for this tab
      });
    } catch (error) {
      // Log a warning if it couldn't enable for a specific tab (e.g., restricted page)
      console.warn(`Could not enable side panel for tab ${tabId} (${tab.url}):`, error);
    }
  }
});

// Also handle when a user switches to a different tab, to ensure the side panel
// is enabled for the newly active tab.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Only enable for valid web URLs, similar to onUpdated.
    if (
      tab.url &&
      !tab.url.startsWith("chrome://") &&
      !tab.url.startsWith("about:") &&
      !tab.url.startsWith("file://")
    ) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: "sidepanel.html",
        enabled: true,
      });
    }
  } catch (error) {
    // Log a warning if there's an issue getting the tab or enabling the panel
    console.warn(`Could not enable side panel for activated tab ${tabId}:`, error);
  }
});