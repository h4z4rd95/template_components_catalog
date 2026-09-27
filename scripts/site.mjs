/**
 * site.mjs — the composed deliverables: a full gaming-news newsroom, and the user guide.
 *
 * Two things this project promises that the hub cannot provide on its own:
 *
 *   1. **A site, not a catalogue of parts.** `docs/sites/gaming-news/**` is a complete newsroom —
 *      lead story, ticker, story grid, reviews desk, live board, long-form article — built from the
 *      catalogue's own tokens, fonts and skin contract, with three of the catalogue's variations
 *      reused live in its banner slots. Its content lives in `sites/gaming-news.json`, its nav is
 *      the shared buildless orbital nav, and it is generated here so the three pages cannot drift.
 *   2. **A guide someone can follow.** `docs/guide/index.html` is written in both languages from
 *      `guides/using-the-elements.json`: how to run the project, how to lift one element out of it,
 *      how to make a variation bilingual and dual-theme, how to add one, what the gates check, and
 *      how the newsroom is assembled.
 *
 * Both are wiped and rewritten on every sync, exactly like the browse tree: content is data, layout
 * is here, and nothing is hand-edited after the fact.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* ------------------------------------------------------------------ helpers --- */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Persian side of a bilingual pair, for `data-i18n-fa` (the shell swaps it at runtime).
 *
 * Accepts either a `{ en, fa }` pair or the Persian string itself. The first version of this took
 * only pairs, and the embed captions — which pass `something.fa` — silently rendered in English in
 * a Persian page. One helper that cannot be called wrong is worth more than a stricter signature.
 */
const fa = (value) => {
  const text = typeof value === "string" ? value : value && value.fa;
  return text ? ` data-i18n-fa="${esc(text)}"` : "";
};

/**
 * Inline markup inside a bilingual string: `**bold**`, `code`, and `[text](href)`. The guide is
 * written by hand in both languages, and a guide that cannot emphasise or link is a wall of text.
 * Because it is written twice, the same markers have to work on both sides — see `faHtml()`.
 */
function rich(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * The Persian side of a rich string. `data-i18n-fa` is a plain-text attribute, so the live markup
 * travels in `data-i18n-fa-html` instead — escaped, because it is an attribute, but real markup once
 * the shell reads it back. Without this the Persian page showed the Markdown it was written in:
 * backticks around `npm run preview` and asterisks around bold text.
 */
const faHtml = (pair) => (pair && pair.fa ? ` data-i18n-fa-html="${esc(rich(pair.fa))}"` : "");

const isoDate = (value) => value;

function head({ base, title, titleFa, description, descriptionFa, accent, scripts, styles, bodyClass = "" }) {
  const icon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23050506'/%3E%3Cpath d='M8 24V8h3.4v6.2h9.2V8H24v16h-3.4v-6.6h-9.2V24z' fill='%23ff4fd8'/%3E%3C/svg%3E";

  return `<!doctype html>
<html lang="en" dir="ltr" data-title-en="${esc(title)}" data-title-fa="${esc(titleFa || title)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" data-desc-en="${esc(description)}" data-desc-fa="${esc(descriptionFa || description)}" />
    <meta name="theme-color" content="#050506" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />

    <!-- Same pre-paint bootstrap as the rest of the catalogue: the first paint already knows the
         language, the direction and the theme, so nothing flashes the wrong way round. -->
    <script>
      (function () {
        try {
          var params = new URLSearchParams(location.search);
          var stored = function (k) {
            try { return localStorage.getItem(k); } catch (e) { return null; }
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
    <link rel="stylesheet" href="${base}assets/hub.css" />
    <link rel="stylesheet" href="${base}assets/theme.css" />
    <link rel="stylesheet" href="${base}assets/chrome.css" />
${styles.map((href) => `    <link rel="stylesheet" href="${href}" />`).join("\n")}
    <link rel="icon" href="${icon}" />

    <script>
      window.__CATALOG_BASE__ = "${base}";
    </script>
    <script src="${base}data/catalog.js" defer></script>
    <script src="${base}assets/chrome.js" defer></script>
${scripts.map((src) => `    <script src="${src}" defer></script>`).join("\n")}
  </head>

  <body${bodyClass ? ` class="${esc(bodyClass)}"` : ""}${accent ? ` style="--site-accent: ${esc(accent)}"` : ""}>
    <a class="skip" href="#main" data-i18n="skip">Skip to the catalog</a>
`;
}

function foot({ base, note, noteFa, scripts }) {
  return `
    <div data-drawer-host></div>
${scripts.map((src) => `    <script src="${src}" defer></script>`).join("\n")}
  </body>
</html>
`;
}

/**
 * The chrome every composed page shares: the catalogue's own switches (language, theme), a link
 * back to the hub, the download control — built by hand here because a newsroom's navigation is its
 * own, not the catalogue's discipline menus. `chrome.js` still owns the state, the storage and the
 * `[data-i18n]` swapping, so nothing is duplicated, only authored.
 */
function chromeBar({ base, brand, brandFa, sectionsId }) {
  return `    <header class="site__bar">
      <div class="site__bar-row">
        <a class="site__brand" href="${base}index.html">
          <span class="site__brand-dot" aria-hidden="true"></span>
          <span class="site__brand-name"${fa(brandFa)}>${esc(brand)}</span>
        </a>

        <!-- The orbital nav mount: the same buildless component the catalogue's Nav_V02 variation
             ships, so the demo and the variation cannot disagree about how a section menu behaves. -->
        <div class="site__nav" id="${esc(sectionsId)}"></div>

        <div class="site__bar-actions">
          <div class="lang-switch" role="group" data-i18n-aria="language">
            <button type="button" class="lang-switch__button" data-lang="en">EN</button>
            <button type="button" class="lang-switch__button" data-lang="fa">فا</button>
          </div>
          <div class="theme-switch" role="group" data-i18n-aria="theme">
            <button type="button" class="theme-switch__button" data-theme-set="light">
              <span class="theme-switch__glyph" aria-hidden="true">☀</span><span data-i18n="light">Light</span>
            </button>
            <button type="button" class="theme-switch__button" data-theme-set="dark">
              <span class="theme-switch__glyph" aria-hidden="true">☾</span><span data-i18n="dark">Dark</span>
            </button>
          </div>
          <a class="masthead__cta" href="${base}guide/index.html"><span data-i18n="guide">Guide</span> ↗</a>
          <a class="masthead__cta" href="${base}download/catalog-source.zip" download><span data-i18n="download">Download</span> ⤓</a>
        </div>
      </div>
    </header>
`;
}

/**
 * A banner slot that mounts one of the catalogue's variations, live, in an iframe.
 *
 * `docs/framework/**` is generated by `npm run build` and deliberately not committed, so the slot
 * has to survive a clone that has not been built: the frame is probed first (HEAD) and, when the
 * build is absent, the slot says so and links to the source instead of showing a hole.
 */
function embed({ base, src, alt, altFa, caption, captionFa, height }) {
  return `      <figure class="site__embed" data-embed data-src="${base}${esc(src)}" style="--embed-h: ${esc(height || "62svh")}">
        <div class="site__embed-frame" data-embed-frame>
          <p class="site__embed-note"${fa(altFa)}>${esc(alt)}</p>
        </div>
        <figcaption class="site__embed-caption"${fa(captionFa)}>${esc(caption)}</figcaption>
      </figure>`;
}

/* -------------------------------------------------------------- the newsroom --- */

function storyCard(story) {
  return `        <article class="site__card" style="--card-accent: ${esc(story.accent)}">
          <p class="site__card-cat">
            <span${fa(story.category)}>${esc(story.category.en)}</span>
            <span class="site__card-dot" aria-hidden="true">·</span>
            <span class="force-ltr">${esc(story.read.en)}</span>
          </p>
          <h3 class="site__card-title"${fa(story.title)}>${esc(story.title.en)}</h3>
          <p class="site__card-excerpt"${fa(story.excerpt)}>${esc(story.excerpt.en)}</p>
          <p class="site__card-meta">
            <span class="force-ltr">${esc(story.author)}</span>
            <span class="site__card-dot" aria-hidden="true">·</span>
            <span${fa(story.date)}>${esc(story.date.en)}</span>
          </p>
        </article>`;
}

function buildHome({ base, data, stories }) {
  const ticker = data.ticker
    .map((item) => `<span class="site__ticker-item"${fa(item)}>${esc(item.en)}</span><span class="site__ticker-sep" aria-hidden="true">✳</span>`)
    .join("\n        ");

  const reviews = data.reviews
    .map(
      (review) => `          <li class="site__review" style="--card-accent: ${esc(review.accent)}">
            <span class="site__review-score force-ltr">${review.score.toFixed(1)}</span>
            <span class="site__review-title"${fa(review.title)}>${esc(review.title.en)}</span>
            <span class="site__review-verdict"${fa(review.verdict)}>${esc(review.verdict.en)}</span>
          </li>`,
    )
    .join("\n");

  const live = data.live
    .map(
      (row) => `          <li class="site__live-row">
            <span class="site__live-event"${fa(row.event)}>${esc(row.event.en)}</span>
            <span class="site__live-score force-ltr">${esc(row.score)}</span>
            <span class="site__live-status" data-status="${esc(row.status.en)}"${fa(row.status)}>${esc(row.status.en)}</span>
          </li>`,
    )
    .join("\n");

  return `${chromeBar({ base, brand: data.site.name.en, brandFa: data.site.name })}
    <div class="site__ticker" role="marquee" aria-label="Headlines">
        ${ticker}
    </div>

    <main id="main">
      <section class="site__lead">
        <div class="site__lead-copy">
          <p class="site__kicker"${fa(data.lead.kicker)}>${esc(data.lead.kicker.en)}</p>
          <h1 class="site__lead-title"${fa(data.lead.title)}>${esc(data.lead.title.en)}</h1>
          <p class="site__lead-standfirst"${fa(data.lead.standfirst)}>${esc(data.lead.standfirst.en)}</p>
          <p class="site__lead-meta">
            <span${fa(data.lead.byline)}>${esc(data.lead.byline.en)}</span>
            <span class="site__card-dot" aria-hidden="true">·</span>
            <span class="force-ltr">${esc(data.lead.date.en)}</span>
          </p>
        </div>
${embed({
    base,
    src: data.lead.embed,
    alt: data.lead.embedAlt.en,
    altFa: data.lead.embedAlt.fa,
    caption: data.lead.embedAlt.en,
    captionFa: data.lead.embedAlt.fa,
    height: "58svh",
  })}
      </section>

      <section class="site__section" aria-labelledby="site-latest">
        <header class="site__section-head">
          <h2 class="site__section-title" id="site-latest"${fa({ en: "Latest", fa: "تازه‌ها" })}>Latest</h2>
          <a class="site__section-link" href="category.html"${fa({ en: "All stories", fa: "همهٔ خبرها" })}>All stories →</a>
        </header>
        <div class="site__grid">
${stories.map(storyCard).join("\n")}
        </div>
      </section>

      <section class="site__section site__section--split" id="live">
        <div>
          <header class="site__section-head">
            <h2 class="site__section-title"${fa({ en: "Live board", fa: "تابلوی زنده" })}>Live board</h2>
          </header>
          <ul class="site__live">
${live}
          </ul>
        </div>
        <div>
          <header class="site__section-head">
            <h2 class="site__section-title"${fa({ en: "Reviews desk", fa: "میز نقدها" })}>Reviews desk</h2>
          </header>
          <ul class="site__reviews">
${reviews}
          </ul>
        </div>
      </section>
    </main>

    <footer class="site__foot">
      <p${fa(data.site.lede)}>${esc(data.site.lede.en)}</p>
      <p class="site__foot-meta">
        <a href="${base}index.html" data-i18n="backToHub">Back to the hub</a>
        <span aria-hidden="true">·</span>
        <a href="${base}guide/index.html" data-i18n="guide">Guide</a>
        <span aria-hidden="true">·</span>
        <a href="${base}component/game-news-desk/index.html" data-i18n="componentPage">Component page</a>
      </p>
    </footer>
`;
}

function buildCategory({ base, data, stories }) {
  const chips = data.categories
    .map(
      (category, index) => `          <button type="button" class="site__chip${index === 0 ? " is-active" : ""}" data-filter="${esc(category.id)}">
            <span${fa(category.label)}>${esc(category.label.en)}</span>
            <span class="site__chip-count force-ltr">${String(category.count).padStart(2, "0")}</span>
          </button>`,
    )
    .join("\n");

  const rows = stories
    .map(
      (story) => `        <li class="site__row" data-category="${esc(story.tag.en.toLowerCase())}" style="--card-accent: ${esc(story.accent)}">
          <span class="site__row-cat"${fa(story.category)}>${esc(story.category.en)}</span>
          <span class="site__row-title"${fa(story.title)}>${esc(story.title.en)}</span>
          <span class="site__row-excerpt"${fa(story.excerpt)}>${esc(story.excerpt.en)}</span>
          <span class="site__row-meta force-ltr">${esc(story.author)} · ${esc(story.read.en)}</span>
        </li>`,
    )
    .join("\n");

  return `${chromeBar({ base, brand: data.site.name.en, brandFa: data.site.name })}
    <main id="main">
      <header class="site__page-head">
        <p class="site__kicker"${fa({ en: "Section", fa: "بخش" })}>Section</p>
        <h1 class="site__page-title"${fa({ en: "Everything, filtered", fa: "همه‌چیز، فیلترشده" })}>Everything, filtered</h1>
        <p class="site__page-lede"${fa({
          en: "Filtering is not a plugin here: the rows are real markup and the chips are buttons, so the section works before any script runs — and it is keyboard-reachable when it does.",
          fa: "فیلتر اینجا پلاگین نیست: ردیف‌ها مارک‌آپ واقعی‌اند و چیپ‌ها دکمه‌اند، پس بخش پیش از اجرای هر اسکریپتی کار می‌کند — و وقتی اسکریپت آمد، با کیبورد هم در دسترس است.",
        })}>${esc("Filtering is not a plugin here: the rows are real markup and the chips are buttons, so the section works before any script runs — and it is keyboard-reachable when it does.")}</p>
      </header>

${embed({
    base,
    src: "framework/next/hero/particle-morph-field/index.html",
    alt: "Banner slot: the particle-morph hero from the catalogue, mounted live as this section's art.",
    altFa: "جایگاه بنر: هیروی میدان ذرات از کاتالوگ، زنده به‌عنوان هنر این بخش سوار شده.",
    caption: "Banner slot: a catalogue hero, mounted live.",
    captionFa: "جایگاه بنر: یک هیروی کاتالوگ، زنده سوار شده.",
    height: "44svh",
  })}

      <section class="site__section">
        <div class="site__filters" role="group" aria-label="Filter stories">
${chips}
        </div>
        <ul class="site__rows" data-rows>
${rows}
        </ul>
        <p class="site__empty" data-empty hidden${fa({ en: "Nothing in this section yet.", fa: "هنوز چیزی در این بخش نیست." })}>Nothing in this section yet.</p>
      </section>
    </main>

    <footer class="site__foot">
      <p${fa(data.site.tagline)}>${esc(data.site.tagline.en)}</p>
      <p class="site__foot-meta">
        <a href="index.html" data-i18n="home">Catalog</a>
        <span aria-hidden="true">·</span>
        <a href="${base}component/game-news-sections/index.html" data-i18n="componentPage">Component page</a>
      </p>
    </footer>
`;
}

function buildArticle({ base, data }) {
  const article = data.article;
  const body = article.body
    .map((paragraph, index) => {
      const pull =
        index === 1
          ? `\n        <blockquote class="site__pull"${fa(article.pull)}>${esc(article.pull.en)}</blockquote>`
          : "";
      return `        <p${fa(paragraph)}>${esc(paragraph.en)}</p>${pull}`;
    })
    .join("\n");

  const tags = article.tags.map((tag) => `<li class="site__tag force-ltr">${esc(tag.en)}</li>`).join("\n            ");

  return `${chromeBar({ base, brand: data.site.name.en, brandFa: data.site.name })}
    <div class="site__progress" aria-hidden="true"><span data-progress></span></div>

    <main id="main" class="site__article">
      <article>
        <header class="site__page-head">
          <p class="site__kicker"${fa(article.kicker)}>${esc(article.kicker.en)}</p>
          <h1 class="site__page-title site__page-title--long"${fa(article.title)}>${esc(article.title.en)}</h1>
          <p class="site__standfirst"${fa(article.standfirst)}>${esc(article.standfirst.en)}</p>
          <p class="site__page-meta">
            <span${fa(article.byline)}>${esc(article.byline.en)}</span>
            <span class="site__card-dot" aria-hidden="true">·</span>
            <span class="force-ltr">${esc(article.date.en)}</span>
          </p>
        </header>

${embed({
    base,
    src: article.embed,
    alt: "Cover spread: the letterpress hero from the catalogue, mounted live.",
    altFa: "صفحهٔ جلد: هیروی لترپرسِ کاتالوگ، زنده سوار شده.",
    caption: article.embedCaption.en,
    captionFa: article.embedCaption.fa,
    height: "50svh",
  })}

        <div class="site__prose" data-prose>
${body}
        </div>

        <ul class="site__tags">
            ${tags}
        </ul>

        <nav class="site__article-nav" aria-label="More">
          <a href="index.html"${fa({ en: "Back to the desk", fa: "بازگشت به میز" })}>Back to the desk</a>
          <a href="category.html"${fa({ en: "More stories", fa: "خبرهای بیشتر" })}>More stories</a>
        </nav>
      </article>
    </main>

    <footer class="site__foot">
      <p${fa(data.site.lede)}>${esc(data.site.lede.en)}</p>
      <p class="site__foot-meta">
        <a href="${base}component/game-news-longform/index.html" data-i18n="componentPage">Component page</a>
      </p>
    </footer>
`;
}

export async function emitSite({ root, manifest, variations }) {
  const docs = join(root, "docs");
  const data = JSON.parse(await readFile(join(root, "sites", "gaming-news.json"), "utf8"));
  const navItems = data.nav;
  const written = [];

  await rm(join(docs, "sites", "gaming-news"), { recursive: true, force: true });
  const write = async (rel, html) => {
    const target = join(docs, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, html, "utf8");
    written.push(rel);
  };

  // Every story links to the long-form page: a newsroom whose cards go nowhere is a mockup.
  const stories = data.stories.slice(0, 4);
  const allStories = data.stories;

  const base = "../../";
  const shell = (title, titleFa, description, descriptionFa, body, extraStyles = []) =>
    head({
      base,
      title,
      titleFa,
      description,
      descriptionFa,
      styles: [`${base}assets/site.css`, `${base}vanilla/shared/orbital-nav.css`, ...extraStyles],
      scripts: [`${base}vanilla/shared/orbital-nav.js`, `${base}assets/site.js`],
    }) +
    body +
    foot({ base, scripts: [] });

  await write(
    "sites/gaming-news/index.html",
    shell(
      `${data.site.name.en} — ${data.site.tagline.en}`,
      `${data.site.name.fa} — ${data.site.tagline.fa}`,
      data.site.lede.en,
      data.site.lede.fa,
      buildHome({ base, data, stories }),
    ),
  );

  await write(
    "sites/gaming-news/category.html",
    shell(
      `${data.site.name.en} — sections`,
      `${data.site.name.fa} — بخش‌ها`,
      "Every story, filtered by section. Rows are real markup; the chips are buttons.",
      "همهٔ خبرها، فیلترشده بر پایهٔ بخش. ردیف‌ها مارک‌آپ واقعی‌اند و چیپ‌ها دکمه.",
      buildCategory({ base, data, stories: allStories }),
    ),
  );

  await write(
    "sites/gaming-news/article.html",
    shell(
      `${data.article.title.en} — ${data.site.name.en}`,
      `${data.article.title.fa} — ${data.site.name.fa}`,
      data.article.standfirst.en,
      data.article.standfirst.fa,
      buildArticle({ base, data }),
    ),
  );

  // The orbital nav's items come from the site's own JSON, so the menu is content too.
  const navConfig = {
    accent: "#5BFFC8",
    triggerEn: "Sections",
    trigger: { en: "Sections", fa: "بخش‌ها" },
    items: navItems.map((item) => ({
      href: item.href,
      label: item.label,
      meta: item.meta,
      accent: "#5BFFC8",
    })),
  };
  await writeFile(join(docs, "sites", "gaming-news", "nav.json"), JSON.stringify(navConfig, null, 2) + "\n", "utf8");

  return { written, site: data };
}

/* ------------------------------------------------------------------ the guide --- */

export async function emitGuide({ root }) {
  const docs = join(root, "docs");
  const guide = JSON.parse(await readFile(join(root, "guides", "using-the-elements.json"), "utf8"));
  const base = "../";

  await rm(join(docs, "guide"), { recursive: true, force: true });
  await mkdir(join(docs, "guide"), { recursive: true });

  const sections = guide.sections
    .map((section, index) => {
      const steps = (section.steps || []).length
        ? `        <ul class="guide__steps">
${section.steps.map((step) => `          <li><span${faHtml(step)}>${rich(step.en)}</span></li>`).join("\n")}
        </ul>`
        : "";
      const body = (section.body || [])
        .map((paragraph) => `        <p${faHtml(paragraph)}>${rich(paragraph.en)}</p>`)
        .join("\n");
      const code = section.code
        ? `        <pre class="guide__code" tabindex="0" aria-label="Code example"><code>${esc(section.code)}</code></pre>`
        : "";

      return `      <section class="guide__section" id="${esc(section.id)}">
        <div class="guide__section-head">
          <span class="guide__index force-ltr">${String(index + 1).padStart(2, "0")}</span>
          <h2 class="guide__section-title"${fa(section.title)}>${esc(section.title.en)}</h2>
        </div>
${body}
${steps}
${code}
      </section>`;
    })
    .join("\n\n");

  const toc = guide.sections
    .map(
      (section) =>
        `          <li><a href="#${esc(section.id)}"><span${fa(section.title)}>${esc(section.title.en)}</span></a></li>`,
    )
    .join("\n");

  const body = `${chromeBar({
    base,
    brand: guide.meta.title.en,
    brandFa: guide.meta.title,
    sectionsId: "guide-nav",
  })}
    <main id="main" class="guide">
      <header class="guide__head">
        <p class="guide__kicker"${fa({ en: "Handbook", fa: "راهنما" })}>Handbook</p>
        <h1 class="guide__title"${fa(guide.meta.title)}>${esc(guide.meta.title.en)}</h1>
        <p class="guide__lede"${fa(guide.meta.lede)}>${esc(guide.meta.lede.en)}</p>
        <p class="guide__updated force-ltr">${esc(isoDate(guide.meta.updated))}</p>
      </header>

      <div class="guide__layout">
        <nav class="guide__toc" aria-label="Contents">
          <ul>
${toc}
          </ul>
        </nav>

        <div class="guide__body">
${sections}
        </div>
      </div>

      <footer class="guide__foot">
        <a href="${base}index.html" data-i18n="backToHub">Back to the hub</a>
        <a href="${base}sites/gaming-news/index.html"${fa({ en: "The newsroom blueprint", fa: "طرحِ اتاق‌خبر" })}>The newsroom blueprint</a>
        <a href="${base}download/catalog-source.zip" download data-i18n="downloadSource">Project source (ZIP)</a>
      </footer>
    </main>
`;

  await writeFile(
    join(docs, "guide", "index.html"),
    head({
      base,
      title: `${guide.meta.title.en} — The Catalog`,
      titleFa: `${guide.meta.title.fa} — کاتالوگ`,
      description: guide.meta.lede.en,
      descriptionFa: guide.meta.lede.fa,
      styles: [`${base}assets/site.css`],
      scripts: [`${base}assets/site.js`],
      bodyClass: "guide-page",
    }) +
      body +
      foot({ base, scripts: [] }),
    "utf8",
  );

  return { written: ["guide/index.html"], sections: guide.sections.length };
}
