# Task files

One file per feature slice, handed to an agent one at a time. Each has a goal, acceptance criteria and the files likely touched. Items marked **by hand** are written by Balakumaran; agents only review them.

| # | Slice | Phase | Status |
| --- | --- | --- | --- |
| [000](000-setup.md) | Repo, docs, CI, scaffold | Setup | ✅ Done (2 manual steps left) |
| [001](001-upload-and-extract.md) | Upload a PDF, extract text per page | MVP | Next |
| [002](002-chunker.md) | Page-bounded chunker with overlap (**by hand**) | MVP | |
| [003](003-embed-and-index.md) | Embed chunks, Atlas vector index with `userId` filter | MVP | |
| [004](004-ask-route.md) | Ask route: retrieve, prompt with page tags (**by hand**), stream | MVP | |
| [005](005-chat-ui-auth-history.md) | Chat UI with citations, Google sign-in, history | MVP | |
| [006](006-evals-and-deploy.md) | First 15 eval questions (**by hand**), deploy to Vercel | MVP | |
