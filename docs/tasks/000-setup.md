# 000 — Setup

**Goal:** a repo an agent can work in safely: docs, rules, scaffold, CI.

## Acceptance criteria

- [x] `docs/PRD.md` (one page) and `docs/ARCHITECTURE.md` with data model and API routes
- [x] Next.js + TypeScript (strict) + Tailwind + ESLint scaffold; Vitest configured
- [x] `AGENTS.md` (+ `CLAUDE.md`, `GEMINI.md` pointing at it) with stack, commands, layout, rules
- [x] GitHub Actions: lint, typecheck, tests, build on every push and PR
- [x] `.env.example` committed; `.env*` ignored from the first commit
- [x] Architecture diagrams rendered to PNG in `docs/assets/`
- [ ] **Manual:** create the MongoDB Atlas M0 cluster and a Gemini API key; fill `.env.local`; `GET /api/health` returns `"configured": true`
- [ ] **Manual:** create the Google OAuth client for Auth.js (redirect URI `http://localhost:3000/api/auth/callback/google`)

## Gate

CI green on `main`, docs merged, `/api/health` configured locally.
