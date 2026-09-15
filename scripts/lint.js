/**
 * ArthoVista linter (zero dependencies).
 *
 * - Runs `node --check` on every source JavaScript file
 * - Validates the built HTML/CSS in public/
 *
 * Run AFTER `npm run build`.
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUB = path.join(ROOT, "public");

const problems = [];
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => problems.push(msg);

/* ---------- 1. Syntax check all JS ----------------------------------------- */
const jsFiles = [
  "server.js",
  "scripts/build.js",
  "scripts/lint.js",
  "public/app.js",
  "site.config.js",
  "src/data/faq.js",
  ...(await fs.readdir(path.join(ROOT, "tests"))).filter((f) => f.endsWith(".js")).map((f) => `tests/${f}`),
];

for (const rel of jsFiles) {
  const file = path.join(ROOT, rel);
  try {
    if (!(await fs.stat(file)).isFile()) throw new Error("missing");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    pass(`syntax ok — ${rel}`);
  } catch {
    fail(`syntax error — ${rel}`);
  }
}

/* ---------- 2. Config -------------------------------------------------------- */
let cfg = (await import(pathToFileURL(path.join(ROOT, "site.config.js")).href)).default;
let hasContact = Boolean((cfg.contact && (cfg.contact.phone || cfg.contact.whatsapp || cfg.contact.email)));
const dighone = (v) => String(v || "").replace(/\D/g, "");
const hasPhone = dighone(cfg.contact?.phone);
const hasWhatsapp = dighone(cfg.contact?.whatsapp);
const hasEmail = cfg.contact?.email;

/* ---------- 3. Built output ---------------------------------------------------- */
async function read(name) {
  try {
    return await fs.readFile(path.join(PUB, name), "utf8");
  } catch {
    return null;
  }
}

const html = await read("index.html");
const css = await read("styles.css");
const robots = await read("robots.txt");
const sitemap = await read("sitemap.xml");

if (!html) {
  fail("public/index.html missing — run `npm run build` first.");
} else {
  const count = (re) => (html.match(re) || []).length;

  count(/<h1\b/g) === 1 ? pass("exactly one <h1>") : fail(`expected 1 <h1>, got ${count(/<h1\b/g)}`);

  const h2 = count(/<h2\b/g);
  h2 === 15 ? pass(`15 section headings (got ${h2})`) : fail(`expected 15 <h2>, got ${h2}`);

  const faq = count(/class="faq-item"/g);
  faq === 10 ? pass(`10 FAQ items (got ${faq})`) : fail(`expected 10 FAQ items, got ${faq}`);

  if (/\[\[[a-z-]+\]\]/i.test(html)) fail("unresolved component markers in HTML");
  if (/%%[A-Z_]+%%/.test(html)) fail("unresolved tokens in HTML");

  if (count(/rel="canonical"/g) === 1) pass("canonical link present") ;
  else fail("canonical link missing");

  if (count(/type="application\/ld\+json"/g) === 3) pass("3 JSON-LD blocks (Organization, Service, FAQPage)");
  else fail(`expected 3 JSON-LD blocks, got ${count(/type="application\/ld\+json"/g)}`);

  if (html.includes('name="companyWebsite"')) pass("honeypot field present");
  else fail("honeypot field missing");

  if (count(/id="leadform"/g) === 1) pass("lead form present");
  else fail("lead form missing");

  if (html.includes('name="consent"')) pass("consent checkbox present");
  else fail("consent checkbox missing");

  if (!html.includes('class="skip-link"')) fail("skip link missing");

  // Contact honesty: no direct-contact markup unless configured
  const tel = count(/href="tel:/g);
  const wa = count(/wa\.me\//g);
  const mail = count(/href="mailto:/g);
  if (hasContact) {
    pass(`direct contact configured (tel:${tel} wa:${wa} mail:${mail})`);
  } else {
    tel === 0 && wa === 0 && mail === 0
      ? pass("no invented contact links (none configured)")
      : fail(`contact links found but not configured in site.config.js (tel:${tel} wa:${wa} mail:${mail})`);
  }

  // data-track events (mirror build.js channel logic)
  const tracks = new Set([...html.matchAll(/data-track="([^"]+)"/g)].map((m) => m[1]));
  const expected = ["hero_cta", "secondary_cta", "entity_cta", "process_cta", "nav_cta", "leadform_submit_btn"];
  if (hasWhatsapp) expected.push("whatsapp_click");
  if (hasPhone) expected.push("phone_click");
  if (hasEmail) expected.push("email_click");
  if (!hasWhatsapp && !hasPhone) expected.push("floating_cta");
  const missing = expected.filter((e) => !tracks.has(e));
  tracks.size > 0 ? pass(`${tracks.size} unique data-track events bound`) : fail("no data-track events found");
  if (missing.length) fail(`missing expected events: ${missing.join(", ")}`);
}

if (css) pass(`styles.css present (${Buffer.byteLength(css)} bytes)`);
else fail("styles.css missing — run `npm run build`");

if (!robots || !robots.includes("Sitemap:")) fail("robots.txt missing/invalid sitemap");
else pass("robots.txt present with Sitemap");

if (!sitemap || !sitemap.includes("<urlset")) fail("sitemap.xml missing/invalid");
else pass("sitemap.xml present");

/* ---------- 4. Report ------------------------------------------------------------ */
console.log("");
if (problems.length) {
  console.error(`✗ ${problems.length} lint problem(s):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log("✓ All lint checks passed.");