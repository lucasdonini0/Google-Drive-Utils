# Google Drive Utils — implementation plan

## Distribution

Use Electron for a self-contained desktop window on Windows and macOS. Downloads and ZIP creation happen locally and stream to disk rather than being held in memory. No hosted file-processing server is needed.

Ship a portable Windows executable and a macOS `.app` in a ZIP. End users do not install Node.js or developer tools. Public releases should be code-signed, and macOS releases should be notarized.

## User flow

1. Paste a Google Drive folder URL.
2. Inspect the complete folder tree, following all listing pages, and show the proposed output before downloading.
3. Choose the destination and download mode:
   - One ZIP containing the complete linked folder.
   - One ZIP per immediate child folder, each containing all its descendants.
   - Individual files, preserving the folder structure.
4. When there are no child folders, ask the user to choose a ZIP or individual files.
5. Show progress, cancellation, retries, and a final list of any failures.

For the per-folder mode, default to one ZIP per immediate child folder. Deeper folders stay inside that ZIP. If files also exist directly in the linked folder, show them explicitly and propose a separate root-files ZIP so nothing is silently omitted. Let the user change the mode before starting.

## Google Drive integration

Use the official Drive API with a configured Google Cloud project. Do not publish user folder URLs or folder contents in the repository.

Use browser-based Google OAuth with PKCE and the `drive.readonly` permission so signed-in users can use public and private folder links. The desktop app receives the callback through a temporary loopback address. Store tokens with Electron's OS-backed encrypted storage. Signing out deletes the local token and requests remote revocation. Complete Google's restricted-scope verification before offering sign-in publicly.

Download ordinary files as bytes. Google Docs, Sheets, Slides, shortcuts, and files whose owner disabled downloads are reported and skipped in the first release. Export support comes later.

## Reliability

- Use streaming ZIP64 archives for large downloads and temporary output names until an archive is complete.
- Preserve nested paths and empty folders; sanitize Windows/macOS-incompatible names and resolve duplicate names deterministically.
- Guard against path traversal, symlink/shortcut loops, accidental overwrites, and low disk space.
- Keep Node.js isolated from the renderer with a sandboxed preload bridge and a restrictive Content Security Policy.
- Distinguish known byte progress from files whose export size is unknown.
- Test empty folders, nested folders, pagination, duplicate names, root files mixed with folders, files over 4 GB, permission failures, interrupted transfers, and Google Workspace exports on both platforms.

## Suggested milestones

1. ~~Implement the desktop UI, OAuth, recursive listing, three download modes, streaming ZIP creation, progress, cancellation, and retry.~~
2. Configure Google Cloud credentials and validate public and private folders against representative data.
3. Package and verify a portable Windows build.
4. Build, sign, notarize, and verify the macOS application on macOS.
5. Add Google Workspace export support after the first release.

## References

- [Drive downloads and exports](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
