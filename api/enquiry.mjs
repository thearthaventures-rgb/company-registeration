/**
 * Vercel serverless function for POST /api/enquiry.
 *
 * The static deployment (vercel.json → public/) cannot run `server.js`
 * (node:sqlite is not available on Vercel's static/edge runtimes). This
 * function restores the API in production by forwarding validated enquiry
 * payloads to a configured endpoint where leads are actually persisted
 * (company CRM, webhook, or a hosted database).
 *
 * Configuration (Vercel project environment variables):
 *   ENQUIRY_ENDPOINT   URL that accepts the lead JSON (e.g. a CRM webhook)
 *   ENQUIRY_TOKEN      optional bearer token sent to that endpoint
 *
 * Until ENQUIRY_ENDPOINT is set, this returns 501 with a clear message so
 * leads are never silently lost — the page shows the configured error to
 * the visitor instead of pretending success.
 */

const MOBILE_RE = /^[0-9+\-()\s]{8,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BYTES = 20_000;
const text = (v) => (typeof v === "string" ? v.trim() : "");

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  let raw = "";
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BYTES) return json(413, { ok: false, error: "Payload too large." });
    }
  } catch {
    return json(400, { ok: false, error: "Invalid request payload." });
  }

  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid request payload." });
  }

  // Honeypot: silently accept bots that fill the hidden field.
  if (text(body?.companyWebsite)) {
    return json(200, { ok: true, id: "ignored", hidden: true });
  }

  const data = {
    fullName: text(body.fullName),
    mobile: text(body.mobile),
    email: text(body.email),
    structure: text(body.structure),
    businessStage: text(body.businessStage),
    message: text(body.message),
    consent: body.consent === true,
  };

  const errors = {};
  if (data.fullName.length < 2 || data.fullName.length > 120) errors.fullName = "Please enter your full name.";
  if (!MOBILE_RE.test(data.mobile)) errors.mobile = "Please enter a valid mobile number.";
  if (!EMAIL_RE.test(data.email)) errors.email = "Please enter a valid email address.";
  if (data.message.length > 2000) errors.message = "Message is too long.";
  if (!data.consent) errors.consent = "Please accept to continue.";
  if (Object.keys(errors).length) {
    return json(422, { ok: false, error: "Please correct the highlighted fields.", fields: errors });
  }

  const endpoint = process.env.ENQUIRY_ENDPOINT;
  if (!endpoint) {
    return json(501, {
      ok: false,
      error: "Enquiry service is not configured in production yet. Please try again later or contact ArthoVista directly.",
    });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ENQUIRY_TOKEN ? { Authorization: `Bearer ${process.env.ENQUIRY_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...data, source: "vercel-landing", forwardedAt: new Date().toISOString() }),
    });
    if (!upstream.ok) {
      return json(502, { ok: false, error: "Enquiry service is temporarily unavailable. Please try again." });
    }
    return json(201, { ok: true, id: "forwarded" });
  } catch {
    return json(502, { ok: false, error: "Enquiry service is temporarily unavailable. Please try again." });
  }
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}