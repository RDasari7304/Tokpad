import { one } from "../db/pool.js";

export interface AccessRequestView {
  username: string;
  status: "pending" | "invited" | "connected";
  requestedAt: Date;
  invitedAt: Date | null;
}

/**
 * Creates or updates a coin's TikTok sandbox (target user) request.
 * Re-submitting the same username keeps its progress; a different username starts over as pending.
 */
export async function upsertAccessRequest(coinId: string, username: string): Promise<AccessRequestView> {
  const row = await one<{ username: string; status: AccessRequestView["status"]; requested_at: Date; invited_at: Date | null }>(
    `INSERT INTO tiktok_access_requests(coin_id, username) VALUES ($1, $2)
     ON CONFLICT (coin_id) DO UPDATE SET
       status = CASE WHEN tiktok_access_requests.username = EXCLUDED.username THEN tiktok_access_requests.status ELSE 'pending' END,
       invited_at = CASE WHEN tiktok_access_requests.username = EXCLUDED.username THEN tiktok_access_requests.invited_at ELSE NULL END,
       requested_at = CASE WHEN tiktok_access_requests.username = EXCLUDED.username THEN tiktok_access_requests.requested_at ELSE now() END,
       username = EXCLUDED.username
     RETURNING username, status, requested_at, invited_at`,
    [coinId, username],
  );
  return { username: row!.username, status: row!.status, requestedAt: row!.requested_at, invitedAt: row!.invited_at };
}

/** The TikTok account connected in the launch form and waiting for the creator's next coin. */
export async function pendingConnection(wallet: string) {
  return one<{
    open_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    token_enc: string;
    token_expires_at: Date;
    refresh_token_enc: string;
    refresh_expires_at: Date;
    scopes: string[];
  }>(`SELECT * FROM tiktok_pending_connections WHERE wallet = $1 AND refresh_expires_at > now()`, [wallet]);
}

export interface WalletRequestView {
  username: string;
  status: "pending" | "invited" | "connected";
  requestedAt: Date;
  invitedAt: Date | null;
}

const walletView = (r: { username: string; status: WalletRequestView["status"]; requested_at: Date; invited_at: Date | null }): WalletRequestView => ({
  username: r.username,
  status: r.status,
  requestedAt: r.requested_at,
  invitedAt: r.invited_at,
});

/** The launch-form access request for a wallet, if any. */
export async function walletRequest(wallet: string): Promise<WalletRequestView | null> {
  const r = await one<any>(`SELECT * FROM tiktok_wallet_requests WHERE wallet = $1`, [wallet]);
  return r ? walletView(r) : null;
}

/** Creates or updates a launch-form access request. The same username keeps its progress; a new one starts over. */
export async function upsertWalletRequest(wallet: string, username: string): Promise<WalletRequestView> {
  const r = await one<any>(
    `INSERT INTO tiktok_wallet_requests(wallet, username) VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE SET
       status = CASE WHEN tiktok_wallet_requests.username = EXCLUDED.username THEN tiktok_wallet_requests.status ELSE 'pending' END,
       invited_at = CASE WHEN tiktok_wallet_requests.username = EXCLUDED.username THEN tiktok_wallet_requests.invited_at ELSE NULL END,
       requested_at = CASE WHEN tiktok_wallet_requests.username = EXCLUDED.username THEN tiktok_wallet_requests.requested_at ELSE now() END,
       username = EXCLUDED.username
     RETURNING *`,
    [wallet, username],
  );
  return walletView(r);
}
