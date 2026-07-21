# Login and Password Flow — Technical Reference

## Authentication Architecture

The system uses a multi-layer authentication system:
- **Session tokens** with rotating refresh tokens (HttpOnly cookies)
- **Argon2id** password hashing with a server-side pepper
- **`mustChangePassword`** flag enforced at both backend and frontend
- **BFCache-aware** state management to prevent stale page restores

---

## First Login Flow

```
1. Admin creates user → mustChangePassword = true in DB
2. User logs in with temporary password
3. Backend checks mustChangePassword → returns flag in user object
4. Frontend detects mustChangePassword=true → redirects to /change-password
5. User sets new password → backend atomically:
   - Hashes new password with Argon2id + pepper
   - Sets mustChangePassword=false
   - Sets firstLoginCompletedAt = now
   - Revokes all existing sessions
   - Returns updated user object in response
6. Frontend updates React Query cache immediately from response (no race)
7. Router navigates away
8. If user presses Back (BFCache): pageshow event triggers cache invalidation + refetch
   → mustChangePassword=false in response → /change-password redirects away instantly
```

---

## Race Condition Fix (Bug That Was Fixed)

**Old behaviour (buggy):**
```typescript
// setSaved(true) could trigger useEffect before refetch resolved
// If refetch returned mustChangePassword=true (stale session), redirect fired
setSaved(true);
await refetch();       // async, could be slow on mobile
router.replace("/");
```

**New behaviour (fixed):**
```typescript
// 1. Cancel any in-flight queries
await client.cancelQueries({ queryKey: ["me"] });
// 2. Set authoritative server response immediately
client.setQueryData(["me"], result.user);
// 3. Mark saved BEFORE async operations
setSaved(true);
// 4. Refetch in background (non-blocking)
void refetch();
// 5. Navigate — data is already correct in cache
router.replace("/");
```

**Double-tap prevention:**
```typescript
// useRef guard — survives re-renders, no stale closure issues
const busyRef = useRef(false);
if (busyRef.current) return;
busyRef.current = true;
// ... submit ...
// NOT reset on success — navigation prevents second tap anyway
```

---

## BFCache Fix

Mobile browsers (iOS Safari, Chrome Android) restore page DOM from cache when the user presses Back. The `pageshow` event fires with `event.persisted = true`.

**Old behaviour:** Called `refetch()` which used the stale cache.

**New behaviour:**
```typescript
const refreshAfterRestore = async (event: PageTransitionEvent) => {
  if (!event.persisted) return;
  // Invalidate cache first — forces network request
  await client.invalidateQueries({ queryKey: ["me"] });
  void refetch();  // Now guaranteed to hit the network
};
```

---

## Password Requirements

| Requirement | Detail |
|---|---|
| Minimum length | 12 characters |
| Uppercase letter | At least 1 (A-Z) |
| Lowercase letter | At least 1 (a-z) |
| Number | At least 1 (0-9) |
| Special character | At least 1 (non-alphanumeric) |
| Not same as temporary | Must differ from the temporary password |

---

## Mobile Optimisations

- **iOS zoom prevention**: All inputs have `font-size: max(16px, 1rem)` — iOS Safari does not zoom on inputs with 16px+ font size
- **Safe-area insets**: Login page uses `env(safe-area-inset-*)` CSS functions for notched phones
- **Touch targets**: All interactive elements have `min-height: 44px` per Apple HIG
- **Password visibility toggle**: 44×44px target area, accessible label

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns user with mustChangePassword |
| POST | `/auth/change-password` | Change password, revokes sessions |
| GET | `/auth/me` | Current user (used for BFCache sync) |
| POST | `/auth/logout` | Revoke current session |
