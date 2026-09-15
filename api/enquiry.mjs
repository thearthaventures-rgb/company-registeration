/**
 * Vercel serverless function for POST /api/enquiry.
 *
 * The static deployment (vercel.json → public/) cannot run `server.js`
 * (node:sqlite + long-lived process). This function restores the API in
 * production by persisting validated leads to Supabase (PostgREST).
 *
 * Configuration (Vercel project environment variables):
 *   SUPABASE_URL             e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY     server-side secret (never the anon/public key)
 *
 * Fallback (when Supabase is not configured):
 *   ENQUIRY_ENDPOINT         URL that accepts the lead JSON (e.g. a webhook)
 *   ENQUIRY_TOKEN            optional bearer token sent to that endpoint
 *
 * Until one of the above is set, this returns 501 with a clear message so
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

  // Supabase (preferred) — direct PostgREST insert with the service key.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const endpoint = `${String(process.env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/leads`;
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          full_name: data.fullName,
          mobile: data.mobile,
          email: data.email,
          structure: data.structure,
          business_stage: data.businessStage,
          business_name: data.businessName,
          message: data.message,
          consent: data.consent,
          source: "vercel-landing",
          created_at: new Date().toISOString(),
        }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        console.error("Supabase insert failed:", upstream.status, detail.slice(0, 200));
        return json(502, { ok: false, error: "Enquiry service is temporarily unavailable. Please try again." });
      }
      const created = await upstream.json().catch(() => [{ id: null }]);
      const id = Array.isArray(created) && created[0] ? created[0].id : created?.id ?? "supabase";
      return json(201, { ok: true, id });
    } catch (err) {
      console.error("Supabase insert error:", err);
      return json(502, { ok: false, error: "Enquiry service is temporarily unavailable. Please try again." });
    }
  }

  // Generic endpoint/webhook fallback.
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