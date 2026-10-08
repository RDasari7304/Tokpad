import { useEffect, useState } from "react";
import { api, humanize, type AppConfig, type CastMember, type ContentSettings, type Format, type Persona } from "./api";
import { ChipChoice, Field, Notice } from "./components";

export const defaultPersona = (): Persona => ({
  personality: null,
  personalityCustom: "",
  backstory: "",
  voice: "",
  visualStyle: "3d_render",
  visualStyleCustom: "",
  themes: [],
  avoid: "",
  language: "English",
  tagline: "",
  goal: "",
  obstacle: "",
  world: "",
  cast: [],
  catchphrase: "",
});

export const defaultContent = (): ContentSettings => ({
  formats: ["image", "carousel"],
  postsPerDay: 12,
  reelsPerWeek: 3,
  autoPublish: true,
  hashtags: [],
  postAboutBurns: true,
  commentReplies: true,
  commentRepliesPerDay: 40,
  reelLook: "film",
});

function TagInput({
  value,
  onChange,
  max,
  placeholder,
  prefix = "",
  maxLen = 60,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  placeholder: string;
  prefix?: string;
  maxLen?: number;
}) {
  const [draft, setDraft] = useState("");
  /** Adds one or more tags (a pasted list is split on new lines and commas), skipping duplicates. */
  const addMany = (text: string) => {
    const next = [...value];
    for (const raw of text.split(/[\n\r,]+/)) {
      const t = raw.trim().replace(/^#/, "").slice(0, maxLen).trim();
      if (t && !next.includes(t) && next.length < max) next.push(t);
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const add = () => addMany(draft);
  return (
    <div className="tags">
      {value.map((t) => (
        <button type="button" key={t} className="tag" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
          {prefix}
          {t} <span aria-hidden>×</span>
        </button>
      ))}
      {value.length < max && (
        <input
          className="tag-input"
          value={draft}
          placeholder={placeholder}
          maxLength={maxLen}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\n\r,]/.test(text)) {
              e.preventDefault();
              addMany(draft + text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      )}
    </div>
  );
}

const CAST_ROLES: Record<string, string> = {
  best_friend: "Best friend",
  rival: "Rival",
  mentor: "Mentor",
  crush: "Crush",
  sidekick: "Sidekick",
  nemesis: "Nemesis",
  family: "Family",
  boss: "Boss",
};
const MAX_CAST = 5;

function CastEditor({ value, onChange }: { value: CastMember[]; onChange: (c: CastMember[]) => void }) {
  const update = (i: number, patch: Partial<CastMember>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="cast">
      {value.map((c, i) => (
        <div className="cast-row" key={i}>
          <input
            className="input cast-name"
            placeholder="Name"
            maxLength={40}
            value={c.name}
            onChange={(e) => update(i, { name: e.target.value })}
            aria-label={`Cast member ${i + 1} name`}
          />
          <select className="input cast-role" value={c.role} onChange={(e) => update(i, { role: e.target.value })} aria-label="Role">
            {Object.entries(CAST_ROLES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="input cast-desc"
            placeholder="Personality and look, e.g. a grumpy pigeon in a tiny trench coat"
            maxLength={240}
            value={c.description}
            onChange={(e) => update(i, { description: e.target.value })}
            aria-label={`Cast member ${i + 1} description`}
          />
          <button type="button" className="cast-remove" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${c.name || "cast member"}`}>
            ×
          </button>
        </div>
      ))}
      {value.length < MAX_CAST && (
        <button
          type="button"
          className="btn btn-small btn-quiet"
          onClick={() => onChange([...value, { name: "", role: value.length ? "rival" : "best_friend", description: "" }])}
        >
          + Add a character
        </button>
      )}
    </div>
  );
}

/** The fields "Write my character" fills in. */
const DRAFTED: Array<keyof Persona> = ["tagline", "goal", "obstacle", "world", "cast", "voice", "catchphrase", "backstory", "themes"];

export function PersonaEditor({
  value,
  onChange,
  config,
  draftFrom,
}: {
  value: Persona;
  onChange: (p: Persona) => void;
  config: AppConfig;
  /** The coin's details, for "Write my character". Omit to hide the button. */
  draftFrom?: { name: string; symbol: string; description: string };
}) {
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => onChange({ ...value, [k]: v });
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  async function writeForMe() {
    setDraftError(null);
    if (!draftFrom?.name.trim()) return setDraftError("Give your coin a name first (in Identity), then try again.");
    const hasWork = DRAFTED.some((k) => (Array.isArray(value[k]) ? (value[k] as unknown[]).length : String(value[k] ?? "").trim()));
    if (hasWork && !confirm("Replace what you've written in the character with a new draft?")) return;
    setDrafting(true);
    try {
      const r = await api<{ persona: Partial<Persona> }>("/coins/persona-draft", {
        method: "POST",
        json: {
          name: draftFrom.name,
          symbol: draftFrom.symbol,
          description: draftFrom.description || undefined,
          idea: idea.trim() || undefined,
          personality: value.personality,
          personalityCustom: value.personalityCustom || undefined,
        },
      });
      onChange({ ...value, ...r.persona });
    } catch (e) {
      const msg = (e as Error).message;
      setDraftError(/401|sign in|unauthor/i.test(msg) ? "Connect your wallet and sign in first (step 1), then try again." : msg);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="editor character">
      {draftFrom && (
        <div className="char-draft">
          <h3 className="sub">Start from an idea</h3>
          <p className="sub-hint">
            Describe it in a few words and Tokpad writes the whole character: its goal, what's in its way, its world and its cast.
            You can edit everything after.
          </p>
          <div className="char-draft-row">
            <input
              className="input"
              maxLength={500}
              value={idea}
              placeholder="A raccoon who wants to become the best street chef on TikTok"
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void writeForMe();
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={writeForMe} disabled={drafting}>
              {drafting ? "Writing…" : "Write my character"}
            </button>
          </div>
          {draftError && <Notice tone="error">{draftError}</Notice>}
        </div>
      )}

      <h3 className="sub">Personality</h3>
      <p className="sub-hint">Who your coin's character is on TikTok.</p>
      <ChipChoice
        label="Personality"
        options={config.catalog.personalities}
        value={value.personality}
        onChange={(v) => set("personality", v)}
        custom={value.personalityCustom}
        onCustom={(v) => set("personalityCustom", v)}
        customPlaceholder="A retired space pirate who speaks only in sea shanties"
      />

      <h3 className="sub">Story</h3>
      <p className="sub-hint">
        This is what turns posts into a series people follow. Every storyline is a step toward the goal, and story posts go out
        as numbered parts on TikTok.
      </p>
      <Field label="Who it is, in one line">
        <input
          className="input"
          maxLength={160}
          value={value.tagline}
          placeholder="A clumsy raccoon chef with big dreams and a stolen spatula"
          onChange={(e) => set("tagline", e.target.value)}
        />
      </Field>
      <div className="grid-2">
        <Field
          label="Goal"
          hint={
            value.goal.trim()
              ? "What it wants most. Every storyline moves it closer, or sets it back."
              : "Strongly recommended: without a goal, posts feel random. Make it big, specific and visual."
          }
        >
          <textarea
            className="input"
            rows={3}
            maxLength={300}
            value={value.goal}
            placeholder="Open its own food truck and win the city's Night Market cook-off"
            onChange={(e) => set("goal", e.target.value)}
          />
        </Field>
        <Field label="What's in the way" hint="A flaw, fear, rival or circumstance. This is where the drama comes from.">
          <textarea
            className="input"
            rows={3}
            maxLength={300}
            value={value.obstacle}
            placeholder="It burns everything when people watch, and the health inspector is onto it"
            onChange={(e) => set("obstacle", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Its world" hint="Where it lives and hangs out, so posts happen in places that feel like one world.">
        <input
          className="input"
          maxLength={300}
          value={value.world}
          placeholder="A rainy neon city of alleys, rooftop gardens and late-night food stalls"
          onChange={(e) => set("world", e.target.value)}
        />
      </Field>

      <h3 className="sub">Cast</h3>
      <p className="sub-hint">
        Recurring characters in its life (up to {MAX_CAST}). They show up across posts, so relationships build over time. Describe
        how they look so they stay recognisable.
      </p>
      <CastEditor value={value.cast ?? []} onChange={(c) => set("cast", c)} />

      <h3 className="sub">Look</h3>
      <p className="sub-hint">Every post uses your token image as the character reference, drawn in this style.</p>
      <ChipChoice
        label="Visual style"
        allowNone={false}
        options={config.catalog.visualStyles}
        value={value.visualStyle}
        onChange={(v) => set("visualStyle", v ?? "3d_render")}
        custom={value.visualStyleCustom}
        onCustom={(v) => set("visualStyleCustom", v)}
        customPlaceholder="Ukiyo-e woodblock print, muted indigo and rust"
      />

      <h3 className="sub">Voice</h3>
      <div className="grid-2">
        <Field label="How it talks" hint="In captions and out loud in videos: tone, accent, pace, slang.">
          <textarea className="input" rows={3} maxLength={400} value={value.voice} onChange={(e) => set("voice", e.target.value)} />
        </Field>
        <Field label="Catchphrase or running bit" hint="Optional. Used now and then, not in every post.">
          <input
            className="input"
            maxLength={120}
            value={value.catchphrase}
            placeholder="“Seasoned with chaos.”"
            onChange={(e) => set("catchphrase", e.target.value)}
          />
        </Field>
      </div>

      <details className="more">
        <summary>More: backstory, themes, limits, language</summary>
        <div className="grid-2">
          <Field label="Backstory" hint="Optional. Where it came from.">
            <textarea className="input" rows={4} maxLength={1500} value={value.backstory} onChange={(e) => set("backstory", e.target.value)} />
          </Field>
          <Field label="Recurring themes" hint="Up to 10, each up to 60 characters. Press Enter after each, or paste a list.">
            <TagInput value={value.themes} onChange={(v) => set("themes", v)} max={10} placeholder="street food, rain, rivalry" />
          </Field>
          <Field label="Never post about" hint="Optional. Topics the character must avoid.">
            <input className="input" maxLength={600} value={value.avoid} onChange={(e) => set("avoid", e.target.value)} />
          </Field>
          <Field label="Caption language">
            <input className="input" maxLength={40} value={value.language} onChange={(e) => set("language", e.target.value)} />
          </Field>
        </div>
      </details>
    </div>
  );
}

const formatLabels = (config: AppConfig): Record<Format, [string, string]> => {
  const secs = config.reels?.seconds ?? 5;
  const shots = config.reels?.shots ?? 1;
  const cut = shots > 1 ? `, edited from ${shots} shots` : "";
  return {
    image: ["Photo posts", "A single photo with a caption (TikTok photo mode)."],
    carousel: ["Photo carousels", "Three to five swipeable photos telling a short story."],
    reel: [
      "Videos",
      config.reels?.audio === false
        ? `About ${secs}-second AI videos${cut}. These cost the most to make, so they're capped per week.`
        : `About ${secs}-second AI videos with sound${cut}, where your character talks to the camera. These cost the most to make, so they're capped per week.`,
    ],
  };
};

export function ContentEditor({ value, onChange, config }: { value: ContentSettings; onChange: (c: ContentSettings) => void; config: AppConfig }) {
  const set = <K extends keyof ContentSettings>(k: K, v: ContentSettings[K]) => onChange({ ...value, [k]: v });
  const toggle = (f: Format) => {
    const has = value.formats.includes(f);
    if (has && value.formats.length === 1) return;
    set("formats", has ? value.formats.filter((x) => x !== f) : [...value.formats, f]);
  };
  const FORMAT_LABELS = formatLabels(config);
  const unaudited = config.tiktokAccessMode === "testers";
  const min = config.limits.minPostsPerDay ?? 1;
  const max = config.limits.maxPostsPerDay;
  // Keep the setting inside what the site offers right now (it changes when TikTok approves the app).
  useEffect(() => {
    if (value.postsPerDay < min || value.postsPerDay > max) set("postsPerDay", config.limits.defaultPostsPerDay ?? min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);
  const repliesPossible = !!config.tiktokComments && !unaudited;
  return (
    <div className="editor">
      <div className="format-options">
        {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => (
          <label key={f} className={value.formats.includes(f) ? "option on" : "option"}>
            <input type="checkbox" checked={value.formats.includes(f)} onChange={() => toggle(f)} />
            <span>
              <strong>{FORMAT_LABELS[f][0]}</strong>
              <small>{FORMAT_LABELS[f][1]}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="grid-2">
        <Field
          label="Posts per day"
          hint={
            unaudited
              ? `Up to ${max} (TikTok's daily limit). Keep it low while posts are private: every post still costs AI credits.`
              : `${min} to ${max} a day (TikTok allows about ${max} posts per account per day). The first post starts at launch.`
          }
        >
          <select className="input" value={value.postsPerDay} onChange={(e) => set("postsPerDay", Number(e.target.value))}>
            {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {value.formats.includes("reel") && (
          <Field label="Videos per week, at most">
            <select className="input" value={value.reelsPerWeek} onChange={(e) => set("reelsPerWeek", Number(e.target.value))}>
              {Array.from({ length: config.limits.maxReelsPerWeek + 1 }, (_, i) => i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Hashtags on every post" hint="Up to 8. Your ticker is always added.">
          <TagInput value={value.hashtags} onChange={(v) => set("hashtags", v)} max={8} placeholder="memecoin" prefix="#" maxLen={40} />
        </Field>
      </div>
      <label className="switch">
        <input type="checkbox" checked={!value.autoPublish} onChange={(e) => set("autoPublish", !e.target.checked)} />
        <span>
          <strong>Review posts before they go live</strong>
          <small>New posts wait on your coin page until you approve them. Off means the character posts on its own.</small>
        </span>
      </label>
      {value.formats.includes("reel") && (
        <label className="switch">
          <input
            type="checkbox"
            checked={value.reelLook !== "match"}
            onChange={(e) => set("reelLook", e.target.checked ? "film" : "match")}
          />
          <span>
            <strong>Film-style videos</strong>
            <small>
              Videos are shot like a scene from a movie: a live-action version of your character in real places, with other
              people in the scene. Off means videos use the character's own art style, like its image posts.
            </small>
          </span>
        </label>
      )}
      <label className="switch">
        <input
          type="checkbox"
          checked={value.postAboutBurns !== false}
          onChange={(e) => set("postAboutBurns", e.target.checked)}
        />
        <span>
          <strong>Post about buybacks and burns</strong>
          <small>At most once a day, the character posts about the latest buyback and burn, using the real numbers.</small>
        </span>
      </label>
      {!repliesPossible && (
        <p className="sub-hint replies-off">
          <strong>Comment replies</strong> switch on once TikTok approves Tokpad's app and its comment access
          {unaudited ? " (private posts can't get comments)" : ""}.
        </p>
      )}
      {repliesPossible && (
      <label className="switch">
        <input
          type="checkbox"
          checked={value.commentReplies !== false}
          onChange={(e) => set("commentReplies", e.target.checked)}
        />
        <span>
          <strong>Reply to comments</strong>
          <small>
            The character reads every comment but only answers the ones it finds interesting: real questions, funny or
            creative comments, people picking up on its story, and anyone talking back to it. Generic hype, spam and
            trolls are skipped.
          </small>
        </span>
      </label>
      )}
      {repliesPossible && value.commentReplies !== false && (
        <div className="grid-2">
          <Field label="Comment replies per day, at most" hint="Replies go out gradually, at most a dozen an hour.">
            <select
              className="input"
              value={value.commentRepliesPerDay ?? 40}
              onChange={(e) => set("commentRepliesPerDay", Number(e.target.value))}
            >
              {[10, 20, 40, 60, 100, 150].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

/** Read-only explanation of the automatic buyback-and-burn treasury (nothing to configure). */
export function TreasuryExplainer({ config }: { config: AppConfig }) {
  const l = config.limits;
  return (
    <div className="editor treasury-explainer">
      <ol className="burn-cycle">
        <li>
          <strong>Fees come in.</strong> Your coin gets its own agent wallet, set as the coin's creator on pump.fun, so
          every trade's creator fee goes to it.
        </li>
        <li>
          <strong>It buys back.</strong> Once at least {l.treasuryMinBuySol} SOL in fees has collected, the agent spends all of
          it, at most once every {l.treasuryBuyIntervalMin} minutes
          {l.nativeBuybackShare
            ? `: ${Math.round((1 - l.nativeBuybackShare) * 100)}% buys your coin and ${Math.round(l.nativeBuybackShare * 100)}% buys the Tokpad native coin.`
            : ", buying your coin."}
        </li>
        <li>
          <strong>It burns what it bought.</strong> Every coin the agent buys back is burned straight away, permanently
          reducing the supply.
        </li>
      </ol>
      <p className="sub-hint">
        It runs on its own for as long as the coin trades, spending all collected fees each time
        {l.nativeBuybackShare ? ` (${Math.round(l.nativeBuybackShare * 100)}% of them buy back and burn the Tokpad native coin)` : ""}.
        Nobody can withdraw from the treasury, including you, and
        every buyback and burn is listed publicly on the coin's Treasury tab.
      </p>
    </div>
  );
}

/** Read-only view of a launched coin's character. It's locked after launch so the influencer stays consistent. */
export function PersonaSummary({ persona, config }: { persona: Persona; config: AppConfig }) {
  const personality =
    persona.personality === "custom"
      ? persona.personalityCustom
      : persona.personality
        ? `${humanize(persona.personality)}. ${config.catalog.personalities[persona.personality] ?? ""}`
        : "";
  const look =
    persona.visualStyle === "custom" ? persona.visualStyleCustom : humanize(persona.visualStyle || "3d_render");
  const rows: Array<[string, string]> = [
    ["Personality", personality],
    ["Look", look],
    ["Backstory", persona.backstory],
    ["Voice", persona.voice],
    ["Recurring themes", (persona.themes ?? []).join(", ")],
    ["Never posts about", persona.avoid],
    ["Caption language", persona.language || "English"],
  ];
  return (
    <div className="editor persona-locked">
      <p className="sub-hint">Locked after launch, so your character stays consistent from post to post.</p>
      <dl className="locked-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value?.trim() ? value : <span className="muted">Not set</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
