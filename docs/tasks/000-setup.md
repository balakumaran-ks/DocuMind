# 000 — Setup

**Goal:** a repository that is ready for feature work: requirements and design written down, a scaffold that builds, and CI that blocks broken changes.

## Acceptance criteria

- [x] `docs/PRD.md` and `docs/ARCHITECTURE.md` with data model and API routes
- [x] Next.js + TypeScript (strict) + Tailwind + ESLint scaffold; Vitest configured
- [x] Architecture decision records for the stack choices
- [x] GitHub Actions: lint, typecheck, tests and build on every push and pull request
- [x] `.env.example` committed; `.env*` ignored from the first commit
- [x] Architecture diagrams rendered to PNG in `docs/assets/`
- [x] MongoDB Atlas M0 cluster and Gemini API key created; `.env.local` filled; `GET /api/health` returns `"configured": true`
- [x] Google OAuth client created for Auth.js (redirect URI `http://localhost:3000/api/auth/callback/google`)

## Gate

CI green on `main`, docs merged, `/api/health` configured locally.
