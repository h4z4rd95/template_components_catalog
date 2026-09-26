/**
 * The Catalog — runtime for the generated pages (browse / discipline / topic / component).
 *
 * Deliberately small. Everything a page *says* was written into the markup at sync time, in both
 * languages, so this file only does the four things markup cannot:
 *
 *   1. hands the manifest to the shell (which builds the masthead bar and the menus),
 *   2. keeps the document's own title and description in the current language,
 *   3. mounts the live stage on a component page — after asking whether the build is actually
 *      there, so a missing export shows an honest notice instead of a blank frame,
 *   4. reloads that stage when the skin changes, because the variation inside it renders its own
 *      page and has no idea the shell just switched language or theme.
 */
(function () {
  "use strict";

  var chrome = window.CatalogChrome;
  var manifest = null;

  function t(key) {
    return chrome ? chrome.t(key) : key;
  }

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
    if (typeof fetch !== "function") return Promise.resolve({ variations: [], disciplines: [], locales: [], ui: {} });
    var url = chrome ? chrome.href("data/catalog.json") : "data/catalog.json";
    return fetch(url, { cache: "no-cache" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (payload) {
        return payload || { variations: [], disciplines: [], locales: [], ui: {} };
      });
  }

  /* --------------------------------------------------------------- the document --- */

  function applyDocumentLanguage() {
    var html = document.documentElement;
    var fa = chrome && chrome.locale() === "fa";
    var title = html.getAttribute(fa ? "data-title-fa" : "data-title-en");
    if (title) document.title = title;

    var description = document.querySelector('meta[name="description"]');
    if (description) {
      var text = description.getAttribute(fa ? "data-desc-fa" : "data-desc-en");
      if (text) description.setAttribute("content", text);
    }
  }

  /* ------------------------------------------------------------------- the stage --- */

  /**
   * Is the framework build actually present? `docs/framework/**` is produced by `npm run build`
   * and deliberately never committed, so a clone that has not been built yet must say so rather
   * than show an empty rectangle. `file://` cannot answer, so it is trusted to the frame itself.
   */
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

  function renderNotice(stage) {
    var frame = stage.querySelector("[data-stage-frame]");
    if (!frame) return;
    var source = stage.getAttribute("data-source") || "";
    frame.innerHTML = "";

    var notice = el("div", "pg__notice");
    notice.appendChild(el("strong", null, t("buildMissingTitle")));

    var line = el("p", null);
    line.appendChild(document.createTextNode(t("buildMissingLead") + " "));
    line.appendChild(el("code", "force-ltr", source));
    line.appendChild(document.createTextNode(" " + t("buildMissingTail")));
    notice.appendChild(line);

    var actions = el("div", "pg__notice-actions");
    var readSource = el("a", "pg__action pg__action--primary", t("buildMissingSource"));
    readSource.href = repoUrl() + "/tree/main/" + source;
    readSource.target = "_blank";
    readSource.rel = "noreferrer noopener";
    actions.appendChild(readSource);

    var workflow = el("a", "pg__action", t("buildMissingWorkflow"));
    workflow.href = repoUrl() + "/blob/main/.github/workflows/deploy.yml";
    workflow.target = "_blank";
    workflow.rel = "noreferrer noopener";
    actions.appendChild(workflow);

    notice.appendChild(actions);
    frame.appendChild(notice);
  }

  function mountStage(stage) {
    if (stage.hasAttribute("data-planned")) return;
    var src = stage.getAttribute("data-src");
    if (!src) return;
    var frame = stage.querySelector("[data-stage-frame]");
    if (!frame || frame.querySelector("iframe")) return;

    probe(src).then(function (available) {
      if (!available) {
        renderNotice(stage);
        return;
      }
      var iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.title = (stage.getAttribute("data-id") || "variation") + " — live preview";
      iframe.setAttribute("allow", "fullscreen; autoplay");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      // The shell broadcasts skin changes to frames that opt in; the reload below is what actually
      // reaches a variation page today, and the attribute is what will make it instant the moment
      // the variations themselves grow a light theme and a second language.
      iframe.setAttribute("data-catalog-frame", "");
      iframe.addEventListener("load", function () {
        iframe.classList.add("is-live");
        stage.classList.add("is-live");
      });
      frame.innerHTML = "";
      frame.appendChild(iframe);
    });
  }

  function refreshStages() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-stage]"), function (stage) {
      var iframe = stage.querySelector("[data-stage-frame] iframe");
      if (iframe) {
        // Same URL, new skin: the variation page reads the persisted choice when it boots.
        iframe.src = iframe.getAttribute("src");
        return;
      }
      if (stage.querySelector(".pg__notice")) renderNotice(stage);
    });
  }

  /* ----------------------------------------------------------------------- boot --- */

  function boot() {
    loadManifest().then(function (payload) {
      manifest = payload;
      if (chrome) chrome.init(manifest);
      applyDocumentLanguage();
      Array.prototype.forEach.call(document.querySelectorAll("[data-stage]"), mountStage);

      if (chrome) {
        chrome.on(function () {
          applyDocumentLanguage();
          refreshStages();
        });
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
