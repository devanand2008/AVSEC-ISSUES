# Performance Before and After

Updated: 19 July 2026

| Area | Before | After AVS Pass |
| --- | --- | --- |
| Brand image path | Original logo only, about 1.4 MB | Optimized display logo at about 69 KB plus generated PWA icons |
| Login page branding | Old CampusOne build served by Docker | AVS title, logo, metadata, and blue theme served from rebuilt Docker web image |
| Auth verification | Admin row existed but old display name was visible | API returns Devanand, `MAIN_ADMIN`, and `mustChangePassword: true` |
| Web build | Pre-patch Docker image | Rebuilt successfully; 37 Next routes generated |
| First login flow | Old UI wording | Browser login redirects to `/change-password` |
| Cold page request | 2513.2 ms after restart | Expected cold-start cost; warm requests 108.1-262.1 ms |
| Health endpoint | 2861.8 ms cold | 5.7-20.3 ms warm |
| Demo/sample data | Seed users, fake issues, fake announcements and demo attendance inflated local state | Confirmed cleanup leaves 1 real admin user, 0 issues, 0 announcements and 0 attendance records |
| LAN access | Web/API previously bound for local desktop use only in Compose | `START_AVS_APP.bat` binds web/API to `0.0.0.0` only for LAN testing and keeps data services on localhost |
| Root frontend baggage | Disconnected root Vite app, static HTML pages and legacy manifest remained beside the maintained Next.js app | Root legacy Vite app files and direct root `vite` dependency removed; maintained runtime remains `apps/web` |
| Startup scripts | Five root BAT files with overlapping behavior plus nested legacy BAT helpers | One `START_AVS_APP.bat` with `--check`, LAN IP detection, health checks and logs |
| Cleanup safety | Cleanup implementation existed under a demo-specific filename | `cleanup:data` now points to `scripts/cleanup-unnecessary-data.ts`; confirmed cleanup still requires a verified backup |

The largest direct improvement in this pass is asset and branding correctness:
the app no longer serves old CampusOne metadata/assets after rebuild, and the
common logo path uses the optimized AVS image instead of repeatedly loading the
large original file.
