import { describe, expect, test } from "bun:test";
import { feedDiagrams } from "../src/lib/seo/feed-html";

const URL = "https://blog.sonui.cn/notes/how-to-set-up-cors/";
const figure = `<figure class="diagram" aria-labelledby="t"><div class="diagram-sheet"><svg id="mmd-1"><title id="t">跨域</title><path d="M0 0"/></svg></div><details class="diagram-source"><summary>图的文字版</summary><pre data-diagram-source=""><code class="language-mermaid">flowchart TD\n  A --&gt; B</code></pre></details></figure>`;

describe("feedDiagrams", () => {
  test("a drawn diagram becomes a link and its source", () => {
    const html = feedDiagrams(`<p>前</p>${figure}<p>后</p>`, URL);
    expect(html).not.toContain("<svg");
    expect(html).toContain(`<a href="${URL}">原文</a>`);
    expect(html).toContain('<pre><code class="language-mermaid">flowchart TD');
    expect(html.startsWith("<p>前</p>")).toBe(true);
    expect(html.endsWith("<p>后</p>")).toBe(true);
  });

  test("every diagram on the page is replaced", () => {
    const html = feedDiagrams(`${figure}${figure}`, URL);
    expect(html.match(/原文/g)?.length).toBe(2);
  });

  test("html without diagrams is unchanged", () => {
    const html = '<figure class="slip"><pre>code</pre></figure>';
    expect(feedDiagrams(html, URL)).toBe(html);
  });
});
