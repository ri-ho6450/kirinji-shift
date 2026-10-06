# Project instructions

## Data preservation

- Registered shifts, assignments, memos, staff, patterns, settings, locks and compensatory dates must be preserved.
- Firestore is the source of truth; its persistent IndexedDB cache supports offline use. Do not replace saved data with an empty initial React state.
- Never seed or overwrite historical shifts automatically during startup.
- Never clear browser storage or cloud collections except through an explicitly confirmed user reset.
- Keep collection names and document formats backward compatible or implement a deliberate migration.
- Do not write test data to the bundled real Firebase project. Use the isolated demo-kirinji emulator.

## Validation

- Run npm run lint, npm run build and npm test after code changes.
- Run npm run test:sync for changes to persistence or synchronization when emulator download/network access is available. Report a blocked test rather than claiming it passed.
- Use the existing checkout; do not create a Git worktree unless the user requests one.
