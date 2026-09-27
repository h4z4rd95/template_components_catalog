"use client";

/**
 * Nav_V01_MegaMenuCommand
 * ───────────────────────
 * Aesthetic : Cyberpunk / High-Density UI · Kinetic Typography
 * Stack     : Next.js 16 · React 19 · Motion (layout + stagger) · CSS Grid · pointer intent
 *
 * What actually happens
 *  1. The bar is a command line, not a list: each discipline is a trigger whose panel drops from
 *     the bar with a `clip-path` wipe while the discipline's name re-assembles letter by letter —
 *     the label is the transition, so opening a menu already reads as motion.
 *  2. Opening is intent-driven: hover or keyboard focus opens, and the panel closes 240 ms after
 *     the pointer leaves the whole nav — long enough to cross the gap, short enough to feel alive.
 *     Once a visitor has opened one group they can sweep horizontally and the panels swap in place.
 *  3. ⌘K / Ctrl+K (or the pill) raises the command palette: every discipline, topic and component
 *     in the catalogue, filtered as you type, ←↑↓→ + Enter to travel. The menu and the palette
 *     read the same model, so they can never disagree about what the catalogue holds.
 *  4. Under 880 px the triggers collapse into one button and the same groups become a full-height
 *     sheet with accordions — the desktop model, not a reduced one.
 *
 * Shell contract: language, direction and theme come from `useCatalogSkin()`, so this variation is
 * bilingual (en/fa), RTL-aware and dual-theme, and still correct when opened raw on its own URL.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { buildMenu, buildPalette, type MenuLink } from "./menu";
import { hubHref } from "@/lib/catalog";
import { lex, skinAttributes, useCatalogSkin, useSkinDocument } from "@/lib/skin";
import styles from "./mega-menu-command.module.css";

/** Words a bilingual UI needs that the catalogue manifest does not carry. */
const COPY = {
  sections: { en: "Sections", fa: "بخش‌ها" },
  menu: { en: "Menu", fa: "منو" },
  close: { en: "Close", fa: "بستن" },
  command: { en: "Command", fa: "فرمان" },
  search: { en: "Search the catalogue", fa: "جست‌وجو در کاتالوگ" },
  topics: { en: "Topics", fa: "موضوع‌ها" },
  components: { en: "Components", fa: "کامپوننت‌ها" },
  openDiscipline: { en: "Open the discipline page", fa: "باز کردن صفحهٔ دیسیپلین" },
  noResults: { en: "Nothing matches that — try “hero”, “gpu” or “checkout”.", fa: "چیزی پیدا نشد — «قهرمان»، «گرافیک» یا «پرداخت» را امتحان کنید." },
  hint: { en: "↑↓ to move · ⏎ to open · esc to close", fa: "↑↓ حرکت · ⏎ باز کردن · esc بستن" },
  more: { en: "More", fa: "بیشتر" },
  overflowTitle: { en: "Also in the catalogue", fa: "همچنین در کاتالوگ" },
  reel: { en: "Vision reel", fa: "گالری حرکتی" },
  hub: { en: "The hub", fa: "کاتالوگ" },
} as const;

export default function MegaMenuCommand() {
  const skin = useCatalogSkin();
  // The variation owns its canvas colours; the shell only carries the choice of day or night.
  useSkinDocument(skin, { dark: "#07070c", light: "#f6f5f1" });
  const reduced = useReducedMotion();
  const groups = useMemo(() => buildMenu(), []);
  const palette = useMemo(() => buildPalette(), []);

  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [overflowed, setOverflowed] = useState<string[]>([]);

  const navRef = useRef<HTMLElement | null>(null);
  const triggerRowRef = useRef<HTMLElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(groups.length);
  const closeTimer = useRef<number | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  const openGroup = groups.find((group) => group.id === openId) ?? null;
  const overflowGroups = groups.filter((group) => overflowed.includes(group.id));
  const t = useCallback((pair: { en: string; fa: string }) => lex(pair, skin.locale), [skin.locale]);

  /* ------------------------------------------------------------------ behaviour */

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenId(null), 240);
  }, [cancelClose]);

  const closeNow = useCallback(
    (restoreFocus = false) => {
      cancelClose();
      setOpenId(null);
      if (restoreFocus && lastTrigger.current) lastTrigger.current.focus();
    },
    [cancelClose],
  );

  /**
   * How many discipline triggers fit in the row — measured, not guessed.
   *
   * Eight disciplines with two-line labels do not fit a laptop bar, and the failure mode is silent:
   * `overflow: clip` simply cut "App & Dashboard" off the trailing edge, in the DOM and out of
   * reach. So the row measures itself (and re-measures when fonts land and on every resize, because
   * Persian labels are not the same width as English ones) and hands whatever does not fit to a
   * "More" trigger, which opens the same panels by another route.
   */
  useLayoutEffect(() => {
    const row = triggerRowRef.current;
    if (!row) return;

    const measure = () => {
      const triggers = [...row.querySelectorAll<HTMLElement>("[data-trigger]")];
      const more = row.querySelector<HTMLElement>("[data-more-trigger]");
      if (!triggers.length) return;

      // Everything visible first: the row has to be measurable at its widest before deciding.
      triggers.forEach((el) => el.style.removeProperty("display"));
      more?.style.removeProperty("display");

      const gap = parseFloat(getComputedStyle(row).columnGap || "0") || 0;
      const available = row.clientWidth;
      const moreWidth = more ? more.offsetWidth + gap : 0;
      let used = 0;
      let fits = triggers.length;

      for (let index = 0; index < triggers.length; index += 1) {
        const width = triggers[index].offsetWidth + (index ? gap : 0);
        // The last trigger the visitor can see decides whether "More" is needed at all.
        if (used + width > available - (index < triggers.length - 1 ? moreWidth : 0)) {
          fits = index;
          break;
        }
        used += width;
      }

      const hidden = triggers.slice(fits);
      hidden.forEach((el) => el.style.setProperty("display", "none"));
      if (more) more.style.setProperty("display", hidden.length ? "inline-flex" : "none");
      if (hidden.length) setVisibleCount(fits);
      else setVisibleCount(triggers.length);
      setOverflowed(hidden.map((el) => el.dataset.trigger ?? "").filter(Boolean));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(document.documentElement);
    // Persian labels arrive with the webfont; measuring before that would fit the wrong number.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [groups.length, skin.locale]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes whatever is on top; ⌘K / Ctrl+K raises the palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key !== "Escape") return;
      if (paletteOpen) setPaletteOpen(false);
      else if (sheetOpen) setSheetOpen(false);
      else if (openId) closeNow(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen, sheetOpen, openId, closeNow]);

  // A horizontal sweep swaps panels without closing: that is the whole point of a mega-menu.
  const sweep = (current: string, step: number) => {
    const index = groups.findIndex((group) => group.id === current);
    const next = groups[(index + step + groups.length) % groups.length];
    setOpenId(next.id);
    triggerRefs.current[next.id]?.focus();
  };

  const onTriggerKey = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      sweep(id, skin.dir === "rtl" ? -1 : 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      sweep(id, skin.dir === "rtl" ? 1 : -1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpenId(id);
      window.requestAnimationFrame(() => {
        const first = navRef.current?.querySelector<HTMLAnchorElement>("[data-panel] a[href]");
        first?.focus();
      });
    }
  };

  // The spotlight follows the pointer across the panel: light, not a spotlight timer.
  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);

  return (
    <div className={styles.root} {...skinAttributes(skin)}>
      <div className={styles.atmosphere} aria-hidden="true">
        <span className={styles.grid} />
        <span className={styles.auroraA} />
        <span className={styles.auroraB} />
      </div>

      {/* ------------------------------------------------------------------ the bar */}
      <header
        className={`${styles.bar} ${scrolled ? styles.barScrolled : ""}`}
        ref={navRef}
        onPointerLeave={closeSoon}
        onPointerEnter={cancelClose}
        onFocus={cancelClose}
      >
        <div className={styles.barRow}>
          <a className={styles.brand} href={hubHref("/")}>
            <span className={styles.brandDot} aria-hidden="true" />
            <span className={styles.brandName}>{lex({ en: "NORTHBOUND", fa: "نورث‌باند" }, skin.locale)}</span>
            <span className={styles.brandTag}>{lex({ en: "index", fa: "فهرست" }, skin.locale)}</span>
          </a>

          <nav className={styles.triggers} aria-label={t(COPY.sections)} ref={triggerRowRef}>
            {groups.map((group) => {
              const isOpen = openId === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  data-trigger={group.id}
                  ref={(node) => {
                    triggerRefs.current[group.id] = node;
                  }}
                  className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""}`}
                  aria-expanded={isOpen}
                  aria-haspopup="true"
                  aria-controls={`panel-${group.id}`}
                  data-open={isOpen || undefined}
                  onPointerEnter={() => {
                    cancelClose();
                    setOpenId(group.id);
                  }}
                  onFocus={(event) => {
                    lastTrigger.current = event.currentTarget;
                    setOpenId(group.id);
                  }}
                  onClick={() => (isOpen ? closeNow() : setOpenId(group.id))}
                  onKeyDown={(event) => onTriggerKey(event, group.id)}
                >
                  <span className={styles.triggerIndex} aria-hidden="true">
                    {group.index}
                  </span>
                  <span className={styles.triggerLabel}>{lex(group.label, skin.locale)}</span>
                  <span className={styles.triggerCount} aria-hidden="true">
                    {String(group.count).padStart(2, "0")}
                  </span>
                </button>
              );
            })}

            {/* Only rendered when the row is too narrow — and then it is the only way to those
                panels, so it opens them rather than merely linking to their pages. */}
            <button
              type="button"
              data-more-trigger=""
              className={`${styles.trigger} ${openId === "__more" ? styles.triggerOpen : ""}`}
              aria-expanded={openId === "__more"}
              aria-haspopup="true"
              aria-controls="panel-more"
              style={{ display: "none" }}
              onPointerEnter={() => {
                cancelClose();
                setOpenId("__more");
              }}
              onFocus={(event) => {
                lastTrigger.current = event.currentTarget;
                setOpenId("__more");
              }}
              onClick={() => (openId === "__more" ? closeNow() : setOpenId("__more"))}
            >
              <span className={styles.triggerLabel}>{t(COPY.more)}</span>
              <span className={styles.triggerCount} aria-hidden="true">
                {String(Math.max(0, groups.length - visibleCount)).padStart(2, "0")}
              </span>
            </button>
          </nav>

          <div className={styles.barActions}>
            <button type="button" className={styles.commandPill} onClick={() => setPaletteOpen(true)}>
              <span className={styles.commandGlyph} aria-hidden="true">
                ⌘
              </span>
              <span className={styles.commandText}>{t(COPY.command)}</span>
              <span className={styles.commandKey} aria-hidden="true">
                K
              </span>
            </button>
            <button
              type="button"
              className={styles.sheetButton}
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen((open) => !open)}
            >
              <span className={styles.sheetGlyph} aria-hidden="true">
                <span />
                <span />
              </span>
              {sheetOpen ? t(COPY.close) : t(COPY.menu)}
            </button>
          </div>
        </div>

        {/* -------------------------------------------------------- the overflow panel */}
        <AnimatePresence initial={false}>
          {openId === "__more" && overflowGroups.length > 0 && (
            <motion.div
              id="panel-more"
              data-panel=""
              className={styles.panel}
              initial={reduced ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, clipPath: "inset(0 0 0% 0)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: reduced ? 0.15 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className={styles.panelHead}>
                <p className={styles.panelKicker}>
                  <span className={styles.panelIndex}>{String(overflowGroups.length).padStart(2, "0")}</span>
                  <span>{t(COPY.overflowTitle)}</span>
                </p>
                <h2 className={styles.panelTitle}>{t(COPY.more)}</h2>
                <p className={styles.panelBlurb}>
                  {lex(
                    {
                      en: "These disciplines do not fit on this screen width. Opening one shows its full panel; the ↗ opens its page.",
                      fa: "این رشته‌ها در این عرض جا نمی‌شوند. با باز کردن هر کدام پنل کاملش می‌آید و ↗ صفحهٔ آن را باز می‌کند.",
                    },
                    skin.locale,
                  )}
                </p>
              </div>
              <div className={styles.panelColumns}>
                <section className={styles.panelColumn}>
                  <p className={styles.columnTitle}>
                    {t(COPY.sections)} <span className={styles.columnCount}>{String(overflowGroups.length).padStart(2, "0")}</span>
                  </p>
                  <ul className={styles.linkList}>
                    {overflowGroups.map((group) => (
                      <li key={group.id} className={styles.moreRow}>
                        <button
                          type="button"
                          className={styles.link}
                          style={{ ["--link-accent" as string]: group.links[0]?.accent ?? "var(--accent)" }}
                          onClick={() => setOpenId(group.id)}
                        >
                          <span className={styles.linkBar} aria-hidden="true" />
                          <span className={styles.linkLabel}>{lex(group.label, skin.locale)}</span>
                          <span className={styles.linkNote}>{lex(group.blurb, skin.locale).slice(0, 28)}…</span>
                        </button>
                        <a className={styles.moreLink} href={group.href} aria-label={lex(group.label, skin.locale)}>
                          ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ------------------------------------------------------------- the panels */}
        <AnimatePresence mode="popLayout" initial={false}>
          {openGroup && (
            <motion.div
              key={openGroup.id}
              id={`panel-${openGroup.id}`}
              data-panel=""
              className={styles.panel}
              initial={reduced ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, clipPath: "inset(0 0 0% 0)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: reduced ? 0.15 : 0.42, ease: [0.16, 1, 0.3, 1] }}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                spotX.set(event.clientX - rect.left);
                spotY.set(event.clientY - rect.top);
              }}
            >
              <motion.span className={styles.panelGlow} style={{ left: spotX, top: spotY }} aria-hidden="true" />

              <motion.div
                className={styles.panelHead}
                initial="closed"
                animate="open"
                variants={
                  reduced
                    ? { open: {}, closed: {} }
                    : { open: { transition: { staggerChildren: 0.018, delayChildren: 0.06 } }, closed: {} }
                }
              >
                <p className={styles.panelKicker}>
                  <span className={styles.panelIndex}>{openGroup.index}</span>
                  <span>{lex({ en: "discipline", fa: "دیسیپلین" }, skin.locale)}</span>
                </p>
                <h2 className={styles.panelTitle} aria-label={lex(openGroup.label, skin.locale)}>
                  {[...lex(openGroup.label, skin.locale)].map((char, index) => (
                    <motion.span
                      key={`${char}-${index}`}
                      aria-hidden="true"
                      className={styles.panelChar}
                      variants={reduced ? {} : { closed: { y: "0.5em", opacity: 0 }, open: { y: 0, opacity: 1 } }}
                      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {char === " " ? "\u00a0" : char}
                    </motion.span>
                  ))}
                </h2>
                <p className={styles.panelBlurb}>{lex(openGroup.blurb, skin.locale)}</p>
                <motion.a
                  className={styles.panelCta}
                  href={openGroup.href}
                  initial={reduced ? {} : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12, duration: 0.4 }}
                >
                  {t(COPY.openDiscipline)} <span aria-hidden="true">↗</span>
                </motion.a>
              </motion.div>

              <div className={styles.panelColumns}>
                <section className={styles.panelColumn}>
                  <p className={styles.columnTitle}>
                    {t(COPY.topics)} <span className={styles.columnCount}>{String(openGroup.topics.length).padStart(2, "0")}</span>
                  </p>
                  <ul className={styles.linkList}>
                    {openGroup.topics.map((topic, index) => (
                      <MenuRow key={topic.id} link={topic} locale={skin.locale} index={index} reduced={!!reduced} />
                    ))}
                  </ul>
                </section>

                <section className={styles.panelColumn}>
                  <p className={styles.columnTitle}>
                    {t(COPY.components)} <span className={styles.columnCount}>{String(openGroup.links.length).padStart(2, "0")}</span>
                  </p>
                  <ul className={styles.linkList}>
                    {openGroup.links.map((link, index) => (
                      <MenuRow key={link.id} link={link} locale={skin.locale} index={index} reduced={!!reduced} />
                    ))}
                  </ul>
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ------------------------------------------------------------------- demo */}
      <main className={styles.demo} id="top">
        <p className={styles.demoKicker}>{lex({ en: "Navigation system · nav / mega-menu command", fa: "سیستم ناوبری · ناوبری / مگا-منوی فرمان" }, skin.locale)}</p>
        <h1 className={styles.demoTitle}>
          {lex({ en: "The menu is the", fa: "منو همان" }, skin.locale)}{" "}
          <em className={styles.demoEm}>{lex({ en: "interface.", fa: "رابط است." }, skin.locale)}</em>
        </h1>
        <p className={styles.demoLede}>
          {lex(
            {
              en: "Hover a section — the panel wipes down, the label re-assembles, and every link lands on a page that actually exists. Sweep sideways to swap panels without closing. Then press ⌘K.",
              fa: "روی یک بخش بروید — پنل پایین می‌آید، عنوان حرف‌به‌حرف ساخته می‌شود و هر لینک به صفحه‌ای واقعی می‌رسد. برای عوض کردن پنل‌ها بدون بستن، افقی حرکت کنید. بعد ⌘K را بزنید.",
            },
            skin.locale,
          )}
        </p>
        <div className={styles.demoMeta}>
          <span>{lex({ en: "pointer intent 240 ms", fa: "قصد اشاره‌گر ۲۴۰ms" }, skin.locale)}</span>
          <span>{lex({ en: "keyboard: ← → ↑ ↓ ⏎ esc", fa: "کیبورد: ← → ↑ ↓ ⏎ esc" }, skin.locale)}</span>
          <span>{lex({ en: "palette: ⌘K / ctrl+K", fa: "پالت: ⌘K / ctrl+K" }, skin.locale)}</span>
        </div>

        <div className={styles.demoBlocks}>
          {[0, 1, 2].map((block) => (
            <article key={block} className={styles.demoBlock}>
              <span className={styles.demoBlockNum}>{String(block + 1).padStart(2, "0")}</span>
              <h2 className={styles.demoBlockTitle}>
                {lex(
                  [
                    { en: "Content you can scroll under it", fa: "محتوایی که زیرش اسکرول می‌شود" },
                    { en: "Every link is a real page", fa: "هر لینک یک صفحهٔ واقعی است" },
                    { en: "One model, two surfaces", fa: "یک مدل، دو سطح" },
                  ][block],
                  skin.locale,
                )}
              </h2>
              <p className={styles.demoBlockBody}>
                {lex(
                  [
                    {
                      en: "The bar is fixed and condenses on scroll, so the navigation is always one gesture away without stealing the page.",
                      fa: "نوار ثابت است و با اسکرول جمع می‌شود؛ ناوبری همیشه یک حرکت فاصله دارد، بدون دزدیدن صفحه.",
                    },
                    {
                      en: "Menu links resolve to the catalogue's generated component pages — id, stack, blueprint and a live stage each.",
                      fa: "لینک‌های منو به صفحه‌های تولیدشدهٔ کاتالوگ می‌رسند — شناسه، پشته، نقشهٔ تعامل و استیج زنده.",
                    },
                    {
                      en: "The mega-menu and the ⌘K palette are built from the same manifest, so they cannot drift apart.",
                      fa: "مگا-منو و پالت ⌘K از یک مانیفست ساخته می‌شوند، پس نمی‌توانند از هم جدا بیفتند.",
                    },
                  ][block],
                  skin.locale,
                )}
              </p>
            </article>
          ))}
        </div>
      </main>

      {/* --------------------------------------------------------------- the sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            className={styles.sheet}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={t(COPY.menu)}
          >
            <div className={styles.sheetHead}>
              <p className={styles.sheetTitle}>{t(COPY.sections)}</p>
              <button type="button" className={styles.sheetClose} onClick={() => setSheetOpen(false)} autoFocus>
                {t(COPY.close)} ✕
              </button>
            </div>
            <div className={styles.sheetBody}>
              {groups.map((group) => (
                <section key={group.id} className={styles.sheetSection}>
                  <h3 className={styles.sheetSectionTitle}>
                    <span className={styles.sheetIndex}>{group.index}</span>
                    {lex(group.label, skin.locale)}
                  </h3>
                  <ul className={styles.sheetLinks}>
                    {[...group.topics, ...group.links].map((link) => (
                      <li key={link.id}>
                        <a className={styles.sheetLink} href={link.href} style={{ ["--link-accent" as string]: link.accent }}>
                          <span className={styles.sheetLinkLabel}>{lex(link.label, skin.locale)}</span>
                          {link.note && <span className={styles.sheetLinkNote}>{lex(link.note, skin.locale)}</span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- the palette */}
      <AnimatePresence>
        {paletteOpen && (
          <CommandPalette
            entries={palette}
            locale={skin.locale}
            onClose={() => setPaletteOpen(false)}
            copy={{ search: t(COPY.search), noResults: t(COPY.noResults), hint: t(COPY.hint), command: t(COPY.command) }}
            reduced={!!reduced}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ sub-components */

function MenuRow({ link, locale, index, reduced }: { link: MenuLink; locale: "en" | "fa"; index: number; reduced: boolean }) {
  return (
    <motion.li
      initial={reduced ? {} : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : 0.05 + index * 0.03, duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
    >
      <a className={styles.link} href={link.href} style={{ ["--link-accent" as string]: link.accent }}>
        <span className={styles.linkBar} aria-hidden="true" />
        <span className={styles.linkLabel}>{lex(link.label, locale)}</span>
        {link.note && <span className={styles.linkNote}>{lex(link.note, locale)}</span>}
        <span className={styles.linkArrow} aria-hidden="true">
          ↗
        </span>
      </a>
    </motion.li>
  );
}

function CommandPalette({
  entries,
  locale,
  onClose,
  copy,
  reduced,
}: {
  entries: { id: string; label: { en: string; fa: string }; kind: { en: string; fa: string }; href: string; keywords: string }[];
  locale: "en" | "fa";
  onClose: () => void;
  copy: { search: string; noResults: string; hint: string; command: string };
  reduced: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? entries.filter((entry) => needle.split(/\s+/).every((word) => entry.keywords.includes(word)))
      : entries;
    return pool.slice(0, 40);
  }, [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  // Keep the highlighted row visible while the cursor travels with the arrow keys.
  useEffect(() => {
    const row = listRef.current?.children[cursor] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const target = results[cursor];
      if (target) window.location.href = target.href;
    }
  };

  return (
    <motion.div
      className={styles.paletteBackdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={copy.command}
    >
      <motion.div
        className={styles.palette}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.paletteField}>
          <span className={styles.paletteGlyph} aria-hidden="true">
            ⌘
          </span>
          <input
            ref={inputRef}
            className={styles.paletteInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={copy.search}
            aria-label={copy.search}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.paletteEsc}>esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className={styles.paletteEmpty}>{copy.noResults}</p>
        ) : (
          <ul className={styles.paletteList} ref={listRef} role="listbox">
            {results.map((entry, index) => (
              <li key={entry.id}>
                <a
                  className={`${styles.paletteRow} ${index === cursor ? styles.paletteRowActive : ""}`}
                  href={entry.href}
                  role="option"
                  aria-selected={index === cursor}
                  onPointerEnter={() => setCursor(index)}
                  onFocus={() => setCursor(index)}
                >
                  <span className={styles.paletteRowLabel}>{lex(entry.label, locale)}</span>
                  <span className={styles.paletteRowKind}>{lex(entry.kind, locale)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className={styles.paletteHint}>{copy.hint}</p>
      </motion.div>
    </motion.div>
  );
}
