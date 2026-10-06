import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  // Load Markdown and MDX files in the `src/posts/` directory.
  loader: glob({ base: "./src/posts", pattern: "**/*.{md,mdx}" }),
  // Type-check frontmatter using a schema
  schema: ({ image }) =>
    z.object({
      // One-sentence summary: shown on the canvas card and used as the meta description.
      description: z.string(),
      heroImage: image().optional(),
      // Transform string to Date object
      pubDate: z.coerce.date(),
      // Hand-picked relations; the canvas draws a line for each.
      related: z.array(reference("blog")).default([]),
      // Original article for translations and reposts.
      source: z.url().optional(),
      // Only for 踩坑 notes about a concrete problem.
      status: z.enum(["已解决", "未解决"]).optional(),
      tags: z.array(z.string()).default([]),
      title: z.string(),
      // Exactly one topic; decides which pile the card sits in on the canvas.
      topic: z.string(),
      type: z.enum(["踩坑", "随想"]),
      updatedDate: z.coerce.date().optional(),
    }),
});

export const collections = { blog };
