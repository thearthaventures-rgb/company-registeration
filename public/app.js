/* ==========================================================================
   ArthoVista — Company Registration landing page (runtime)
   Zero dependencies.

   Analytics architecture
   ----------------------
   Config is injected in <head> by `npm run build` as `window.__ARTHO__`.
   `track(name, params)` always emits a CustomEvent("arthovista:event") for
   debugging and any in-app listener, and forwards to any enabled provider
   (GA4 via gtag). Add new providers in `sendToProviders` without touching
   call sites. No credentials live in this file.

   Standard events:
     hero_cta, secondary_cta, structure_cta, estimate_cta, nav_cta,
     nav_toggle, floating_cta, phone_click, whatsapp_click, email_click,
     faq_open, leadform_start, leadform_error, leadform_submit, leadform_success
   ========================================================================== */

(() => {
  "use strict";

  const config = (typeof window.__ARTHO__ === "object" && window.__ARTHO__) || {
    analytics: { enabled: false, measurementId: "", provider: "ga4" },
  };
  const analytics = config.analytics || {};

  const DEBUG = false; // set true to log events to console

  function sendToProviders(name, params) {
    if (analytics.enabled && typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    }
  }

  function track(name, params = {}) {
    window.dispatchEvent(new CustomEvent("arthovista:event", { detail: { name, params } }));
    if (DEBUG) console.debug(`[artho] ${name}`, params);
    sendToProviders(name, params);
  }

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---- Year ------------------------------------------------------------- */
  const yearEl = qs("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- Mobile nav toggle ------------------------------------------------ */
  const toggle = qs("#nav-toggle");
  const nav = qs("#primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
      track("nav_toggle", { open: !open });
    });

    qsa("a", nav).forEach((link) =>
      link.addEventListener("click", () => {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
      })
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
        toggle.focus();
      }
    });
  }

  /* ---- Header shadow on scroll ------------------------------------------ */
  const header = qs("#site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Generic CTA / contact click tracking (data-track) ----------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-track]");
    if (!el) return;
    const label = (el.getAttribute("aria-label") || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    track(el.dataset.track, { label });
  });

  /* ---- FAQ accordion analytics hook ------------------------------------- */
  qsa(".faq-item").forEach((item) => {
    const summary = qs("summary", item);
    summary.addEventListener("click", () => {
      if (item.open) return;
      track("faq_open", { question: summary.textContent.trim().slice(0, 80) });
    });
  });

  /* ---- Lead form --------------------------------------------------------- */
  const form = qs("#enquiry-form");
  if (!form) return;

  let formStarted = false;
  form.addEventListener(
    "input",
    () => {
      if (!formStarted) {
        formStarted = true;
        track("leadform_start");
      }
    },
    { passive: true }
  );

  const statusBox = qs("#form-status");
  const submitBtn = qs('button[type="submit"]', form);
  const originalBtnHTML = submitBtn ? submitBtn.innerHTML : "";

  const setStatus = (type, message) => {
    if (!statusBox) return;
    statusBox.className = "form-status " + type;
    statusBox.textContent = message;
    statusBox.hidden = false;
  };
  const clearStatus = () => {
    if (statusBox) statusBox.hidden = true;
  };

  const stripTags = (val) => val.replace(/<[^>]*>/g, "").trim();

  const setFieldError = (input, message) => {
    const hint = input ? qs(`#${input.id}-hint`) : null;
    if (input) input.setAttribute("aria-invalid", "true");
    if (hint) {
      hint.textContent = message;
      hint.hidden = false;
    }
  };
  const clearFieldError = (input) => {
    const hint = input ? qs(`#${input.id}-hint`) : null;
    if (input) input.removeAttribute("aria-invalid");
    if (hint) hint.hidden = true;
  };

  const validators = {
    fullName: (v) => (v.length < 2 ? "Please enter your full name." : ""),
    mobile: (v) => (/^[0-9+\-()\s]{8,16}$/.test(v) ? "" : "Please enter a valid mobile number."),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Please enter a valid email address."),
    message: (v) => (v.length > 2000 ? "Message is too long." : ""),
  };

  qsa("input, textarea, select", form).forEach((field) => {
    field.addEventListener("blur", () => {
      if (!field.value) return;
      const err = validators[field.name] ? validators[field.name](field.value.trim()) : "";
      if (err && field.hasAttribute("required")) setFieldError(field, err);
      else clearFieldError(field);
    });
    field.addEventListener("input", () => {
      if (field.getAttribute("aria-invalid") === "true") clearFieldError(field);
    });
  });

  const consent = qs("#f-consent");

  const validate = () => {
    const data = new FormData(form);
    const values = {};
    let firstInvalid = null;

    ["fullName", "mobile", "email", "message"].forEach((name) => {
      const input = qs(`[name="${name}"]`, form);
      const raw = data.get(name) ? String(data.get(name)) : "";
      const err = validators[name](stripTags(raw));
      values[name] = stripTags(raw);
      if (err) {
        setFieldError(input, err);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearFieldError(input);
      }
    });

    // Consent
    const consentHolder = qs(".field-check", form);
    const consentInvalid = !consent || !consent.checked;
    if (consentInvalid && !firstInvalid) firstInvalid = consent;
    if (consent) consent.setAttribute("aria-invalid", consentInvalid ? "true" : "false");
    if (consentHolder) {
      let indicator = qs(".consent-error", consentHolder);
      if (consentInvalid) {
        if (!indicator) {
          indicator = document.createElement("p");
          indicator.className = "field-hint consent-error";
          indicator.textContent = "Please accept to continue.";
          consentHolder.appendChild(indicator);
        }
      } else if (indicator) {
        indicator.remove();
      }
    }

    if (firstInvalid) {
      firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
      firstInvalid.focus({ preventScroll: true });
      return null;
    }

    // Optional fields (trimmed; honeypot left raw)
    values.structure = stripTags(String(data.get("structure") || ""));
    values.businessStage = stripTags(String(data.get("businessStage") || ""));
    values.businessName = stripTags(String(data.get("businessName") || ""));
    values.consent = consentInvalid ? false : true;
    values.companyWebsite = String(data.get("companyWebsite") || ""); // honeypot
    return values;
  };

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.setAttribute("aria-busy", String(loading));
    submitBtn.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span> Submitting…'
      : originalBtnHTML;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const values = validate();
    if (!values) {
      track("leadform_error", { reason: "validation" });
      return;
    }

    clearStatus();
    setLoading(true);
    track("leadform_submit");

    try {
      const res = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        if (payload && payload.fields) {
          Object.entries(payload.fields).forEach(([name, msg]) => {
            const input = qs(`[name="${name}"]`, form);
            if (input) setFieldError(input, msg);
          });
        }
        track("leadform_error", { reason: "server", status: res.status });
        setStatus("error", (payload && payload.error) || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      track("leadform_success", { id: payload && payload.id });
      setStatus("success", "Thank you! We have received your enquiry and a consultant will get back to you shortly.");
      form.hidden = true;
    } catch (err) {
      track("leadform_error", { reason: "network" });
      setStatus("error", "We could not reach our server. Please check your connection and try again.");
      setLoading(false);
    }
  });
})();