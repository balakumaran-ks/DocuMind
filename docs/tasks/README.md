# Task files

The MVP is built in small slices. Each task file states the goal, the acceptance criteria, the tests to write first and the files likely touched, and each one lands as its own pull request.

| # | Slice | Phase | Status |
| --- | --- | --- | --- |
| [000](000-setup.md) | Repository, docs, CI, scaffold | Setup | ✅ Done |
| [001](001-upload-and-extract.md) | Upload a PDF, extract text per page | MVP | ✅ Done |
| [002](002-chunker.md) | Page-bounded chunker with overlap | MVP | ✅ Done |
| [003](003-embed-and-index.md) | Embed chunks, Atlas vector index with `userId` filter | MVP | ✅ Done |
| [004](004-ask-route.md) | Ask route: retrieve, prompt with page tags, stream | MVP | ✅ Done |
| [005](005-chat-ui-auth-history.md) | Chat UI with citations, Google sign-in, history | MVP | ✅ Done |
| [006](006-evals-and-deploy.md) | First 15 eval questions, deploy to Vercel | MVP | ✅ Done (live check pending) |
| [007](007-free-tier-ingestion.md) | Index large documents within the free tier | MVP | In review (007a, 007b) |
