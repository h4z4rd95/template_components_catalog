/* ============================================================================
   hud.js — the hub's metadata HUD renderer.

   The same information architecture as the React `CatalogHUD` inside the variations:
   ID + name, stack, vibe, interaction blueprint, provenance. Built with DOM APIs
   (never innerHTML) so a manifest entry can never inject markup.
   ========================================================================= */
(function () {
  "use strict";

  const GITHUB = "https://github.com/h4z4rd95/template_components_catalog";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chipRow(items, className) {
    const wrap = el("div", className);
    items.forEach(function (item) {
      wrap.appendChild(el("span", "card__chip", item));
    });
    return wrap;
  }

  /**
   * Builds the metadata block that sits above every preview frame.
   * @param {object} variation a manifest record
   * @param {{ onOpen: Function, onCopy: Function }} handlers
   */
  /* Shell strings follow the active language; the record itself follows `pick()`. */
  const t = (key) => (window.CatalogChrome ? window.CatalogChrome.t(key) : key);
  const pick = (record, field) =>
    window.CatalogChrome ? window.CatalogChrome.pick(record, field) : record[field];

  function renderCardHUD(variation, handlers) {
    const hud = el("div", "card__hud");

    const head = el("div", "card__head");
    head.appendChild(el("span", "card__badge", "BATCH " + String(variation.batch).padStart(2, "0")));
    head.appendChild(el("span", "card__discipline", variation.discipline));
    const status = el("span", "card__status force-ltr", variation.status);
    status.dataset.status = variation.status;
    head.appendChild(status);
    hud.appendChild(head);

    hud.appendChild(el("h3", "card__id force-ltr", variation.id));
    hud.appendChild(el("p", "card__title", pick(variation, "title")));

    const meta = el("dl", "card__meta");

    const stackDt = el("dt", null, t("stack"));
    const stackDd = el("dd", null);
    stackDd.appendChild(chipRow(variation.stack, "card__stack"));
    meta.appendChild(stackDt);
    meta.appendChild(stackDd);

    meta.appendChild(el("dt", null, t("vibe")));
    meta.appendChild(el("dd", "card__vibe", pick(variation, "vibe")));

    meta.appendChild(el("dt", null, t("interaction")));
    meta.appendChild(el("dd", null, pick(variation, "interaction")));

    if (variation.perf && variation.perf.assetWeight) {
      meta.appendChild(el("dt", null, "Weight"));
      meta.appendChild(
        el("dd", null, variation.perf.assetWeight + (variation.perf.webgl ? " · gpu" : " · cpu only")),
      );
    }

    hud.appendChild(meta);

    const actions = el("div", "card__actions");

    // A planned variation has no page, so it gets no "Raw ↗" — that link would be a 404 — and no
    // primary button. The panel above the actions already explains the status; what remains here
    // is only what genuinely works: its component page (latent), its id and its source.
    if (variation.status === "planned") {
      const route = el("a", "card__action", t("openPreview") + " ↗");
      route.href = window.CatalogChrome
        ? window.CatalogChrome.componentHref(variation.slug)
        : variation.href;
      route.rel = "noreferrer noopener";
      actions.appendChild(route);
    } else {
      const open = el("button", "card__action card__action--primary", t("openPreview"));
      open.type = "button";
      open.addEventListener("click", function () {
        handlers.onOpen(variation);
      });
      actions.appendChild(open);
    }

    const copy = el("button", "card__action", t("copyId"));
    copy.type = "button";
    copy.addEventListener("click", function () {
      handlers.onCopy(variation.id, copy);
    });
    actions.appendChild(copy);

    if (variation.status !== "planned") {
      const raw = el("a", "card__action", t("raw") + " ↗");
      raw.href = variation.href + "index.html";
      raw.target = "_blank";
      raw.rel = "noreferrer noopener";
      actions.appendChild(raw);
    }

    const source = el("a", "card__action", t("source") + " ↗");
    source.href = GITHUB + "/tree/main/" + variation.source;
    source.target = "_blank";
    source.rel = "noreferrer noopener";
    if (variation.status === "planned") source.href = GITHUB + "/tree/main/catalog";
    actions.appendChild(source);

    hud.appendChild(actions);
    return hud;
  }

  /** Tags rail under the frame — click to filter by that tag. */
  function renderTagRail(variation, onTagClick) {
    const wrap = el("div", "card__tags");
    variation.tags.forEach(function (tag) {
      const button = el("button", "card__tag", tag.replace(/-/g, " "));
      button.type = "button";
      button.addEventListener("click", function () {
        onTagClick(tag);
      });
      wrap.appendChild(button);
    });
    return wrap;
  }

  window.CatalogHUD = { renderCardHUD: renderCardHUD, renderTagRail: renderTagRail, GITHUB: GITHUB };
})();
