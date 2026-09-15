/**
 * ArthoVista — zero-dependency static + API server.
 *
 * - Serves public/ (built by `npm run build`)
 * - POST /api/enquiry → validated → leads store → 201
 * - Leads store is Supabase (PostgREST) when SUPABASE_URL +
 *   SUPABASE_SERVICE_KEY are configured, otherwise SQLite (node:sqlite).
 * - Security: rate limiting, honeypot, payload cap, security headers,
 *   directory-traversal protection, IP hashed before storage.
 *
 * Node >= 22.13 required for node:sqlite (fallback store only).
 */

import http from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.PORT) || 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const contentTypes = (ext) => MIME[ext] || "application/octet-stream";

/* ---------- env ----------------------------------------------------------------- */
/** Minimal .env loader (no dependency): loads every KEY=value into process.env. */
function loadEnv() {
  try {
    const raw = readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env file — env vars must come from the environment */
  }
}

/* ---------- rate limiting ------------------------------------------------------ */
function createRateLimiter({ windowMs = 10 * 60 * 1000, max = 12 } = {}) {
  const recent = new Map();
  return function rateLimited(ip, now = Date.now()) {
    const key = ip || "unknown";
    const entry = recent.get(key);
    if (!entry || now - entry.start > windowMs) {
      recent.set(key, { start: now, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  };
}

/* ---------- lead store --------------------------------------------------------- */
/** Stores enquiry leads in SQLite. PII minimal + IP stored only as a salted hash. */
function createLeadStore(dataDir) {
  const dbPath = path.join(dataDir, "leads.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT NOT NULL,
      structure TEXT,
      business_stage TEXT,
      business_name TEXT,
      message TEXT,
      consent INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO leads (full_name, mobile, email, structure, business_stage, business_name, message,
                       consent, source, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  async function migrateLegacyJsonl() {
    const legacy = path.join(dataDir, "leads.jsonl");
    try {
      const content = await fs.readFile(legacy, "utf8");
      if (!content.trim()) return;
      const rowCount = db.prepare("SELECT COUNT(*) AS n FROM leads").get().n;
      if (rowCount > 0) return; // migration already done / not empty

      let imported = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          insert.run(
            row.fullName || "",
            row.mobile || "",
            row.email || "",
            row.structure || "",
            row.businessStage || "",
            row.businessName || "",
            row.message || "",
            1,
            row.source || "legacy",
            row.ip_hash || "",
            row.createdAt || new Date().toISOString()
          );
          imported += 1;
        } catch {
          /* skip corrupt legacy line */
        }
      }
      await fs.rename(legacy, legacy + ".imported");
      console.log(`Migrated ${imported} legacy leads from leads.jsonl into SQLite.`);
    } catch {
      /* no legacy file */
    }
  }

  migrateLegacyJsonl();

  return {
    async insert(row) {
      insert.run(
        row.fullName,
        row.mobile,
        row.email,
        row.structure,
        row.businessStage,
        row.businessName,
        row.message,
        row.consent ? 1 : 0,
        row.source,
        row.ipHash,
        row.createdAt
      );
      const r = db.prepare("SELECT last_insert_rowid() AS id").get();
      return { id: Number(r.id) };
    },
    close() {
      db.close();
    },
  };
}

/**
 * Stores enquiry leads in Supabase via the PostgREST API (no SDK needed).
 * Requires SUPABASE_URL (https://<project>.supabase.co) and
 * SUPABASE_SERVICE_KEY (a server-side secret — never the anon/public key,
 * never shipped to the browser).
 */
function createSupabaseLeadStore({ url, serviceKey }) {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/leads`;
  return {
    async insert(row) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          full_name: row.fullName,
          mobile: row.mobile,
          email: row.email,
          structure: row.structure,
          business_stage: row.businessStage,
          business_name: row.businessName,
          message: row.message,
          consent: row.consent ? true : false,
          source: row.source,
          ip_hash: row.ipHash,
          created_at: row.createdAt,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Supabase ${response.status} ${detail.slice(0, 200)}`);
      }
      const created = await response.json().catch(() => ({ id: null }));
      const id = Array.isArray(created) && created[0] ? created[0].id : created?.id ?? null;
      return { id };
    },
    close() {},
  };
}

/* ---------- validation --------------------------------------------------------- */
const text = (val) => (typeof val === "string" ? val.trim() : "");
const MOBILE_RE = /^[0-9+\-()\s]{8,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEnquiry(body) {
  const data = {
    fullName: text(body?.fullName),
    mobile: text(body?.mobile),
    email: text(body?.email),
    structure: text(body?.structure),
    businessStage: text(body?.businessStage),
    businessName: text(body?.businessName),
    message: text(body?.message),
    consent: body?.consent === true,
  };
  const errors = {};

  if (data.fullName.length < 2 || data.fullName.length > 120) {
    errors.fullName = "Please enter your full name.";
  }
  if (!MOBILE_RE.test(data.mobile)) {
    errors.mobile = "Please enter a valid mobile number.";
  }
  if (data.email && !EMAIL_RE.test(data.email)) {
    errors.email = "Please enter a valid email address.";
  }
  if (data.structure.length > 120) {
    errors.structure = "Please select a valid option.";
  }
  if (data.businessStage.length > 120) {
    errors.businessStage = "Please select a valid option.";
  }
  if (data.businessName.length > 120) {
    errors.businessName = "Please enter a shorter name.";
  }
  if (data.message.length > 2000) {
    errors.message = "Message is too long.";
  }
  if (!data.consent) {
    errors.consent = "Please accept to continue.";
  }

  return { errors, data };
}

const hashIp = (ip) => createHash("sha256").update("arthovista::" + String(ip || "")).digest("hex").slice(0, 32);

/* ---------- static -------------------------------------------------------------- */
async function serveStatic(req, res, root) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return res.writeHead(400).end("Bad Request");
  }

  const resolved = path.normalize(path.join(root, pathname));
  if (!resolved.startsWith(path.normalize(root))) {
    return res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
  }

  let filePath = resolved;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { Location: pathname + "/" });
        return res.end();
      }
      filePath = path.join(filePath, "index.html");
    }
    await fs.stat(filePath);
  } catch {
    return res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
  }

  const ext = path.extname(filePath).toLowerCase();
  const isAsset = ext !== ".html";
  res.writeHead(200, {
    "Content-Type": contentTypes(ext),
    "Cache-Control": isAsset ? "public, max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  });
  res.end(await fs.readFile(filePath));
}

/* ---------- HTTP server --------------------------------------------------------- */
export function startServer({ port = DEFAULT_PORT, root = path.join(__dirname, "public"), dataDir = path.join(__dirname, "data"), rate = {} } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const store = supabaseUrl && supabaseKey
    ? createSupabaseLeadStore({ url: supabaseUrl, serviceKey: supabaseKey })
    : createLeadStore(dataDir);
  const rateLimited = createRateLimiter(rate);
  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const sendJson = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(body));
    };

    if (method === "GET" && url.pathname === "/api/health") {
      return sendJson(200, { ok: true, service: "arthovista-company-registration" });
    }

    if (method === "POST" && url.pathname === "/api/enquiry") {
      if (rateLimited(req.socket.remoteAddress)) {
        return sendJson(429, { ok: false, error: "Too many requests. Please try again later." });
      }

      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20_000) {
          return sendJson(413, { ok: false, error: "Payload too large." });
        }
      }

      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return sendJson(400, { ok: false, error: "Invalid request payload." });
      }

      // Honeypot: silently accept bots that fill the hidden field.
      if (text(body?.companyWebsite)) {
        return sendJson(200, { ok: true, id: "ignored", hidden: true });
      }

      const { errors, data } = validateEnquiry(body);
      if (Object.keys(errors).length > 0) {
        return sendJson(422, { ok: false, error: "Please correct the highlighted fields.", fields: errors });
      }

      try {
        const { id } = await store.insert({
          ...data,
          source: "landing-page",
          ipHash: hashIp(req.socket.remoteAddress),
          createdAt: new Date().toISOString(),
        });
        return sendJson(201, { ok: true, id, message: "Thank you! We have received your enquiry." });
      } catch (err) {
        console.error("Lead storage failed:", err);
        return sendJson(500, { ok: false, error: "Something went wrong. Please try again." });
      }
    }

    // Any other /api/ route or verb → 405 (keeps API surface explicit).
    if (url.pathname.startsWith("/api/")) {
      return sendJson(405, { ok: false, error: "Method Not Allowed" });
    }

    if (method === "GET" || method === "HEAD") {
      return serveStatic(req, res, root);
    }

    return sendJson(405, { ok: false, error: "Method Not Allowed" });
  });

  server.on("close", () => store.close());
  return server;
}

/* ---------- CLI ----------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const server = startServer();
  server.listen(DEFAULT_PORT, () => {
    const store = process.env.SUPABASE_URL ? "Supabase" : "SQLite";
    console.log(`ArthoVista landing running at http://localhost:${DEFAULT_PORT} (leads → ${store})`);
  });
}