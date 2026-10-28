# Installation Guide

This guide covers setting up a new instance of the Nostr CMS, with or without the scheduled posts feature.

## Table of Contents

- [Quick Start (Basic)](#quick-start-basic)
- [With Scheduled Posts](#with-scheduled-posts)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Quick Start (Basic)

For a basic installation without scheduled posts functionality.

### 1. Clone and Install

```bash
git clone https://github.com/bitkarrot/nostr-cms.git
cd nostr-cms
npm install
```

### 2. Configure Environment Variables

Create a `.env` file (or configure in your hosting platform):

```bash
# Remote nostr.json for admin authentication
VITE_REMOTE_NOSTR_JSON_URL=https://your-domain.com/.well-known/nostr.json

# Default relay for reading content
VITE_DEFAULT_RELAY=wss://your-relay.com

# Master pubkey (owner of the site)
VITE_MASTER_PUBKEY=your_admin_pubkey_hex
```

### 3. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` and authenticate using your Nostr extension (NIP-07).

### 4. Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

---

## With Scheduled Posts

The scheduled posts feature allows you to schedule Kind 1 notes and Kind 30023 blog posts for future automatic publishing. This requires an **InsForge Backend** instance.

### Prerequisites

1. **InsForge Account**: Sign up at [insforge.app](https://insforge.app)
2. **Create a Project**: Create a new project in your InsForge dashboard
3. **Get Credentials**: Note your backend URL and anon key

### Step 1: Set Up InsForge Database

Run the SQL migration in your InsForge dashboard SQL editor. You can find the migration file at:

```
migrations/20240204000000_scheduled_posts.sql
```

Or run the following SQL directly:

```sql
-- Migration: Create scheduled_posts table for InsForge Backend
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pubkey TEXT NOT NULL,
  kind INTEGER NOT NULL,
  signed_event JSONB NOT NULL,
  relays JSONB NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  published_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_for_status ON scheduled_posts(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_status ON scheduled_posts(user_pubkey, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_kind ON scheduled_posts(kind);

-- Enable Row Level Security
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow anon access (Nostr auth is client-side)
DROP POLICY IF EXISTS "Allow anon access" ON scheduled_posts;
CREATE POLICY "Allow anon access" ON scheduled_posts
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- RLS Policy: Allow authenticated access (for edge functions)
DROP POLICY IF EXISTS "Allow authenticated access" ON scheduled_posts;
CREATE POLICY "Allow authenticated access" ON scheduled_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RLS Policy: Allow postgres access
DROP POLICY IF EXISTS "Allow postgres access" ON scheduled_posts;
CREATE POLICY "Allow postgres access" ON scheduled_posts
  FOR ALL TO postgres USING (true) WITH CHECK (true);

-- RLS Policy: Project admin full access
DROP POLICY IF EXISTS "project_admin_policy" ON scheduled_posts;
CREATE POLICY "project_admin_policy" ON scheduled_posts
  FOR ALL TO project_admin USING (true) WITH CHECK (true);

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated, postgres;
GRANT ALL ON scheduled_posts TO anon, authenticated, postgres;
```

### Step 2: Deploy the Edge Function

The edge function `src/edge-functions/publish-scheduled-posts.js` must be deployed to InsForge.

**Via MCP Tool:**
```bash
# If you have the InsForge MCP tool configured
mcp__insforge__create-function
```

**Via InsForge Dashboard:**
1. Go to your project's Functions section
2. Create a new function named `publish-scheduled-posts`
3. Copy the contents of `src/edge-functions/publish-scheduled-posts.js`
4. Deploy the function

### Step 3: Configure Cron Schedule

In your InsForge dashboard, set up a cron schedule to trigger the edge function:

- **Schedule**: Recommended every 5 minutes (`*/5 * * * *`)
- **Endpoint**: `publish-scheduled-posts`
- **Method**: GET

### Step 4: Configure Environment Variables

Add the InsForge credentials to your `.env` file:

```bash
# ... existing variables ...

# InsForge Backend (for scheduled posts feature)
INSFORGE_BASE_URL=https://your-project.insforge.app
INSFORGE_ANON_KEY=your_anon_key_here
```

To get your anon key, you can use the InsForge MCP tool or dashboard:
```bash
mcp__insforge__get-anon-key
```

### Step 5: Verify Configuration

After restarting your app:

1. The **Scheduled** menu item should appear in the admin panel
2. The **Schedule for later** toggle should be visible when creating notes and blog posts
3. Visit `/admin/scheduled` to view and manage scheduled posts

---

## Environment Variables

### Required Variables (Basic)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_REMOTE_NOSTR_JSON_URL` | URL to remote `nostr.json` for admin authentication | `https://example.com/.well-known/nostr.json` |
| `VITE_DEFAULT_RELAY` | Primary relay for reading content | `wss://relay.damus.io` |
| `VITE_MASTER_PUBKEY` | Hex pubkey of the site owner (primary admin) | `3878d95db7b854c3...` |
| `AI_API_KEY` | Optional: OpenAI-compatible provider key. Powers the `/api/ai/*` serverless proxy (shared AI Helper for admins) and local tooling — never bundled into the frontend. See `docs/AI_CHAT.md` | `sk-...` |
| `AI_BASE_URL` | Optional: provider base URL for the server proxy | `https://gateway.trytokenfactory.dev/v1` |
| `AI_MODEL` | Optional: default model advertised by the proxy | `glm-5.3-flash` |

### Optional Variables (Scheduled Posts)

| Variable | Description | Example |
|----------|-------------|---------|
| `INSFORGE_BASE_URL` | InsForge backend URL | `https://your-project.insforge.app` |
| `INSFORGE_ANON_KEY` | InsForge anonymous key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

If `INSFORGE_BASE_URL` or `INSFORGE_ANON_KEY` are not set, the scheduled posts feature will be **hidden** and the app will function normally without it.

---

## Deployment

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbitkarrot%2Fnostr-cms)

1. Click the Deploy button above
2. Configure environment variables in Vercel project settings
3. Deploy

### Netlify

```bash
npm run build
# Deploy the dist/ folder
netlify deploy --prod --dir=dist
```

### Static Hosting

```bash
npm run build
# Upload the dist/ folder to your static host
```

---

## Troubleshooting

### Scheduled posts menu not appearing

- Verify `INSFORGE_BASE_URL` and `INSFORGE_ANON_KEY` are set correctly
- Check browser console for authentication errors
- Ensure the `scheduled_posts` table exists in your database

### Posts not publishing at scheduled time

- Verify the edge function is deployed: `publish-scheduled-posts`
- Check the cron schedule is configured in InsForge dashboard
- Check edge function logs for errors

### "JWSInvalidSignature" error

- The `INSFORGE_ANON_KEY` may be incorrect
- Regenerate the anon key from your InsForge dashboard

### Database connection errors

- Verify the `scheduled_posts` table exists (run the migration)
- Check RLS policies are correctly configured
- Ensure anon role has permissions on the table

### CSP errors (blank page)

If you see CSP errors in the console blocking fonts or scripts:

1. Check `index.html` Content-Security-Policy meta tag
2. Ensure `fonts.googleapis.com` and `fonts.gstatic.com` are allowed
3. Ensure your CDN/host is in the script-src and style-src directives

---

## Admin Authentication Setup

To set up admin authentication, you need a remote `nostr.json` file accessible at the `VITE_REMOTE_NOSTR_JSON_URL`.

### nostr.json Format

```json
{
  "names": {
    "admin": "pubkey_hex_here",
    "your_username": "another_pubkey_hex_here"
  },
  "relays": {
    "pubkey_hex_here": ["wss://relay1.com", "wss://relay2.com"]
  }
}
```

### Setting Up Remote nostr.json

1. **Choose a domain**: You can use a GitHub Pages, Vercel, or your own domain
2. **Create the file**: Place `nostr.json` in `.well-known/` directory
3. **Configure NIP-05**: Set up your NIP-05 identification if desired

Example file structure:
```
your-domain.com/
└── .well-known/
    └── nostr.json
```

The master pubkey (`VITE_MASTER_PUBKEY`) will have full admin privileges. Additional pubkeys listed in `nostr.json` will be assigned **Secondary Admin** role with limited publishing permissions.

---

## Support

For issues or questions:
- GitHub Issues: [bitkarrot/nostr-cms](https://github.com/bitkarrot/nostr-cms/issues)
- Nostr: Mention `@bitkarrot` in a note
