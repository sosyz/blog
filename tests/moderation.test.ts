// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  AiModerator,
  createModerator,
  ManualModerator,
  type ModerationItem,
  type Moderator,
  moderate,
  statusFor,
} from "../src/lib/server/moderation";

const comment: ModerationItem = {
  type: "comment",
  id: "c1",
  slug: "go-context",
  kind: "comment",
  name: "小周",
  body: "写得真好",
};

const sticker: ModerationItem = {
  type: "sticker",
  id: "s1",
  mime: "image/webp",
  width: 200,
  height: 200,
};

describe("registry", () => {
  test("defaults to the manual moderator", () => {
    expect(createModerator()).toBeInstanceOf(ManualModerator);
    expect(createModerator({ mode: "manual" }).name).toBe("manual");
  });

  test("ai mode without a model falls back to manual", () => {
    expect(createModerator({ mode: "ai" })).toBeInstanceOf(ManualModerator);
  });

  test("ai mode with a model uses the AI moderator", () => {
    const moderator = createModerator({
      mode: "ai",
      ai: () => Promise.resolve("APPROVE"),
    });
    expect(moderator).toBeInstanceOf(AiModerator);
  });
});

describe("decision flow", () => {
  test("manual: everything waits for a human", async () => {
    const moderator = new ManualModerator();
    expect(await moderate(moderator, comment)).toEqual({
      decision: "hold",
      status: "pending",
      actor: "moderator:manual",
    });
    expect((await moderate(moderator, sticker)).status).toBe("pending");
  });

  test("decisions map to stored statuses", () => {
    expect(statusFor("approve")).toBe("approved");
    expect(statusFor("reject")).toBe("rejected");
    expect(statusFor("hold")).toBe("pending");
  });

  test("a failing moderator means hold, with a note", async () => {
    const broken: Moderator = {
      name: "broken",
      review: () => Promise.reject(new Error("AI down")),
    };
    expect(await moderate(broken, comment)).toEqual({
      decision: "hold",
      status: "pending",
      actor: "moderator:broken",
      note: "AI down",
    });
  });

  test("AI stub: parses verdicts, unclear means hold, never approves stickers", async () => {
    const ai = (answer: string) =>
      new AiModerator(() => Promise.resolve(answer));
    expect((await moderate(ai("APPROVE"), comment)).status).toBe("approved");
    expect((await moderate(ai("reject."), comment)).status).toBe("rejected");
    expect((await moderate(ai("不确定"), comment)).status).toBe("pending");
    expect((await moderate(ai("APPROVE"), sticker)).status).toBe("pending");
  });
});
