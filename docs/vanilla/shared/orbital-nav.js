/**
 * The Catalog — orbital navigation (buildless, shared)
 *
 * A radial menu with no framework, no bundler and no CDN: one script that both the
 * `Nav_V02_VanillaOrbitalDrawer` variation and the gaming-news site mount, so the two can never
 * disagree about how the catalogue's sections are laid out.
 *
 *   OrbitalNav.mount(root, {
 *     accent: "#5BFFC8",
 *     label:  { en: "Sections", fa: "بخش‌ها" },
 *     items:  [{ id, href, label: { en, fa }, meta: { en, fa }, accent }],
 *   });
 *
 * Behaviour, and why each part is there:
 *   · The ring opens on click (not hover) because it covers the page: a menu that opens as the
 *     pointer crosses it is a menu that opens by accident.
 *   · Items are placed on an arc with plain trigonometry. The arc is mirrored for RTL, so the ring
 *     sweeps the same way relative to the reading direction rather than against it.
 *   · ↑ ↓ (and ← → in LTR / RTL respectively) move a roving selection, Enter follows it, Escape
 *     closes and returns focus to the trigger. Tab order is the DOM order, which is the item order.
 *   · `prefers-reduced-motion` keeps the fade and drops the orbit — the nav still works, it just
 *     does not travel.
 *
 * The markup is built here rather than written twice in HTML, so the variation page and the site
 * cannot drift apart. Language comes from the host page's `[data-i18n-fa]` convention (the catalogue
 * shell swaps it), and the elements the nav needs are exactly: a trigger, a backdrop and a field.
 */
(function (global) {
  "use strict";

  var ARC_START = -140; // degrees, measured from the positive x axis in LTR
  var ARC_END = -40;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Mirrors a bilingual pair the same way the catalogue shell does: `data-i18n-fa` + swap. */
  function bilingual(node, label, english) {
    node.textContent = english;
    if (label && label.fa && label.fa !== english) node.setAttribute("data-i18n-fa", label.fa);
    return node;
  }

  function currentLocale() {
    var html = document.documentElement;
    if (html.dataset.locale) return html.dataset.locale;
    return html.dir === "rtl" ? "fa" : "en";
  }

  function pick(pair) {
    if (!pair) return "";
    return currentLocale() === "fa" && pair.fa ? pair.fa : pair.en;
  }

  function isRtl() {
    return (document.documentElement.dir || "ltr") === "rtl";
  }

  function mount(root, options) {
    if (!root || root.dataset.orbMounted === "1") return null;
    root.dataset.orbMounted = "1";
    root.classList.add("orb");
    if (options.accent) root.style.setProperty("--orb-accent", options.accent);
    if (options.canvas) root.style.setProperty("--orb-canvas", options.canvas);

    var items = options.items || [];
    var label = options.label || { en: "Sections", fa: "بخش‌ها" };
    var triggerLabel = options.trigger || label;

    /* ---------------------------------------------------------------- markup --- */

    // `triggerEn` is what the markup says in English; the Persian side rides on `data-i18n-fa`, the
    // catalogue shell's convention, so the nav speaks both languages without knowing the shell.
    var triggerEn = options.triggerEn || "Sections";
    var trigger = el("button", "orb__trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "orb-field");
    var icon = el("span", "orb__trigger-icon");
    icon.setAttribute("aria-hidden", "true");
    trigger.appendChild(icon);
    bilingual(trigger.appendChild(el("span", "orb__trigger-label")), triggerLabel, triggerEn);
    trigger.appendChild(el("span", "orb__count", String(items.length).padStart(2, "0")));
    root.appendChild(trigger);

    var backdrop = el("div", "orb__backdrop");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.addEventListener("click", close);
    root.appendChild(backdrop);

    var field = el("div", "orb__field");
    field.id = "orb-field";
    field.setAttribute("role", "menu");
    if (!trigger.id) trigger.id = "orb-trigger";
    field.setAttribute("aria-labelledby", trigger.id);
    field.appendChild(el("span", "orb__sweep")).setAttribute("aria-hidden", "true");

    var coreEl = el("button", "orb__core");
    coreEl.type = "button";
    bilingual(coreEl, { en: "Close", fa: "بستن" }, "Close");
    coreEl.addEventListener("click", close);
    field.appendChild(coreEl);

    var nodes = items.map(function (item, index) {
      var link = el("a", "orb__item");
      link.href = item.href;
      link.setAttribute("role", "menuitem");
      link.dataset.index = String(index);
      if (item.accent) link.style.setProperty("--orb-accent", item.accent);
      bilingual(link.appendChild(el("span", "orb__item-label")), item.label, item.label.en);
      if (item.meta) bilingual(link.appendChild(el("span", "orb__item-meta")), item.meta, item.meta.en);
      else if (item.note) bilingual(link.appendChild(el("span", "orb__item-meta")), item.note, item.note.en);
      return link;
    });
    nodes.forEach(function (node) {
      field.appendChild(node);
    });
    root.appendChild(field);

    /* --------------------------------------------------------------- geometry --- */

    /**
     * The layout: a curved fan, not a circle of boxes.
     *
     * A ring with nine wide labels overlaps itself — at the top of the arc, neighbours differ only
     * horizontally, and at 136px radius the horizontal step is 30px against a 152px label. So the
     * items are laid out the way a radial menu actually survives contact with real copy: uniform
     * vertical spacing (so nothing can ever collide), with a horizontal bulge that follows a sine,
     * which is what gives the fan its curve. The decorative sweep ring behind it stays a ring.
     *
     * Heights are *measured* rather than assumed: Persian labels set taller, and a layout that
     * guesses 48px puts its rows on top of each other in one of the two languages.
     */
    var GAP = 6;

    function layout() {
      var dir = isRtl() ? 1 : -1; // the bulge points inwards: left in LTR, right in RTL
      var bulge = Math.min(72, 20 + nodes.length * 5);
      var heights = nodes.map(function (node) {
        return node.offsetHeight || 44;
      });
      var core = coreEl.offsetHeight || 40;

      var y = core + GAP * 2;
      nodes.forEach(function (node, index) {
        var t = nodes.length === 1 ? 0.5 : index / (nodes.length - 1);
        var x = dir * Math.sin(Math.PI * t) * bulge;
        node.style.setProperty("--orb-x", Math.round(x) + "px");
        node.style.setProperty("--orb-y", Math.round(y) + "px");
        y += heights[index] + GAP;
      });

      // The field states its own height so it can scroll instead of running off a short screen.
      field.style.setProperty("--orb-field-h", Math.round(y) + "px");
      field.style.setProperty("--orb-bulge", Math.round(bulge) + "px");
    }

    /* -------------------------------------------------------------- behaviour --- */

    var lastFocus = null;
    var active = -1;

    function isOpen() {
      return root.dataset.open === "true";
    }

    function open(index) {
      lastFocus = document.activeElement;
      root.dataset.open = "true";
      trigger.setAttribute("aria-expanded", "true");
      layout();
      setActive(index === undefined ? 0 : index);
    }

    function close(restore) {
      if (!isOpen()) return;
      root.dataset.open = "false";
      trigger.setAttribute("aria-expanded", "false");
      active = -1;
      nodes.forEach(function (node) {
        node.removeAttribute("data-active");
      });
      var target = restore === false ? null : lastFocus || trigger;
      if (target && target.focus) target.focus();
    }

    function setActive(index) {
      active = (index + nodes.length) % nodes.length;
      nodes.forEach(function (node, i) {
        if (i === active) {
          node.setAttribute("data-active", "true");
          node.focus({ preventScroll: true });
        } else {
          node.removeAttribute("data-active");
        }
      });
    }

    trigger.addEventListener("click", function () {
      if (isOpen()) close(false);
      else open();
    });

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        open(nodes.length - 1);
      }
    });

    root.addEventListener("keydown", function (event) {
      if (!isOpen()) return;
      var step = isRtl() ? -1 : 1;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActive(active + step);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActive(active - step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(active - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(nodes.length - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        // Tabbing out of the ring closes it: a menu that stays open behind the keyboard is a trap.
        window.setTimeout(function () {
          if (!root.contains(document.activeElement)) close(false);
        }, 0);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) close();
    });

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      if (!isOpen()) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layout, 160);
    });

    // The label language follows the shell, which swaps `[data-i18n-fa]` — but the aria labels the
    // nav generates itself are not in the document tree it scans, so they are refreshed here.
    document.addEventListener("catalog:skin", refresh);
    if (global.CatalogChrome && global.CatalogChrome.on) global.CatalogChrome.on(refresh);

    function refresh() {
      field.setAttribute("aria-label", pick(label));
      coreEl.textContent = pick({ en: "Close", fa: "بستن" });
      coreEl.setAttribute("data-i18n-fa", "بستن");
      layout();
    }

    refresh();

    return { open: open, close: close, root: root };
  }

  global.OrbitalNav = { mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
