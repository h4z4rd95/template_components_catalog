/**
 * split.ts — a framework-agnostic kinetic text engine (the moral equivalent of GSAP SplitText,
 * which is free in the public npm package since 3.13, but we also need a dependency-free
 * version for the vanilla/Nuxt track).
 *
 * Accessibility is baked in, not bolted on: the animated spans are `aria-hidden` and the original
 * string is preserved in a visually-hidden `<span>` so screen readers hear the sentence, not letters.
 *
 *   const split = splitText(el, { by: "chars", stagger: 0.03 });
 *   split.targets          // HTMLElement[] — feed these to GSAP / Motion / WAAPI
 *   split.revert()         // restore the original DOM exactly
 *   split.words / lines    // the word & line wrappers, for line-clip reveals
 */

export type SplitBy = "chars" | "words" | "lines" | "words-and-chars";

export interface SplitOptions {
  by?: SplitBy;
  /** CSS class applied to every animated leaf span. */
  className?: string;
  /** Keeps spaces as real text nodes so inline layout behaves. Default true. */
  preserveSpaces?: boolean;
  /** aria text used by the screen-reader-only mirror. Defaults to the element's textContent. */
  ariaText?: string;
}

export interface SplitResult {
  /** Leaf spans — what you actually animate. */
  targets: HTMLElement[];
  /** Word wrappers (useful for masks/overflow hidden line reveals). */
  words: HTMLElement[];
  /** Line wrappers — only populated when `by` includes "lines". */
  lines: HTMLElement[];
  /** The visually hidden full sentence for assistive tech. */
  srMirror: HTMLElement | null;
  /** Restores the original innerHTML and removes every generated node. */
  revert: () => void;
  /** Re-runs the split against new content (used by the cyber typewriter). */
  refresh: (html?: string) => void;
}

const SR_ONLY: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: "0",
};

const isBrowser = typeof document !== "undefined";

/** Groups nodes into visual lines by comparing their vertical offset. */
function groupIntoLines(nodes: HTMLElement[]): HTMLElement[][] {
  const lines: HTMLElement[][] = [];
  let currentTop: number | null = null;
  for (const node of nodes) {
    const top = node.offsetTop;
    if (currentTop === null || Math.abs(top - currentTop) > 4) {
      lines.push([node]);
      currentTop = top;
    } else {
      // `noUncheckedIndexedAccess` is on for every app in this repo: read the line, then push.
      const line = lines[lines.length - 1];
      if (line) line.push(node);
    }
  }
  return lines;
}

export function splitText(element: HTMLElement, options: SplitOptions = {}): SplitResult {
  const { by = "chars", className = "split-unit", preserveSpaces = true, ariaText } = options;

  const originalHTML = element.innerHTML;
  const source = ariaText ?? element.textContent ?? "";
  const targets: HTMLElement[] = [];
  const words: HTMLElement[] = [];
  const lines: HTMLElement[] = [];
  let srMirror: HTMLElement | null = null;

  if (!isBrowser) {
    return { targets, words, lines, srMirror, revert: () => {}, refresh: () => {} };
  }

  const make = (text: string, tag = "span"): HTMLElement => {
    const span = document.createElement(tag);
    span.className = className;
    span.textContent = text;
    span.style.display = "inline-block";
    // no white-space:pre here — the wrapper keeps normal collapsing behaviour
    return span;
  };

  const build = (html: string) => {
    targets.length = 0;
    words.length = 0;
    lines.length = 0;
    element.innerHTML = "";
    element.setAttribute("aria-hidden", "true");

    srMirror = document.createElement("span");
    srMirror.className = "split-sr";
    srMirror.textContent = html || source;
    Object.assign(srMirror.style, SR_ONLY);
    element.insertAdjacentElement("afterend", srMirror);

    const fragment = document.createDocumentFragment();
    const paragraphs = html.split(/\n+/);

    paragraphs.forEach((paragraph, pIndex) => {
      if (pIndex > 0) fragment.appendChild(document.createElement("br"));
      const tokens = paragraph.split(/(\s+)/);

      for (const token of tokens) {
        if (!token) continue;

        if (/^\s+$/.test(token)) {
          if (preserveSpaces) fragment.appendChild(document.createTextNode(" "));
          continue;
        }

        const wordEl = document.createElement("span");
        wordEl.className = `${className}-word`;
        wordEl.style.display = "inline-block";

        if (by === "chars" || by === "words-and-chars") {
          for (const char of Array.from(token)) {
            const charEl = make(char);
            wordEl.appendChild(charEl);
            targets.push(charEl);
          }
        } else {
          wordEl.textContent = token;
          targets.push(wordEl);
        }

        words.push(wordEl);
        fragment.appendChild(wordEl);
      }
    });

    element.appendChild(fragment);

    if (by === "lines" || by === "words-and-chars") {
      for (const group of groupIntoLines(words)) {
        const first = group[0];
        if (!first) continue;
        const lineEl = document.createElement("span");
        lineEl.className = `${className}-line`;
        lineEl.style.display = "block";
        lineEl.style.overflow = "hidden";
        first.parentElement?.insertBefore(lineEl, first);
        group.forEach((w) => lineEl.appendChild(w));
        lines.push(lineEl);
      }
    }
  };

  build(originalHTML);

  return {
    targets,
    words,
    lines,
    get srMirror() {
      return srMirror;
    },
    revert: () => {
      srMirror?.remove();
      srMirror = null;
      element.innerHTML = originalHTML;
      element.removeAttribute("aria-hidden");
      targets.length = 0;
      words.length = 0;
      lines.length = 0;
    },
    refresh: (html?: string) => {
      srMirror?.remove();
      build(html ?? element.textContent ?? source);
    },
  };
}

/**
 * Scrambles text through a glyph ramp — the engine behind the cyber-decrypt headings.
 * Returns a cancel function.
 */
export function scramble(
  element: HTMLElement,
  finalText: string,
  {
    glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]{}#$%&*+=?",
    duration = 1400,
    speed = 34,
    onComplete,
  }: { glyphs?: string; duration?: number; speed?: number; onComplete?: () => void } = {},
): () => void {
  if (!isBrowser) return () => {};
  const start = performance.now();
  let raf = 0;
  let lastSwap = 0;
  const resolved = new Array(finalText.length).fill(false);

  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const settled = Math.floor(progress * finalText.length);

    if (now - lastSwap > speed) {
      lastSwap = now;
      let out = "";
      for (let i = 0; i < finalText.length; i += 1) {
        const ch = finalText[i];
        if (ch === " " || ch === "\n") {
          out += ch;
          continue;
        }
        resolved[i] = i < settled;
        out += resolved[i] ? ch : glyphs[Math.floor(Math.random() * glyphs.length)];
      }
      element.textContent = out;
    }

    if (progress < 1) raf = requestAnimationFrame(frame);
    else {
      element.textContent = finalText;
      onComplete?.();
    }
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
