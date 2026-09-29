// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  cleanKeys,
  EMPTY_CACHE,
  hiddenKeys,
  normaliseCache,
  RECENT_MS,
  withChange,
  withServerKeys,
} from "../src/scripts/interact/builtin-hidden-store";

const NOW = 1_700_000_000_000;
const TRAM = "outer:place-tram";
const DOG = "dog:people-dog";
const PILE = "pile:运维与网络:place-lighthouse";

const sorted = (keys: Set<string>) => [...keys].sort();

describe("hidden built-ins cache", () => {
  test("normalise keeps well-formed keys and fresh changes only", () => {
    expect(
      normaliseCache(
        {
          keys: [TRAM, TRAM, "bad key", 3, PILE],
          recent: {
            [DOG]: { hidden: true, at: NOW - 1000 },
            [TRAM]: { hidden: false, at: NOW - RECENT_MS - 1 },
            "outer:x": { hidden: "yes", at: NOW },
          },
        },
        NOW
      )
    ).toEqual({
      keys: [TRAM, PILE],
      recent: { [DOG]: { hidden: true, at: NOW - 1000 } },
    });
    expect(normaliseCache(null, NOW)).toEqual(EMPTY_CACHE);
    expect(normaliseCache([TRAM], NOW)).toEqual(EMPTY_CACHE);
    expect(cleanKeys("outer:place-tram")).toEqual([]);
  });

  test("the owner's recent change wins over a stale server list", () => {
    const hidden = withChange(EMPTY_CACHE, TRAM, true, NOW);
    // The edge cache still answers without it.
    const stale = withServerKeys(hidden, [], NOW + 60_000);
    expect(sorted(hiddenKeys(stale, NOW + 60_000))).toEqual([TRAM]);
    // After RECENT_MS the server's word counts again.
    expect(sorted(hiddenKeys(stale, NOW + RECENT_MS + 1))).toEqual([]);
  });

  test("a restore wins over a stale list that still has it", () => {
    const start = withServerKeys(EMPTY_CACHE, [TRAM, DOG], NOW);
    const restored = withChange(start, TRAM, false, NOW);
    expect(restored.keys).toEqual([DOG]);
    const stale = withServerKeys(restored, [TRAM, DOG], NOW + 1000);
    expect(sorted(hiddenKeys(stale, NOW + 1000))).toEqual([DOG]);
  });

  test("server keys replace the old list and drop expired changes", () => {
    const old = withChange(EMPTY_CACHE, DOG, true, NOW);
    const next = withServerKeys(old, [PILE], NOW + RECENT_MS + 1);
    expect(next).toEqual({ keys: [PILE], recent: {} });
  });

  test("malformed keys are ignored", () => {
    expect(withChange(EMPTY_CACHE, "<img>", true, NOW)).toBe(EMPTY_CACHE);
  });
});
