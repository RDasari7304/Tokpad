import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { castText, personaBrief } from "../src/domain/persona.ts";
import { personaSchema } from "../src/domain/schemas.ts";
import { normalizeArc, seriesLabel, storyBrief, type Arc } from "../src/domain/story.ts";

const coin = { name: "Toker", symbol: "TOKER", description: "Tokpad's ambassador on TikTok" };

describe("character story engine", () => {
  it("puts the goal, obstacle, world, cast and catchphrase in the brief", () => {
    const brief = personaBrief(coin, {
      goal: "Open the first arcade on the moon",
      obstacle: "Terrified of heights",
      world: "A neon pier town",
      cast: [{ name: "Pip", role: "best_friend", description: "a tiny robot with one squeaky wheel" }],
      catchphrase: "Tok tok, who's there?",
    });
    assert.match(brief, /YOUR BIG GOAL.*first arcade on the moon/);
    assert.match(brief, /stands in your way.*Terrified of heights/);
    assert.match(brief, /Your world.*neon pier town/);
    assert.match(brief, /Pip \(your best friend\): a tiny robot/);
    assert.match(brief, /catchphrase.*Tok tok/);
  });
  it("leaves the brief unchanged for characters without the new fields", () => {
    const brief = personaBrief(coin, {});
    assert.doesNotMatch(brief, /BIG GOAL|recurring cast/);
    assert.equal(castText([]), "");
  });
  it("accepts old personas and caps the cast", () => {
    const old = personaSchema.parse({ personality: null, visualStyle: "3d_render" });
    assert.deepEqual(old.cast, []);
    assert.equal(old.goal, "");
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `C${i}`, role: "rival", description: "" }));
    assert.equal(personaSchema.safeParse({ cast: many }).success, false);
  });
});

describe("storylines toward the goal", () => {
  const beats = Array.from({ length: 4 }, (_, i) => ({ title: `Ep ${i}`, summary: `Something happens ${i}` }));
  it("keeps the goal step", () => {
    assert.equal(normalizeArc({ title: "Moon Shot", premise: "p", goal_step: "  Gets the permit  ", beats })?.goalStep, "Gets the permit");
  });
  it("labels story posts as a numbered series and mentions the goal", () => {
    const arc: Arc = { id: "a1", title: "Moon Shot", premise: "p", goalStep: "Gets the permit", beats, currentBeat: 1, postsInBeat: 0, status: "active" };
    assert.equal(seriesLabel("Moon Shot", 3), "Moon Shot · Part 3");
    const brief = storyBrief(arc, 3);
    assert.match(brief, /Part 3 of the series "Moon Shot"/);
    assert.match(brief, /picks up right where the last part left off/);
    assert.match(brief, /step toward your big goal\. Gets the permit/);
    assert.doesNotMatch(storyBrief(arc), /Part \d of the series/);
  });
});
