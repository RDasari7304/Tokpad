-- Creators log in with TikTok during the launch form, before the coin exists. The connection waits here,
-- keyed by their wallet, and moves to tiktok_accounts when the coin is created.
CREATE TABLE IF NOT EXISTS tiktok_pending_connections (
  wallet             text PRIMARY KEY,
  open_id            text NOT NULL,
  username           text NOT NULL,
  display_name       text,
  avatar_url         text,
  token_enc          text NOT NULL,
  token_expires_at   timestamptz NOT NULL,
  refresh_token_enc  text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  scopes             text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);
