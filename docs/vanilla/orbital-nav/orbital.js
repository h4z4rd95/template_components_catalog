/**
 * Nav_V02_VanillaOrbitalDrawer — the page around the shared nav.
 *
 * The nav itself lives in `../shared/orbital-nav.js`, mounted here with the catalogue's own
 * sections (read from the manifest the shell already loaded), so this variation is a *real* map of
 * the catalogue rather than a mock: every item opens a generated page.
 */
(function () {
  "use strict";

  var chrome = window.CatalogChrome;
  var BASE = window.__CATALOG_BASE__ || "";

  function t(key) {
    return chrome ? chrome.t(key) : key;
  }

  function pick(pair, field) {
    var locale = document.documentElement.dataset.locale || "en";
    var record = locale === "fa" ? pair.fa : pair.en;
    return record[field] || record[field + "Fa"] || record;
  }

  function sectionsFromManifest(manifest) {
    return (manifest.disciplines || [])
      .filter(function (discipline) {
        return (discipline.topics || []).length > 0;
      })
      .map(function (discipline, index) {
        var owned = (manifest.variations || []).filter(function (variation) {
          return variation.discipline === discipline.id;
        });
        return {
          href: BASE + "browse/" + discipline.id.toLowerCase() + "/index.html",
          label: { en: discipline.label, fa: discipline.labelFa },
          meta: { en: String(owned.length).padStart(2, "0") + " variations", fa: String(owned.length).padStart(2, "0") + " نمونه" },
          accent: (owned[0] && owned[0].accent) || "#5bffc8",
          index: index,
        };
      });
  }

  function mount() {
    var host = document.getElementById("orb-mount");
    var manifest = window.__CATALOG__;
    if (!host || !manifest || !window.OrbitalNav) return;

    window.OrbitalNav.mount(host, {
      accent: getComputedStyle(document.documentElement).getPropertyValue("--orb-accent").trim() || "#5bffc8",
      canvas: getComputedStyle(document.documentElement).getPropertyValue("--ink-000").trim(),
      triggerEn: "Sections",
      trigger: { en: "Sections", fa: "بخش‌ها" },
      items: sectionsFromManifest(manifest),
    });
    // Both passes: `translateTree` for `ui` keys, `translateData` for the bilingual labels the nav
    // just created. Without the second the fan is English on the Persian page.
    if (chrome) {
      chrome.translateTree(host);
      chrome.translateData(host);
    }
  }

  function wireHud() {
    var hud = document.getElementById("hud");
    var toggle = document.getElementById("hud-toggle");
    if (!hud || !toggle) return;

    var small = window.matchMedia("(max-width: 900px), (max-height: 760px)");
    // No text is written here: the button carries both labels and CSS chooses one, so the label is
    // always in the reader's language even if this script runs before the shell is ready.
    var apply = function (collapsed) {
      hud.dataset.collapsed = collapsed ? "true" : "false";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    };

    apply(small.matches);
    toggle.addEventListener("click", function () {
      apply(hud.dataset.collapsed !== "true");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "h" || event.key === "H") apply(hud.dataset.collapsed !== "true");
    });
    small.addEventListener("change", function (event) {
      apply(event.matches);
    });
  }

  function boot() {
    // The manifest ships as `data/catalog.js` (a plain script), so it is already on the page — but
    // the shell also fetches it, and either arriving first is fine.
    var wait = function (attempt) {
      if (window.__CATALOG__) {
        // Start the shell *before* mounting the nav: `chrome.init()` is what reads `?lang=`/`?theme=`
        // and puts them on the document, and the nav measures its own labels to lay itself out — a
        // mount that runs first would be measured in the wrong language and then never re-measured.
        if (chrome && chrome.init) chrome.init(window.__CATALOG__);
        mount();
        wireHud();
        return;
      }
      if (attempt > 40) return;
      window.setTimeout(function () {
        wait(attempt + 1);
      }, 50);
    };
    wait(0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
