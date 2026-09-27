"use client";

/**
 * skin.ts — the variation-side half of the shell contract.
 *
 * The catalogue shell (docs/assets/chrome.js) owns language, direction and theme for the whole
 * site. A variation renders inside an iframe and therefore cannot see any of that state, so the
 * shell hands it over twice:
 *
 *   1. **On load**, through the same `localStorage` keys the shell persists (`catalog:locale`,
 *      `catalog:theme`) plus the `?lang=` / `?theme=` parameters — which is what makes a *reload*
 *      of the frame land in the right skin.
 *   2. **On every change**, through a `postMessage` of `{ type: "catalog:skin", locale, theme,
 *      dir }`. The shell broadcasts to any `iframe[data-catalog-frame]`, which the hub's card
 *      frames and the component page's stage both set.
 *
 * A variation that uses this hook is therefore bilingual and dual-theme without knowing anything
 * about the catalogue, and it still renders correctly when it is opened *raw* — on its own URL,
 * outside any frame — because the stored values are the same ones the shell wrote.
 */
import { useEffect, useState } from "react";

export type Locale = "en" | "fa";
export type Theme = "dark" | "light";

export interface Skin {
  locale: Locale;
  theme: Theme;
  dir: "ltr" | "rtl";
}

const DEFAULT_SKIN: Skin = { locale: "en", theme: "dark", dir: "ltr" };

/** A string that exists in both catalogue languages. */
export interface Bilingual {
  en: string;
  fa: string;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode, or a sandboxed frame
  }
}

function prefersLight(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** The skin as it stands right now: query string first, then what the shell stored, then system. */
export function readSkin(): Skin {
  if (typeof window === "undefined") return DEFAULT_SKIN;
  const params = new URLSearchParams(window.location.search);

  const localeParam = params.get("lang") || readStored("catalog:locale") || "en";
  const locale: Locale = localeParam === "fa" ? "fa" : "en";

  const themeParam = params.get("theme") || readStored("catalog:theme");
  const theme: Theme = themeParam === "light" || themeParam === "dark" ? themeParam : prefersLight() ? "light" : "dark";

  return { locale, theme, dir: locale === "fa" ? "rtl" : "ltr" };
}

/**
 * Follows the shell for as long as the variation is mounted. The first render is always the
 * default skin — server and client must agree — and the real one arrives in the effect, which is
 * also what keeps a static export from flashing the wrong language into the HTML.
 */
export function useCatalogSkin(): Skin {
  const [skin, setSkin] = useState<Skin>(DEFAULT_SKIN);

  useEffect(() => {
    setSkin(readSkin());

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as Partial<Skin> & { type?: string };
      if (!payload || payload.type !== "catalog:skin") return;
      const locale: Locale = payload.locale === "fa" ? "fa" : "en";
      const theme: Theme = payload.theme === "light" ? "light" : "dark";
      setSkin({ locale, theme, dir: locale === "fa" ? "rtl" : "ltr" });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return skin;
}

/** Pick one side of a bilingual pair. `lex(pair, "fa")` — short on purpose, it is everywhere. */
export function lex(pair: Bilingual, locale: Locale): string {
  return locale === "fa" ? pair.fa : pair.en;
}

/**
 * The document-level half: sets `dir`, `data-theme` and `lang` on the variation's own root element
 * (via the returned attributes) **and** on `<html>`, so the CSS can do day/night and RTL with
 * ordinary selectors.
 *
 * The `<html>` half is not decoration: the app's `globals.css` paints the document background and
 * sets the scrollbar colour from these attributes, and a light-mode variation sitting on a dark
 * canvas shows at the seams — the overscroll edge, the area under a short page. It restores what
 * was there on unmount, because the frame can be re-mounted by the hub's stage.
 */
export function useSkinDocument(skin: Skin, canvas?: { dark: string; light: string }): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    // The canvas is the variation's own colour, passed in so the shell never guesses: it is what
    // shows at the overscroll edge and under a page shorter than the viewport.
    const body = document.body;
    const canvasBefore = body.style.background;
    const before = {
      dir: root.getAttribute("dir"),
      lang: root.getAttribute("lang"),
      theme: root.getAttribute("data-theme"),
      locale: root.getAttribute("data-locale"),
    };

    root.setAttribute("dir", skin.dir);
    root.setAttribute("lang", skin.locale);
    root.setAttribute("data-theme", skin.theme);
    root.setAttribute("data-locale", skin.locale);
    if (canvas) body.style.background = skin.theme === "light" ? canvas.light : canvas.dark;

    return () => {
      body.style.background = canvasBefore;
      for (const [key, value] of Object.entries(before)) {
        if (value === null) root.removeAttribute(key);
        else root.setAttribute(key, value);
      }
    };
  }, [skin.dir, skin.locale, skin.theme, canvas?.dark, canvas?.light]);
}

/**
 * Convenience: the attributes for the variation's root element. Spread them, so the CSS can scope
 * itself to the variation and stay independent of whatever the host document is doing.
 */
export function skinAttributes(skin: Skin): {
  dir: "ltr" | "rtl";
  lang: Locale;
  "data-theme": Theme;
  "data-locale": Locale;
} {
  return { dir: skin.dir, lang: skin.locale, "data-theme": skin.theme, "data-locale": skin.locale };
}
