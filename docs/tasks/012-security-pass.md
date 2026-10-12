# 012 — Security pass

**Goal:** review the app's trust boundaries before calling it done, fix what the review finds, and write the threat model down.

## Acceptance criteria

- Every response carries security headers: `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (no framing, so no clickjacking of buttons such as "Confirm delete"), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` turning off camera, microphone and location.
- Uploaded file names are cleaned before they are stored: control characters and text-direction overrides (which can make `invoice‮fdp.exe` display as `invoiceexe.pdf`) are removed, whitespace is collapsed, and names over `LIMITS.maxFilenameChars` (120) are shortened, keeping the extension.
- Each user may upload `LIMITS.maxUploadsPerDay` (10) documents per UTC day, counted when an upload passes every check and is about to be embedded, so deleting and re-uploading can't drain the shared embedding quota. The next upload answers `429 daily_upload_limit_reached` with `resetsAt`, and stores and embeds nothing. Rejected uploads don't count.
- `docs/SECURITY.md` records the threat model: what is protected, how, and what is accepted.

## Tests first

- Unit: the header list, `cleanFilename`, the new limits.
- Integration: the upload route stores the cleaned name; the daily cap (including uploads that were deleted), rejected uploads not counting, and per-user counting.
