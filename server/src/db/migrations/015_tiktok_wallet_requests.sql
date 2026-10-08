-- While the TikTok app is unaudited, creators request access from the launch form (before any coin exists):
-- they give their TikTok username, an admin adds it as a sandbox target user and marks it added.
CREATE TABLE IF NOT EXISTS tiktok_wallet_requests (
  wallet        text PRIMARY KEY,
  username      text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','connected')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  invited_at    timestamptz
);
CREATE INDEX IF NOT EXISTS tiktok_wallet_requests_status_idx ON tiktok_wallet_requests(status, requested_at);
