# 014 — Ready for public sign-in

**Goal:** everything Google's sign-in setup asks for when the app is published to everyone: a home page that describes the app and links a privacy policy, the policy itself on the same domain, terms, a logo, and a way for users to delete their data.

## Acceptance criteria

- `/privacy` says which Google account data is collected (name, email address, profile picture, account id) and why, what else is stored, that document text and questions go to Google's Gemini API (whose free tier may use them, with human review), who processes the data (Vercel, MongoDB Atlas, Google), the cookies used, how to delete documents and the whole account, and Google's Limited Use statement, with a contact link.
- `/terms` presents DocuMind as a demonstration provided as is, asks users to check cited pages, not to upload confidential material and not to automate or abuse the free service, and links the privacy policy.
- Every page has a footer linking Privacy, Terms and the source code.
- "Delete my account" on the documents page, after a confirmation that says what will be deleted, removes every row of the user (profile, documents, pages, chunks, chats, messages, upload counts) and signs them out. Other users' data and the sample templates are untouched.
- The app icon is the DocuMind logo, and a 120×120 PNG of it is served at `/brand/documind-logo-120.png` for the sign-in setup.
- `GOOGLE_SITE_VERIFICATION`, if set, is published as the `google-site-verification` meta tag, so the domain can be verified in Google Search Console.

## Tests first

- Component: the privacy and terms pages' required statements, the footer links, the delete-account confirmation.
- Integration: `deleteAccount` (everything of the user, nothing of anyone else) and the server action (deletes, signs out; does nothing signed out).
- Unit: the optional verification token.
