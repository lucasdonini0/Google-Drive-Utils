# Google Drive Utils — proposed implementation

## Distribution

Build a portable Go application with an embedded web interface. Opening the application starts a local HTTP server bound only to 127.0.0.1 and opens the user's browser. Downloads and ZIP creation happen in the local application, streamed to disk rather than held in browser memory. No hosted file-processing server is needed.

Ship a Windows executable and a macOS .app in a ZIP, with builds for the supported CPU architectures. Users do not install Go or other developer tools. Use signing and macOS notarization for public releases. This is a proposal, not an implemented architecture.

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

First validate recursive listing and downloads against a representative public folder. Use the official Drive API with a configured Google Cloud project; validate API-key access for public links, including resource keys, instead of assuming every shared URL is anonymously downloadable. Do not publish the user's example folder URL or its contents in the repository.

For private folders, add browser-based Google OAuth with PKCE and the appropriate read permissions. Choosing an existing folder does not automatically grant access to all descendants through drive.file. Review scope requirements and Google's verification process before offering private-folder support publicly. Store tokens in the OS credential store.

Download ordinary files as bytes and export Google Docs, Sheets, and Slides to explicitly selected supported formats. Respect download restrictions and quotas. Report inaccessible files and unsupported exports instead of claiming that an incomplete archive is complete.

## Reliability

- Use streaming ZIP64 archives for large downloads, bounded concurrency, backoff, and temporary output names until an archive is complete.
- Preserve nested paths and empty folders; sanitize Windows/macOS-incompatible names and resolve duplicate names deterministically.
- Guard against path traversal, symlink/shortcut loops, accidental overwrites, and low disk space.
- Bind the UI server to loopback, use a per-launch session token, validate request origins, and never expose arbitrary filesystem endpoints.
- Distinguish known byte progress from files whose export size is unknown.
- Test empty folders, nested folders, pagination, duplicate names, root files mixed with folders, files over 4 GB, permission failures, interrupted transfers, and Google Workspace exports on both platforms.

## Suggested milestones

1. Prove Drive access and recursive listing with a public folder.
2. Implement the three download modes and reliable streaming ZIP creation.
3. Add the local browser interface, progress, cancellation, and error reporting.
4. Package and verify portable Windows and macOS builds.
5. Add private-folder OAuth and Workspace exports after access and distribution requirements are validated.

## References

- [Go embedded assets](https://pkg.go.dev/embed)
- [Go ZIP support](https://pkg.go.dev/archive/zip)
- [Drive downloads and exports](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
