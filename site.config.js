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
  pagePath: "", // company-registration landing page

  title: "Company Registration in India — PVT Ltd, LLP, OPC | ArthoVista",
  description:
    "Company registration services in India — Private Limited, LLP, OPC and more. Choose the right structure, prepare your documents, and complete incorporation with professional filing support.",
  locale: "en_IN",

  themeColor: "#0A2A57",

  analytics: {
    // GA4: set to e.g. "G-XXXXXXXXXX" (public-facing, not a secret) and enabled: true
    measurementId: "",
    enabled: false,
  },

  contact: {
    // Real contact details from company source material. Markup is only
    // rendered when a value is present.
    phone: "+91 98999 02568",
    whatsapp: "919899902568", // same number as phone per company site (wa.me link)
    email: "",
  },
};