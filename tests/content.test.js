import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const html = await fs.readFile(path.join(ROOT, "public", "index.html"), "utf8");

test("SEO essentials", () => {
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
  assert.match(title, /ArthoVista/i);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test("no invented contact details by default", async () => {
  const cfg = (await import(pathToFileURL(path.join(ROOT, "site.config.js")).href)).default;
  const hasContact = Boolean(cfg.contact && (cfg.contact.phone || cfg.contact.whatsapp || cfg.contact.email));
  if (!hasContact) {
    assert.ok(!/href="tel:/i.test(html), "no fake tel link");
    assert.ok(!/wa\.me\//i.test(html), "no fake WhatsApp link");
    assert.ok(!/href="mailto:/i.test(html), "no fake mailto link");
  }
});

test("brand positioning present", () => {
  assert.match(html, /ArthoVista/i);
  assert.match(html, /BUILD\. FUND\. SCALE\.|Build\. Fund\. Scale\./i);
  assert.match(html, /Business &amp; Capital Diagnostic|Business and Capital Diagnostic|Capital Diagnostic/);
});

test("no unsupported promise language", () => {
  const banned = [
    "guaranteed approval",
    "guaranteed incorporation",
    "100% success",
    "zero deficiency",
    "instantly registered",
    "instant registration",
    "government guarantee",
    "guaranteed funding",
    "guaranteed grant",
  ];
  for (const phrase of banned) {
    assert.ok(!html.toLowerCase().includes(phrase), `banned phrase present: "${phrase}"`);
  }
});

test("accessibility hooks present", () => {
  assert.match(html, /class="skip-link"/);
  assert.equal((html.match(/aria-expanded/g) || []).length >= 1, true);
  assert.match(html, /aria-live="polite"/);
  assert.equal((html.match(/<svg\b/g) || []).length >= 1, true, "decorative icons present with alt handling");
});

test("form honesty + privacy", () => {
  assert.match(html, /id="enquiry-form"/);
  assert.match(html, /name="consent"/);
  assert.match(html, /name="companyWebsite"/);
  assert.match(html, /DPDP/);
  assert.match(html, /Institutional\"? .*readiness|funding-ready|funding readiness/i);
});

test("structured data completeness", () => {
  assert.match(html, /"@type": "Organization"/);
  assert.match(html, /"@type": "Service"/);
  assert.match(html, /"@type": "FAQPage"/);
});