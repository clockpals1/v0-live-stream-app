# Production Setup Guide

This walks through everything needed to get **Stripe**, **Google /
YouTube**, and **Cloudflare R2** working in production at
`live.isunday.me`. Estimated time: 60-90 minutes total if you've never
touched these dashboards before.

> **Order matters.** Do them in the order below. R2 is the easiest;
> Stripe is the most fiddly.

---

## Prerequisites

Before starting, make sure you have:

- Wrangler CLI logged in: `npx wrangler whoami` should show your
  Cloudflare account email.
- The Supabase SQL Editor open in another tab.
- The following migrations applied in order (paste each file into the
  SQL Editor and run, only the ones not yet applied):
  - `022_admin_plan_grants.sql` — manual plan grants table.
  - `023_archive_retention.sql` — soft delete + retention columns.

> **Setting Worker secrets.** Throughout this guide you'll see commands
> like `npx wrangler secret put R2_BUCKET`. Run that, then paste the
> value when it prompts. Repeat for each secret. They're encrypted at
> rest in Cloudflare and only readable by your Worker.

---

## 1. Cloudflare R2 (cloud archive uploads) — ~10 min

R2 is Cloudflare's S3-compatible object store. We use it to store
post-stream recordings uploaded directly from the browser via
presigned URLs.

### 1a. Enable R2 and create a bucket

1. Go to **Cloudflare dashboard → R2 → Overview** and click
   **Purchase R2** if it's not already enabled. (Free tier is generous —
   10 GB storage and 1M Class A operations/month.)
2. Click **Create bucket**.
   - **Name:** `live-stream-archives` (or whatever you prefer; just
     remember it).
   - **Location:** Automatic.
   - **Default storage class:** Standard.
3. Open the new bucket → **Settings** tab.

### 1b. Configure CORS (so the browser can PUT directly)

In **Settings → CORS Policy**, paste this and save:

```json
[
  {
    "AllowedOrigins": ["https://live.isunday.me"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add `http://localhost:3000` to `AllowedOrigins` if you also want
uploads to work from local dev.

### 1c. (Optional but recommended) Public custom domain

If you want archives served from `archives.isunday.me` instead of a
signed-URL-on-every-load pattern:

1. Bucket → **Settings → Public access → Connect Domain**.
2. Enter `archives.isunday.me`.
3. Cloudflare auto-creates the DNS record on your zone.

If you skip this, the app still works — it falls back to short-lived
signed download URLs.

### 1d. Get your Account ID

Cloudflare dashboard → right sidebar of any page → copy **Account ID**
(a 32-char hex string).

### 1e. Create an R2 API token

1. **R2 → Manage R2 API Tokens → Create API Token**.
2. **Token name:** `v0-live-stream-app worker`.
3. **Permissions:** **Object Read & Write**.
4. **Specify bucket:** the bucket you just created (don't grant
   account-wide access — minimize blast radius).
5. **TTL:** Forever (or set a reminder to rotate yearly).
6. Click **Create API Token**.
7. Copy the **Access Key ID** and **Secret Access Key**. **The secret
   is shown only once** — save it somewhere safe immediately.

### 1f. Set the secrets on your Worker

Run each of these in the project directory and paste the value when
prompted:

```bash
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
# Only if you set up the public custom domain in step 1c:
npx wrangler secret put R2_PUBLIC_URL_BASE
# Value: https://archives.isunday.me  (no trailing slash)
```

### 1g. Enable cloud_archive on a plan

1. Sign in to `live.isunday.me` as an admin.
2. Visit `/admin/billing` → **Plans** section.
3. Edit the plan you want to enable cloud archive for.
4. Toggle the **`cloud_archive`** feature on. Save.

### 1h. Verify

- Visit `/host/settings`. The **Cloud archive** card should show a
  green **Available** pill.
- Start and end a test stream — the post-stream dialog should let you
  upload to R2.

---

## 2. Google YouTube Data API — ~25 min

Allows hosts to publish their post-stream recording straight to their
YouTube channel.

### 2a. Create a Google Cloud project

1. <https://console.cloud.google.com> → top bar **Project selector → New Project**.
2. **Project name:** `live-stream-app` (or anything).
3. Wait for it to create, then make sure the new project is selected
   in the top bar.

### 2b. Enable the YouTube Data API v3

1. Sidebar → **APIs & Services → Library**.
2. Search for **YouTube Data API v3** → **Enable**.

### 2c. Configure the OAuth consent screen

1. Sidebar → **APIs & Services → OAuth consent screen**.
2. **User Type:** External → **Create**.
3. **App information:**
   - App name: `Live Stream` (or your brand).
   - User support email: your email.
   - App logo: optional.
4. **App domain:**
   - Application home page: `https://live.isunday.me`
   - Application privacy policy: `https://live.isunday.me/privacy`
     (create this page later if needed)
   - Application terms of service: `https://live.isunday.me/terms`
5. **Authorized domains:** `isunday.me`.
6. **Developer contact info:** your email.
7. Click **Save and Continue**.

8. **Scopes** screen → **Add or Remove Scopes** → manually add:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `openid`, `email`, `profile`
9. **Save and Continue**.

10. **Test users:** while in "Testing" mode, only listed test users can
    auth. Add your own email (and any other host emails). Save.

11. **Publishing status:** Initially the app is in "Testing." That's
    fine for the first few hosts. To remove the 100-user testing limit
    you'll later need to **Publish App** which kicks off Google's
    verification (they'll review your privacy policy and scope usage —
    typically 1-3 weeks for sensitive scopes like `youtube.upload`).

### 2d. Create the OAuth client credentials

1. Sidebar → **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type:** Web application.
3. **Name:** `live-stream-app worker`.
4. **Authorized JavaScript origins:**
   - `https://live.isunday.me`
   - (Optional) `http://localhost:3000` for dev.
5. **Authorized redirect URIs:**
   - `https://live.isunday.me/api/integrations/youtube/callback`
   - (Optional) `http://localhost:3000/api/integrations/youtube/callback`
6. **Create**. Copy the **Client ID** and **Client Secret** that pop
   up. The secret is only shown once.

### 2e. Set the Worker secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REDIRECT_URI
# Value: https://live.isunday.me/api/integrations/youtube/callback
```

### 2f. Enable youtube_upload on a plan

`/admin/billing` → toggle the **`youtube_upload`** feature on at least
one plan. Save.

### 2g. Verify

- `/host/settings` → **YouTube** card should show **Available**.
- Click **Connect YouTube** → walks through Google consent → returns
  to the page with the channel name + avatar.
- After your next stream, the post-stream dialog will offer the
  YouTube upload option.

> **Quota note.** YouTube Data API uploads cost ~1,600 quota units
> each, and the default project quota is 10,000 units/day (~6 uploads
> per project per day). Once you have real volume, request a quota
> increase via Google Cloud Console → APIs & Services → YouTube Data
> API v3 → Quotas → "All quotas" → Edit Quotas. State your use case
> clearly; turnaround is days-weeks.

---

## 3. Stripe (paid plans / subscriptions) — ~30 min

Stripe handles all customer payments. Unlike R2 and YouTube, Stripe
keys are stored in the database (admin UI) rather than Worker secrets,
so the admin can rotate them without redeploying.

### 3a. Create the Stripe account

1. <https://dashboard.stripe.com> → sign up. Use a real business
   email — Stripe will eventually want bank details for live mode.
2. Stripe starts you in **Test mode** (toggle top-right). Stay there
   until you've verified the integration works end-to-end.

### 3b. Create your products & prices in Stripe (test mode)

For each plan you want to sell (Pro, Studio, etc.):

1. **Products → Add product**.
2. **Name:** match the plan name in your `/admin/billing` editor.
3. **Pricing:**
   - **Recurring**, billing period **monthly** (or yearly).
   - Currency: USD (or whatever you operate in).
   - Price: e.g. `$19.00`.
4. **Save**. On the resulting page, copy the **Price ID** (it looks
   like `price_1OrXXXxXXxXXxXXxX`). You'll paste this into the admin UI
   in step 3e.
5. Repeat for any annual variants.
6. **Repeat the entire process again in Live mode** later when you're
   ready to charge real cards (toggle top-right). Live-mode prices have
   different IDs than test-mode prices — that's why the
   `billing_plans` table stores both.

### 3c. Get your API keys (test mode)

1. **Developers → API keys**.
2. Copy:
   - **Publishable key** (starts with `pk_test_…`).
   - **Secret key** — click **Reveal** (starts with `sk_test_…`).

### 3d. Create the webhook endpoint

1. **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:** `https://live.isunday.me/api/billing/webhook`
3. **Events to listen to** (click **Select events**):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. **Add endpoint**.
5. On the endpoint detail page, click **Reveal** under **Signing
   secret** and copy it (starts with `whsec_…`).

### 3e. Paste keys into the admin UI

1. Sign in to `live.isunday.me` as an admin.
2. `/admin/billing` → **Stripe credentials** section.
3. **Mode:** keep on **Test** for now.
4. Fill the three test fields:
   - Test secret key → `sk_test_…`
   - Test publishable key → `pk_test_…`
   - Test webhook secret → `whsec_…`
5. **Save**. The fields should now show ✓ "Set" with the last 4 chars
   of the secret as a placeholder.

### 3f. Wire prices into your plans

For each plan in `/admin/billing → Plans`:

1. Click the plan to edit.
2. Paste the **test Price ID** (`price_…` from step 3b) into
   **Stripe price (test)**.
3. Save. (Leave **Stripe price (live)** blank for now.)

### 3g. End-to-end test (test mode)

1. Sign in as a non-admin host (or use admin → Manual grants → revoke
   any active grant first, so you're on the underlying plan).
2. `/host/dashboard` → **Subscription** card → **Upgrade plan**.
3. Pick a plan → click **Continue to checkout**.
4. Stripe Checkout opens. Use **test card `4242 4242 4242 4242`**, any
   future expiry, any CVC, any zip.
5. Complete the flow. You should land back on the dashboard with a
   "Subscription active" toast.
6. Verify the host's row in Supabase:
   ```sql
   select plan_slug, subscription_status, stripe_customer_id
   from hosts where email = 'your-test-host@example.com';
   ```
   Expect `plan_slug` = your purchased slug, `subscription_status` =
   `active`.
7. Visit Stripe → **Customers** — you should see the new customer with
   the active subscription.

### 3h. Going live

When you're ready to take real money:

1. **Activate your Stripe account** (Settings → Activate account).
   Stripe will need legal name, address, EIN/SSN, bank account.
2. Once activated, in Stripe **toggle to Live mode** and:
   - Re-create every product & price in live mode (yes, separately).
   - Create a separate live webhook endpoint pointing at the same URL.
   - Grab the **live** API keys and **live** webhook signing secret.
3. In `/admin/billing → Stripe credentials`, fill the **live** fields,
   then change **Mode** to **Live**, save.
4. In each plan, paste the **live Price ID** into **Stripe price (live)**.
5. Test again — but **with a real card and a small price** ($1 plan)
   first. Refund yourself afterwards via the Stripe dashboard.

> **Customer Portal.** Stripe → Settings → Customer portal →
> **Activate test link** so the "Manage subscription" button works.
> Configure what users can do (cancel, update card, switch plan).
> Repeat the activation step for live mode separately.

---

## 4. Sentry (error monitoring) — ~5 min

Optional but strongly recommended. Without it, every bug becomes "I
dunno, it just stopped working."

1. <https://sentry.io> → create a free account.
2. **Projects → Create Project** → platform **Next.js** → name it
   `live-stream-app`.
3. On the resulting page, copy the **DSN** (looks like
   `https://abcd1234@o123456.ingest.sentry.io/7654321`).
4. Set the Worker secret:
   ```bash
   npx wrangler secret put SENTRY_DSN
   ```
5. (Optional) Set environment + release tags so you can filter:
   ```bash
   npx wrangler secret put SENTRY_ENVIRONMENT   # value: production
   npx wrangler secret put SENTRY_RELEASE       # value: deploy SHA
   ```
6. The app reports server errors automatically; client errors are
   forwarded via `app/global-error.tsx` → `/api/observability/client-error`.
7. Test it: cause a known error (e.g. POST malformed JSON to
   `/api/admin/billing/grants`) and watch it appear in the Sentry
   issues list within ~30s.

---

## 5. Transactional email (Welcome / Payment failed / Archive ready / Plan granted) — ~10 min

The platform sends 4 transactional emails. They reuse the same
SMTP-or-Resend transport that Insider Circle broadcasts use, so if
that's already working, transactional emails work too.

If not yet configured, pick **one** of:

### Option A: Resend (easiest)

1. <https://resend.com> → sign up.
2. **API Keys → Create API Key** → copy the key (starts with `re_…`).
3. **Domains → Add Domain** → add `isunday.me`. Resend shows the DNS
   records you need (TXT for SPF, CNAME for DKIM). Add them to your
   Cloudflare zone and click **Verify**.
4. Set the Worker secrets:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM
   # Value: e.g. "Live Stream <noreply@isunday.me>"
   ```

### Option B: SMTP (use any provider — SES, Brevo, SendGrid…)

```bash
npx wrangler secret put SMTP_HOST
npx wrangler secret put SMTP_PORT       # 465 (TLS) or 587 (STARTTLS)
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASS
npx wrangler secret put SMTP_FROM
```

Test by triggering a known sender — for example, the easiest is admin
→ Manual grants → grant a plan to yourself. You should receive the
"You've been upgraded to {plan}" email within seconds.

If neither backend is configured, every transactional sender silently
no-ops (fire-and-forget; never breaks the user-facing flow). Watch for
`[email/welcome] skipped — backend not configured` in `wrangler tail`.

---

## 6. Archive retention cron — ~3 min

Migration 023 added a `delete_after_at` column on each archive,
populated from the host's plan retention at upload time. The cron
endpoint at `/api/cron/archives/cleanup` deletes any expired archives
from R2 and soft-deletes the rows.

Wrangler is already configured with a daily 03:30 UTC trigger
(`wrangler.toml` → `[triggers] crons`), but you also need a shared
secret for manual / external scheduler calls:

```bash
npx wrangler secret put CRON_SECRET    # any random 32-byte hex
```

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Verify by calling the dry-run mode:

```bash
curl -X POST "https://live.isunday.me/api/cron/archives/cleanup?dryRun=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response: `{ "ok": true, "dryRun": true, "scanned": 0, ... }`
when there's no expired data, or a sample of the rows that **would**
be deleted.

> **Per-plan retention.** Each plan's `features` JSON has a
> `retention_days` integer. Free plans default to 30 days, paid to
> 365. Edit per-plan in `/admin/billing → Plans`. Existing archives
> were backfilled with a 365-day window by migration 023 so the cron
> won't immediately purge legacy uploads.

---

## 7. Final checklist

- [ ] R2: bucket created, CORS set, secrets uploaded, plan toggled.
- [ ] R2: post-stream upload tested.
- [ ] YouTube: OAuth consent screen completed, secrets uploaded, plan
      toggled.
- [ ] YouTube: Connect-channel flow tested end-to-end.
- [ ] Stripe (test): keys + webhook in admin UI, price IDs pasted into
      plans, test purchase with `4242…` succeeds.
- [ ] Stripe (live): account activated, live keys + webhook + price IDs
      pasted, $1 real purchase + refund tested.
- [ ] Migrations `022_admin_plan_grants.sql` AND `023_archive_retention.sql`
      applied.
- [ ] At least one admin account exists (set `hosts.role = 'admin'` or
      `hosts.is_admin = true` in Supabase).
- [ ] (Optional) Sentry: `SENTRY_DSN` set; trial error visible in
      Sentry within 30s of triggering.
- [ ] (Optional) Email: SMTP_* OR RESEND_* configured; manual-grant
      email arrives within seconds.
- [ ] (Optional) `CRON_SECRET` set; dry-run cleanup returns 200.

---

## 5. Where to look when something breaks

| Symptom | First place to look |
|---|---|
| Cloud archive upload fails | `/api/host/storage/status` response — should say `serverConfigured: true`. Check Worker secrets. |
| YouTube "not configured" | Same idea: `/api/host/integrations/youtube/status`. |
| Stripe checkout 500s | `npx wrangler tail` while clicking — most likely a missing key or bad mode. |
| Webhook never fires | Stripe dashboard → Webhooks → click the endpoint → **Recent attempts**. 4xx means signature mismatch (wrong webhook secret); 2xx with no DB change means the handler ran but couldn't match a customer. |
| All pages 500 after a deploy | `npx wrangler tail` and refresh. Almost always a Next.js routing conflict or a top-level import that throws. |

---

## 6. Secret rotation

Rotate annually or when staff with access leaves:

1. **R2:** create a new API token, update three secrets, delete old token.
2. **Google:** Credentials → click client → **Reset client secret**
   (this invalidates existing tokens; hosts must reconnect). Update
   `GOOGLE_CLIENT_SECRET` Worker secret.
3. **Stripe:** Developers → API keys → **Roll** secret key. Paste new
   value into `/admin/billing` → save. **Do not roll the webhook secret
   unless compromised** — every webhook would fail until updated.
