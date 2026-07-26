# Test Plan

Canonical plan: `../TEST_PLAN.md`.

Run the deterministic full-project gate:

```powershell
npm run test:all
```

`pnpm test:all` also works when pnpm is available because it runs the same
package script.
