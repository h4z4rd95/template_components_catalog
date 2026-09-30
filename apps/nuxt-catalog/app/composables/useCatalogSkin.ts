/**
 * useCatalogSkin — the Nuxt track's half of the shell contract, the twin of the React
 * `src/lib/skin.ts`.
 *
 * The catalogue shell (docs/assets/chrome.js) owns language, direction and theme for the whole
 * site. A variation renders inside an `iframe` and cannot see any of that state, so the shell
 * hands it over twice:
 *
 *   1. **On load**, through the same `localStorage` keys the shell persists (`catalog:locale`,
 *      `catalog:theme`) plus the `?lang=` / `?theme=` parameters — which is what makes a reload of
 *      the frame land in the right skin.
 *   2. **On every change**, through a `postMessage` of `{ type: "catalog:skin", locale, theme, dir }`
 *      to every `iframe[data-catalog-frame]`.
 *
 * A variation that reads this composable is therefore bilingual and dual-theme without knowing
 * anything about the catalogue — and it still renders correctly when opened raw, on its own URL,
 * outside any frame, because the stored values are the same ones the shell wrote.
 */
export type Locale = "en" | "fa";
export type Theme = "dark" | "light";

export interface Skin {
  locale: Locale;
  theme: Theme;
  dir: "ltr" | "rtl";
}

const DEFAULT_SKIN: Skin = { locale: "en", theme: "dark", dir: "ltr" };

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode, or a sandboxed frame
  }
}

/** Query string first, then what the shell stored, then the system preference. */
function readSkin(): Skin {
  if (typeof window === "undefined") return DEFAULT_SKIN;
  const params = new URLSearchParams(window.location.search);

  const localeParam = params.get("lang") || readStored("catalog:locale") || "en";
  const locale: Locale = localeParam === "fa" ? "fa" : "en";

  const themeParam = params.get("theme") || readStored("catalog:theme");
  const prefersLight =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme: Theme =
    themeParam === "light" || themeParam === "dark" ? themeParam : prefersLight ? "light" : "dark";

  return { locale, theme, dir: locale === "fa" ? "rtl" : "ltr" };
}

/**
 * The document half: puts `dir`, `lang` and `data-theme` on `<html>` so ordinary CSS selectors
 * work — including the day palette in `main.css`, which is keyed on `[data-theme="light"]`.
 * Restored on unmount because the hub's stage can re-mount a frame.
 */
function paintDocument(skin: Skin) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = skin.theme;
  root.dataset.locale = skin.locale;
  root.lang = skin.locale === "fa" ? "fa" : "en";
  root.dir = skin.dir;
}

export function useCatalogSkin() {
  const skin = useState<Skin>("catalog-skin", () => DEFAULT_SKIN);

  onMounted(() => {
    skin.value = readSkin();
    paintDocument(skin.value);

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as Partial<Skin> & { type?: string };
      if (!payload || payload.type !== "catalog:skin") return;
      const locale: Locale = payload.locale === "fa" ? "fa" : "en";
      const theme: Theme = payload.theme === "light" ? "light" : "dark";
      skin.value = { locale, theme, dir: locale === "fa" ? "rtl" : "ltr" };
      paintDocument(skin.value);
    };

    window.addEventListener("message", onMessage);
    onUnmounted(() => window.removeEventListener("message", onMessage));
  });

  return skin;
}
