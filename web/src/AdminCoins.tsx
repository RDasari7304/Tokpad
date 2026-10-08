import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, normalizeTikTokUsername, shortAddr } from "./api";

type AccessState = "none" | "pending" | "invited" | "connected" | "expired" | "disconnected";

interface AdminCoin {
  id: string;
  name: string;
  symbol: string;
  imageUrl: string;
  mint: string | null;
  creatorWallet: string;
  status: "draft" | "awaiting_signature" | "launching" | "live" | "failed";
  createdAt: string;
  launchedAt: string | null;
  access: { state: AccessState; username: string | null; requestedAt: string | null; invitedAt: string | null };
}

interface AdminCoinsResponse {
  accessMode: "testers" | "open";
  sandboxUrl: string;
  testersUsed: number;
  coins: AdminCoin[];
}

const TESTER_LIMIT = 10; // TikTok sandbox target users

const STATE_LABEL: Record<AccessState, string> = {
  none: "No username yet",
  pending: "Needs sandbox access",
  invited: "Added, waiting for creator to log in",
  connected: "Connected",
  expired: "Connection expired",
  disconnected: "Disconnected",
};

const COIN_STATUS: Record<AdminCoin["status"], string> = {
  draft: "Not launched",
  awaiting_signature: "Not launched",
  launching: "Launching",
  live: "Live",
  failed: "Launch failed",
};

type Filter = "all" | "pending" | "invited" | "connected" | "none";
const FILTERS: Array<[Filter, string]> = [
  ["all", "All"],
  ["pending", "Needs access"],
  ["invited", "Added"],
  ["connected", "Connected"],
  ["none", "No username"],
];

const ago = (iso: string | null) => {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

interface WalletRequest {
  wallet: string;
  username: string;
  status: "pending" | "invited" | "connected";
  requestedAt: string;
  invitedAt: string | null;
}

const REQUEST_LABEL: Record<WalletRequest["status"], string> = {
  pending: "Needs adding",
  invited: "Added, waiting for them to log in",
  connected: "Connected",
};

/** Launch-form requests (no coin yet): creators waiting to be added as TikTok sandbox users. */
function AccessRequests({ sandboxUrl, onChange }: { sandboxUrl: string; onChange: () => void }) {
  const [requests, setRequests] = useState<WalletRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<{ requests: WalletRequest[] }>("/admin/tiktok-wallet-requests")
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const mark = async (r: WalletRequest, invited: boolean) => {
    setBusy(r.wallet);
    try {
      await api(`/admin/tiktok-wallet-requests/${r.wallet}/invited`, { method: "POST", json: { invited } });
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const copy = (u: string) => {
    navigator.clipboard.writeText(u).catch(() => {});
    setCopied(u);
    setTimeout(() => setCopied(null), 1200);
  };
  if (error) return <p className="field-error">{error}</p>;
  if (!requests) return null;
  const pending = requests.filter((r) => r.status === "pending");
  const rest = requests.filter((r) => r.status !== "pending");
  const row = (r: WalletRequest) => (
    <li key={r.wallet} className="access-row">
      <button type="button" className="queue-user" onClick={() => copy(r.username)} title="Copy username">
        @{r.username} <span>{copied === r.username ? "Copied" : "Copy"}</span>
      </button>
      <span className="access-meta">
        {shortAddr(r.wallet)} · {ago(r.requestedAt)}
      </span>
      <span className={`tt-state tt-state-${r.status}`}>{REQUEST_LABEL[r.status]}</span>
      <span className="access-action">
        {r.status === "pending" && (
          <button className="btn btn-small btn-primary" disabled={busy === r.wallet} onClick={() => mark(r, true)}>
            Mark added
          </button>
        )}
        {r.status === "invited" && (
          <button className="btn btn-small btn-quiet" disabled={busy === r.wallet} onClick={() => mark(r, false)}>
            Undo
          </button>
        )}
      </span>
    </li>
  );
  return (
    <div className="access-requests">
      <h3 className="sub">Waiting for TikTok access {pending.length > 0 && <span className="chip-count">{pending.length}</span>}</h3>
      <p className="sub-hint">
        Creators asking from the launch form. For each one: copy the username, add it in{" "}
        <a href={sandboxUrl} target="_blank" rel="noreferrer">
          your app's Sandbox → Target users
        </a>
        , then click Mark added. Their launch form switches to Log in with TikTok within 30 seconds.
      </p>
      {pending.length === 0 && <p className="muted">No one waiting.</p>}
      <ul className="access-list">{pending.map(row)}</ul>
      {rest.length > 0 && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"} added and connected ({rest.length})
          </button>
          {showDone && <ul className="access-list">{rest.map(row)}</ul>}
        </>
      )}
    </div>
  );
}

/** Admin: every coin created so far, with its creator and TikTok sandbox access status. */
export function AdminCoins() {
  const [data, setData] = useState<AdminCoinsResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = (q = search) =>
    api<AdminCoinsResponse>(`/admin/coins${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, pending: 0, invited: 0, connected: 0, none: 0 };
    for (const coin of data?.coins ?? []) {
      c.all++;
      if (coin.access.state in c) c[coin.access.state as Filter]++;
    }
    return c;
  }, [data]);

  if (error) return <p className="field-error">{error}</p>;
  if (!data) return <div aria-busy="true" className="loading-block" />;

  const testers = data.accessMode === "testers";
  const shown = data.coins.filter((c) => filter === "all" || c.access.state === filter);

  return (
    <div className="admin-coins">
      {testers && <AccessRequests sandboxUrl={data.sandboxUrl} onChange={() => load()} />}
      {testers ? (
        <p className="sub-hint">
          Coins that asked for TikTok from their coin page. To give a creator access: copy their TikTok username, open{" "}
          <a href={data.sandboxUrl} target="_blank" rel="noreferrer">
            your app's Sandbox in the TikTok developer portal
          </a>
          , go to Target users, add the account, then click Mark added here so the creator's coin page shows the Log in
          with TikTok button. Sandbox users in use: <strong>{data.testersUsed}</strong> of {TESTER_LIMIT}.
        </p>
      ) : (
        <p className="sub-hint">Open mode: creators log in with TikTok directly. No sandbox access needed.</p>
      )}

      <div className="admin-coins-bar">
        <div className="chips" role="tablist" aria-label="Filter coins">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? "chip on" : "chip"}
              onClick={() => setFilter(key)}
            >
              {label} <span className="chip-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <form
          className="admin-search"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            className="input"
            type="search"
            placeholder="Search name, ticker, wallet or @username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search coins"
          />
        </form>
      </div>

      {shown.length === 0 ? (
        <p className="muted">{data.coins.length === 0 ? "No coins created yet." : "Nothing matches this filter."}</p>
      ) : (
        <ul className="admin-coin-list">
          {shown.map((c) => (
            <CoinRow key={c.id} coin={c} testers={testers} onChange={() => load()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CoinRow({ coin, testers, onChange }: { coin: AdminCoin; testers: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(coin.access.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { state, username } = coin.access;

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveUsername = (e: FormEvent) => {
    e.preventDefault();
    const u = normalizeTikTokUsername(value);
    if (!u) return setError("Use letters, numbers, periods and underscores (2-24, not ending in a period).");
    run(() => api(`/admin/coins/${coin.id}/tiktok-access`, { method: "PUT", json: { username: u } })).then(() =>
      setEditing(false),
    );
  };

  const markInvited = (invited: boolean) =>
    run(() => api(`/admin/tiktok-requests/${coin.id}/invited`, { method: "POST", json: { invited } }));

  return (
    <li className={`admin-coin is-${state}`}>
      <img src={coin.imageUrl} alt="" />
      <div className="admin-coin-main">
        <Link to={`/coin/${coin.id}`} className="admin-coin-name">
          {coin.name} <span>${coin.symbol}</span>
        </Link>
        <span className="admin-coin-meta">
          <span className={`status status-${coin.status}`}>{COIN_STATUS[coin.status]}</span>
          <button type="button" className="admin-wallet" onClick={() => copy(coin.creatorWallet, "wallet")} title="Copy creator wallet">
            {copied === "wallet" ? "Copied" : shortAddr(coin.creatorWallet)}
          </button>
          <span className="muted">created {ago(coin.createdAt)}</span>
        </span>
      </div>

      <div className="admin-coin-tt">
        {editing ? (
          <form className="username-form" onSubmit={saveUsername}>
            <span className="at" aria-hidden>
              @
            </span>
            <input
              className="input"
              value={value}
              maxLength={25}
              autoFocus
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              aria-label={`TikTok username for ${coin.name}`}
            />
            <button className="btn btn-small btn-primary" disabled={busy}>
              Save
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            {username && (
              <button type="button" className="queue-user" onClick={() => copy(username, "user")} title="Copy username">
                @{username} <span>{copied === "user" ? "Copied" : "Copy"}</span>
              </button>
            )}
            <span className={`tt-state tt-state-${state}`}>
              {STATE_LABEL[state]}
              {state === "pending" && coin.access.requestedAt ? `, requested ${ago(coin.access.requestedAt)}` : ""}
              {state === "invited" && coin.access.invitedAt ? ` (${ago(coin.access.invitedAt)})` : ""}
            </span>
          </>
        )}
        {error && <span className="field-error">{error}</span>}
      </div>

      {!editing && (
        <div className="admin-coin-actions">
          {testers && state === "pending" && (
            <button className="btn btn-small btn-primary" disabled={busy} onClick={() => markInvited(true)}>
              Mark added
            </button>
          )}
          {testers && state === "invited" && (
            <button className="btn btn-small btn-quiet" disabled={busy} onClick={() => markInvited(false)}>
              Undo
            </button>
          )}
          {state !== "connected" && (
            <button
              className="btn btn-small btn-quiet"
              onClick={() => {
                setValue(username ?? "");
                setEditing(true);
              }}
            >
              {username ? "Change username" : "Add username"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
