/* ============================================================================
   The Catalog — the shell: language, direction, theme and navigation.

   One module owns all four because they are one decision each, they all persist,
   they are all deep-linkable (`?lang=fa&theme=light`) and they all have to agree
   before the first paint. Everything else in the catalogue reads state from here.

   Buildless: no imports, no bundler. `hub.js` (the catalog grid) and `page.js`
   (the generated browse/component pages) both call into this module.
   ========================================================================= */

window.CatalogChrome = (function () {
  "use strict";

  var LOCALE_KEY = "catalog:locale";
  var THEME_KEY = "catalog:theme";

  var state = {
    locale: "en",
    theme: "dark",
    manifest: null,
    listeners: [],
  };

  /* ---------------------------------------------------------------- storage */

  function readStored(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null; // private mode: defaults still apply
    }
  }

  function writeStored(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* ignore */
    }
  }

  function param(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (err) {
      return null;
    }
  }

  /* ----------------------------------------------------------------- helpers */

  function locales() {
    return (state.manifest && state.manifest.locales) || [
      { id: "en", label: "English", dir: "ltr" },
      { id: "fa", label: "فارسی", dir: "rtl" },
    ];
  }

  function localeMeta(id) {
    var list = locales();
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return list[0];
  }

  /** Translate a shell string. Falls back to English, then to the key itself. */
  function t(key) {
    var ui = (state.manifest && state.manifest.ui) || {};
    var dict = ui[state.locale] || {};
    var fallback = ui[state.manifest && state.manifest.defaultLocale] || ui.en || {};
    return dict[key] !== undefined ? dict[key] : fallback[key] !== undefined ? fallback[key] : key;
  }

  /** Pick the right half of a variation record for the active language. */
  function pick(record, field) {
    if (!record) return "";
    if (state.locale === "fa") {
      var fa = record[field + "Fa"];
      if (fa) return fa;
    }
    return record[field] || "";
  }

  function label(record) {
    if (!record) return "";
    if (state.locale === "fa") return record.labelFa || record.label || "";
    return record.label || record.labelFa || "";
  }

  function blurb(record) {
    if (!record) return "";
    if (state.locale === "fa") return record.blurbFa || record.blurb || "";
    return record.blurb || record.blurbFa || "";
  }

  /* -------------------------------------------------------------- apply layer */

  function apply(options) {
    var root = document.documentElement;
    var meta = localeMeta(state.locale);
    var dir = meta.dir || (state.locale === "fa" ? "rtl" : "ltr");

    root.lang = state.locale;
    root.dir = dir;
    root.dataset.locale = state.locale;
    root.dataset.theme = state.theme;

    if (options && options.animate && "startViewTransition" in document && !prefersReduced()) {
      root.classList.add("theme-transition");
      window.setTimeout(function () {
        root.classList.remove("theme-transition");
      }, 400);
    }

    document.dispatchEvent(
      new CustomEvent("catalog:skin", { detail: { locale: state.locale, theme: state.theme, dir: dir } }),
    );

    for (var i = 0; i < state.listeners.length; i += 1) {
      try {
        state.listeners[i]({ locale: state.locale, theme: state.theme, dir: dir });
      } catch (err) {
        /* a listener must never break the shell */
      }
    }

    paintSwitches();
    translateTree(document);
    translateData(document);
    localiseDrawer();
    syncUrl();
  }

  /**
   * One guarded place for the two media queries the shell asks about. `matchMedia` is universal in
   * browsers, but it is also the kind of call that should never be the reason a header fails to
   * build — a missing API answers "no" here, and the shell carries on.
   */
  function media(query) {
    if (typeof window.matchMedia !== "function") return null;
    try {
      return window.matchMedia(query);
    } catch (err) {
      return null;
    }
  }

  function prefersReduced() {
    var mq = media("(prefers-reduced-motion: reduce)");
    return !!(mq && mq.matches);
  }

  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;
    try {
      var url = new URL(window.location.href);
      if (state.locale === "en") url.searchParams.delete("lang");
      else url.searchParams.set("lang", state.locale);
      if (state.theme === "dark") url.searchParams.delete("theme");
      else url.searchParams.set("theme", state.theme);
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      /* file:// or an exotic URL: the state simply is not mirrored */
    }
  }

  /* -------------------------------------------------------------- translation */

  /** Any element carrying `data-i18n` is a shell string; anything else is content. */
  /**
   * `[data-i18n]` covers the shell's own strings. Generated pages also carry *data* — discipline
   * names, variation titles, blurbs, blueprint sentences — which is not in the `ui` dictionary.
   * Those nodes ship both languages in the markup (`data-i18n-fa` holds the Persian text, the
   * element's own text is English) and are swapped here, so a page written once is bilingual
   * without a JSON payload and without JavaScript-only content that search engines cannot read.
   */
  function translateData(scope) {
    var nodes = (scope || document).querySelectorAll("[data-i18n-fa]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.getAttribute("data-l10n-lang") === state.locale) return;
      if (state.locale === "fa") {
        if (!node.hasAttribute("data-l10n-en")) node.setAttribute("data-l10n-en", node.textContent);
        var fa = node.getAttribute("data-i18n-fa");
        if (fa) node.textContent = fa;
      } else if (node.hasAttribute("data-l10n-en")) {
        node.textContent = node.getAttribute("data-l10n-en");
      }
      node.setAttribute("data-l10n-lang", state.locale);
    });
  }

  function translateTree(scope) {
    var nodes = (scope || document).querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var key = node.getAttribute("data-i18n");
      var value = t(key);
      var attr = node.getAttribute("data-i18n-attr");
      if (attr) node.setAttribute(attr, value);
      else node.textContent = value;
    }
    var aria = (scope || document).querySelectorAll("[data-i18n-aria]");
    for (var a = 0; a < aria.length; a += 1) {
      aria[a].setAttribute("aria-label", t(aria[a].getAttribute("data-i18n-aria")));
    }
    var ph = (scope || document).querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < ph.length; j += 1) {
      ph[j].setAttribute("placeholder", t(ph[j].getAttribute("data-i18n-placeholder")));
    }
  }

  /* ------------------------------------------------------------------ switches */

  function paintSwitches() {
    var langButtons = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < langButtons.length; i += 1) {
      var button = langButtons[i];
      var active = button.getAttribute("data-lang") === state.locale;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-current", active ? "true" : "false");
    }
    var themeButtons = document.querySelectorAll("[data-theme-set]");
    for (var j = 0; j < themeButtons.length; j += 1) {
      var themeButton = themeButtons[j];
      var on = themeButton.getAttribute("data-theme-set") === state.theme;
      themeButton.setAttribute("aria-pressed", on ? "true" : "false");
    }
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var k = 0; k < toggles.length; k += 1) {
      toggles[k].setAttribute("aria-label", t("theme") + ": " + t(state.theme));
    }
  }

  function setLocale(id) {
    if (id === state.locale) return;
    state.locale = id;
    writeStored(LOCALE_KEY, id);
    apply({ animate: true });
  }

  function setTheme(id) {
    if (id === state.theme) return;
    state.theme = id;
    writeStored(THEME_KEY, id);
    if ("startViewTransition" in document && !prefersReduced()) {
      document.startViewTransition(function () {
        apply({ animate: false });
      });
    } else {
      apply({ animate: true });
    }
  }

  function on(fn) {
    state.listeners.push(fn);
    return function off() {
      var index = state.listeners.indexOf(fn);
      if (index > -1) state.listeners.splice(index, 1);
    };
  }

  /* ------------------------------------------------------------------ routing */

  /** Depth-aware URL builder so one link map works on the hub and on nested pages. */
  function href(path) {
    var base = window.__CATALOG_BASE__ || "";
    return base + path.replace(/^\//, "");
  }

  function disciplineSlug(id) {
    return String(id).toLowerCase();
  }

  function disciplineHref(id) {
    return href("browse/" + disciplineSlug(id) + "/");
  }

  function topicHref(disciplineId, topic) {
    return href("browse/" + disciplineSlug(disciplineId) + "/" + topic + "/");
  }

  function componentHref(slug) {
    return href("component/" + slug + "/");
  }

  /** Where the live variation actually lives — the built route, opened raw. */
  function variationHref(variation) {
    return href(variation.href);
  }

  /* ------------------------------------------------------------------- nav ---- */

  var nav = {
    root: null,
    drawer: null,
    lastFocus: null,
  };

  function variationByDiscipline(manifest) {
    var map = {};
    (manifest.variations || []).forEach(function (v) {
      if (!map[v.discipline]) map[v.discipline] = [];
      map[v.discipline].push(v);
    });
    return map;
  }

  /**
   * The bar is the same chrome on every page of the site, and there is exactly one definition of
   * it. Any page that ships `<nav class="masthead__bar" data-shell-bar>` gets the brand, the
   * menus, the counters, the switches and the download control built into it. Keeping a copy of
   * this markup in the hub *and* in the generated pages would mean two headers to keep honest —
   * which is precisely how one of them ends up with a bug the other one was fixed for.
   */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildBar(manifest) {
    var bar = document.querySelector("[data-shell-bar]");
    if (!bar) return;
    bar.innerHTML = "";

    var brand = el("a", "brand");
    // On any page but the hub the brand has to walk back to it.
    brand.href = window.__CATALOG_BASE__ ? href("index.html") : "#top";
    brand.appendChild(el("span", "brand__dot")).setAttribute("aria-hidden", "true");
    var name = el("span", "brand__name", t("brand"));
    name.setAttribute("data-i18n", "brand");
    brand.appendChild(name);
    bar.appendChild(brand);

    var burger = el("button", "burger");
    burger.type = "button";
    burger.setAttribute("data-burger", "");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "nav-drawer");
    var glyph = el("span", "burger__glyph");
    glyph.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 3; i += 1) glyph.appendChild(el("span"));
    burger.appendChild(glyph);
    var burgerLabel = el("span", null, t("menu"));
    burgerLabel.setAttribute("data-i18n", "menu");
    burger.appendChild(burgerLabel);
    bar.appendChild(burger);

    var navHost = el("div", "nav");
    navHost.setAttribute("data-nav-host", "");
    navHost.setAttribute("role", "navigation");
    navHost.setAttribute("data-i18n-aria", "browseCatalog");
    bar.appendChild(navHost);

    // Counters: the numbers are filled from the manifest, the words follow the ui dictionary.
    var counts = manifest.counts || {};
    var meta = el("span", "masthead__meta");
    [
      ["stat-variations", counts.total, "variations"],
      // Counted the same way the hub counts them: distinct batches and distinct stack entries, not
      // the highest batch number, so the two stay in agreement if a batch is ever skipped.
      ["stat-batches", (manifest.variations || []).reduce(function (all, v) {
        if (v.batch) all[v.batch] = true;
        return all;
      }, {}), "batches"],
      ["stat-stacks", (manifest.variations || []).reduce(function (all, v) {
        (v.stack || []).forEach(function (name) {
          all[name] = true;
        });
        return all;
      }, {}), "stacks"],
    ].forEach(function (row, index) {
      if (index) meta.appendChild(el("span", "sep", "·")).setAttribute("aria-hidden", "true");
      var value = typeof row[1] === "object" && row[1] !== null ? Object.keys(row[1]).length : row[1] || 0;
      var counter = el("span", "counter force-ltr", String(value).padStart(2, "0"));
      counter.id = row[0];
      meta.appendChild(counter);
      var word = el("span", null, t(row[2]));
      word.setAttribute("data-i18n", row[2]);
      meta.appendChild(word);
    });
    bar.appendChild(meta);

    var switches = el("div", "shell-switches");
    var lang = el("div", "lang-switch");
    lang.setAttribute("role", "group");
    lang.setAttribute("data-i18n-aria", "language");
    (manifest.locales || []).forEach(function (locale) {
      var button = el("button", "lang-switch__button", locale.id === "fa" ? "فا" : "EN");
      button.type = "button";
      button.setAttribute("data-lang", locale.id);
      lang.appendChild(button);
    });
    switches.appendChild(lang);

    var theme = el("div", "theme-switch");
    theme.setAttribute("role", "group");
    theme.setAttribute("data-i18n-aria", "theme");
    [["light", "☀", "light"], ["dark", "☾", "dark"]].forEach(function (row) {
      var button = el("button", "theme-switch__button");
      button.type = "button";
      button.setAttribute("data-theme-set", row[0]);
      var themeGlyph = el("span", "theme-switch__glyph", row[1]);
      themeGlyph.setAttribute("aria-hidden", "true");
      button.appendChild(themeGlyph);
      var themeLabel = el("span", null, t(row[2]));
      themeLabel.setAttribute("data-i18n", row[2]);
      button.appendChild(themeLabel);
      theme.appendChild(button);
    });
    switches.appendChild(theme);

    var reel = el("a", "masthead__cta");
    reel.href = href("vision/index.html");
    var reelLabel = el("span", null, t("visionReel"));
    reelLabel.setAttribute("data-i18n", "visionReel");
    reel.appendChild(reelLabel);
    reel.appendChild(document.createTextNode(" ↗"));
    switches.appendChild(reel);

    var download = el("details", "download");
    download.setAttribute("data-download", "");
    var summary = el("summary", "download__button");
    summary.setAttribute("data-i18n-aria", "downloadTitle");
    var downloadGlyph = el("span", "download__glyph", "⤓");
    downloadGlyph.setAttribute("aria-hidden", "true");
    summary.appendChild(downloadGlyph);
    var downloadLabel = el("span", null, t("download"));
    downloadLabel.setAttribute("data-i18n", "download");
    summary.appendChild(downloadLabel);
    download.appendChild(summary);

    var panel = el("div", "download__panel");
    var panelTitle = el("p", "download__title", t("downloadTitle"));
    panelTitle.setAttribute("data-i18n", "downloadTitle");
    panel.appendChild(panelTitle);

    var zipLink = el("a", "download__option download__option--primary");
    zipLink.href = href("download/catalog-source.zip");
    zipLink.setAttribute("download", "");
    var zipName = el("span", "download__option-name", t("downloadSource"));
    zipName.setAttribute("data-i18n", "downloadSource");
    zipLink.appendChild(zipName);
    var zipHint = el("span", "download__option-hint");
    var zipHintText = el("span", null, t("downloadSourceHint"));
    zipHintText.setAttribute("data-i18n", "downloadSourceHint");
    zipHint.appendChild(zipHintText);
    var zipFacts = el("span", "download__facts");
    zipFacts.setAttribute("data-download-facts", "");
    zipHint.appendChild(zipFacts);
    zipLink.appendChild(zipHint);
    panel.appendChild(zipLink);

    var repoLink = el("a", "download__option");
    var repo = (manifest.meta && manifest.meta.repo) || "h4z4rd95/template_components_catalog";
    repoLink.href = "https://github.com/" + repo;
    repoLink.target = "_blank";
    repoLink.rel = "noreferrer noopener";
    var repoName = el("span", "download__option-name", t("downloadRepo"));
    repoName.setAttribute("data-i18n", "downloadRepo");
    repoLink.appendChild(repoName);
    var repoHint = el("span", "download__option-hint", t("downloadRepoHint"));
    repoHint.setAttribute("data-i18n", "downloadRepoHint");
    repoLink.appendChild(repoHint);
    panel.appendChild(repoLink);

    var includes = el("p", "download__note", t("downloadIncludes"));
    includes.setAttribute("data-i18n", "downloadIncludes");
    panel.appendChild(includes);
    download.appendChild(panel);
    switches.appendChild(download);

    bar.appendChild(switches);
  }

  function buildDesktopNav(manifest) {
    var list = document.createElement("ul");
    list.className = "nav__list";
    var grouped = variationByDiscipline(manifest);

    (manifest.disciplines || []).forEach(function (discipline) {
      var items = grouped[discipline.id] || [];
      if (!items.length) return;

      var item = document.createElement("li");
      item.className = "nav__item";

      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "nav__trigger";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "true");
      trigger.innerHTML =
        '<span class="nav__trigger-label"></span><span class="nav__count force-ltr">' +
        String(items.length).padStart(2, "0") +
        "</span>";
      trigger.querySelector(".nav__trigger-label").textContent = label(discipline);

      var panel = document.createElement("div");
      panel.className = "nav__panel";
      panel.hidden = true;

      var topicsCol = document.createElement("div");
      topicsCol.className = "nav__col";
      var topicsTitle = document.createElement("p");
      topicsTitle.className = "nav__col-title";
      topicsTitle.textContent = t("topics");
      topicsCol.appendChild(topicsTitle);

      var topicRegistry = manifest.topics || [];
      (discipline.topics || []).forEach(function (topicId) {
        var topic = topicRegistry.filter(function (x) {
          return x.id === topicId;
        })[0];
        if (!topic) return;
        var link = document.createElement("a");
        link.className = "nav__topic";
        link.href = topicHref(discipline.id, topic.id);
        link.textContent = label(topic);
        var count = items.filter(function (v) {
          return v.topic === topic.id;
        }).length;
        if (count) {
          var badge = document.createElement("span");
          badge.className = "nav__count force-ltr";
          badge.textContent = String(count);
          link.appendChild(badge);
        }
        topicsCol.appendChild(link);
      });

      var linksCol = document.createElement("div");
      linksCol.className = "nav__col nav__col--wide";
      var linksTitle = document.createElement("p");
      linksTitle.className = "nav__col-title";
      linksTitle.textContent = discipline.id;
      linksCol.appendChild(linksTitle);

      items.slice(0, 6).forEach(function (variation) {
        var link = document.createElement("a");
        link.className = "nav__link" + (variation.status === "planned" ? " is-planned" : "");
        link.href = componentHref(variation.slug);
        var id = document.createElement("span");
        id.className = "nav__link-id force-ltr";
        id.textContent = variation.id;
        var name = document.createElement("span");
        name.className = "nav__link-title";
        name.textContent = pick(variation, "title");
        link.appendChild(id);
        link.appendChild(name);
        linksCol.appendChild(link);
      });

      if (items.length > 6) {
        var more = document.createElement("a");
        more.className = "nav__more";
        more.href = disciplineHref(discipline.id);
        more.textContent = t("all") + " · " + items.length;
        linksCol.appendChild(more);
      }

      panel.appendChild(topicsCol);
      panel.appendChild(linksCol);
      item.appendChild(trigger);
      item.appendChild(panel);
      list.appendChild(item);

      trigger.addEventListener("click", function (event) {
        event.stopPropagation();
        togglePanel(item, trigger, panel);
      });
    });

    return list;
  }

  function closePanels(except) {
    var items = document.querySelectorAll(".nav__item");
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (item === except) continue;
      var trigger = item.querySelector(".nav__trigger");
      var panel = item.querySelector(".nav__panel");
      if (!panel || panel.hidden) continue;
      panel.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      item.classList.remove("is-open");
    }
  }

  function togglePanel(item, trigger, panel) {
    var willOpen = panel.hidden;
    closePanels(item);
    panel.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    item.classList.toggle("is-open", willOpen);
  }

  function buildDrawer(manifest) {
    var drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.id = "nav-drawer";
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", t("menu"));

    var head = document.createElement("div");
    head.className = "drawer__head";
    var title = document.createElement("p");
    title.className = "drawer__title";
    title.textContent = t("categories");
    var close = document.createElement("button");
    close.type = "button";
    close.className = "drawer__close";
    close.setAttribute("aria-label", t("close"));
    close.textContent = "✕ " + t("close");
    head.appendChild(title);
    head.appendChild(close);
    drawer.appendChild(head);

    var body = document.createElement("div");
    body.className = "drawer__body";
    var grouped = variationByDiscipline(manifest);

    (manifest.disciplines || []).forEach(function (discipline) {
      var items = grouped[discipline.id] || [];
      if (!items.length) return;

      var section = document.createElement("section");
      section.className = "drawer__section";
      section.setAttribute("data-discipline", discipline.id);

      var summary = document.createElement("button");
      summary.type = "button";
      summary.className = "drawer__summary";
      summary.setAttribute("aria-expanded", "false");
      summary.innerHTML =
        '<span class="drawer__summary-label"></span><span class="nav__count force-ltr">' +
        String(items.length).padStart(2, "0") +
        "</span>";
      summary.querySelector(".drawer__summary-label").textContent = label(discipline);

      var panel = document.createElement("div");
      panel.className = "drawer__panel";
      panel.hidden = true;

      var hint = document.createElement("p");
      hint.className = "drawer__blurb";
      hint.textContent = blurb(discipline);
      panel.appendChild(hint);

      items.forEach(function (variation) {
        var link = document.createElement("a");
        link.className = "drawer__link";
        link.href = componentHref(variation.slug);
        var name = document.createElement("span");
        name.textContent = pick(variation, "title");
        var id = document.createElement("span");
        id.className = "drawer__link-id force-ltr";
        id.textContent = variation.id;
        link.appendChild(name);
        link.appendChild(id);
        panel.appendChild(link);
      });

      summary.addEventListener("click", function () {
        var willOpen = panel.hidden;
        panel.hidden = !willOpen;
        summary.setAttribute("aria-expanded", willOpen ? "true" : "false");
        section.classList.toggle("is-open", willOpen);
      });

      section.appendChild(summary);
      section.appendChild(panel);
      body.appendChild(section);
    });

    var foot = document.createElement("div");
    foot.className = "drawer__foot";
    foot.innerHTML =
      '<div class="theme-switch" role="group">' +
      '<button type="button" class="theme-switch__button" data-theme-set="light"><span class="theme-switch__glyph">☀</span><span data-i18n="light"></span></button>' +
      '<button type="button" class="theme-switch__button" data-theme-set="dark"><span class="theme-switch__glyph">☾</span><span data-i18n="dark"></span></button>' +
      "</div>" +
      '<div class="lang-switch" role="group">' +
      '<button type="button" class="lang-switch__button" data-lang="en">EN</button>' +
      '<button type="button" class="lang-switch__button" data-lang="fa">فا</button>' +
      "</div>";

    // On a phone the bar keeps only the brand, the download control and the menu button — the
    // reel link and the language / theme switches move in here, so nothing becomes unreachable.
    var links = document.createElement("div");
    links.className = "drawer__links";
    var reel = document.createElement("a");
    reel.className = "drawer__cta drawer__cta--reel";
    reel.href = href("vision/index.html");
    var reelName = document.createElement("span");
    reelName.className = "drawer__cta-name";
    reelName.textContent = t("visionReel") + " ↗";
    reel.appendChild(reelName);
    var archive = document.createElement("a");
    archive.className = "drawer__cta drawer__cta--primary";
    archive.href = href("download/catalog-source.zip");
    archive.setAttribute("download", "");
    var archiveName = document.createElement("span");
    archiveName.className = "drawer__cta-name";
    archiveName.textContent = t("downloadSource");
    archive.appendChild(archiveName);
    var facts = document.createElement("span");
    facts.className = "drawer__cta-facts";
    facts.setAttribute("data-download-facts", "");
    archive.appendChild(facts);
    links.appendChild(archive);
    links.appendChild(reel);
    foot.appendChild(links);
    drawer.appendChild(foot);
    drawer.appendChild(body);

    close.addEventListener("click", closeDrawer);
    return drawer;
  }

  /**
   * The drawer is assembled once, from `t()` at that moment, so its built-in text does not follow a
   * locale change the way `[data-i18n]` nodes do. Re-label it whenever the skin changes — otherwise
   * a Persian reader opens a menu whose headings, discipline names and blurbs are still English.
   */
  function localiseDrawer() {
    var drawer = nav.drawer;
    if (!drawer) return;
    drawer.setAttribute("aria-label", t("menu"));

    var title = drawer.querySelector(".drawer__title");
    if (title) title.textContent = t("categories");
    var close = drawer.querySelector(".drawer__close");
    if (close) close.textContent = "✕ " + t("close");
    var burger = document.querySelector("[data-burger]");
    if (burger && burger.getAttribute("aria-expanded") === "true") burger.setAttribute("aria-label", t("close"));

    var disciplines = (state.manifest && state.manifest.disciplines) || [];
    Array.prototype.forEach.call(drawer.querySelectorAll(".drawer__section"), function (section) {
      var id = section.getAttribute("data-discipline");
      var discipline = null;
      for (var i = 0; i < disciplines.length; i += 1) {
        if (disciplines[i].id === id) discipline = disciplines[i];
      }
      if (!discipline) return;
      var labelEl = section.querySelector(".drawer__summary-label");
      var blurbEl = section.querySelector(".drawer__blurb");
      if (labelEl) labelEl.textContent = label(discipline);
      if (blurbEl) blurbEl.textContent = blurb(discipline);
    });

    var reelName = drawer.querySelector(".drawer__cta--reel .drawer__cta-name");
    if (reelName) reelName.textContent = t("visionReel") + " ↗";
    var archiveName = drawer.querySelector(".drawer__cta--primary .drawer__cta-name");
    if (archiveName) archiveName.textContent = t("downloadSource");

    loadDownloadFacts();
  }

  function openDrawer() {
    if (!nav.drawer) return;
    nav.lastFocus = document.activeElement;
    nav.drawer.hidden = false;
    document.body.classList.add("has-drawer");
    var burger = document.querySelector("[data-burger]");
    if (burger) {
      burger.setAttribute("aria-expanded", "true");
      burger.setAttribute("aria-label", t("close"));
    }
    var first = nav.drawer.querySelector(".drawer__close");
    if (first) first.focus();
  }

  function closeDrawer() {
    if (!nav.drawer || nav.drawer.hidden) return;
    nav.drawer.hidden = true;
    document.body.classList.remove("has-drawer");
    var burger = document.querySelector("[data-burger]");
    if (burger) {
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", t("menu"));
      if (nav.lastFocus === burger) burger.focus();
    }
  }

  /** Keyboard contract: Escape closes whatever is open and returns focus. */
  function onKeydown(event) {
    if (event.key !== "Escape") return;
    if (nav.drawer && !nav.drawer.hidden) {
      closeDrawer();
      return;
    }
    closePanels(null);
    var open = document.querySelector(".nav__trigger[aria-expanded='true']");
    if (open) open.focus();
  }

  /* ----------------------------------------------------------------- download --- */

  /**
   * The archive's real size and file count come from `docs/data/download.json`, which
   * `scripts/bundle.mjs` writes when it builds the ZIP — so the panel states a fact instead of a
   * number typed into a translation string that goes stale on the next build. If the file cannot
   * be read (file://, or a clone that has not run the bundler yet) the generic hint stays, which
   * is still true.
   */
  function formatBytes(bytes) {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    const value = mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
    return value;
  }

  function loadDownloadFacts() {
    if (typeof fetch !== "function" || location.protocol === "file:") return;
    fetch(href("data/download.json"), { cache: "no-cache" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (payload) {
        var facts = payload && payload.source;
        if (!facts) return;
        var length = window.navigator.language && window.navigator.language.indexOf("fa") === 0 ? "fa-IR" : "en-US";
        var parts = [];
        var size = formatBytes(facts.bytes);
        if (size) parts.push(size);
        if (facts.files) parts.push(facts.files.toLocaleString(length) + " " + t("files"));
        if (!parts.length) return;
        // Every place that names the archive (header panel, drawer) states the same facts.
        Array.prototype.forEach.call(document.querySelectorAll("[data-download-facts]"), function (slot) {
          slot.textContent = parts.join(" · ");
        });
      })
      .catch(function () {
        /* the generic hint is already on screen */
      });
  }

  function wireDownload() {
    var widget = document.querySelector("[data-download]");
    if (!widget) return;
    document.addEventListener("click", function (event) {
      if (widget.contains(event.target)) return;
      widget.open = false;
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !widget.open) return;
      widget.open = false;
      var summary = widget.querySelector("summary");
      if (summary) summary.focus();
    });
    // A download link that leaves the panel open looks broken on the next visit.
    widget.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest("a")) widget.open = false;
    });
    loadDownloadFacts();
  }

  /* ------------------------------------------------------------------- init --- */

  /** Read the four states before first paint where the host page allows it. */
  function resolve(manifest) {
    var available = (manifest.locales || []).map(function (l) {
      return l.id;
    });
    var wantedLocale = param("lang") || readStored(LOCALE_KEY);
    if (!wantedLocale && document.documentElement.lang) wantedLocale = document.documentElement.lang;
    if (available.indexOf(wantedLocale) === -1) wantedLocale = manifest.defaultLocale || available[0] || "en";
    state.locale = wantedLocale;

    var wantedTheme = param("theme") || readStored(THEME_KEY);
    if (wantedTheme !== "light" && wantedTheme !== "dark") {
      var light = media("(prefers-color-scheme: light)");
      wantedTheme = light && light.matches ? "light" : "dark";
    }
    state.theme = wantedTheme;
  }

  function init(manifest) {
    state.manifest = manifest || { variations: [], disciplines: [], locales: [], ui: {} };
    resolve(state.manifest);
    apply({ animate: false });

    buildBar(state.manifest);

    var host = document.querySelector("[data-nav-host]");
    if (host) {
      host.innerHTML = "";
      host.appendChild(buildDesktopNav(state.manifest));
      nav.root = host;
    }

    var drawerHost = document.querySelector("[data-drawer-host]");
    if (drawerHost) {
      drawerHost.innerHTML = "";
      nav.drawer = buildDrawer(state.manifest);
      drawerHost.appendChild(nav.drawer);
      localiseDrawer();
    }

    document.addEventListener("click", function (event) {
      var langButton = event.target.closest ? event.target.closest("[data-lang]") : null;
      if (langButton) {
        setLocale(langButton.getAttribute("data-lang"));
        return;
      }
      var themeButton = event.target.closest ? event.target.closest("[data-theme-set]") : null;
      if (themeButton) {
        setTheme(themeButton.getAttribute("data-theme-set"));
        return;
      }
      var themeToggle = event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
      if (themeToggle) {
        setTheme(state.theme === "dark" ? "light" : "dark");
        return;
      }
      var burger = event.target.closest ? event.target.closest("[data-burger]") : null;
      if (burger) {
        if (nav.drawer && nav.drawer.hidden) openDrawer();
        else closeDrawer();
        return;
      }
      if (nav.drawer && !nav.drawer.hidden) return; // clicks inside the dialog are its own
      if (!event.target.closest || !event.target.closest(".nav__item")) closePanels(null);
    });

    document.addEventListener("keydown", onKeydown);
    wireDownload();
    loadDownloadFacts();

    var systemTheme = media("(prefers-color-scheme: light)");
    var onSystemTheme = function (event) {
      // Only follow the system while the visitor has not made a choice of their own.
      if (readStored(THEME_KEY) || param("theme")) return;
      setTheme(event.matches ? "light" : "dark");
    };
    if (systemTheme && systemTheme.addEventListener) systemTheme.addEventListener("change", onSystemTheme);

    // The stage overlay is an iframe; a language flip there needs telling.
    on(function (detail) {
      var frames = document.querySelectorAll("iframe[data-catalog-frame]");
      for (var i = 0; i < frames.length; i += 1) {
        try {
          frames[i].contentWindow.postMessage(
            { type: "catalog:skin", locale: detail.locale, theme: detail.theme, dir: detail.dir },
            "*",
          );
        } catch (err) {
          /* cross-origin: the frame simply keeps its own defaults */
        }
      }
    });

    return state;
  }

  return {
    init: init,
    t: t,
    pick: pick,
    label: label,
    blurb: blurb,
    href: href,
    componentHref: componentHref,
    disciplineHref: disciplineHref,
    topicHref: topicHref,
    variationHref: variationHref,
    translateTree: translateTree,
    setLocale: setLocale,
    setTheme: setTheme,
    state: state,
    on: on,
    formatBytes: formatBytes,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    locale: function () {
      return state.locale;
    },
    theme: function () {
      return state.theme;
    },
    dir: function () {
      return localeMeta(state.locale).dir || "ltr";
    },
  };
})();
