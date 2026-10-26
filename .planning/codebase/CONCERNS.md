# Codebase Concerns

**Analysis Date:** 2025-05-09

## Security Considerations

### XSS Vulnerabilities (HIGH)
**Location:** `src/pages/StaticPage.tsx:162`, `src/components/ui/chart.tsx:79`

**Issue:** Use of `dangerouslySetInnerHTML` with user-controlled content without sanitization.
- `StaticPage.tsx` renders HTML content from Blossom servers directly without sanitization
- `chart.tsx` uses dangerouslySetInnerHTML for dynamic CSS injection

**Files:**
- `src/pages/StaticPage.tsx`
- `src/components/ui/chart.tsx`

**Risk:** malicious actors could inject scripts through page content or Nostr events

**Current mitigation:** None detected

**Recommendations:**
- Use DOMPurify or similar library to sanitize HTML before rendering
- For chart styles, ensure only CSS properties are allowed (current implementation appears safe due to limited CSS property injection)
- Consider using a sandboxed iframe for external HTML content

---

### NIP-04/NIP-17 Encryption (MEDIUM)
**Location:** `src/components/DMProvider.tsx`

**Issue:** NIP-04 uses deprecated AES-ECB encryption which has known vulnerabilities. NIP-17 (Gift Wraps) is the modern replacement.

**Files:**
- `src/components/DMProvider.tsx` (lines 224-232, 261-410)
- `src/lib/dmUtils.ts`

**Current state:** The codebase supports both NIP-04 and NIP-17 protocols, with NIP-17 being the default (`PROTOCOL_MODE.NIP17_ONLY`)

**Risk:** NIP-04 encrypted messages can be compromised

**Recommendations:**
- Consider deprecating NIP-04 entirely in favor of NIP-17
- Add UI warnings when NIP-04 is being used
- Document the security differences for users

---

### Admin Authorization via External nostr.json (MEDIUM)
**Location:** `src/hooks/useRemoteNostrJson.ts`

**Issue:** Admin authorization depends on an external `nostr.json` file fetched from a remote URL. If this file is compromised or the endpoint is hijacked, unauthorized users could gain admin access.

**Files:**
- `src/hooks/useRemoteNostrJson.ts`
- `src/contexts/AdminAuthContext.tsx`

**Risk:** Remote endpoint compromise leads to admin access bypass

**Recommendations:**
- Add signature verification for nostr.json responses
- Consider caching with ETag validation
- Add fallback to local configuration if remote fetch fails

---

### URL Validation in TipTap Editor (LOW)
**Location:** `src/components/TipTapEditor.tsx:68, 75`

**Issue:** URLs are inserted via `window.prompt()` without validation. Could allow `javascript:` or other dangerous protocols.

**Files:**
- `src/components/TipTapEditor.tsx`

**Recommendations:**
- Validate URLs to only allow http/https protocols
- Use a proper URL input component instead of prompt()

---

## Performance Concerns

### Large Component Files (MEDIUM)
**Files with 1000+ lines:**
- `src/components/admin/AdminForms.tsx` (1886 lines)
- `src/components/DMProvider.tsx` (1533 lines)
- `src/components/admin/AdminSettings.tsx` (1195 lines)
- `src/components/admin/AdminNotes.tsx` (1175 lines)
- `src/components/admin/AdminBlog.tsx` (1009 lines)

**Impact:** Difficult to maintain, slower compile times, potential code-splitting issues

**Recommendations:**
- Split AdminForms into separate components per field type
- Extract DMProvider logic into custom hooks
- Consider lazy loading for admin routes

---

### No Memoization in Some Components (MEDIUM)
**Issue:** Limited use of `React.memo`, `useCallback`, and `useMemo` patterns (only ~49 occurrences across components)

**Files:** Various components throughout `src/components/`

**Impact:** Unnecessary re-renders, especially in feed items and DM conversations

**Recommendations:**
- Add React.memo to FeedItem and similar list items
- Memoize callback props in parent components
- Profile render performance with React DevTools

---

### Global Caching Without Invalidation (MEDIUM)
**Location:** `src/hooks/useZapAnalytics.ts:48-62`

**Issue:** Module-level Maps (`userZapCache`, `profileCache`) persist across user sessions without proper invalidation when switching users or relays.

**Files:**
- `src/hooks/useZapAnalytics.ts`

**Impact:** Stale data shown to users after switching accounts

**Current mitigation:** `clearZapCaches()` function exists but may not be called consistently

---

### IndexedDB for DM Cache Without Size Limits (LOW)
**Location:** `src/components/DMProvider.tsx`

**Issue:** No quota management for IndexedDB storage of DM messages

**Impact:** Potential storage exhaustion on devices with limited storage

**Recommendations:**
- Implement message expiration/rotation
- Add storage quota checking
- Provide manual cache clear option

---

## Code Quality

### TypeScript Any Usage (LOW)
**Locations with `@typescript-eslint/no-explicit-any` suppressions:**
- `src/components/FeedItem.tsx:242-243`
- `src/components/admin/AdminSystemSettings.tsx:228-229`
- `src/lib/queryRelays.ts:15-16`

**Issue:** Type safety is being bypassed

**Recommendations:**
- Define proper types instead of using `any`
- Use `unknown` with type guards for dynamic data

---

### Weak Random ID Generation (LOW)
**Location:** `src/components/admin/AdminForms.tsx:172`

**Issue:** `Math.random().toString(36).substring(2, 8)` generates IDs with only ~36^6 (2 billion) possibilities and potential collisions.

**Files:**
- `src/components/admin/AdminForms.tsx`

**Recommendations:**
- Use `crypto.randomUUID()` for truly unique IDs
- Or use timestamp-based IDs with random suffix

---

### Console Logging in Production (LOW)
**Issue:** Extensive console logging throughout codebase (50+ occurrences) including potentially sensitive data

**Files:**
- `src/components/DMProvider.tsx` (30+ console statements)
- `src/components/NostrSync.tsx`
- Various other components

**Recommendations:**
- Use a logging framework with environment-based levels
- Strip console logs in production build
- Ensure no sensitive data is logged

---

## Test Coverage Gaps

### Limited Test Coverage (HIGH)
**Current state:** Only 4 test files found
- `src/App.test.tsx`
- `src/test/ErrorBoundary.test.tsx`
- `src/components/NoteContent.test.tsx`
- `src/lib/genUserName.test.ts`

**Critical areas not tested:**
- DM encryption/decryption (NIP-04/NIP-17)
- Admin authorization logic
- Form submission and validation
- Zap payment flows
- Nostr event publishing
- Authentication flows

**Risk:** High - bugs in critical paths may go undetected

**Recommendations:**
- Add unit tests for DMProvider encryption logic
- Test admin auth edge cases
- Add integration tests for form submissions
- Mock Nostr relay responses for testing

---

## Accessibility Concerns

### Limited Accessibility Attributes (MEDIUM)
**Issue:** Only 18 occurrences of `aria-label` or `role` attributes found in components

**Files:** Various components throughout `src/components/`

**Missing:**
- Keyboard navigation for custom components
- ARIA labels for icon-only buttons
- Screen reader announcements for dynamic content
- Focus management in dialogs and modals

**Recommendations:**
- Audit all interactive components for keyboard accessibility
- Add ARIA labels to icon buttons
- Implement focus traps in modals
- Add live regions for dynamic content updates

---

## Technical Debt

### Deprecated Dependencies Addressed (RESOLVED)
**Issue:** Handlebars CVE-2026-33937 (prototype pollution vulnerability)

**Status:** Already addressed with override in `package.json:86-92`
```json
"overrides": {
  "handlebars": ">=4.7.9"
}
```

---

### Inconsistent Error Handling (MEDIUM)
**Issue:** Mix of try/catch, error logging, and silent failures throughout the codebase

**Files:** Various

**Recommendations:**
- Standardize error handling patterns
- Use error boundaries for React components
- Implement centralized error tracking
- Show user-friendly error messages

---

### Missing AbortSignal Usage in Fetch (LOW)
**Location:** Various fetch calls throughout codebase

**Issue:** Some fetch calls don't use AbortSignal for timeout/cancellation

**Files:**
- `src/pages/StaticPage.tsx:87` (Blossom fetch)
- `src/components/admin/MediaSelectorDialog.tsx:143`
- `src/components/admin/AdminMedia.tsx:315`
- `src/hooks/useAiChat.ts` (multiple fetches)

**Recommendations:**
- Add AbortSignal with timeout to all fetch calls
- Use AbortSignal.any() for combining timeouts with component unmount signals

---

## Dependency Risks

### Nostr Tools/Nostrify Version Compatibility (LOW)
**Issue:** Using both `nostr-tools` and `@nostrify/nostrify` packages which may have overlapping functionality

**Files:**
- `package.json` (lines 68, 20-21)

**Recommendations:**
- Evaluate if both libraries are necessary
- Consider standardizing on one Nostr library to reduce bundle size

---

## Known Issues (TODO/FIXME)

**None found** - No TODO/FIXME/HACK comments detected in the codebase, which is positive.

---

## Summary by Severity

| Severity | Count | Areas |
|----------|-------|-------|
| HIGH | 2 | XSS vulnerabilities, Test coverage gaps |
| MEDIUM | 8 | NIP-04 deprecation, Admin auth, Large components, No memoization, Global cache, IndexedDB, Type safety, Error handling |
| LOW | 8 | URL validation, Weak random IDs, Console logging, Accessibility, Fetch timeouts, Dependency overlap, CSP awareness, Input validation |

---

*Concerns audit: 2025-05-09*
