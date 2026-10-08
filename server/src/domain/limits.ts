/**
 * Posting frequency. Pure, shared by schemas, scheduling and tests.
 *
 * POSTS_PER_DAY is the range any saved setting is clamped to: TikTok caps Direct Post at about 15 posts per
 * creator per day. postingLimits() narrows it to what the site offers right now.
 */
export const POSTS_PER_DAY = { min: 1, max: 15 } as const;

export interface PostingLimits {
  min: number;
  max: number;
  /** Preselected for a new coin. */
  default: number;
}

/**
 * Until TikTok approves the app ("testers" mode), every post is private and only a handful of accounts can post
 * per day, so coins post a little (1-15, default 3) instead of being held to the usual minimum.
 */
export function postingLimits(accessMode: "testers" | "open", configMin: number, configMax: number): PostingLimits {
  const max = Math.min(POSTS_PER_DAY.max, Math.max(POSTS_PER_DAY.min, configMax));
  if (accessMode === "testers") return { min: POSTS_PER_DAY.min, max, default: Math.min(3, max) };
  const min = Math.min(max, Math.max(POSTS_PER_DAY.min, configMin));
  return { min, max, default: min };
}

/** A coin's posts per day, held to the current limits. */
export const clampPostsPerDay = (limits: PostingLimits, value: number | undefined) =>
  Math.min(limits.max, Math.max(limits.min, value ?? limits.default));
