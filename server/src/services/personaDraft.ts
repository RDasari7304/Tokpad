import { config } from "../config.js";
import { CONTENT_RULES, personalityText } from "../domain/persona.js";
import { CAST_ROLES, MAX_CAST } from "../domain/schemas.js";
import { structured } from "./ai/claude.js";
import { BudgetError, releaseSpend, reserveSpend } from "./spend.js";

/**
 * "Write my character": drafts a full character bible (goal, obstacle, world, cast, voice...) from the
 * creator's coin details and a rough idea. The creator edits it before launch; nothing is saved here.
 */
const SCHEMA = {
  type: "object",
  properties: {
    tagline: { type: "string", description: "Who the character is, in one punchy line (max 140 characters)." },
    goal: {
      type: "string",
      description:
        "The one big, specific, visual thing the character wants and is working toward, that can take many storylines to reach (max 250 characters). Not about price or money from the coin.",
    },
    obstacle: { type: "string", description: "What stands in the way: a flaw, fear, rival or circumstance (max 250 characters)." },
    world: { type: "string", description: "Where the character lives and hangs out, concrete and visual (max 250 characters)." },
    cast: {
      type: "array",
      description: `2 to 4 recurring fictional characters in its life (max ${MAX_CAST}). No real people.`,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name." },
          role: { type: "string", enum: [...CAST_ROLES] },
          description: { type: "string", description: "Personality plus how they look, in one sentence (max 200 characters)." },
        },
        required: ["name", "role", "description"],
        additionalProperties: false,
      },
    },
    voice: { type: "string", description: "How it talks: tone, pace, slang, quirks (max 300 characters)." },
    catchphrase: { type: "string", description: "A short catchphrase or running bit (max 100 characters)." },
    backstory: { type: "string", description: "Where it came from, in 2-4 sentences (max 800 characters)." },
    themes: { type: "array", items: { type: "string" }, description: "3 to 6 recurring topics, a few words each." },
  },
  required: ["tagline", "goal", "obstacle", "world", "cast", "voice", "catchphrase", "backstory", "themes"],
  additionalProperties: false,
};

export interface DraftInput {
  name: string;
  symbol: string;
  description?: string;
  idea?: string;
  personality?: string | null;
  personalityCustom?: string;
}

const cut = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export async function draftPersona(input: DraftInput) {
  if (!(await reserveSpend(config.COST_LLM_USD))) throw new BudgetError();
  try {
    const personality = personalityText({ personality: input.personality, personalityCustom: input.personalityCustom });
    const raw = await structured<any>({
      system: [
        "You design original characters for AI influencers that post short videos and photos on TikTok, as the face of a meme coin.",
        "Great characters have a clear, specific goal they chase across many posts, something real in their way, a vivid world, and a small recurring cast. That's what makes followers come back for the next part.",
        "Make it fun, visual and original. Everything must be fictional: no real people, celebrities, brands or copyrighted characters.",
        CONTENT_RULES,
      ].join("\n\n"),
      user: [
        `Coin: ${input.name} ($${input.symbol})`,
        input.description ? `Coin description: ${input.description}` : "",
        personality ? `Personality: ${personality}` : "",
        input.idea ? `The creator's idea: ${input.idea}` : "No extra idea from the creator: invent something that fits the name.",
        "Design this character.",
      ]
        .filter(Boolean)
        .join("\n"),
      toolName: "character",
      toolDescription: "the character as JSON matching the schema.",
      schema: SCHEMA,
      maxTokens: 1500,
    });
    return {
      tagline: cut(raw.tagline, 160),
      goal: cut(raw.goal, 300),
      obstacle: cut(raw.obstacle, 300),
      world: cut(raw.world, 300),
      cast: (Array.isArray(raw.cast) ? raw.cast : [])
        .slice(0, MAX_CAST)
        .map((c: any) => ({ name: cut(c.name, 40), role: cut(c.role, 40) || "best_friend", description: cut(c.description, 240) }))
        .filter((c: { name: string }) => c.name),
      voice: cut(raw.voice, 400),
      catchphrase: cut(raw.catchphrase, 120),
      backstory: cut(raw.backstory, 1500),
      themes: (Array.isArray(raw.themes) ? raw.themes : []).map((t: unknown) => cut(t, 60)).filter(Boolean).slice(0, 10),
    };
  } catch (e) {
    await releaseSpend(config.COST_LLM_USD).catch(() => {});
    throw e;
  }
}
