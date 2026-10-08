import { config } from "../../config.js";
import { higgsfieldVideoBody, isTerminal, readHiggsfieldStatus } from "../../domain/higgsfield.js";

/**
 * Renders a short vertical video on Higgsfield from our keyframe image (image-to-video). The model is
 * HIGGSFIELD_VIDEO_ENDPOINT (e.g. kling-video/v3.0/std/image-to-video); extra model fields come from
 * HIGGSFIELD_VIDEO_PARAMS. Polls the request's status URL with backoff until it finishes.
 */
const BASE = "https://api.higgsfield.ai";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function higgsfieldVideo(prompt: string, imageUrl: string, onTick?: (elapsedMs: number) => Promise<unknown> | void) {
  const headers = {
    Authorization: `Key ${config.HIGGSFIELD_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const endpoint = config.HIGGSFIELD_VIDEO_ENDPOINT.replace(/^\/+/, "");
  const submit = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(higgsfieldVideoBody(prompt, imageUrl, config.HIGGSFIELD_VIDEO_PARAMS)),
  });
  const submitText = await submit.text();
  if (!submit.ok) throw new Error(`Higgsfield submit failed (${submit.status}): ${submitText.slice(0, 300)}`);
  const job = JSON.parse(submitText) as { request_id?: string; id?: string; status_url?: string };
  const statusUrl = job.status_url ?? `${BASE}/requests/${job.request_id ?? job.id}/status`;
  if (!job.status_url && !job.request_id && !job.id) throw new Error(`Higgsfield returned no request id: ${submitText.slice(0, 200)}`);

  const started = Date.now();
  const deadline = started + 15 * 60_000;
  let wait = 2000;
  let lastTick = 0;
  while (Date.now() < deadline) {
    await sleep(wait + Math.floor(Math.random() * 500));
    wait = Math.min(10_000, Math.round(wait * 1.5));
    if (onTick && Date.now() - lastTick > 10_000) {
      lastTick = Date.now();
      await Promise.resolve(onTick(lastTick - started)).catch(() => {});
    }
    const res = await fetch(statusUrl, { headers });
    if (res.status === 401) throw new Error("Higgsfield rejected the API key (401). Check HIGGSFIELD_API_KEY (format KEY_ID:KEY_SECRET).");
    if (!res.ok) continue; // 5xx or a blip: keep polling
    const s = readHiggsfieldStatus(await res.json());
    if (!isTerminal(s.state)) continue;
    if (s.state === "completed" && s.videoUrl) return s.videoUrl;
    throw new Error(`Higgsfield generation ${s.state}${s.error ? `: ${s.error}` : ""}`);
  }
  throw new Error("Higgsfield generation timed out");
}
