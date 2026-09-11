import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { build } from "../scripts/build.js";

test("build assembles a valid page from components", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "artho-build-"));
  try {
    const res = await build({ outDir: out, page: "home" });
    const html = await fs.readFile(path.join(out, "index.html"), "utf8");

    assert.equal((html.match(/<h1\b/g) || []).length, 1, "exactly one H1");
    assert.equal((html.match(/<details class="faq-item">/g) || []).length, 7, "7 FAQ items");
    assert.ok(!/\[\[[a-z-]+\]\]/i.test(html), "no unresolved component markers");
    assert.ok(!/%%[A-Z_]+%%/.test(html), "no unresolved tokens");
    assert.match(html, /application\/ld\+json/);
    assert.ok(
      /"@type": "FAQPage"/.test(html) &&
        (html.match(/"@type": "Question"/g) || []).length === 7,
      "FAQPage JSON-LD mirrors the 7 FAQs"
    );
    assert.match(html, /id="enquiry-form"/);
    assert.match(html, /BUILD\. FUND\. SCALE\.|Build\. Fund\. Scale\./i);

    const css = await fs.readFile(path.join(out, "styles.css"), "utf8");
    assert.match(css, /--brand-orange: #F75D01/);
    assert.match(css, /@media \(min-width: 640px\)/);

    const robots = await fs.readFile(path.join(out, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap: https/);

    const sitemap = await fs.readFile(path.join(out, "sitemap.xml"), "utf8");
    assert.match(sitemap, /<urlset/);

    // Deterministic / idempotent
    const second = await build({ outDir: out, page: "home" });
    const html2 = await fs.readFile(path.join(out, "index.html"), "utf8");
    assert.equal(html, html2, "build output is idempotent");
    assert.equal(res.pageUrl, second.pageUrl);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});