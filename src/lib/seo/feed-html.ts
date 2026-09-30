/**
 * Feed-only rewrites of a rendered note (rss.xml.ts). Pure, so bun test can
 * import it (render.ts needs astro:container).
 *
 * Mermaid diagrams are inline hand-drawn SVGs on the page (up to ~80 KB
 * each, src/lib/markdown/diagrams.ts). Feed readers often drop inline SVG,
 * and the feed should stay small, so each diagram becomes a line pointing to
 * the note plus the diagram's text version (the Mermaid source).
 */

const DIAGRAM_FIGURE = /<figure class="diagram"[\s\S]*?<\/figure>/g;
const DIAGRAM_SOURCE = /<pre data-diagram-source[^>]*>([\s\S]*?)<\/pre>/;

/** Replaces every drawn diagram with a link to `pageUrl` and its source. */
export const feedDiagrams = (html: string, pageUrl: string) =>
  html.replace(DIAGRAM_FIGURE, (figure) => {
    const source = DIAGRAM_SOURCE.exec(figure)?.[1];
    const note = `<p><em>这里有一张流程图，见<a href="${pageUrl}">原文</a>。</em></p>`;
    return source ? `${note}<pre>${source}</pre>` : note;
  });
