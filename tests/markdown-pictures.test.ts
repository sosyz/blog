// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "satteri";
import {
  PICTURE_SIZES,
  PICTURE_WIDTHS,
  responsivePictures,
} from "../src/lib/markdown/plugins";

type SeenProps = Record<string, unknown>;

/** Render with the plugin, and record what the next plugin (Astro's image pass) sees. */
const render = async (markdown: string) => {
  const seen: SeenProps[] = [];
  const { html } = await markdownToHtml(markdown, {
    hastPlugins: [
      responsivePictures,
      {
        name: "spy",
        element: {
          filter: ["img"],
          visit(node) {
            seen.push({ ...node.properties });
          },
        },
      },
    ],
  });
  return { html, seen };
};

describe("responsivePictures", () => {
  test("local pictures get srcset widths and sizes for the image pass", async () => {
    const { seen } = await render("![拓扑](../assets/posts/a/b.png)");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.widths).toEqual([...PICTURE_WIDTHS]);
    expect(seen[0]?.sizes).toBe(PICTURE_SIZES);
  });

  test("remote and data: pictures are left alone", async () => {
    const { seen } = await render(
      "![a](https://example.com/a.png) ![b](//cdn.example.com/b.png) ![c](data:image/png;base64,AA==)"
    );
    expect(seen).toHaveLength(3);
    for (const props of seen) {
      expect(props.widths).toBeUndefined();
      expect(props.sizes).toBeUndefined();
    }
  });

  test("widths top out at 1200px and sizes match the drawer column", () => {
    expect(PICTURE_WIDTHS.map(Number).at(-1)).toBe(1200);
    expect(PICTURE_SIZES).toContain("508px");
  });
});
