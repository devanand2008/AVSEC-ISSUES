# Implementation Plan

Canonical plans: `../UPGRADE_PLAN.md` and `../IMPLEMENTATION_PLAN.md`.

Priority order:

1. Preserve Devanand Main Admin and verified AVS system data.
2. Keep the stable Next.js/NestJS/PostgreSQL architecture.
3. Use `START_AVS_APP.bat` as the only Windows launcher.
4. Keep destructive cleanup blocked until a fresh database dump is verified.
5. Use `npm run test:all` as the deterministic full-project gate.
