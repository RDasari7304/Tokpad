import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, humanize, type AppConfig, type Coin, type ContentSettings, type Persona } from "../api";
import { Field, Notice } from "../components";
import {
  ContentEditor,
  defaultContent,
  defaultPersona,
  PersonaEditor,
  TreasuryExplainer,
} from "../editors";
import { decodeTx, signAndLaunch } from "../launchTx";
import { useSession } from "../session";

interface PendingTikTok {
  username: string;
  displayName: string | null;
  picture: string | null;
}

/** The form is kept in sessionStorage while the creator is away at TikTok's login (the image has to be picked again). */
const DRAFT_KEY = "tokpad.launchDraft";
type SavedDraft = { name: string; symbol: string; description: string; twitter: string; telegram: string; persona: Persona; content: ContentSettings };
function saveDraft(d: SavedDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: the form just starts empty */
  }
}
function readDraft(): Partial<SavedDraft> | null {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
  } catch {
    return null;
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

type Stage = "idle" | "saving" | "building" | "signing" | "confirming" | "devbuy" | "done";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "",
  saving: "Uploading image and saving your coin…",
  building: "Preparing the launch transaction…",
  signing: "Approve the transaction in your wallet…",
  confirming: "Launching on pump.fun. This usually takes a few seconds…",
  devbuy: "Approve your first buy in your wallet…",
  done: "Launched.",
};

function ProfilePreview(props: { name: string; symbol: string; description: string; image: string | null; persona: Persona; config: AppConfig; tiktok: string | null }) {
  const { name, symbol, description, image, persona, config } = props;
  const handle = props.tiktok ?? ((name || "yourcoin").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24).replace(/\.+$/, "") || "yourcoin");
  const trait =
    persona.personality === "custom" ? persona.personalityCustom : persona.personality ? config.catalog.personalities[persona.personality] : "";
  const style = persona.visualStyle === "custom" ? persona.visualStyleCustom || "Custom style" : humanize(persona.visualStyle);
  return (
    <aside className="phone" aria-label="Influencer profile preview">
      <div className="phone-screen">
        <div className="tt-top">
          <span className="tt-name">{name || "Your coin"}</span>
        </div>
        <div className="tt-head">
          <div className="tt-avatar">{image ? <img src={image} alt="" /> : <span>{symbol ? symbol[0] : "?"}</span>}</div>
          <span className="tt-handle">@{handle}</span>
          <dl className="tt-stats">
            <div>
              <dt>Following</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Followers</dt>
              <dd>0</dd>
            </div>
            <div>
              <dt>Likes</dt>
              <dd>0</dd>
            </div>
          </dl>
        </div>
        <div className="tt-bio">
          <p>{description || trait || "Your character's bio shows up here."}</p>
          <span className="tt-ticker">{symbol ? `$${symbol}` : "$TICKER"}</span>
          <span className="tt-tag">AI-generated</span>
        </div>
        <div className="tt-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="tt-cell" style={image ? { backgroundImage: `url(${image})` } : undefined}>
              {i === 0 && <span className="tt-style">{style}</span>}
              <span className="tt-plays" aria-hidden>
                ▷ 0
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="phone-note">Preview of its profile. It starts posting on Tokpad right after launch.</p>
    </aside>
  );
}

export default function Launch() {
  const { config, wallet: sessionWallet, signIn } = useSession();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>(defaultPersona);
  const [content, setContent] = useState<ContentSettings>(defaultContent);
  // The TikTok account the creator logged in with (undefined while loading).
  const [tiktok, setTiktok] = useState<PendingTikTok | null | undefined>(undefined);
  const [params, setParams] = useSearchParams();
  const [flash, setFlash] = useState<string | null>(null);
  const [devBuy, setDevBuy] = useState("0");
  const [accepted, setAccepted] = useState(false);

  const [coin, setCoin] = useState<Coin | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  // Coming back from TikTok's login: restore what was typed before leaving, and show how it went.
  useEffect(() => {
    const saved = readDraft();
    if (saved) {
      setName(saved.name ?? "");
      setSymbol(saved.symbol ?? "");
      setDescription(saved.description ?? "");
      setTwitter(saved.twitter ?? "");
      setTelegram(saved.telegram ?? "");
      if (saved.persona) setPersona({ ...defaultPersona(), ...saved.persona });
      if (saved.content) setContent(saved.content);
      clearDraft();
    }
    if (params.get("tt") === "connected") setFlash("TikTok connected. Your influencer will post there from the moment it launches.");
    if (params.get("tt_error")) setError(params.get("tt_error"));
    if (params.has("tt") || params.has("tt_error")) {
      params.delete("tt");
      params.delete("tt_error");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New coins start at the site's default posting pace (lower while the TikTok app is unaudited).
  useEffect(() => {
    const d = config?.limits.defaultPostsPerDay;
    if (d) setContent((c) => (c.postsPerDay === defaultContent().postsPerDay ? { ...c, postsPerDay: d } : c));
  }, [config?.limits.defaultPostsPerDay]);

  useEffect(() => {
    if (!sessionWallet) return setTiktok(null);
    api<{ tiktok: PendingTikTok | null }>("/tiktok/pending")
      .then((r) => setTiktok(r.tiktok))
      .catch(() => setTiktok(null));
  }, [sessionWallet]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);


  const devBuySol = Number(devBuy) || 0;
  const total = useMemo(
    () => (config ? config.platformFeeSol + config.agentGasSol + devBuySol + 0.02 : 0),
    [config, devBuySol],
  );

  if (!config) return <div className="page narrow" aria-busy="true" />;

  const busy = stage !== "idle" && stage !== "done";
  const ttReady = !!tiktok || !config.tiktokRequired || !!coin;
  const canSubmit = name.trim() && symbol.trim() && (file || coin) && accepted && ttReady && !busy;

  /** Sends the creator to TikTok's login. Their wallet session ties the connection to them. */
  async function connectTikTok() {
    setError(null);
    try {
      if (!publicKey) {
        setVisible(true);
        return;
      }
      if (sessionWallet !== publicKey.toBase58()) await signIn();
      saveDraft({ name, symbol, description, twitter, telegram, persona, content });
      window.location.href = "/api/tiktok/connect";
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function disconnectTikTok() {
    await api("/tiktok/pending", { method: "DELETE" }).catch(() => {});
    setTiktok(null);
  }

  async function launch() {
    setError(null);
    try {
      if (!publicKey) {
        setVisible(true);
        return;
      }
      if (!signTransaction) throw new Error("This wallet can't sign transactions.");
      if (sessionWallet !== publicKey.toBase58()) await signIn();

      let current = coin;
      if (!current) {
        setStage("saving");
        const form = new FormData();
        form.append("image", file!);
        form.append(
          "data",
          JSON.stringify({
            name,
            symbol,
            description,
            twitter: twitter || undefined,
            telegram: telegram || undefined,
            persona,
            contentSettings: content,
          }),
        );
        current = (await api<{ coin: Coin }>("/coins", { method: "POST", body: form })).coin;
        setCoin(current);
      }

      await signAndLaunch(current.id, signTransaction, setStage);

      if (devBuySol > 0) {
        try {
          setStage("devbuy");
          const r = await api<{ transaction: string }>(`/coins/${current.id}/dev-buy-tx`, { method: "POST", json: { sol: devBuySol } });
          const sig = await sendTransaction(decodeTx(r.transaction), connection);
          await connection.confirmTransaction(sig, "confirmed");
        } catch (e) {
          // The coin is live either way; the creator can buy on pump.fun.
          console.warn("dev buy failed", e);
        }
      }
      setStage("done");
      navigate(`/coin/${current.id}?launched=1`);
    } catch (e) {
      setStage("idle");
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setError(/reject|declin|cancel/i.test(msg) ? "You cancelled in your wallet. Nothing was charged." : msg);
    }
  }

  return (
    <div className="page launch">
      <div className="launch-form">
        <h1>Launch a coin with a face</h1>
        <p className="lede">
          {config.tiktokRequired
            ? "Log in with TikTok, then give it a name, ticker and image. Everything else is optional and can be changed after launch."
            : "Everything except the name, ticker and image is optional and can be changed after launch."}
        </p>

        <section className="step">
          <h2>
            <span className="step-n">1</span> TikTok account
          </h2>
          {flash && <Notice tone="ok">{flash}</Notice>}
          {tiktok ? (
            <div className="tt-connected">
              {tiktok.picture ? <img src={tiktok.picture} alt="" /> : <span className="tt-connected-ph" aria-hidden />}
              <div>
                <strong>@{tiktok.username}</strong>
                <small>{tiktok.displayName ? `${tiktok.displayName} · ` : ""}connected. Posts go here, and it becomes the coin's website.</small>
              </div>
              {!coin && (
                <button type="button" className="btn btn-small btn-quiet" onClick={disconnectTikTok}>
                  Use a different account
                </button>
              )}
            </div>
          ) : (
            <div className="tt-connect">
              <p>
                Log in with the TikTok account your coin's character will post from. Tokpad asks TikTok for permission to
                read your profile and publish posts for you; you can remove it any time in TikTok's settings.
                {config.tiktokAccessMode === "testers" &&
                  " Tokpad is in early access, so the account must be approved by the Tokpad team before it can log in."}
              </p>
              <button type="button" className="btn btn-primary" onClick={connectTikTok} disabled={tiktok === undefined && !!sessionWallet}>
                {!publicKey ? "Connect wallet, then TikTok" : "Log in with TikTok"}
              </button>
              {!config.tiktokRequired && <p className="sub-hint">Optional: you can also launch now and connect TikTok later from the coin page.</p>}
            </div>
          )}
        </section>

        <section className="step">
          <h2>
            <span className="step-n">2</span> Identity
          </h2>
          <div className="identity">
            <label className={preview ? "dropzone has-image" : "dropzone"}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={!!coin}
              />
              {preview ? <img src={preview} alt="Token image" /> : <span>Add the token image. Square works best, up to 5 MB.</span>}
            </label>
            <div className="identity-fields">
              <Field label="Name">
                <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} disabled={!!coin} />
              </Field>
              <Field label="Ticker">
                <input
                  className="input ticker"
                  maxLength={10}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                  disabled={!!coin}
                />
              </Field>
              <Field label="Description" hint="Shown on pump.fun and in the TikTok bio.">
                <textarea className="input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!!coin} />
              </Field>
            </div>
          </div>
          <details className="more">
            <summary>Links</summary>
            <div className="grid-3">
              <Field label="Website" hint="Set automatically: the TikTok account you connected in step 1 (or the influencer's Tokpad page without one).">
                <input className="input" value={tiktok ? `tiktok.com/@${tiktok.username}` : "tokpad.fun/coin/…"} readOnly disabled />
              </Field>
              <Field label="X">
                <input className="input" type="url" placeholder="https://x.com/…" value={twitter} onChange={(e) => setTwitter(e.target.value)} disabled={!!coin} />
              </Field>
              <Field label="Telegram">
                <input className="input" type="url" placeholder="https://t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} disabled={!!coin} />
              </Field>
            </div>
          </details>
        </section>

        <section className="step">
          <h2>
            <span className="step-n">3</span> Character
          </h2>
          <PersonaEditor value={persona} onChange={setPersona} config={config} draftFrom={{ name, symbol, description }} />
        </section>

        <section className="step">
          <h2>
            <span className="step-n">4</span> Posting
          </h2>
          <ContentEditor value={content} onChange={setContent} config={config} />
        </section>

        <section className="step">
          <h2>
            <span className="step-n">5</span> Buyback and burn
          </h2>
          <TreasuryExplainer config={config} />
          {config.treasuryDryRun && <Notice tone="warn">Buybacks are in simulation mode on this site right now: they're logged but not sent on-chain yet.</Notice>}
        </section>

        <section className="step">
          <h2>
            <span className="step-n">6</span> Launch
          </h2>
          <div className="grid-2">
            <Field label="Your first buy (SOL)" hint="Optional. Bought right after the coin is created, as a second approval.">
              <input className="input" type="number" min={0} step={0.1} value={devBuy} onChange={(e) => setDevBuy(e.target.value)} disabled={busy} />
            </Field>
          </div>
          <table className="costs">
            <tbody>
              <tr>
                <td>Platform fee</td>
                <td>{config.platformFeeSol} SOL</td>
              </tr>
              <tr>
                <td>Starting gas for the agent wallet</td>
                <td>{config.agentGasSol} SOL</td>
              </tr>
              <tr>
                <td>pump.fun creation and network fees</td>
                <td>about 0.02 SOL</td>
              </tr>
              {devBuySol > 0 && (
                <tr>
                  <td>Your first buy</td>
                  <td>{devBuySol} SOL</td>
                </tr>
              )}
              <tr className="costs-total">
                <td>Total, roughly</td>
                <td>{total.toFixed(3)} SOL</td>
              </tr>
            </tbody>
          </table>
          <label className="switch">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>
              <strong>I understand</strong>
              <small>
                The coin is created on pump.fun from my wallet, its creator fees go to an AI-run treasury that automatically buys back and burns the coin, I can't withdraw from it, and
                the AI character posts publicly on Tokpad and on the TikTok account I connect. I've read the Terms.
              </small>
            </span>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          {busy && <Notice>{STAGE_TEXT[stage]}</Notice>}
          {publicKey && !coin && !ttReady && <p className="sub-hint">Log in with TikTok in step 1 to launch.</p>}
          <button className="btn btn-primary btn-big" onClick={launch} disabled={publicKey ? !canSubmit : false}>
            {!publicKey ? "Connect wallet to launch" : coin ? "Try launching again" : "Launch coin"}
          </button>
        </section>
      </div>
      <ProfilePreview name={name} symbol={symbol} description={description} image={preview} persona={persona} config={config} tiktok={tiktok?.username ?? null} />
    </div>
  );
}
