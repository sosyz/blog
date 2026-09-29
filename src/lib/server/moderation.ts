/**
 * Moderation hook shared by comments and stickers (design.md 「审核插口」).
 *
 * A Moderator looks at one new item and answers approve / reject / hold
 * ("needs a human"). The API stores the item with the matching status and
 * logs the decision; everything on hold waits in /admin/.
 *
 * Today the registry always returns ManualModerator (everything → hold). To
 * add AI moderation later, callers do not change:
 *   1. add a Workers AI binding to wrangler.jsonc: "ai": { "binding": "AI" }
 *      and run `bun run cf-typegen`;
 *   2. set a var MODERATOR = "ai" (wrangler.jsonc "vars" or a secret);
 *   3. in `src/lib/server/env.ts`, pass `ai: (prompt) => env.AI.run(model, …)`
 *      into `createModerator`.
 * `AiModerator` below is the documented stub for step 3. It is not enabled.
 *
 * Pure (no Workers imports) so the decision flow is unit-tested.
 */

import type { ItemStatus } from "./types";

export type Decision = "approve" | "reject" | "hold";

export type ModerationItem =
  | {
      type: "comment";
      id: string;
      slug: string;
      kind: "comment" | "inline";
      name: string;
      site?: string;
      body: string;
      /** Highlighted text for inline comments. */
      quote?: string;
    }
  | {
      type: "sticker";
      id: string;
      name?: string;
      mime: string;
      width: number;
      height: number;
    };

export type Moderator = {
  /** Recorded in moderation_log as `moderator:<name>`. */
  readonly name: string;
  review: (item: ModerationItem) => Promise<Decision>;
};

/** First implementation: every item waits for a human in /admin/. */
export class ManualModerator implements Moderator {
  readonly name = "manual";

  review(_item: ModerationItem): Promise<Decision> {
    return Promise.resolve("hold");
  }
}

/** Runs a prompt on a text model and returns its reply (e.g. Workers AI). */
export type TextModel = (prompt: string) => Promise<string>;

const VERDICT = /\b(APPROVE|REJECT|HOLD)\b/;

/**
 * STUB, not enabled. Asks a text model for a verdict on comments. It never
 * approves stickers (it cannot see images) and falls back to "hold" on any
 * unclear answer, so a human still sees everything the model is unsure about.
 */
export class AiModerator implements Moderator {
  readonly name = "ai";
  readonly #model: TextModel;

  constructor(model: TextModel) {
    this.#model = model;
  }

  async review(item: ModerationItem): Promise<Decision> {
    if (item.type !== "comment") {
      return "hold";
    }
    const prompt = [
      "你在审核一个技术博客的访客留言。只回答一个词：APPROVE（正常留言）、REJECT（广告、辱骂、违法内容）或 HOLD（拿不准）。",
      `昵称：${item.name}`,
      item.site ? `网址：${item.site}` : "",
      item.quote ? `评论的原文：${item.quote}` : "",
      `留言：${item.body}`,
    ]
      .filter(Boolean)
      .join("\n");
    const answer = await this.#model(prompt);
    const verdict = VERDICT.exec(answer.toUpperCase())?.[1];
    if (verdict === "APPROVE") {
      return "approve";
    }
    if (verdict === "REJECT") {
      return "reject";
    }
    return "hold";
  }
}

export type ModeratorConfig = {
  /** "manual" (default) or "ai". */
  mode?: string;
  /** Needed for "ai"; without it the manual moderator is used. */
  ai?: TextModel;
};

/** The registry: picks the moderator from config. */
export const createModerator = (config: ModeratorConfig = {}): Moderator => {
  if (config.mode === "ai" && config.ai) {
    return new AiModerator(config.ai);
  }
  return new ManualModerator();
};

export const statusFor = (decision: Decision): ItemStatus => {
  if (decision === "approve") {
    return "approved";
  }
  if (decision === "reject") {
    return "rejected";
  }
  return "pending";
};

export type ModerationResult = {
  decision: Decision;
  status: ItemStatus;
  /** For moderation_log.actor. */
  actor: string;
  /** Set when the moderator failed and we fell back to hold. */
  note?: string;
};

/** Runs the moderator; any error means "hold" so nothing is lost or auto-published. */
export const moderate = async (
  moderator: Moderator,
  item: ModerationItem
): Promise<ModerationResult> => {
  const actor = `moderator:${moderator.name}`;
  try {
    const decision = await moderator.review(item);
    return { decision, status: statusFor(decision), actor };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    return { decision: "hold", status: "pending", actor, note };
  }
};
