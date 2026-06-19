# Testing

This project uses Jest for tests. Add the following to your documentation or paste directly.

## Quick commands

- Run all workspace tests:

```bash
pnpm test
```

- Run backend tests only (Jest project `backend` in `jest.config.js`):

```bash
pnpm exec jest --selectProjects backend
```

- Run a single backend test file (useful for focused debugging):

```bash
pnpm exec jest backend/src/routes/tasks.test.ts --runInBand
```

## Useful files to link in docs

- Package scripts and dependencies: [package.json](package.json)
- Jest project configuration: [jest.config.js](jest.config.js)
- Example test to reference: [backend/src/routes/tasks.test.ts](backend/src/routes/tasks.test.ts)

## CI badge (optional)

Add this to your README by replacing `OWNER/REPO` and `ci.yml` with your repository/workflow names:

```
[![Tests](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions)
```

---

If you want this content merged into `workspace.md` or `README.md`, tell me which file and I'll insert it there.