import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "../server.js";

let server;
let base;
let tmpdir;

const HJSON = { "Content-Type": "application/json" };

const validPayload = () => ({
  fullName: "Test Founder",
  mobile: "9876543210",
  email: "founder@example.com",
  structure: "Private Limited Company",
  businessStage: "Pre-revenue startup",
  businessName: "Test Startup",
  message: "Please send me an estimate.",
  consent: true,
});

before(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "artho-api-"));
  // High rate ceiling so unrelated tests never trip the limiter.
  server = startServer({ port: 0, dataDir: tmpdir, rate: { max: 10000 } });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpdir, { recursive: true, force: true });
});

test("GET /api/health returns ok", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test("GET / serves the landing page", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.match(html, /ArthoVista/);
  assert.match(html, /id="enquiry-form"/);
});

test("unknown path returns 404", async () => {
  const res = await fetch(`${base}/nope-not-here`);
  assert.equal(res.status, 404);
});

test("valid enquiry returns 201 and persists to SQLite", async () => {
  const res = await fetch(`${base}/api/enquiry`, { method: "POST", headers: HJSON, body: JSON.stringify(validPayload()) });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.id);

  const db = new DatabaseSync(path.join(tmpdir, "leads.db"));
  const row = db.prepare("SELECT * FROM leads WHERE email = ?").get("founder@example.com");
  db.close();
  assert.ok(row);
  assert.equal(row.full_name, "Test Founder");
  assert.equal(row.consent, 1);
  assert.ok(row.ip_hash && row.ip_hash.length === 32);
  assert.equal(row.source, "landing-page");
});

test("invalid enquiry returns 422 with field errors", async () => {
  const res = await fetch(`${base}/api/enquiry`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ fullName: "A", mobile: "x", email: "bad", consent: false }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.ok, false);
  for (const key of ["fullName", "mobile", "email", "consent"]) {
    assert.ok(body.fields[key], `expected field error for ${key}`);
  }
});

test("consent is mandatory", async () => {
  const payload = validPayload();
  payload.consent = false;
  const res = await fetch(`${base}/api/enquiry`, { method: "POST", headers: HJSON, body: JSON.stringify(payload) });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.fields.consent);
});

test("honeypot is silently ignored", async () => {
  const res = await fetch(`${base}/api/enquiry`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ ...validPayload(), companyWebsite: "http://spambot.example" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.hidden, true);
});

test("oversized payload returns 413", async () => {
  const res = await fetch(`${base}/api/enquiry`, {
    method: "POST",
    headers: HJSON,
    body: JSON.stringify({ ...validPayload(), message: "x".repeat(30_000) }),
  });
  assert.equal(res.status, 413);
});

test("malformed JSON returns 400", async () => {
  const res = await fetch(`${base}/api/enquiry`, { method: "POST", headers: HJSON, body: "{not json" });
  assert.equal(res.status, 400);
});

test("telemetry body size cap protects memory", async () => {
  const res = await fetch(`${base}/api/enquiry`, { method: "POST", headers: HJSON, body: "y".repeat(100_000) });
  assert.equal(res.status, 413);
});

test("wrong method on API path returns 405", async () => {
  const res = await fetch(`${base}/api/enquiry`, { method: "GET" });
  assert.equal(res.status, 405);
});

test("request to POST /api/health returns 405", async () => {
  const res = await fetch(`${base}/api/health`, { method: "POST", headers: HJSON, body: "{}" });
  assert.equal(res.status, 405);
});

test("rate limiter allows 12 then returns 429", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "artho-rate-"));
  const s = startServer({ port: 0, dataDir: tmp });
  await new Promise((resolve) => s.listen(0, resolve));
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${b}/api/enquiry`, {
        method: "POST",
        headers: HJSON,
        body: JSON.stringify({ ...validPayload(), email: `rate${i}@example.com` }),
      });
      assert.equal(res.status, 201);
    }
    const res13 = await fetch(`${b}/api/enquiry`, { method: "POST", headers: HJSON, body: JSON.stringify(validPayload()) });
    assert.equal(res13.status, 429);
  } finally {
    await new Promise((resolve) => s.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});