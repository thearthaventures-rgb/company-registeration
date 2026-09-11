/**
 * ArthoVista static-site builder (zero dependencies).
 *
 * - Assembles public/index.html from templates/page.html + src/components/*.html
 * - Generates FAQ accordion HTML and FAQPage JSON-LD from src/data/faq.js
 * - Bundles src/styles/*.css into public/styles.css (in manifest order)
 * - Writes public/robots.txt and public/sitemap.xml
 * - Reads site.config.js (optionally overridden by site.config.local.js)
 *
 * Output location: pass { outDir } to build(), or set OUT_DIR, or default to
 * the project's public/ directory.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "public");

const CSS_ORDER = [
  "tokens.css",
  "base.css",
  "layout.css",
  "buttons.css",
  "header.css",
  "hero.css",
  "cards.css",
  "tables.css",
  "sections.css",
  "forms.css",
  "footer.css",
  "floating.css",
  "responsive.css",
  "print.css",
];

/** Page model — component partials in DOM order (reusable for future pages). */
const PAGES = {
  home: {
    template: path.join(ROOT, "templates", "page.html"),
    components: [
      "header",
      "hero",
      "stats",
      "about",
      "ecosystem",
      "capital",
      "foundations",
      "methodology",
      "sectors",
      "pillars",
      "services",
      "faq", // generated from src/data/faq.js, not a file
      "leadform",
      "footer",
      "floating-cta",
    ],
  },
};

/* ---------- helpers ------------------------------------------------------------ */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function mergeConfig(base, over) {
  const out = { ...base };
  for (const key of Object.keys(over || {})) {
    out[key] =
      over[key] && typeof over[key] === "object" && !Array.isArray(over[key])
        ? { ...(base[key] || {}), ...over[key] }
        : over[key];
  }
  return out;
}

async function loadConfig() {
  let cfg = (await import(pathToFileURL(path.join(ROOT, "site.config.js")).href)).default;
  try {
    const local = (await import(pathToFileURL(path.join(ROOT, "site.config.local.js")).href)).default;
    cfg = mergeConfig(cfg, local);
  } catch {
    /* no local override */
  }
  return cfg;
}

async function readFaq() {
  return (await import(pathToFileURL(path.join(ROOT, "src", "data", "faq.js")).href)).default;
}

function faqHtml(items) {
  const accordion = items
    .map(
      (f) =>
        `<details class="faq-item"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
    )
    .join("\n");
  return `<section class="section" id="faq">
  <div class="container">
    <div class="section-head">
      <p class="eyebrow accent">Questions</p>
      <h2>Frequently asked questions</h2>
      <p class="section-lede">Straight answers to the questions enterprises ask us most.</p>
    </div>
    <div class="faq">
${accordion}
    </div>
  </div>
</section>`;
}

function jsonScript(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

function buildJsonLd(cfg, pageUrl, favList) {
  const siteRoot = new URL("/", pageUrl).href;
  const c = cfg.contact || {};
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ArthoVista",
    url: siteRoot,
    logo: new URL("assets/logo.svg", pageUrl).href,
    description:
      "ArthoVista is a strategic business advisory and capital-access partner for ambitious Indian enterprises — business foundations, government funding, grants & CSR, private capital, compliance and growth.",
    areaServed: "India",
    sameAs: [],
  };
  if (dighone(c.phone)) org.telephone = c.phone;
  const service = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Business Advisory & Capital Access in India",
    serviceType: "Business Advisory & Capital Access",
    provider: { "@type": "Organization", name: "ArthoVista", url: siteRoot },
    areaServed: "India",
    description:
      "Strategic business advisory and capital-access services for Indian enterprises — business setup & certifications, government funding, grants & CSR, private and institutional capital, compliance, and growth strategy.",
    offers: {
      "@type": "Offer",
      description: "Business & Capital Diagnostic with tailored funding and readiness recommendations",
    },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: favList.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return [org, service, faq].map(jsonScript).join("\n");
}

function analyticsHead(cfg) {
  const a = cfg.analytics || {};
  const clientConfig = JSON.stringify({
    analytics: {
      enabled: Boolean(a.enabled),
      measurementId: a.measurementId || "",
      provider: "ga4",
    },
  });
  const inline = `<script>\nwindow.__ARTHO__ = ${clientConfig};\n</script>`;
  if (a.enabled && a.measurementId) {
    return [
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(a.measurementId)}"></script>`,
      "<script>",
      "window.dataLayer = window.dataLayer || [];",
      "function gtag(){dataLayer.push(arguments);}",
      "gtag('js', new Date());",
      `gtag('config', '${esc(a.measurementId)}', { anonymize_ip: true });`,
      "</script>",
      inline,
    ].join("\n");
  }
  return inline;
}

const downphone = (v) => String(v || "").replace(/[^\d+]/g, "");
const dighone = (v) => String(v || "").replace(/\D/g, "");

function directContact(cfg) {
  const c = cfg.contact || {};
  if (!dighone(c.phone) && !dighone(c.whatsapp) && !c.email) {
    return [
      "<p>Prefer to talk directly? Request a callback and a consultant will get in touch during business hours.</p>",
      '<a class="btn btn-outline btn-sm" href="#contact" data-track="secondary_cta">Request a Callback</a>',
    ].join("\n");
  }
  const parts = [];
  if (dighone(c.phone)) {
    parts.push(`<a class="btn btn-outline btn-sm" href="tel:${esc(downphone(c.phone))}" data-track="phone_click">Call ${esc(c.phone)}</a>`);
  }
  if (dighone(c.whatsapp)) {
    parts.push(`<a class="btn btn-outline btn-sm" href="https://wa.me/${esc(dighone(c.whatsapp))}" target="_blank" rel="noopener" data-track="whatsapp_click">WhatsApp us</a>`);
  }
  if (c.email) {
    parts.push(`<a class="btn btn-outline btn-sm" href="mailto:${esc(c.email)}" data-track="email_click">${esc(c.email)}</a>`);
  }
  return `<p>Prefer to talk directly?</p>\n<div class="direct-contact">\n${parts.join("\n")}\n</div>`;
}

function floatingCta(cfg) {
  const c = cfg.contact || {};
  const icon =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
  if (dighone(c.whatsapp)) {
    return `<a class="floating-cta" href="https://wa.me/${esc(dighone(c.whatsapp))}" target="_blank" rel="noopener" aria-label="Chat with ArthoVista on WhatsApp" data-track="whatsapp_click">${icon} WhatsApp us</a>`;
  }
  if (downphone(c.phone)) {
    return `<a class="floating-cta" href="tel:${esc(downphone(c.phone))}" aria-label="Call ArthoVista" data-track="phone_click">${icon} Call us</a>`;
  }
  return `<a class="floating-cta" href="#contact" aria-label="Request a Business and Capital Diagnostic" data-track="floating_cta">${icon} Request a Diagnostic</a>`;
}

function sitemapXml(pageUrl) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${esc(pageUrl)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
`;
}

/* ---------- build -------------------------------------------------------------- */

export async function build(opts = {}) {
  const outDir = opts.outDir || process.env.OUT_DIR || DEFAULT_OUT;
  const cfg = await loadConfig();
  const favList = await readFaq();

  const pageDef = PAGES[opts.page || "home"];
  if (!pageDef) throw new Error(`Unknown page: ${opts.page}`);

  const siteRoot = cfg.siteUrl.replace(/\/+$/, "") + "/";
  const pageUrl = new URL(cfg.pagePath.replace(/^\/+/, ""), siteRoot).href;
  const ogImage = new URL("assets/logo.svg", siteRoot).href;

  /* --- HTML --- */
  let page = await fs.readFile(pageDef.template, "utf8");

  for (const name of pageDef.components) {
    const file = path.join(ROOT, "src", "components", `${name}.html`);
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      content = null;
    }
    if (name === "faq" || content === null) {
      if (name === "faq") {
        content = `<div class="faq">\n${faqHtml(favList)}\n</div>`;
      } else {
        throw new Error(`Missing component: ${name}`);
      }
    }
    page = page.replaceAll(`[[${name}]]`, content);
  }

  const tokens = {
    "%%TITLE%%": cfg.title,
    "%%DESCRIPTION%%": cfg.description,
    "%%PAGE_URL%%": pageUrl,
    "%%OG_IMAGE%%": ogImage,
    "%%THEME_COLOR%%": cfg.themeColor || "#F75D01",
    "%%LOCALE%%": cfg.locale || "en_IN",
    "%%ANALYTICS_HEAD%%": analyticsHead(cfg),
    "%%JSONLD%%": buildJsonLd(cfg, pageUrl, favList),
    "%%DIRECT_CONTACT%%": directContact(cfg),
    "%%FLOATING%%": floatingCta(cfg),
  };
  for (const [key, value] of Object.entries(tokens)) {
    page = page.replaceAll(key, value);
  }

  const leftoverMarkers = page.match(/\[\[[^\]]+\]\]/g);
  if (leftoverMarkers) throw new Error(`Unresolved component markers: ${leftoverMarkers.join(", ")}`);
  const leftoverTokens = page.match(/%%[A-Z_]+%%/g);
  if (leftoverTokens) throw new Error(`Unresolved tokens: ${leftoverTokens.join(", ")}`);

  /* --- CSS --- */
  const banner = `/* ArthoVista design system — bundled by npm run build. Do not edit directly. */\n`;
  const cssParts = [banner];
  for (const file of CSS_ORDER) {
    cssParts.push(await fs.readFile(path.join(ROOT, "src", "styles", file), "utf8"));
  }
  const css = cssParts.join("\n\n");

  /* --- Write --- */
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "index.html"), page, "utf8");
  await fs.writeFile(path.join(outDir, "styles.css"), css, "utf8");

  const robots = (await fs.readFile(path.join(ROOT, "src", "robots.txt"), "utf8")).replace(
    "%%SITEMAP_URL%%",
    new URL("sitemap.xml", siteRoot).href
  );
  await fs.writeFile(path.join(outDir, "robots.txt"), robots, "utf8");
  await fs.writeFile(path.join(outDir, "sitemap.xml"), sitemapXml(pageUrl), "utf8");

  return { outDir, pageUrl, htmlBytes: Buffer.byteLength(page) };
}

/* ---------- CLI ----------------------------------------------------------------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  build()
    .then((r) => console.log(`Built → ${r.outDir} (index.html ${r.htmlBytes} bytes)`))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}