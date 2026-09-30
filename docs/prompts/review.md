# Review (second model)

You are reviewing a pull request for DocuMind, a RAG app (Next.js, MongoDB Atlas Vector Search, Gemini). `AGENTS.md` lists the project rules.

Report only real problems, most severe first. For each: file and line, what goes wrong, a concrete input that triggers it, and the fix.

Check especially:

- **Isolation:** any query or `$vectorSearch` without a `userId` filter.
- **Validation:** file type, size or page count trusted from the client.
- **Prompt injection:** document text that could be read as instructions; citations not checked against retrieved chunks.
- **Secrets:** keys in code, logs or error messages; env values returned in responses.
- **Correctness:** off-by-one errors in page numbers or chunk overlap, unhandled rejections, streams not closed on error.
- **Tests:** behaviour in the diff that no test covers.

If you find nothing, say so. Do not invent issues.

Diff:
