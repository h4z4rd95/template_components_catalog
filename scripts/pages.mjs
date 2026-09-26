/**
 * pages.mjs — the catalogue's real pages, generated from the manifest.
 *
 * The hub is a single scroll. It cannot answer "what else is under Typography across every
 * discipline?", and it cannot give a single component a URL worth sending to a client. So the
 * same manifest that feeds the hub also emits:
 *
 *   docs/browse/index.html                    every discipline → topic → variation, one index
 *   docs/browse/<discipline>/index.html       one discipline, its topics and its variations
 *   docs/browse/<discipline>/<topic>/index.html   one topic inside one discipline
 *   docs/component/<slug>/index.html          one variation: HUD, live stage, source, neighbours
 *
 * Three properties matter more than the markup:
 *
 *   1. **Generated, never hand-edited.** The whole tree is wiped and rewritten on every sync, so a
 *      removed variation cannot leave a page behind pointing at nothing.
 *   2. **Bilingual without JavaScript.** Both languages live in the markup: the element text is
 *      English and `data-i18n-fa` carries the Persian. The shell swaps them (see chrome.js), which
 *      means the pages are readable, indexable and correct before a single script runs — and there
 *      is no JSON payload to fetch before the text appears.
 *   3. **Depth-aware.** Every href, stylesheet and script is written from the page's own base, so
 *      the same output works at `/`, at `/<repo>/` on Pages, and over `file://`.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* ------------------------------------------------------------------ helpers --- */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Persian text for a node whose element text is the English one. */
const bi = (fa) => (fa ? ` data-i18n-fa="${esc(fa)}"` : "");

const pad = (value) => String(value).padStart(2, "0");

/** A generated page's own furniture — the shell (bar, drawer) comes from chrome.js. */
const PREFIX = "pg";

function page({ base, kind, title, titleFa, description, descriptionFa, accent, body }) {
  const icon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23050506'/%3E%3Cpath d='M8 24V8h3.4v6.2h9.2V8H24v16h-3.4v-6.6h-9.2V24z' fill='%23ff4fd8'/%3E%3C/svg%3E";

  return `<!doctype html>
<html lang="en" dir="ltr" data-page="${esc(kind)}" data-title-en="${esc(title)}" data-title-fa="${esc(titleFa || title)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" data-desc-en="${esc(description)}" data-desc-fa="${esc(descriptionFa || description)}" />
    <meta name="theme-color" content="#050506" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <link rel="alternate" hreflang="en" href="?lang=en" />
    <link rel="alternate" hreflang="fa" href="?lang=fa" />

    <!-- The same pre-paint bootstrap the hub runs: nothing renders in the wrong theme or the wrong
         direction, because the very first paint already knows which one applies. -->
    <script>
      (function () {
        try {
          var params = new URLSearchParams(location.search);
          var stored = function (k) {
            try {
              return localStorage.getItem(k);
            } catch (e) {
              return null;
            }
          };
          var theme = params.get("theme") || stored("catalog:theme");
          if (theme !== "light" && theme !== "dark") {
            theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          }
          var locale = params.get("lang") || stored("catalog:locale") || "en";
          if (locale !== "en" && locale !== "fa") locale = "en";
          var root = document.documentElement;
          root.dataset.theme = theme;
          root.dataset.locale = locale;
          root.lang = locale;
          root.dir = locale === "fa" ? "rtl" : "ltr";
        } catch (e) {
          document.documentElement.dataset.theme = "dark";
        }
      })();
    </script>

    <link rel="stylesheet" href="${base}assets/fonts.css" />
    <!-- hub.css carries the authored dark ink ramp and the masthead bar itself; the shell has to
         look identical here and on the hub, so there is one definition of it, not two. Order
         matters and is the hub's: both ramps are single-class specificity, so the light ramp in
         theme.css only wins because it is read *after* the dark one. -->
    <link rel="stylesheet" href="${base}assets/hub.css" />
    <link rel="stylesheet" href="${base}assets/theme.css" />
    <link rel="stylesheet" href="${base}assets/chrome.css" />
    <link rel="stylesheet" href="${base}assets/page.css" />
    <link rel="icon" href="${icon}" />

    <script>
      window.__CATALOG_BASE__ = "${base}";
    </script>
    <script src="${base}data/catalog.js" defer></script>
    <script src="${base}assets/chrome.js" defer></script>
    <script src="${base}assets/page.js" defer></script>
  </head>

  <body class="${PREFIX}${accent ? ` ${PREFIX}--accented` : ""}" style="--accent: ${esc(accent || "#ff4fd8")}">
    <a class="skip" href="#main" data-i18n="skip">Skip to the catalog</a>

    <header class="masthead ${PREFIX}__masthead">
      <nav class="masthead__bar" data-shell-bar data-i18n-aria="primaryNav"></nav>
    </header>

    <main id="main" class="${PREFIX}__main">
${body}
    </main>

    <footer class="${PREFIX}__foot">
      <p class="${PREFIX}__foot-note" data-i18n="footerNote">
        Built as an open, bilingual, dual-theme showroom. Every variation is a real page.
      </p>
      <a class="${PREFIX}__foot-link" href="${base}index.html" data-i18n="backToHub">Back to the hub</a>
    </footer>

    <div data-drawer-host></div>
  </body>
</html>
`;
}

function crumbs(base, trail) {
  const parts = [`<a href="${base}index.html" data-i18n="home">Catalog</a>`];
  for (const step of trail) {
    parts.push('<span aria-hidden="true">/</span>');
    parts.push(
      step.href
        ? `<a href="${esc(step.href)}"${bi(step.fa)}>${esc(step.label)}</a>`
        : `<span aria-current="page"${bi(step.fa)}>${esc(step.label)}</span>`,
    );
  }
  return `      <nav class="${PREFIX}__crumbs" aria-label="Breadcrumb">
        ${parts.join("\n        ")}
      </nav>`;
}

function hero({ kicker, kickerKey, kickerFa, title, titleFa, lede, ledeFa, stats, accent }) {
  // A kicker is either data (a discipline name, a component id) or a shell string. When it is a
  // shell string it carries `data-i18n`, so the same markup serves both languages properly rather
  // than printing the key itself.
  const kickerAttrs = `${kickerKey ? ` data-i18n="${esc(kickerKey)}"` : ""}${bi(kickerFa)}`;
  return `      <header class="${PREFIX}__hero"${accent ? ` style="--accent: ${esc(accent)}"` : ""}>
        <p class="${PREFIX}__kicker force-ltr"${kickerAttrs}>${esc(kicker)}</p>
        <h1 class="${PREFIX}__title"${bi(titleFa)}>${esc(title)}</h1>
        <p class="${PREFIX}__lede"${bi(ledeFa)}>${esc(lede)}</p>
${stats.length ? `        <ul class="${PREFIX}__stats">\n${stats.map((s) => `          <li>${s}</li>`).join("\n")}\n        </ul>` : ""}
      </header>`;
}

/** A topic chip: label, the number of variations under it, and a link to its own page. */
function topicChip(topic, href, count, active) {
  return `            <li>
              <a class="${PREFIX}__chip${active ? ` is-active` : ""}" href="${esc(href)}"${count ? "" : ' data-empty="1"'}>
                <span class="${PREFIX}__chip-label"${bi(topic.labelFa)}>${esc(topic.label)}</span>
                <span class="${PREFIX}__chip-count force-ltr">${pad(count)}</span>
              </a>
            </li>`;
}

/** A variation row: the thing a reader actually clicks on their way to a component page. */
function variationRow(variation, href, { ui, showVibe = true } = {}) {
  const chips = (variation.stack || [])
    .slice(0, 4)
    .map((name) => `<span class="${PREFIX}__row-chip">${esc(name)}</span>`)
    .join("");
  return `            <li>
              <a class="${PREFIX}__row" href="${esc(href)}" style="--row-accent: ${esc(variation.accent)}" data-status="${esc(variation.status)}">
                <span class="${PREFIX}__row-id force-ltr">${esc(variation.id)}</span>
                <span class="${PREFIX}__row-title"${bi(variation.titleFa)}>${esc(variation.title)}</span>
                ${showVibe ? `<span class="${PREFIX}__row-vibe"${bi(variation.vibeFa)}>${esc(variation.vibe)}</span>` : ""}
                <span class="${PREFIX}__row-stack">${chips}</span>
                <span class="${PREFIX}__row-status" data-i18n="${esc(variation.status)}">${esc(variation.status)}</span>
              </a>
            </li>`;
}

function rowList(rows) {
  return `          <ul class="${PREFIX}__rows">
${rows.join("\n")}
          </ul>`;
}

/* ------------------------------------------------------------- page builders --- */

function buildBrowseRoot({ base, disciplines, variations, topicsById, topicCounts, ui }) {
  const blocks = disciplines
    .filter((d) => (d.topics || []).length)
    .map((discipline) => {
      const items = variations.filter((v) => v.discipline === discipline.id);
      const chips = (discipline.topics || [])
        .map((id) => topicsById.get(id))
        .filter(Boolean)
        .map((topic) => topicChip(topic, `${base}browse/${discipline.id.toLowerCase()}/${topic.id}/index.html`, topicCounts.get(`${discipline.id}/${topic.id}`) || 0))
        .join("\n");

      return `      <section class="${PREFIX}__block">
        <div class="${PREFIX}__block-head">
          <h2 class="${PREFIX}__block-title">
            <a href="${base}browse/${discipline.id.toLowerCase()}/index.html"${bi(discipline.labelFa)}>${esc(discipline.label)}</a>
          </h2>
          <p class="${PREFIX}__block-blurb"${bi(discipline.blurbFa)}>${esc(discipline.blurb)}</p>
          <p class="${PREFIX}__block-counts">
            <span class="force-ltr">${pad(items.length)}</span> <span data-i18n="variations">variations</span>
            <span aria-hidden="true">·</span>
            <span class="force-ltr">${pad((discipline.topics || []).length)}</span> <span data-i18n="topics">topics</span>
          </p>
        </div>
${chips ? `        <ul class="${PREFIX}__chips">\n${chips}\n        </ul>` : ""}
${items.length ? rowList(items.map((v) => variationRow(v, `${base}component/${v.slug}/index.html`, { ui }))) : `        <p class="${PREFIX}__empty" data-i18n="noVariations">No variation has landed in this topic yet.</p>`}
      </section>`;
    })
    .join("\n\n");

  return page({
    base,
    kind: "browse",
    title: "Browse the catalog — every discipline, topic and variation",
    titleFa: "مرور کاتالوگ — هر رشته، موضوع و نمونه",
    description:
      "The whole catalog as an index: disciplines, the topics under them, and every variation — each with its own page.",
    descriptionFa: "تمام کاتالوگ به شکل فهرست: رشته‌ها، موضوع‌های زیرشان و همهٔ نمونه‌ها — هر کدام با صفحهٔ خودش.",
    body:
      crumbs(base, [{ label: "Browse", fa: "مرور" }]) +
      "\n" +
      hero({
        kicker: ui.en.browse,
        kickerKey: "browse",
        title: "Every discipline, topic and variation",
        titleFa: "هر رشته، موضوع و نمونه",
        lede: ui.en.browseLede,
        ledeFa: ui.fa.browseLede,
        stats: [
          `<span class="force-ltr">${pad(disciplines.length)}</span> <span data-i18n="disciplines">disciplines</span>`,
          `<span class="force-ltr">${pad(topicsById.size)}</span> <span data-i18n="topics">topics</span>`,
          `<span class="force-ltr">${pad(variations.length)}</span> <span data-i18n="variations">variations</span>`,
        ].map((s) => `<span class="${PREFIX}__stat">${s}</span>`),
      }) +
      "\n" +
      blocks +
      "\n",
  });
}

function buildDisciplinePage({ base, discipline, disciplines, variations, topicsById, topicCounts, ui }) {
  const items = variations.filter((v) => v.discipline === discipline.id);
  const topics = (discipline.topics || []).map((id) => topicsById.get(id)).filter(Boolean);
  const chips = topics
    .map((topic) => topicChip(topic, `${topic.id}/index.html`, topicCounts.get(`${discipline.id}/${topic.id}`) || 0))
    .join("\n");

  // Grouped by topic, in the order the discipline declares its topics: the page then reads as the
  // discipline's own table of contents rather than as an undifferentiated list.
  const grouped = topics
    .map((topic) => {
      const group = items.filter((v) => v.topic === topic.id);
      if (!group.length) return "";
      return `      <section class="${PREFIX}__block">
        <div class="${PREFIX}__block-head">
          <h2 class="${PREFIX}__block-title">
            <a href="${topic.id}/index.html"${bi(topic.labelFa)}>${esc(topic.label)}</a>
          </h2>
          <p class="${PREFIX}__block-blurb"${bi(topic.blurbFa)}>${esc(topic.blurb)}</p>
        </div>
${rowList(group.map((v) => variationRow(v, `${base}component/${v.slug}/index.html`, { ui })))}
      </section>`;
    })
    .filter(Boolean)
    .join("\n\n");

  const untopiced = items.filter((v) => !v.topic);
  const others = disciplines
    .filter((d) => d.id !== discipline.id && (d.topics || []).length)
    .map(
      (d) =>
        `<li><a class="${PREFIX}__chip" href="${base}browse/${d.id.toLowerCase()}/index.html"><span class="${PREFIX}__chip-label"${bi(d.labelFa)}>${esc(d.label)}</span></a></li>`,
    )
    .join("\n");

  return page({
    base,
    kind: "discipline",
    title: `${discipline.label} — variations, topics and stacks`,
    titleFa: `${discipline.labelFa} — نمونه‌ها، موضوع‌ها و استک‌ها`,
    description: `${discipline.blurb} ${items.length} variations across ${topics.length} topics.`,
    descriptionFa: `${discipline.blurbFa} ${items.length} نمونه در ${topics.length} موضوع.`,
    accent: items[0]?.accent,
    body:
      crumbs(base, [
        { label: "Browse", fa: "مرور", href: "../index.html" },
        { label: discipline.label, fa: discipline.labelFa },
      ]) +
      "\n" +
      hero({
        kicker: discipline.id,
        kickerFa: discipline.labelFa,
        title: discipline.label,
        titleFa: discipline.labelFa,
        lede: discipline.blurb,
        ledeFa: discipline.blurbFa,
        stats: [
          `<span class="force-ltr">${pad(items.length)}</span> <span data-i18n="variations">variations</span>`,
          `<span class="force-ltr">${pad(topics.length)}</span> <span data-i18n="topics">topics</span>`,
        ].map((s) => `<span class="${PREFIX}__stat">${s}</span>`),
      }) +
      "\n" +
      `      <nav class="${PREFIX}__topics" data-i18n-aria="filterTopic">
        <ul class="${PREFIX}__chips">
${chips}
        </ul>
      </nav>\n` +
      (grouped || `      <p class="${PREFIX}__empty" data-i18n="noVariations">No variation has landed in this topic yet.</p>`) +
      "\n" +
      (untopiced.length
        ? `      <section class="${PREFIX}__block">\n${rowList(untopiced.map((v) => variationRow(v, `${base}component/${v.slug}/index.html`, { ui })))}\n      </section>\n`
        : "") +
      `      <section class="${PREFIX}__block ${PREFIX}__block--aside">
        <h2 class="${PREFIX}__block-title" data-i18n="disciplines">Disciplines</h2>
        <ul class="${PREFIX}__chips">
${others}
        </ul>
      </section>\n`,
  });
}

function buildTopicPage({ base, discipline, topic, variations, topicsById, topicCounts, ui }) {
  const items = variations.filter((v) => v.discipline === discipline.id && v.topic === topic.id);
  const siblings = (discipline.topics || [])
    .map((id) => topicsById.get(id))
    .filter((t) => t && t.id !== topic.id)
    .map((t) => topicChip(t, `../${t.id}/index.html`, topicCounts.get(`${discipline.id}/${t.id}`) || 0))
    .join("\n");

  return page({
    base,
    kind: "topic",
    title: `${topic.label} · ${discipline.label} — ${items.length} variations`,
    titleFa: `${topic.labelFa} · ${discipline.labelFa} — ${items.length} نمونه`,
    description: `${topic.blurb} ${items.length} variations in ${discipline.label}.`,
    descriptionFa: `${topic.blurbFa} ${items.length} نمونه در ${discipline.labelFa}.`,
    accent: items[0]?.accent,
    body:
      crumbs(base, [
        { label: "Browse", fa: "مرور", href: "../../index.html" },
        { label: discipline.label, fa: discipline.labelFa, href: "../index.html" },
        { label: topic.label, fa: topic.labelFa },
      ]) +
      "\n" +
      hero({
        kicker: discipline.label,
        kickerFa: discipline.labelFa,
        title: topic.label,
        titleFa: topic.labelFa,
        lede: topic.blurb,
        ledeFa: topic.blurbFa,
        stats: [
          `<span class="force-ltr">${pad(items.length)}</span> <span data-i18n="variations">variations</span> <span data-i18n="inThisTopic">in this topic</span>`,
        ].map((s) => `<span class="${PREFIX}__stat">${s}</span>`),
      }) +
      "\n" +
      (items.length
        ? rowList(items.map((v) => variationRow(v, `${base}component/${v.slug}/index.html`, { ui })))
        : `      <p class="${PREFIX}__empty" data-i18n="noVariations">No variation has landed in this topic yet.</p>`) +
      "\n" +
      `      <section class="${PREFIX}__block ${PREFIX}__block--aside">
        <h2 class="${PREFIX}__block-title" data-i18n="siblingTopics">Topics in this discipline</h2>
        <ul class="${PREFIX}__chips">
${siblings}
        </ul>
      </section>\n`,
  });
}

function buildComponentPage({ base, variation, discipline, topic, variations, github, ui }) {
  const planned = variation.status === "planned";
  const topicUrl = topic ? `${base}browse/${discipline.id.toLowerCase()}/${topic.id}/index.html` : null;

  const specRow = (labelKey, value, extra = "") =>
    `          <div class="${PREFIX}__spec-row">
            <dt data-i18n="${labelKey}">${labelKey}</dt>
            <dd${extra}>${value}</dd>
          </div>`;

  const chips = (variation.stack || [])
    .map((name) => `<span class="${PREFIX}__row-chip">${esc(name)}</span>`)
    .join("");

  const tags = (variation.tags || [])
    .map((tag) => `<li class="${PREFIX}__tag force-ltr">${esc(tag)}</li>`)
    .join("");

  const sourceUrl = `${github}/tree/main/${variation.source}`;
  const rawUrl = `${base}${variation.href}index.html`;

  const stage = planned
    ? `      <section class="${PREFIX}__stage ${PREFIX}__stage--planned" data-planned>
        <div class="${PREFIX}__stage-bar">
          <span class="${PREFIX}__stage-label" data-i18n="livePreview">Live preview</span>
          <span class="${PREFIX}__stage-badge" data-i18n="planned">planned</span>
        </div>
        <div class="${PREFIX}__blueprint">
          <p class="card__planned-kicker" data-i18n="plannedTitle">In production</p>
          <dl class="card__planned-row">
            <dt class="card__planned-label" data-i18n="plannedRoute">Route reserved</dt>
            <dd class="card__planned-value force-ltr">${esc(variation.href)}</dd>
          </dl>
          <p class="card__planned-note" data-i18n="pagePlan">
            Its page ships in the commerce batch — the metadata, stack and blueprint above are already final.
          </p>
          <a class="${PREFIX}__action" href="${esc(sourceUrl)}" target="_blank" rel="noreferrer noopener" data-i18n="source">Source ↗</a>
        </div>
      </section>`
    : `      <section class="${PREFIX}__stage" data-stage data-src="${esc(rawUrl)}" data-id="${esc(variation.id)}" data-source="${esc(variation.source)}" data-href="${esc(variation.href)}">
        <div class="${PREFIX}__stage-bar">
          <span class="${PREFIX}__stage-label" data-i18n="livePreview">Live preview</span>
          <div class="${PREFIX}__stage-actions">
            <a class="${PREFIX}__action" href="${esc(rawUrl)}" target="_blank" rel="noreferrer noopener" data-i18n="raw">Raw ↗</a>
            <a class="${PREFIX}__action" href="${esc(sourceUrl)}" target="_blank" rel="noreferrer noopener" data-i18n="source">Source ↗</a>
          </div>
        </div>
        <div class="${PREFIX}__stage-frame" data-stage-frame>
          <span class="${PREFIX}__stage-idle" data-i18n="scrollHint">Scroll to explore</span>
        </div>
      </section>`;

  // Neighbours: the variations on either side of this one inside the same discipline. A catalogue
  // that never offers a next thing to look at is a dead end.
  const siblings = variations.filter((v) => v.discipline === variation.discipline);
  const index = siblings.findIndex((v) => v.slug === variation.slug);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const pager =
    prev || next
      ? `      <nav class="${PREFIX}__pager" aria-label="${esc(discipline.label)}">
${prev ? `        <a class="${PREFIX}__pager-link" href="${base}component/${prev.slug}/index.html"><span class="${PREFIX}__pager-dir" data-i18n="previous">Previous</span><span${bi(prev.titleFa)}>${esc(prev.title)}</span></a>` : `        <span class="${PREFIX}__pager-link is-empty"></span>`}
${next ? `        <a class="${PREFIX}__pager-link ${PREFIX}__pager-link--next" href="${base}component/${next.slug}/index.html"><span class="${PREFIX}__pager-dir" data-i18n="next">Next</span><span${bi(next.titleFa)}>${esc(next.title)}</span></a>` : `        <span class="${PREFIX}__pager-link is-empty"></span>`}
      </nav>`
      : "";

  const related = variations
    .filter((v) => v.topic && v.topic === variation.topic && v.slug !== variation.slug)
    .slice(0, 6);
  const relatedBlock = related.length
    ? `      <section class="${PREFIX}__block">
        <h2 class="${PREFIX}__block-title" data-i18n="related">Related variations</h2>
${rowList(related.map((v) => variationRow(v, `${base}component/${v.slug}/index.html`, { ui, showVibe: false })))}
      </section>`
    : "";

  const trail = [
    { label: "Browse", fa: "مرور", href: `${base}browse/index.html` },
    { label: discipline.label, fa: discipline.labelFa, href: `${base}browse/${discipline.id.toLowerCase()}/index.html` },
  ];
  if (topic && topicUrl) trail.push({ label: topic.label, fa: topic.labelFa, href: topicUrl });
  trail.push({ label: variation.title, fa: variation.titleFa });

  return page({
    base,
    kind: "component",
    title: `${variation.title} — ${variation.id} · The Catalog`,
    titleFa: `${variation.titleFa || variation.title} — ${variation.id} · کاتالوگ`,
    description: `${variation.vibe}. ${variation.interaction}`,
    descriptionFa: `${variation.vibeFa || variation.vibe}. ${variation.interactionFa || variation.interaction}`,
    accent: variation.accent,
    body:
      crumbs(base, trail) +
      "\n" +
      hero({
        kicker: variation.id,
        title: variation.title,
        titleFa: variation.titleFa,
        lede: variation.vibe,
        ledeFa: variation.vibeFa,
        stats: [
          `<span class="${PREFIX}__stat ${PREFIX}__stat--status" data-status="${esc(variation.status)}" data-i18n="${esc(variation.status)}">${esc(variation.status)}</span>`,
          `<span class="${PREFIX}__stat"><span data-i18n="batch">Batch</span> <span class="force-ltr">${pad(variation.batch || 1)}</span></span>`,
          topic ? `<span class="${PREFIX}__stat"><a href="${esc(topicUrl)}"${bi(topic.labelFa)}>${esc(topic.label)}</a></span>` : "",
        ].filter(Boolean),
      }) +
      "\n" +
      `      <!-- The metadata HUD, exactly as the card carries it: id, stack, vibe, blueprint, tags. -->
      <section class="${PREFIX}__hud" aria-labelledby="${PREFIX}-hud-title" style="--accent: ${esc(variation.accent)}">
        <p class="${PREFIX}__hud-title" id="${PREFIX}-hud-title" data-i18n="catalogSummary">Catalog summary</p>
        <dl class="${PREFIX}__spec">
${specRow("id", `<span class="force-ltr">${esc(variation.id)}</span>`)}
${specRow("discipline", `<a href="${base}browse/${discipline.id.toLowerCase()}/index.html"${bi(discipline.labelFa)}>${esc(discipline.label)}</a>`)}
${topic ? specRow("topicLabel", `<a href="${esc(topicUrl)}"${bi(topic.labelFa)}>${esc(topic.label)}</a>`) : ""}
${specRow("stack", `<span class="${PREFIX}__row-stack">${chips}</span>`)}
${specRow("vibe", `<span${bi(variation.vibeFa)}>${esc(variation.vibe)}</span>`)}
${specRow("interaction", `<span${bi(variation.interactionFa)}>${esc(variation.interaction)}</span>`)}
${specRow("tags", `<ul class="${PREFIX}__tags">${tags}</ul>`)}
        </dl>
      </section>` +
      "\n" +
      stage +
      "\n" +
      `      <section class="${PREFIX}__block ${PREFIX}__block--aside">
        <h2 class="${PREFIX}__block-title" data-i18n="howToRun">How to run it</h2>
        <p class="${PREFIX}__howto">
          <code class="force-ltr">npm install</code>
          <code class="force-ltr">npm run dev</code>
          <span class="${PREFIX}__howto-note" data-i18n="componentPage">Component page</span>
          <code class="force-ltr">${esc(variation.source)}</code>
        </p>
      </section>` +
      "\n" +
      relatedBlock +
      (relatedBlock ? "\n" : "") +
      pager +
      "\n",
  });
}

/* -------------------------------------------------------------------- emit --- */

export async function emitPages({ root, manifest, variations }) {
  const docs = join(root, "docs");
  const topics = manifest.topics || [];
  const disciplines = manifest.disciplines || [];
  const ui = manifest.ui || { en: {}, fa: {} };
  const github = `https://github.com/${(manifest.meta && manifest.meta.repo) || "h4z4rd95/template_components_catalog"}`;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

  // How many variations each discipline/topic pair actually holds, so a chip can state its number.
  const topicCounts = new Map();
  for (const v of variations) {
    if (!v.topic) continue;
    const key = `${v.discipline}/${v.topic}`;
    topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
  }

  // Generated means generated: the tree is wiped, so a variation deleted from the manifest cannot
  // leave an orphan page behind claiming it still exists.
  const written = [];
  for (const dir of ["browse", "component"]) {
    await rm(join(docs, dir), { recursive: true, force: true });
  }

  const write = async (rel, html) => {
    const target = join(docs, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, html, "utf8");
    written.push(rel);
  };

  await write(
    "browse/index.html",
    buildBrowseRoot({ base: "../", disciplines, variations, topicsById, topicCounts, ui }),
  );

  for (const discipline of disciplines) {
    if (!(discipline.topics || []).length) continue;
    const base = "../../";
    await write(
      `browse/${discipline.id.toLowerCase()}/index.html`,
      buildDisciplinePage({ base, discipline, disciplines, variations, topicsById, topicCounts, ui }),
    );

    for (const topicId of discipline.topics) {
      const topic = topicsById.get(topicId);
      if (!topic) continue;
      await write(
        `browse/${discipline.id.toLowerCase()}/${topicId}/index.html`,
        buildTopicPage({
          base: "../../../",
          discipline,
          topic,
          variations,
          topicsById,
          topicCounts,
          ui,
        }),
      );
    }
  }

  for (const variation of variations) {
    const discipline = disciplines.find((d) => d.id === variation.discipline);
    if (!discipline) continue;
    const topic = topicsById.get(variation.topic) || null;
    await write(
      `component/${variation.slug}/index.html`,
      buildComponentPage({ base: "../../", variation, discipline, topic, variations, github, ui }),
    );
  }

  return { written, github };
}
