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
  body: "写得真好",
  id: "c1",
  kind: "comment",
  name: "小周",
  slug: "go-context",
  type: "comment",
};

const sticker: ModerationItem = {
  height: 200,
  id: "s1",
  mime: "image/webp",
  type: "sticker",
  width: 200,
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
      ai: () => Promise.resolve("APPROVE"),
      mode: "ai",
    });
    expect(moderator).toBeInstanceOf(AiModerator);
  });
});

describe("decision flow", () => {
  test("manual: everything waits for a human", async () => {
    const moderator = new ManualModerator();
    expect(await moderate(moderator, comment)).toEqual({
      actor: "moderator:manual",
      decision: "hold",
      status: "pending",
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
      actor: "moderator:broken",
      decision: "hold",
      note: "AI down",
      status: "pending",
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
