/**
 * Higgsfield API (docs.higgsfield.ai): every model is its own endpoint on https://api.higgsfield.ai, requests
 * are queued, and the status URL is polled until a terminal state. Pure helpers, unit-tested.
 */
export type HiggsfieldState = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HiggsfieldStatus {
  state: HiggsfieldState | "unknown";
  /** The finished video, when completed. */
  videoUrl: string | null;
  error: string | null;
}

/** Reads a status (or submit) response. Video models put the file at `video.url`. */
export function readHiggsfieldStatus(json: any): HiggsfieldStatus {
  const raw = String(json?.status ?? "").toLowerCase();
  const state = (["queued", "in_progress", "completed", "failed", "nsfw", "canceled", "cancelled"].includes(raw)
    ? raw === "cancelled"
      ? "canceled"
      : raw
    : "unknown") as HiggsfieldStatus["state"];
  const videoUrl = json?.video?.url ?? json?.videos?.[0]?.url ?? json?.output?.video?.url ?? null;
  const error = json?.error ? String(json.error?.message ?? json.error) : state === "nsfw" ? "rejected by Higgsfield's content filter" : null;
  return { state, videoUrl: typeof videoUrl === "string" ? videoUrl : null, error };
}

export const isTerminal = (s: HiggsfieldStatus["state"]) => ["completed", "failed", "nsfw", "canceled"].includes(s);

/** The request body: our keyframe and prompt, plus any model-specific extras from HIGGSFIELD_VIDEO_PARAMS. */
export function higgsfieldVideoBody(prompt: string, imageUrl: string, extraJson: string): Record<string, unknown> {
  let extra: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(extraJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed;
  } catch {
    /* invalid JSON is rejected at startup; ignore here */
  }
  return { image_url: imageUrl, prompt: prompt.slice(0, 2500), ...extra };
}
