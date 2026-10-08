# Tokpad

Launch a pump.fun coin with its own AI influencer. The creator sets the name, ticker, image and character (personality,
look, voice); the coin is created on pump.fun from their wallet; they can connect a TikTok
account; the character then posts videos, photos and photo carousels on a schedule, on Tokpad and on TikTok. Each coin also gets an agent wallet that
receives the coin's pump.fun creator fees and automatically uses them to buy back and burn the coin.

## How it works

```
Browser (React + Solana wallet adapter)
   │  sign-in by wallet signature, launch form, coin pages
   ▼
API (Express) ───────────── Postgres (coins, posts, treasury log, job queue)
   │                              ▲
   │                              │ jobs
   ▼                              │
Worker ── plan post (Claude) ── generate media (fal.ai) ── store (R2) ── publish (TikTok Content Posting API)
      └── treasury: price snapshot → claim creator fees → policy decision → buy (PumpPortal) → burn
```

**Launch.** The server generates a mint keypair and an agent keypair (encrypted at rest), pins the image and metadata to
IPFS, and builds one transaction: pump.fun `createV2` with the creator wallet as payer and the **agent wallet as the coin's
creator** (so creator fees go to the treasury), plus the platform fee and a small gas transfer to the agent. The mint key
signs on the server; the creator signs in their wallet; the server checks the signed transaction is byte-for-byte what it
built before broadcasting. An optional first buy follows as a second approval.

**Posting.** Every minute the worker finds coins due a post, picks a format (respecting the weekly video cap), asks Claude
for a plan in the character's voice, rejects captions that promise returns or tell people to buy, generates images with the
token image as a character reference (and animates keyframes for videos), converts to TikTok-compatible JPEG/MP4,
stores them publicly, and publishes. Creators can switch on review mode to approve each post first.

**Treasury (automatic buyback and burn).** Every 15 minutes per coin: record the price and claim creator fees. Once at
least `TREASURY_MIN_BUY_SOL` has collected (and at most every `TREASURY_BUY_INTERVAL_MIN` minutes), the agent spends the
fees above its gas reserve buying the coin back, then burns everything it bought. The pure policy in
`server/src/domain/treasuryPolicy.ts` caps each buyback and each day; extra fees carry over. Creators can't change or
pause it; admins can, platform-wide or per coin. `TREASURY_DRY_RUN=true` (the default) logs simulated
trades instead of sending them. Admins have kill switches for launches, posting and trading.

## Run locally

Requirements: Node 20+ and Postgres 14+. On Windows, use **WSL** (Ubuntu) and keep the project in your Linux home
folder (`~/tokpad`), not under `/mnt/c`. Run every `npm` command from WSL: packages installed from Windows don't work
in WSL and vice versa.

```bash
# 1. Get the code
git clone https://github.com/RDasari7304/Tokpad.git ~/tokpad
cd ~/tokpad
npm install

# 2. Postgres (skip if you already have it)
sudo apt update && sudo apt install -y postgresql
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" -c "CREATE DATABASE tokpad;"

# 3. Settings
cp .env.example server/.env
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
#    paste both lines into server/.env, then set at least:
#      NODE_ENV=development
#      PUBLIC_URL=http://localhost:5173
#      DATABASE_URL=postgres://postgres:postgres@localhost:5432/tokpad
#      DATABASE_SSL=false
#      ADMIN_WALLETS and PLATFORM_FEE_WALLET = your Solana wallet address
#    Keys you don't have yet can be any placeholder text (URLs must look like URLs, e.g. https://example.com).

# 4. Run
npm run migrate:dev --workspace server
npm run dev            # site on http://localhost:5173, API on :8080
npm test               # unit tests
```

Check the API with `curl localhost:8080/api/health` (`{"ok":true}`). If the site shows "Request failed (500)", the API
isn't running: its error is in the `npm run dev` terminal (usually Postgres not started, or a bad value in `server/.env`).

What works with which keys:

| To... | You need real |
|---|---|
| Browse the site, open Admin | nothing beyond the settings above, plus a Solana wallet extension (e.g. Phantom) |
| Launch a coin | `PINATA_JWT`, `S3_*`, a paid `SOLANA_RPC_URL`, and real SOL |
| Generate posts | `ANTHROPIC_API_KEY`, `FAL_KEY` |
| Post to TikTok | `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` and a public HTTPS URL (see below) |

TikTok login needs a public HTTPS redirect, so test the connect flow on your deployed domain, or run an HTTPS tunnel
(`cloudflared tunnel --url http://localhost:5173`) and set `PUBLIC_URL` to the tunnel's address.

## Accounts you need

| Service | Used for | Notes |
|---|---|---|
| Solana RPC (Helius, Triton…) | Launches, balances, trades | Public RPC drops transactions |
| Pinata | IPFS image + metadata | pump.fun no longer accepts direct uploads |
| Cloudflare R2 (or any S3) | Public media for TikTok | Bucket must be publicly readable, domain verified in TikTok |
| TikTok developer app | TikTok publishing | See below |
| Anthropic | Post planning and captions | |
| fal.ai | Images and Reels | Model IDs configurable |

## TikTok setup

Creators connect TikTok **inside the launch form**: step 1 is "Log in with TikTok", which sends them to TikTok's
login and consent screen and back to the form. The account is attached to the coin when it's created, becomes the
token's website on pump.fun, and the influencer posts there from launch. With `TIKTOK_REQUIRED_AT_LAUNCH=true` (default)
nobody can launch without it; set it to `false` to make TikTok optional (creators can then connect later from the
coin page).

### 1. Create the app

1. Go to [developers.tiktok.com](https://developers.tiktok.com), log in, and register as a developer (individual or
   organization).
2. **Manage apps → Connect an app.** Fill in: app icon (1024×1024), name ("Tokpad"), category, description, and these
   URLs: Terms of Service `https://yourdomain.com/terms`, Privacy Policy `https://yourdomain.com/privacy`, and
   Web/Desktop URL `https://yourdomain.com`. Platforms: **Web**.
3. Copy the **Client key** and **Client secret** into `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.

### 2. Add products and scopes

1. **Add products → Login Kit.** Redirect URI (Web): `https://yourdomain.com/api/tiktok/callback`. It must match
   `PUBLIC_URL` exactly, so it must be HTTPS (see "Testing locally" below).
2. **Add products → Content Posting API.** Turn on **Direct Post**.
3. **Scopes:** `user.info.basic`, `user.info.profile`, `video.publish`, `video.upload`, `video.list`.
4. **URL properties → Add URL property:** verify the domain (or URL prefix) of `S3_PUBLIC_BASE_URL`, e.g.
   `https://media.yourdomain.com/`. TikTok gives you a TXT record (domain) or a file (URL prefix) to prove ownership.
   TikTok pulls every video and photo from that address and rejects unverified ones (`url_ownership_unverified`).
5. **Webhooks:** callback URL `https://yourdomain.com/api/tiktok/webhook`, so Tokpad drops the tokens when a creator
   removes the app from their TikTok.

### 3. Sandbox (before TikTok approves the app)

1. In the app, switch to **Sandbox** (create one if asked). Sandbox has its own client key and secret: use those in
   `server/.env` while testing.
2. **Sandbox → Target users → Add account:** add each TikTok account that should be able to log in (yours first). Only
   target users can log in while the app is unaudited, and TikTok allows a limited number of them.
3. Keep `TIKTOK_ACCESS_MODE=testers`. Unaudited apps can only post **privately** ("only me"); Tokpad does this
   automatically, so test posts show on the account but aren't public.
4. Admin → TikTok access lists accounts creators asked for from coin pages (when TikTok isn't required at launch).

While the app is unaudited (`TIKTOK_ACCESS_MODE=testers`), Tokpad follows TikTok's limits for unaudited apps:
every post goes out as private (`SELF_ONLY`), the creator's TikTok account must itself be set to Private (otherwise
the post fails with an explanation), only a few accounts can post through the app per day, and comment replies are
off. Coins can choose 1-15 posts a day (default 3) instead of the usual minimum. Posts still show publicly on Tokpad.

### 4. Go live (audit)

1. In the app, **Submit for review**. Include a screen recording of: open the launch form → Log in with TikTok →
   approve → finish launching → a post appearing on the TikTok account. Explain that posts are AI-generated and
   labelled as such (`is_aigc`), and that creators choose to connect their own accounts.
2. After approval, switch `server/.env` to the production client key/secret and set `TIKTOK_ACCESS_MODE=open`. Posts go
   out public (`TIKTOK_PRIVACY_LEVEL`, default `PUBLIC_TO_EVERYONE`), and any TikTok account can log in.

### Testing locally

TikTok only redirects to HTTPS addresses you've registered, so `http://localhost` won't work for the login itself.
Either set `TIKTOK_REQUIRED_AT_LAUNCH=false` and skip TikTok locally, or run a tunnel:

```bash
cloudflared tunnel --url http://localhost:5173      # prints https://<random>.trycloudflare.com
```

Set `PUBLIC_URL` to that address, add `<that address>/api/tiktok/callback` as a Login Kit redirect URI in the sandbox,
restart `npm run dev`, and open the site through the tunnel address.

### Limits and notes

- TikTok caps Direct Post at roughly 15 posts per creator per day, so `CONTENT_MAX_POSTS_PER_DAY` defaults to 15.
- Videos post as TikToks; image posts and carousels post as photo-mode posts with auto-added music. All carry
  TikTok's AI-generated label.
- Access tokens last 24 hours and refresh automatically (refresh tokens last a year).
- **Comment replies (optional):** TikTok's comment scopes (`comment.list`, `comment.list.manage`) need separate
  approval. Once granted, set `TIKTOK_COMMENTS=true`; creators reconnect once.

## Characters that hold together

The launch form's **Character** step is a small story bible: a one-line pitch, a **goal**, **what's in the way**, the
character's **world**, a recurring **cast** (up to 5), voice and catchphrase. "Write my character" drafts all of it
from a one-line idea (one Claude call, counted in the AI budget).

- Every storyline is planned as the next chapter toward the goal and records how it moved the character closer
  (`story_arcs.goal_step`); later storylines see that history.
- Story posts go out as a numbered TikTok series ("<storyline> · Part 3"), opening with a hook that picks up from the
  previous part. Turn it off per coin with `contentSettings.seriesLabels=false`.
- The cast and goal are in every planning prompt, so the same people and the same ambition keep coming back.

## Deploy (Render)

**Full step-by-step guide: [DEPLOY.md](DEPLOY.md).** Short version:

1. Push this folder to a GitHub repo. In Render, **New → Blueprint** and select it (`render.yaml` creates the web service
   and Postgres).
2. Fill in the dashboard env vars (descriptions in `.env.example`). Generate `MASTER_KEY` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and **store a copy offline**: it decrypts
   every agent wallet.
3. Add your domain in Render, then set `PUBLIC_URL` to it.
4. Migrations run on boot. Open `/admin` with a wallet listed in `ADMIN_WALLETS`.

## Before real money goes through it

- **Launch a test coin end to end** on mainnet with a small amount. The pump.fun SDK call is isolated in
  `server/src/services/pump.ts`; if a newer SDK version changes `createV2Instruction`'s parameters, that's the one place to
  adjust. Confirm on pump.fun that the coin's creator is the agent wallet.
- Check the fal.ai model pages for current input fields and prices (`server/src/services/ai/fal.ts`), and set
  `COST_*_USD` and `DAILY_AI_BUDGET_USD` accordingly.
- Watch simulated treasury activity for a few days, then set `TREASURY_DRY_RUN=false`. Start with low platform caps.
- The platform holds the agent wallets' keys, which makes treasuries custodial. Keep `MASTER_KEY` and the database
  secured, restrict admin wallets, and consider the legal side of running a service that creates and trades tokens and
  promotes them on social media. TikTok's policies on financial products, AI-generated content and branded content apply to these accounts.
  Have a lawyer review the Terms and Privacy pages in `web/src/pages/Legal.tsx`.

## Project layout

```
server/src
  config.ts               env validation
  db/                     pool, migrations, Postgres job queue
  domain/                 pure logic: catalog, schemas, persona prompt, captions, schedule, treasury policy
  services/               pump.fun, PumpPortal, Solana, TikTok, Claude, fal.ai, storage, IPFS, content, treasury
  http/                   routes: auth (wallet sign-in), coins, posts, tiktok, admin
  worker/                 job runner + minute ticker
web/src
  pages/                  Home, Launch, Coin, Mine, Admin, Legal
  editors.tsx             character / posting / treasury editors (launch + settings)
```
