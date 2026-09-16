# Google Drive Utils

Tired of Google Drive splitting your downloads into four separate ZIP files? Use Google Drive Utils.

A portable app for macOS and Windows that lets you paste a Google Drive folder link and download its contents the way you want:

- Download everything as a single ZIP, or save the files individually.
- If the folder contains subfolders, download one ZIP per subfolder, including everything nested inside it.
- If it only contains files, choose between a ZIP and individual downloads.

It runs as a desktop app without an installer. Just download, open, sign in with Google, and paste your link.

## Current status

The first Windows and macOS version is under development. It already includes:

- Google sign-in for public and private folders.
- A single ZIP, one ZIP per immediate subfolder, or individual files.
- Nested folders, empty folders, duplicate names, progress, cancellation, and retry for failed downloads.
- Local ZIP creation and encrypted local token storage.

Google Docs, Sheets, Slides, and Drive shortcuts are reported and skipped for now.

## Development

Create a Google Cloud desktop OAuth client with the Drive API enabled. Download its credentials and save them as `oauth_client.json` in the project root. For a portable Windows build, the same file can sit next to the executable. The app uses a temporary loopback callback supported by Google's desktop OAuth flow.

```text
npm install
npm start
```

Use `npm test` for the automated checks and `npm run build:win` for a portable Windows executable. The macOS build must be created on macOS with `npm run build:mac`.
