/**
 * ArthoVista — site configuration (single source of truth for SITE CONFIG).
 *
 * - siteUrl is the deployed domain. Source material lists arthaventures.co.in;
 *   change to the final ArthoVista domain if different before going live.
 * - Set analytics.measurementId to enable GA4 conversion tracking.
 * - Set contact.phone / contact.whatsapp / contact.email to render direct
 *   contact buttons (footer + floating). Anything left empty is simply not
 *   rendered — no placeholders are ever published.
 *
 * SECURITY: this file is NOT served to the browser and contains no secrets.
 */

export default {
  siteUrl: "https://www.arthaventures.co.in/",
  pagePath: "", // brand homepage

  title: "ArthoVista | Business Advisory & Capital Access in India",
  description:
    "ArthoVista is a strategic business advisory and capital-access partner for ambitious Indian enterprises — business foundations, government funding, grants & CSR, private capital, compliance and growth. Build. Fund. Scale.",
  locale: "en_IN",

  themeColor: "#F75D01",

  analytics: {
    // GA4: set to e.g. "G-XXXXXXXXXX" (public-facing, not a secret) and enabled: true
    measurementId: "",
    enabled: false,
  },

  contact: {
    // Real contact details from company source material. Markup is only
    // rendered when a value is present.
    phone: "+91 98999 02568",
    whatsapp: "", // e.g. "9198XXXXXXXX" (country code, digits only)
    email: "",
  },
};