# DocuMind — Security and threat model

What DocuMind protects, how, and which risks are accepted. Reviewed in [task 012](tasks/012-security-pass.md).

## What is protected

- Each user's documents, questions and answers, from other users.
- The shared free quotas (Gemini embeddings and answers), which every user depends on.
- Secrets: the database password, OAuth client secret, session secret and API key.

## Controls

| Threat | Control |
| --- | --- |
| Someone else's data | Every query and both searches filter by the session's `userId`; for search, the filter runs inside the index, so other users' chunks are never candidates. Another user's id gets `404`, as if it didn't exist. Integration tests cover each route. |
| Impersonation | Google sign-in through Auth.js. The session is an encrypted JWT in an `HttpOnly` cookie (`Secure` in production) signed with `AUTH_SECRET`; the user id comes from the session, never from the request. |
| Cross-site requests | The session cookie is `SameSite=Lax`, so it isn't sent on cross-site `POST`s; `DELETE` needs a CORS preflight that the app never grants. |
| Clickjacking | `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on every response; deleting needs a second confirming click. |
| Script injection (XSS) | React escapes all text. Answers are rendered as text, with citation buttons built from parsed markers; no raw HTML is rendered anywhere. |
| Prompt injection from documents | Document text is wrapped in `<source>` tags, with `<source` and `</source` escaped so it can't break out, and the rules say to ignore instructions inside sources. Only document letters, never file names, enter the prompt. The model has no tools or privileged actions, so the worst case is a wrong answer. The eval set includes a document with hidden instructions: 4 of 4 resisted. |
| Invented citations | Citations are kept only for pages that were actually retrieved (per document across documents). |
| Malicious files | Type by magic bytes (`%PDF-`), size (4 MB) and page count (50) are checked on the server. PDFs are parsed for text only (PDF.js via unpdf), never rendered or executed. File names are cleaned of control and text-direction characters and shortened. |
| Quota abuse | Per user: 5 documents, 10 uploads a day (deleted ones count), 50 questions a day, questions up to 1,000 characters. Vectors are reused by content hash. |
| Secrets in the repository | Secrets live only in `.env.local` and Vercel; `.env*` is ignored except `.env.example`. `/api/health` reports missing variables by name only. |
| Operator access | `npm run stats` is the only query across users. It prints counts only, and refusals are detected inside the database query, so no question or answer text reaches it. |

## Accepted risks

- **Document text goes to Google.** Answers and embeddings use the Gemini API's free tier, under which Google may use submitted content to improve its products and human reviewers may read it ([terms](https://ai.google.dev/gemini-api/terms)). The upload area says so: don't upload anything confidential or personal. A paid tier changes these terms.
- **The database accepts connections from any IP address.** Vercel's Hobby plan has no fixed outbound IPs, so Atlas network access is open, and the strong database password and TLS are the protection.
- **Caps can be exceeded slightly under concurrency.** The question cap counts and then writes, so simultaneous requests can pass together; the upload cap is atomic.
- **Caps are per account.** Several Google accounts multiply them.
- **No full Content Security Policy.** Next.js inline scripts would need nonces; only `frame-ancestors` is set.
- **No end-to-end browser test.** Flows are covered by component tests in the browser layer and integration tests against a real MongoDB, not by one test driving a real browser through sign-in.
