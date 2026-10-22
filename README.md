# A Nostr CMS for Organizations

Architecture overview for the combined CMS + relay setup: [docs/MEETUP_SPACE_ARCHITECTURE.md](./docs/MEETUP_SPACE_ARCHITECTURE.md)

Use the [Super Easy Setup Guide for separate components](https://setupcms.hivetalk.org/)
or 
[One Shot integrated CMS + Relay](https://oneshot.hivetalk.org/)

or

## Deploy with Vercel 

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbitkarrot%2Fmeetup-site) 

You Must configure your .env in vercel before running the app

```sh
# Remote nostr.json for admin authentication
VITE_REMOTE_NOSTR_JSON_URL=

# Default relay for reading content
VITE_DEFAULT_RELAY=

# Master pubkey (owner of the site)
VITE_MASTER_PUBKEY=
```

A comprehensive meetup or small organization and event management system built with React, TypeScript, and Nostr. This project provides both an admin CMS for content management and a public-facing website for community engagement.

## Features

### Admin Dashboard
- **Authentication**: Remote `nostr.json` validation for admin access control.
- **Admin Roles**: Support for **Primary** and **Secondary** admin roles with different publishing permissions.
- **Content Management**: Full CMS for blogs, pages, notes, and events. Blogs and pages use a markdown editor with formatting toolbar.
- **Static Pages**: Create and manage static HTML/Markdown pages via **Kind 34128** (nsite) with Blossom storage.
- **Blog Management**: Create, edit, and manage long-form content (**NIP-23**) with username-based filtering.
- **Event Management**: Create and manage events with RSVP functionality (**NIP-52**) and username-based filtering.
- **Draft Support**: Save drafts to default relay before publishing.
- **Site Configuration**: Customize logos, titles, favicons, and navigation menus.
- **Relay Management**: Configure a **Primary Relay** (prioritized) and additional **Publishing Relays** for redundancy.
- **Media Library**: Manage uploaded images and files via Blossom servers.
- **Feed Management**: Curate and manage content feeds.
- **Zaplytics**: Comprehensive analytics dashboard for tracking zap earnings, top contributors, and content performance.
- **Reset to Defaults**: Quickly reset all site settings to environment variable defaults and clear local caches.

### Public Website
- **Zaps & Tips**: Integrated support for **Lightning Zaps (NIP-57)** for community appreciation.
- **NWC Integration**: Support for **Nostr Wallet Connect (NIP-47)** for seamless zapping.
- **Hero Section**: Customizable hero with background image and text.
- **Event Listings**: Browse upcoming and past events with filtering and author attribution.
- **Event Details**: Full event pages with RSVP functionality and attendee lists.
- **Blog Section**: Display published blog posts with rich formatting and author metadata.
- **Navigation**: Customizable navigation menu with submenus and mobile-responsive labels.
- **Responsive Design**: Mobile-friendly interface with light/dark mode support.

### AI Integration
- **Shakespeare API**: Built-in `useShakespeare` hook for integrating AI chat completions.
- **Streaming Support**: Support for streaming AI responses.
- **Model Selection**: Dynamic model discovery and selection.
- **Nostr Authentication**: Secure authentication with the AI provider using Nostr keys.

## Technical Stack

- **React 18.x**: Modern React with hooks and concurrent features.
- **TypeScript**: Type-safe development.
- **Vite**: Fast build tool and development server.
- **TailwindCSS & shadcn/ui**: Utility-first CSS and high-quality UI components.
- **Nostrify**: Nostr protocol integration.
- **Markdown editor**: Formatting toolbar on blogs and pages; @-mention suggestions in the notes composer.
- **TanStack Query**: Data fetching and state management.
- **Blossom**: Media and static content storage.
- **WebLN**: Lightning Network integration for zaps.
- **Shakespeare AI**: AI chat completion API integration.

## Configuration

### Relay Architecture (Two-Tier Strategy)

The application uses a two-tier relay strategy to separate CMS content from social data:

#### Tier 1: Default Relay Only (CMS Content)
Configured via `VITE_DEFAULT_RELAY`. This is the **single source of truth** for all CMS content — both reading and writing. The environment variable always takes precedence over any locally cached or Nostr-stored relay URL.

CMS content that reads/writes exclusively from the default relay:
- Site configuration (Kind 30078)
- Blog posts (Kind 30023)
- Calendar events (Kind 31922, 31923)
- Forms (Kind 30168) and form responses (Kind 30169)
- Static pages (Kind 34128)
- Event RSVPs (Kind 31925)
- Admin dashboard, settings, and system settings
- NIP-65 relay list sync and site config sync

#### Tier 2: Default Relay + NIP-65 Relays (Social Data)
Social and aggregated content fans out to both the default relay and the user's NIP-65 relay list, since this data may not exist on the default relay alone:
- **Feed** (Kind 1 notes) — also includes publish relays if `feedReadFromPublishRelays` is enabled
- **Notes & Note Stats** (Kind 1, reactions, zaps, reposts)
- **Zap Receipts & Analytics** (Kind 9735)
- **Comments** (Kind 1111)
- **User Profiles** (Kind 0) — with `wss://purplepag.es` fallback
- **Direct Messages** (NIP-04 Kind 4, NIP-17 Kind 1059)

The fan-out logic is implemented via `queryWithNip65Fanout()` in `src/lib/queryRelays.ts`, which queries the pool (default relay) and all NIP-65 read relays in parallel, then deduplicates results by event ID.

#### Publishing
All writes always include the default relay. NIP-65 write relays are also included for redundancy. Additional publishing relays can be configured in admin settings for blast publishing.

#### Relay Priority
The `VITE_DEFAULT_RELAY` environment variable **always** overrides any relay URL stored in localStorage or fetched from Nostr events. This prevents stale relay URLs from persisting after switching the default relay.

- **Additional Publishing Relays**: 
  - `wss://relay.damus.io`
  - `wss://relay.primal.net` 
  - `wss://nos.lol`
- **Admin Control**: Admins can dynamically add or remove publishing relays via the system settings.

### Admin Access
Admin access is controlled by a remote `nostr.json` file (configured via `VITE_REMOTE_NOSTR_JSON_URL`). The site automatically detects users and maps roles based on the Master Pubkey.

## NIPs Used

- **NIP-01**: Basic protocol flow
- **NIP-05**: Mapping Nostr keys to DNS-based identifiers
- **NIP-23**: Long-form content for blog posts
- **NIP-47**: Nostr Wallet Connect (NWC)
- **NIP-52**: Calendar events for meetups
- **NIP-25**: Event RSVP functionality
- **NIP-57**: Lightning Zaps
- **NIP-nsite (Type 34128)**: Static page mapping
- **NIP-04/17**: Direct messaging support

## Project Structure

```
src/
├── components/
│   ├── admin/          # Admin dashboard components (Blogs, Events, Pages, Settings)
│   ├── ui/              # shadcn/ui components
│   └── ...            # Other shared components
├── contexts/             # React contexts (App, DM, NWC, Wallet)
├── hooks/               # Custom hooks (useNostr, useZaps, useAuthor, etc.)
├── pages/              # Page components
│   ├── admin/          # Admin pages
│   └── ...            # Public pages
└── lib/                # Utility functions and shared logic
```

## Development

### Prerequisites
- Node.js 18+
- npm or pnpm

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Building
```bash
npm run build
```

## Admin Features In-Depth

### Settings Structure
The application uses a layered configuration approach:

1. **Environment Variables (`.env`)**: 
   - Immutable infrastructure keys (Relays, Master Pubkey, Remote Admin JSON).
   - Serves as the hardcoded default state.

2. **Site Settings (Admin UI)**: 
   - Customizable branding (Logo, Title, Description, Navigation).
   - Stored as Replaceable Events (Kind 30078) on Nostr.
   - Overrides defaults when present.

3. **System Settings (Admin UI)**:
   - Administrative configuration (Relay List, Admin Roles).
   - Controls strictly limited to the Master User.

The **Reset to Defaults** feature allows admins to purge the Nostr-based Site Settings and revert to the `.env` configuration.

### Static Pages (Kind 34128)
Admins can create custom URL paths (e.g., `/about`, `/contact`) and upload content (HTML/Markdown) to Blossom. These are mapped using Kind 34128 events, allowing the site to serve decentralized static content.

## Public Features In-Depth

### Community Zapping
Users can send Bitcoin via Lightning Network zaps to authors of blog posts and events. The site supports:
- **WebLN**: Browser extensions like Alby.
- **NWC**: Cross-device wallet connections.
- **QR Codes**: Manual scanning for mobile or desktop wallets.

## Security
- Admin access is cryptographically verified based on the remote `nostr.json`.
- Sensitve configurations are stored in environment variables.
- No private keys are stored on the server; all signing happens via local clients or NWC.

## Developer Documentation

The project includes specialized documentation in the `docs/` directory:

- **[AI Chat](docs/AI_CHAT.md)**: Implementation guide for AI chat interfaces using the Shakespeare API.
- **[Nostr Direct Messages](docs/NOSTR_DIRECT_MESSAGES.md)**: Guide for implementing NIP-04 and NIP-17 direct messaging.
- **[Nostr Comments](docs/NOSTR_COMMENTS.md)**: Guide for comment systems.
- **[Infinite Scroll](docs/NOSTR_INFINITE_SCROLL.md)**: Guide for feed interfaces.

## License
This project is open source and available under the MIT License.

## Note
This project was vibe coded by bitkarrot as an experiment with antigravity.
