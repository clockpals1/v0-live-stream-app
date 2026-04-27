# Publishing Hub — OAuth Setup Guide

Step-by-step instructions for activating Instagram, TikTok, and Twitter/X publishing.

All credentials are stored as **Cloudflare Worker secrets** — never in `.env` or `wrangler.toml`.
They are available to all three surfaces (live / studio / ai) because a single Worker serves all of them.

---

## Prerequisites

- Publishing Hub feature is behind the `ai_publishing` plan feature key.
- YouTube is already integrated via the Google Cloud Console (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`). The pattern is the same for every platform below.
- After adding Worker secrets via `wrangler secret put`, redeploy the Worker: `npm run deploy` (or push to `main` to trigger CI/CD).

---

## 1 — Instagram / Reels

### What you need
A **Meta for Developers** app with **Facebook Login** and the **Instagram Graph API** product enabled.
The connected Instagram account must be a **Business** or **Creator** account linked to a **Facebook Page**.

### Step-by-step

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**.
2. Select app type **Business**.
3. Under **Add Products**, add:
   - **Facebook Login** → set up for a **Web** platform.
   - **Instagram Graph API** (found in Product Catalog).
4. In **Facebook Login → Settings**:
   - Add to **Valid OAuth Redirect URIs**: `https://live.isunday.me/api/integrations/instagram/callback`
   - Enable **"Login with Instagram"** if shown.
5. In **App Settings → Basic**:
   - Copy **App ID** → `META_APP_ID`
   - Copy **App Secret** → `META_APP_SECRET`
6. Set the redirect URI secret:
   - Value: `https://live.isunday.me/api/integrations/instagram/callback` → `INSTAGRAM_REDIRECT_URI`
7. Set scopes in **Facebook Login → Permissions & Features** — ensure these are added:
   - `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`
8. Submit the app for **App Review** for `instagram_content_publish` and `pages_read_engagement` (required for production; test with your own account in Dev mode first).

### Add Worker secrets

```bash
wrangler secret put META_APP_ID
wrangler secret put META_APP_SECRET
wrangler secret put INSTAGRAM_REDIRECT_URI
```

### Verify

After deploying:
1. Go to `https://ai.isunday.me/publish` → **Connections** tab.
2. The Instagram card will show a purple **Connect Instagram / Reels** button.
3. Click it → you will be redirected to Facebook Login consent.
4. After approving, you land back on the Publishing Hub with a green **Connected** badge.

---

## 2 — TikTok

### What you need
A **TikTok for Developers** app with the **Content Posting API** enabled.

### Step-by-step

1. Go to [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps** → **Create app**.
2. Fill in app name, category (Content Tools), description.
3. Under **Products**, enable:
   - **Login Kit** (required for OAuth)
   - **Content Posting API**
4. In **Login Kit → Configure**:
   - Add **Redirect URI for login**: `https://live.isunday.me/api/integrations/tiktok/callback`
5. Under **App info**, copy:
   - **Client Key** → `TIKTOK_CLIENT_KEY`
   - **Client Secret** → `TIKTOK_CLIENT_SECRET`
6. Set the redirect URI secret:
   - Value: `https://live.isunday.me/api/integrations/tiktok/callback` → `TIKTOK_REDIRECT_URI`
7. Request scopes:
   - `user.info.basic` — approved automatically
   - `video.upload` — requires brief justification in the app review form
8. Submit for **App Audit** (required to use with accounts other than the developer account). You can test immediately with the developer TikTok account.

### Add Worker secrets

```bash
wrangler secret put TIKTOK_CLIENT_KEY
wrangler secret put TIKTOK_CLIENT_SECRET
wrangler secret put TIKTOK_REDIRECT_URI
```

### Verify

After deploying:
1. Go to `https://ai.isunday.me/publish` → **Connections** tab.
2. The TikTok card will show a **Connect TikTok** button.
3. Click it → TikTok consent screen.
4. After approval, you land back with a **Connected** badge showing your TikTok display name and avatar.

---

## 3 — Twitter / X

### What you need
A **Twitter Developer Portal** app with **OAuth 2.0** enabled, type **Web App, Automated App or Bot**.
Requires an **Elevated** or **Basic** access tier (Free tier doesn't allow tweet.write at scale).

### Step-by-step

1. Go to [developer.twitter.com](https://developer.twitter.com) → **Projects & Apps** → **New App**.
2. Name the app and copy the **Bearer Token** (not needed here, but save it).
3. In **App Settings → User authentication settings** → **Set up**:
   - App type: **Web App, Automated App or Bot**
   - Callback URI / Redirect URL: `https://live.isunday.me/api/integrations/twitter/callback`
   - Website URL: `https://live.isunday.me`
   - Required scopes (toggle on): `tweet.read`, `tweet.write`, `users.read`, `offline.access`
4. After saving, Twitter shows the **Client ID** and **Client Secret** once. Copy both immediately.
   - `Client ID` → `TWITTER_CLIENT_ID`
   - `Client Secret` → `TWITTER_CLIENT_SECRET`
5. Set the redirect URI secret:
   - Value: `https://live.isunday.me/api/integrations/twitter/callback` → `TWITTER_REDIRECT_URI`

> **Important:** Twitter OAuth 2.0 uses **PKCE** — there is no separate "state" cookie. The `tw_code_verifier` cookie is set at connect time and consumed at callback. Do not share the same callback URL across multiple apps.

### Add Worker secrets

```bash
wrangler secret put TWITTER_CLIENT_ID
wrangler secret put TWITTER_CLIENT_SECRET
wrangler secret put TWITTER_REDIRECT_URI
```

### Verify

After deploying:
1. Go to `https://ai.isunday.me/publish` → **Connections** tab.
2. The Twitter / X card will show a blue **Connect Twitter / X** button.
3. Click it → Twitter OAuth consent with your app's name.
4. After approval, you land back with a **Connected** badge showing your display name and @handle.

---

## Cron Auto-publish

The hourly cron (`0 * * * *` in `wrangler.toml`) calls `GET /api/cron/publish/scheduled`.

It finds all `publish_queue` items where `status='scheduled' AND scheduled_for <= now()` and processes up to **10 items per run**.

| Platform | Cron behaviour |
|---|---|
| **YouTube** | Streams R2 archive directly to YouTube resumable upload. Works for files ≤ ~200 MB. For larger files it re-queues the item and asks the creator to use "Publish Now" from the browser (browser-mediated upload has no size limit). |
| **Instagram, TikTok, Twitter** | Marks as `failed` with a message directing the creator to publish manually once the OAuth is configured. |

You can trigger the cron manually at any time:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://live.isunday.me/api/cron/publish/scheduled
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Connect button not showing | Worker secret not set or Worker not redeployed | Run `wrangler secret put` then redeploy |
| "Invalid CSRF state" on callback | Cookie expired (>10 min) or browser blocked it | Retry the connect flow |
| Instagram: "no instagram business account" | Personal IG account or not linked to a Page | Connect the IG account to a Facebook Page in Meta Business Suite |
| TikTok: 403 on token exchange | Redirect URI mismatch | Ensure `TIKTOK_REDIRECT_URI` matches exactly what's in the TikTok Developer Portal |
| Twitter: "expired_token" after 2 hours | Refresh token missing (offline.access scope not granted) | Reconnect; ensure `offline.access` scope is enabled in the app settings |
| Cron not running | Worker not deployed / cron not registered | Run `wrangler deploy` — crons in `wrangler.toml` are registered at deploy time, not push time |
