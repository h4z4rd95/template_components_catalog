/**
 * The Catalog — runtime for the composed pages (newsroom, guide).
 *
 * Small on purpose: the copy is already in the markup in both languages, so this file only does
 * what markup cannot —
 *
 *   1. mounts the shared buildless orbital nav from the page's own `nav.json`,
 *   2. mounts the banner slots that reuse a catalogue variation *live* in an iframe, after asking
 *      whether the framework build is actually there (it is generated, never committed),
 *   3. filters the section listing,
 *   4. draws the article's reading progress,
 *   5. hands the manifest to the catalogue shell, which owns language, direction and theme.
 */
(function () {
  "use strict";

  var chrome = window.CatalogChrome;
  var base = window.__CATALOG_BASE__ || "";
  var manifest = null;

  var t = function (key) {
    return chrome ? chrome.t(key) : key;
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function repoUrl() {
    var repo = (manifest && manifest.meta && manifest.meta.repo) || "h4z4rd95/template_components_catalog";
    return "https://github.com/" + repo;
  }

  function loadManifest() {
    if (window.__CATALOG__) return Promise.resolve(window.__CATALOG__);
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch(base + "data/catalog.json", { cache: "no-cache" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /* ------------------------------------------------------------------ the nav --- */

  function mountNav() {
    var host = document.querySelector(".site__nav");
    if (!host || !window.OrbitalNav) return;
    fetch(base + "sites/gaming-news/nav.json", { cache: "no-cache" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (config) {
        if (!config) return;
        window.OrbitalNav.mount(host, config);
        // The nav's labels are generated, so the shell's translation passes have to run again now
        // that they exist — `translateData` carries the bilingual items, `translateTree` the keys.
        if (chrome) {
          chrome.translateTree(host);
          chrome.translateData(host);
        }
      })
      .catch(function () {
        /* no nav.json on a page that has no nav — fine */
      });
  }

  /* --------------------------------------------------------------- the embeds --- */

  function probe(src) {
    if (location.protocol === "file:" || typeof fetch !== "function") return Promise.resolve(true);
    return fetch(src, { method: "HEAD", cache: "no-cache" })
      .then(function (response) {
        return response.ok;
      })
      .catch(function () {
        return false;
      });
  }

  function embedNotice(frame, src) {
    frame.innerHTML = "";
    var missing = el("div", "site__embed-missing");
    var title = el("strong", null, document.documentElement.dataset.locale === "fa" ? "بیلدِ فریم‌ورک موجود نیست" : "framework build missing");
    missing.appendChild(title);
    var line = el("p");
    line.appendChild(document.createTextNode((document.documentElement.dataset.locale === "fa" ? "این جایگاه یک نمونهٔ زنده از کاتالوگ را سوار می‌کند؛ برای دیدنش " : "This slot mounts a catalogue variation live — run ") ));
    line.appendChild(el("code", null, "npm run build"));
    line.appendChild(document.createTextNode(document.documentElement.dataset.locale === "fa" ? " را اجرا کنید یا سورس را روی گیت‌هاب ببینید." : ", or read the source on GitHub."));
    missing.appendChild(line);
    var link = el("a", null, document.documentElement.dataset.locale === "fa" ? "دیدن پوشهٔ سورس ↗" : "Read the source ↗");
    link.href = repoUrl() + "/tree/main/docs/framework";
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    missing.appendChild(link);
    frame.appendChild(missing);
  }

  function mountEmbeds() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-embed]"), function (slot) {
      var src = slot.getAttribute("data-src");
      var frame = slot.querySelector("[data-embed-frame]");
      if (!src || !frame || frame.querySelector("iframe")) return;

      probe(src).then(function (available) {
        if (!available) {
          embedNotice(frame, src);
          return;
        }
        var iframe = document.createElement("iframe");
        iframe.src = src;
        iframe.title = "Live catalogue variation";
        iframe.loading = "lazy";
        iframe.setAttribute("allow", "fullscreen; autoplay");
        iframe.setAttribute("referrerpolicy", "no-referrer");
        // Opt in to the shell's skin broadcast, exactly like the hub's cards.
        iframe.setAttribute("data-catalog-frame", "");
        iframe.addEventListener("load", function () {
          iframe.classList.add("is-live");
        });
        var note = frame.querySelector(".site__embed-note");
        if (note) note.remove();
        frame.appendChild(iframe);
      });
    });
  }

  function refreshEmbeds() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-embed] iframe"), function (iframe) {
      // Same URL, new skin: the variation reads the persisted choice when it boots.
      iframe.src = iframe.getAttribute("src");
    });
  }

  /* --------------------------------------------------------------- the section --- */

  function wireFilters() {
    var chips = document.querySelectorAll("[data-filter]");
    var rows = document.querySelectorAll("[data-rows] .site__row");
    var empty = document.querySelector("[data-empty]");
    if (!chips.length || !rows.length) return;

    function apply(id) {
      var shown = 0;
      Array.prototype.forEach.call(rows, function (row) {
        var match = id === "all" || row.getAttribute("data-category") === id;
        row.hidden = !match;
        if (match) shown += 1;
      });
      Array.prototype.forEach.call(chips, function (chip) {
        var on = chip.getAttribute("data-filter") === id;
        chip.classList.toggle("is-active", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (empty) empty.hidden = shown > 0;
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () {
        apply(chip.getAttribute("data-filter"));
      });
    });
    apply("all");
  }

  /* --------------------------------------------------------------- the article --- */

  function wireProgress() {
    var bar = document.querySelector("[data-progress]");
    if (!bar) return;
    var raf = 0;
    var update = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
    };
    var onScroll = function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }

  /* ----------------------------------------------------------------------- boot --- */

  function applyDocumentLanguage() {
    var html = document.documentElement;
    var fa = html.dataset.locale === "fa";
    var title = html.getAttribute(fa ? "data-title-fa" : "data-title-en");
    if (title) document.title = title;
    var description = document.querySelector('meta[name="description"]');
    if (description) {
      var text = description.getAttribute(fa ? "data-desc-fa" : "data-desc-en");
      if (text) description.setAttribute("content", text);
    }
  }

  function boot() {
    loadManifest().then(function (payload) {
      manifest = payload;
      if (payload && chrome) chrome.init(payload);
      applyDocumentLanguage();
      mountNav();
      mountEmbeds();
      wireFilters();
      wireProgress();

      if (chrome) {
        chrome.on(function () {
          applyDocumentLanguage();
          refreshEmbeds();
        });
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
