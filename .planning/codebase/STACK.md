# Technology Stack

**Analysis Date:** 2026-05-09

## Languages

**Primary:**
- TypeScript ^5.5.3 - All source files use TypeScript (`.ts`, `.tsx`)

**Secondary:**
- JavaScript - Used in build scripts (`scripts/generate-route-meta.mjs`)

## Runtime

**Environment:**
- Node.js (via `npx` commands in scripts)
- Browser: Modern browsers with ES2020 support

**Package Manager:**
- npm (primary - configured in package.json scripts)
- pnpm (overrides configured for security patches)
- Lockfile: `package-lock.json` (implicit from npm usage)

## Frameworks

**Core:**
- React ^18.3.1 - UI framework
- MKStack - Custom React framework for Nostr apps (`stack.json`)
- react-router-dom ^6.30.3 - Client-side routing

**Nostr Protocol:**
- @nostrify/nostrify ^0.48.2 - Nostr protocol implementation
- @nostrify/react ^0.2.20 - React integration for Nostrify
- nostr-tools ^2.13.0 - NIP-19 encoding, key generation

**State & Data Fetching:**
- @tanstack/react-query ^5.56.2 - Server state management
- idb ^8.0.3 - IndexedDB wrapper for client-side storage

**UI Component Libraries:**
- @radix-ui/* - Headless UI components (20+ packages: accordion, dialog, dropdown-menu, tabs, etc.)
- shadcn-ui - Component architecture pattern (configured in `tailwind.config.ts`)

**Rich Text Editing:**

**Styling:**
- tailwindcss ^3.4.11 - Utility-first CSS
- tailwindcss-animate ^1.0.7 - Animation utilities
- @tailwindcss/typography ^0.5.19 - Typography plugin
- class-variance-authority ^0.7.1 - Component variant styling
- tailwind-merge ^2.5.2 - Tailwind class merging
- clsx ^2.1.1 - Conditional class names

**Drag & Drop:**
- @dnd-kit/core ^6.3.1 - Drag and drop framework
- @dnd-kit/sortable ^10.0.0 - Sortable lists
- @dnd-kit/utilities ^3.2.2 - DnD utilities

**Forms:**
- react-hook-form ^7.53.0 - Form state management
- @hookform/resolvers ^3.9.0 - Form validation resolvers
- zod ^3.25.71 - Schema validation

**Data Visualization:**
- recharts ^2.12.7 - Charts and graphs

**Carousels & Sliders:**
- embla-carousel-react ^8.3.0 - Carousel component
- react-resizable-panels ^2.1.3 - Resizable layouts

**Date & Time:**
- date-fns ^3.6.0 - Date manipulation
- react-day-picker ^8.10.1 - Date picker

**Markdown:**
- react-markdown ^10.1.0 - Markdown rendering
- rehype-raw ^7.0.0 - HTML support in markdown
- remark-gfm ^4.0.1 - GitHub Flavored Markdown

**Icons:**
- lucide-react ^0.462.0 - Icon library

**Other UI:**
- cmdk ^1.0.0 - Command menu
- vaul ^0.9.3 - Drawer component
- input-otp ^1.2.4 - OTP input
- qrcode ^1.5.4 - QR code generation

**Lightning Network:**
- @getalby/sdk ^5.1.1 - Nostr Wallet Connect (NWC) client
- light-bolt11-decoder ^3.2.0 - BOLT-11 invoice parsing

**SEO:**
- @unhead/react ^2.1.12 - Document head management
- @unhead/addons ^2.1.12 - Unhead addons

**Font:**
- @fontsource-variable/inter ^5.2.6 - Inter variable font

**Polyfills:**
- buffer ^6.0.3 - Node buffer polyfill for browser

## Testing

**Runner:**
- vitest ^3.1.4 - Test runner
- jsdom ^26.1.0 - DOM environment for tests

**Testing Library:**
- @testing-library/react ^16.3.0 - React testing utilities
- @testing-library/jest-dom ^6.6.3 - DOM matchers

## Build/Dev

**Build Tool:**
- vite ^6.4.2 - Build tool and dev server
- @vitejs/plugin-react-swc ^3.5.0 - React plugin with SWC compiler

**Linting:**
- eslint ^9.9.0 - JavaScript linter
- typescript-eslint ^8.0.1 - TypeScript ESLint parser
- eslint-plugin-react-hooks ^5.1.0-rc.0 - React hooks linting
- eslint-plugin-react-refresh ^0.4.9 - Fast refresh linting
- @html-eslint/eslint-plugin ^0.41.0 - HTML linting
- @html-eslint/parser ^0.41.0 - HTML parser

**Type Checking:**
- typescript ^5.5.3 - TypeScript compiler

**CSS Processing:**
- postcss ^8.4.47 - CSS processor
- autoprefixer ^10.4.20 - CSS vendor prefixing

**Type Definitions:**
- @types/node ^22.5.5 - Node.js type definitions
- @types/react ^18.3.1 - React type definitions
- @types/react-dom ^18.3.1 - React DOM type definitions
- @types/qrcode ^1.5.5 - QR code type definitions
- @webbtc/webln-types ^3.0.0 - WebLN type definitions

**Development Tools:**
- globals ^15.9.0 - Global variables for ESLint

## Configuration

**Environment:**
- Build-time: Vite env vars (`VITE_DEFAULT_RELAY`, `VITE_MASTER_PUBKEY`, `VITE_REMOTE_NOSTR_JSON_URL`, `VITE_SWARM_API_URL`)
- Runtime: Server-injected `<meta name="swarm-config">` tag (for Go deployment)

**Build:**
- `vite.config.ts` - Vite configuration with proxy for `/api` routes
- `tsconfig.json` - TypeScript config (target: ES2020, strict: false, strictNullChecks: true)
- `tailwind.config.ts` - Tailwind config with shadcn-ui theme
- `eslint.config.js` - ESLint flat config with custom rules
- `postcss.config.js` - PostCSS config

**Path Aliases:**
- `@/*` → `./src/*` (configured in both Vite and TypeScript)

## Platform Requirements

**Development:**
- Node.js (supports ESM modules)
- npm or pnpm
- Modern browser for dev server

**Production:**
- Static site hosting (Vite build output)
- WebSocket proxy for relay connections (Go/Swarm backend optional)
- No server-side rendering required

---

*Stack analysis: 2026-05-09*
