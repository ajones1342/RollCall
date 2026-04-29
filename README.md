# RollCall

Live D&D character overlays for Twitch streams. Players edit their own sheet from any device; the overlay updates on stream in realtime.

- Mobile + PC friendly player edit page
- Read-only OBS browser-source overlay (transparent background, medieval font)
- Twitch OAuth — no passwords, players sign in with the account they already have
- Multi-campaign from day one (the same deployment can host other tables)

## Stack

- Vite + React + TypeScript
- Tailwind CSS (font: Cinzel via Google Fonts)
- Supabase (Postgres + Auth + Realtime)
- React Router

## One-time setup

You'll do this once before running locally.

### 1. Install dependencies

```sh
npm install
```

### 2. Create a Supabase project

1. Go to https://supabase.com and create a free project.
2. In the SQL Editor, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. Copy the project URL and the **anon public** key from `Project Settings → API`.

### 3. Register a Twitch application

1. Go to https://dev.twitch.tv/console/apps and click **Register Your Application**.
2. Name: `RollCall (dev)` (or whatever you like).
3. OAuth Redirect URLs: paste `https://<your-project-ref>.supabase.co/auth/v1/callback` (Supabase shows this exact URL in `Authentication → Providers → Twitch`).
4. Category: `Website Integration`.
5. After creating it, copy the **Client ID** and generate a **Client Secret**.

### 4. Enable Twitch in Supabase Auth

1. In Supabase: `Authentication → Providers → Twitch` → enable.
2. Paste the Twitch Client ID and Secret.
3. In `Authentication → URL Configuration`, set `Site URL` to `http://localhost:5173` for now (add your production URL later).

### 5. Configure environment variables

```sh
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Run

```sh
npm run dev
```

Open http://localhost:5173.

## Use it

1. **GM (you):** open the app, sign in with Twitch, create a campaign.
2. **Players:** GM copies the **Player Join Link** from the campaign page and shares it (Discord, etc). Each player clicks it, signs in with Twitch, and gets their own character sheet to edit.
3. **OBS:** Each player's video tile gets its own Browser Source pointing at that player's per-character overlay URL (visible on the campaign page next to each character):
   - URL: `https://your-app.com/overlay/<campaignId>/<characterId>`
   - Width: 1920, Height: 1080 (the layout scales to whatever size you give the source — keep 16:9)
   - Custom CSS: leave blank (the page handles transparency)
   - Refresh source if it ever stops updating
   - The all-characters URL (`/overlay/<campaignId>`) is for preview only — use per-character URLs in production so you can position each card over each player's video tile.

**Layout (per 1920x1080 card):**
- Top-left: character name (large) + race / class
- Right edge: STR, AGI, CON, INT, WIS, CHA spread top-to-bottom
- Bottom-left: HP / Max HP
- Bottom-center: Twitch display name

Edits show up on the overlay in realtime (~100ms).

## Project layout

```
src/
  pages/
    Landing.tsx          # / — sign in
    GMDashboard.tsx      # /gm — list/create campaigns
    CampaignManage.tsx   # /gm/:id — invite link, overlay URL, party list
    JoinCampaign.tsx     # /join/:id — player sign-in + auto-create character
    PlayerEdit.tsx       # /play/:id — edit character form
    Overlay.tsx          # /overlay/:id — read-only OBS overlay
  lib/
    supabase.ts          # client init
    types.ts             # Character, Campaign, attribute keys
  hooks/
    useSession.ts        # auth session helper
supabase/
  schema.sql             # tables, RLS, realtime
```

## Deploy

When you're ready to host:

1. Deploy this repo to Vercel or Netlify (both detect Vite automatically).
2. Add the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars in the host's dashboard.
3. In Supabase `Authentication → URL Configuration`, add the production URL to `Site URL` and `Redirect URLs`.
4. Add the production redirect URL to your Twitch app: `https://<your-project-ref>.supabase.co/auth/v1/callback` is the same — Twitch only needs the Supabase callback, not your frontend URL.

## Roadmap

- Drag-to-reorder party (uses `display_order`)
- Conditions / status effects
- Inspiration toggle
- Character portraits (Twitch avatar fallback already wired)
- Optional GM-curated join (approve players before they appear)
- Packaged hosted SaaS for other GMs
