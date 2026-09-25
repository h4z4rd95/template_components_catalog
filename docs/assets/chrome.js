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
    syncUrl();
  }

  function prefersReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    drawer.appendChild(foot);
    drawer.appendChild(body);

    close.addEventListener("click", closeDrawer);
    return drawer;
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
      wantedTheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    state.theme = wantedTheme;
  }

  function init(manifest) {
    state.manifest = manifest || { variations: [], disciplines: [], locales: [], ui: {} };
    resolve(state.manifest);
    apply({ animate: false });

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

    var media = window.matchMedia("(prefers-color-scheme: light)");
    var onSystemTheme = function (event) {
      // Only follow the system while the visitor has not made a choice of their own.
      if (readStored(THEME_KEY) || param("theme")) return;
      setTheme(event.matches ? "light" : "dark");
    };
    if (media.addEventListener) media.addEventListener("change", onSystemTheme);

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
