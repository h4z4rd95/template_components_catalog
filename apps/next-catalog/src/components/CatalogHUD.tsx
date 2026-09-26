"use client";

/**
 * CatalogHUD — the metadata heads-up display that wraps every variation.
 *
 * Reads one `Variation` record (from the shared manifest) and renders:
 *   · Component ID + name          · technology stack chips
 *   · aesthetic vibe               · interaction blueprint (what happens on scroll/hover)
 *   · provenance actions (copy ID, view source, open raw, collapse)
 *
 * Behaviour: `H` toggles it, the collapsed state persists in localStorage, and inside an iframe
 * it hands the "expand" affordance to the parent frame instead of fighting for fullscreen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Variation } from "@catalog/shared";
import { appHref, hubHref } from "@/lib/catalog";
import styles from "./CatalogHUD.module.css";

const STORAGE_KEY = "catalog:hud:collapsed";
const GITHUB = "https://github.com/h4z4rd95/template_components_catalog";

export interface CatalogHUDProps {
  variation: Variation;
  /** Rendered as the batch line, e.g. "Batch 01 · Hero". */
  defaultOpen?: boolean;
}

export default function CatalogHUD({ variation, defaultOpen = true }: CatalogHUDProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState<null | "id" | "link">(null);
  const [inIframe, setInIframe] = useState(false);
  const [hub, setHub] = useState("/");
  const [raw, setRaw] = useState("");
  const rootRef = useRef<HTMLElement>(null);

  /* ---------------------------------------------------------------- restore state */
  useEffect(() => {
    setInIframe(window.self !== window.top);
    setHub(hubHref("/"));
    setRaw(appHref(variation));
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setOpen(false);
      else if (stored === "0") setOpen(true);
      else {
        // No stored preference: a 480px-wide panel would eat most of a phone (or a small laptop
        // artwork *is* the content, so start collapsed there. The height threshold is 860px on
    // purpose: the open panel is ~20rem tall, and on anything shorter it would sit on top of
    // the hero copy rather than beside it. A visitor who wants the metadata can still open it.
        if (window.innerWidth < 900 || window.innerHeight < 860) setOpen(false);
      }
    } catch {
      /* private mode — default state is fine */
    }
  }, [variation]);

  const toggle = useCallback((next?: boolean) => {
    setOpen((prev) => {
      const value = next ?? !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, value ? "0" : "1");
      } catch {
        /* ignore */
      }
      return value;
    });
  }, []);

  /* ------------------------------------------------------- keyboard affordances */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === "h" || event.key === "H") toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const copy = useCallback(
    async (kind: "id" | "link") => {
      const value = kind === "id" ? variation.id : window.location.href;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Clipboard API is unavailable over file:// and in some embeds → legacy path.
        const helper = document.createElement("textarea");
        helper.value = value;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        try {
          document.execCommand("copy");
        } catch {
          /* nothing else we can do; the button still reports the attempt */
        }
        helper.remove();
      }
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    },
    [variation.id],
  );

  const expand = useCallback(() => {
    if (inIframe) {
      // The hub listens for this and expands the card into a full-width stage.
      window.parent.postMessage({ type: "catalog:expand", id: variation.id }, "*");
      return;
    }
    const node = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.().catch(() => {});
  }, [inIframe, variation.id]);

  const sourceHref = `${GITHUB}/tree/main/${variation.source}`;
  const badge = useMemo(() => `BATCH ${String(variation.batch).padStart(2, "0")}`, [variation.batch]);

  return (
    <aside
      ref={rootRef}
      className={`${styles.hud} ${open ? "" : styles.collapsed}`}
      style={{ ["--hud-accent" as string]: variation.accent }}
      aria-label={`Metadata for ${variation.id}`}
      data-catalog-hud
    >
      <div className={styles.tab}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.tabId}>{variation.id}</span>
        <button
          type="button"
          className={styles.tabToggle}
          onClick={() => toggle()}
          aria-expanded={open}
          aria-controls="catalog-hud-body"
        >
          {open ? "Hide HUD (H)" : "Show HUD (H)"}
        </button>
      </div>

      <div className={styles.body} id="catalog-hud-body" hidden={!open}>
        <header className={styles.head}>
          <span className={styles.badge}>{badge}</span>
          <span className={styles.discipline}>{variation.discipline}</span>
          <span className={styles.status} data-status={variation.status}>
            {variation.status}
          </span>
        </header>

        <h2 className={styles.id}>{variation.id}</h2>
        <p className={styles.title}>{variation.title}</p>

        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>Stack</dt>
            <dd className={styles.chips}>
              {variation.stack.map((tech) => (
                <span key={tech} className={styles.chip}>
                  {tech}
                </span>
              ))}
            </dd>
          </div>
          <div className={styles.metaRow}>
            <dt>Vibe</dt>
            <dd className={styles.vibe}>{variation.vibe}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>Interaction</dt>
            <dd className={styles.note}>{variation.interaction}</dd>
          </div>
        </dl>

        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => copy("id")}>
            {copied === "id" ? "Copied ✓" : "Copy ID"}
          </button>
          <button type="button" className={styles.action} onClick={() => copy("link")}>
            {copied === "link" ? "Copied ✓" : "Copy link"}
          </button>
          <button type="button" className={styles.action} onClick={expand}>
            {inIframe ? "Expand" : "Fullscreen"}
          </button>
          <a className={styles.action} href={sourceHref} target="_blank" rel="noreferrer noopener">
            Source ↗
          </a>
          <a className={styles.action} href={hub}>
            Hub ↩
          </a>
          {inIframe ? (
            <a className={styles.action} href={raw || variation.href} target="_blank" rel="noreferrer noopener">
              Raw ↗
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
