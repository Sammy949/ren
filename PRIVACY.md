# Ren — Privacy Policy

_Last updated: 2 October 2026_

Ren ("the extension") is a notepad that runs in the Google Chrome side panel.

## What we collect

**Nothing.** Ren does not collect, transmit, sell, or share any personal data.
We operate no servers and have no ability to see your notes or settings.

## Your notes and settings

- **Notes** you write are stored locally on your device using Chrome's storage
  API (`chrome.storage.local`). They never leave your machine through Ren.
- **Settings** (theme, onboarding state) are stored using Chrome's sync storage
  (`chrome.storage.sync`). Google may sync this small amount of data across
  devices where you are signed into the same Chrome profile. It stays inside
  your own Google account and is never sent to us or any third party.

## Permissions

- **`sidePanel`** — to display Ren inside Chrome's native side panel.
- **`storage`** — to save your notes and settings on your device.

Ren requests no other extension permissions and accesses no web page content.
If you choose **Back up to folder**, Chrome asks you to select and allow access
to a folder. Ren writes a new JSON backup there and reads it back to verify the
write. Ren does not scan other files in that folder or upload the backup.
Backups are plain text, not encrypted; a folder synced by another application
may be uploaded by that application.

## Data deletion

Uninstalling Ren removes its local note storage. Clearing browsing history or
cache does not clear notes stored in Chrome's extension storage. You can delete
individual notes in Ren and export a JSON backup from Settings. Downloaded and folder
backups remain wherever you saved them and must be deleted separately.

See [Chrome's storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)
for browser storage behavior.

## Third parties

Ren contains **no analytics, no trackers, and no third-party code** that
transmits data.

## Contact

Questions: hello@samuelyahaya.com

## Changes

Any updates to this policy will be posted at this URL.
