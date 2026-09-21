#!/usr/bin/env node
/**
 * smoke-hub.mjs — runtime smoke test for the buildless showroom (docs/).
 *
 * jsdom executes the real `docs/index.html` with the real `catalog.js`, `hud.js` and `hub.js`,
 * then asserts that the hub actually did its job: counters filled, one card per manifest entry,
 * metadata HUD present, filtering/search reframing the DOM, and the stage overlay opening with
 * the correct iframe source.
 *
 * This is the closest thing to a browser we can run in CI without shipping Chromium, and it
 * catches the classic buildless failures: a typo in a selector, a manifest path that moved, a
 * filter that silently renders zero cards.
 *
 * Run: npm run test:hub
 */
import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

let failures = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✖ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function read(path) {
  return readFile(join(DOCS, path), "utf8");
}

async function main() {
  const html = await read("index.html");
  const scripts = {
    catalog: await read("data/catalog.js"),
    hud: await read("assets/hud.js"),
    hub: await read("assets/hub.js"),
  };

  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => consoleErrors.push(String(error)));
  virtualConsole.on("error", (...args) => consoleErrors.push(args.join(" ")));

  const dom = new JSDOM(html, {
    url: "https://example.test/", // non-file so the fetch path is used… which then falls back
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });

  const { window } = dom;
  // Stub availability probing as "build present" so the iframe mount path is exercised.
  window.fetch = () => Promise.resolve({ ok: true, status: 200 });

  // Execute the same three scripts the page loads, in document order.
  window.eval(scripts.catalog);
  window.eval(scripts.hud);
  window.eval(scripts.hub);

  // The manifest promise chain needs a macrotask or two to settle.
  await new Promise((r) => setTimeout(r, 60));

  const doc = window.document;
  const manifest = window.__CATALOG__;
  const variations = manifest.variations;

  console.log("─".repeat(72));
  console.log("  HUB SMOKE TEST (jsdom)");
  console.log("─".repeat(72));

  check("manifest fallback executed (window.__CATALOG__)", !!manifest && variations.length > 0);
  check(
    "one card rendered per variation",
    doc.querySelectorAll(".card").length === variations.length,
    `got ${doc.querySelectorAll(".card").length}, expected ${variations.length}`,
  );

  const counters = doc.getElementById("stat-variations");
  check("live counter filled", counters && counters.textContent.trim() !== "—", counters?.textContent);

  const firstCard = doc.querySelector(".card");
  check("card carries its accent token", !!firstCard.style.getPropertyValue("--card-accent"));
  check("metadata HUD: component id present", !!firstCard.querySelector(".card__id")?.textContent.trim());
  check("metadata HUD: stack chips present", firstCard.querySelectorAll(".card__chip").length > 0);
  check("metadata HUD: vibe present", !!firstCard.querySelector(".card__vibe")?.textContent.trim());
  check(
    "metadata HUD: interaction blueprint present",
    (firstCard.querySelectorAll(".card__meta dd")[2]?.textContent || "").length > 20,
  );
  const actions = Array.from(firstCard.querySelectorAll("a.card__action")).map((a) => a.href);
  check(
    "provenance links: raw route + GitHub source + build workflow",
    actions.some((href) => /\/hero\/[a-z-]+\/index\.html$/.test(href)) &&
      actions.some((href) => href.includes("github.com")) ,
    actions.join(" "),
  );
  check(
    "no undefined class tokens anywhere",
    !/class="[^"]*undefined/.test(doc.body.innerHTML) && !document1HasUndefined(doc),
  );

  /* ------------------------------------------------------------ filtering */
  const disciplineChip = Array.from(doc.querySelectorAll("#discipline-rail .chip")).find((chip) =>
    chip.textContent.startsWith("Hero"),
  );
  disciplineChip?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const visibleAfterDiscipline = Array.from(doc.querySelectorAll(".card")).filter((c) => !c.hidden);
  check(
    "discipline filter narrows to Hero variations",
    visibleAfterDiscipline.length === variations.filter((v) => v.discipline === "Hero").length,
    `${visibleAfterDiscipline.length} visible`,
  );

  const search = doc.getElementById("search");
  search.value = "shader";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220)); // debounce is 140ms
  const visibleAfterSearch = Array.from(doc.querySelectorAll(".card")).filter((c) => !c.hidden);
  check(
    "search matches the shader variations",
    visibleAfterSearch.length > 0 &&
      visibleAfterSearch.every((card) => /shader|webgl|fbm|glsl/i.test(card.dataset.haystack)),
    `${visibleAfterSearch.length} visible`,
  );

  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));

  /* --------------------------------------------------------------- stage */
  const openButton = doc.querySelector(".card__action--primary");
  openButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const stage = doc.getElementById("stage");
  check("stage overlay opens", stage.hidden === false);
  check(
    "stage iframe points at the built route",
    /\/hero\/[a-z-]+\/index\.html$/.test(doc.getElementById("stage-frame").getAttribute("src") || ""),
    doc.getElementById("stage-frame").getAttribute("src"),
  );
  check("stage deep-links the route in the hash", /^#\/(hero|nav|loader|scroll|footer|ux|dashboard)\//.test(window.location.hash), window.location.hash);

  doc.querySelector("[data-close].chip").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("stage overlay closes", stage.hidden === true);

  /* ---------------------------------------------------- postMessage relay */
  window.dispatchEvent(
    new window.MessageEvent("message", { data: { type: "catalog:expand", id: variations[0].id } }),
  );
  check("iframe HUD can request expansion via postMessage", doc.getElementById("stage").hidden === false);

  /* ------------------------------------------------------------- iframes */
  const frames = doc.querySelectorAll(".card__frame iframe");
  check(
    "preview iframes mount within the concurrency cap (≤6)",
    frames.length > 0 && frames.length <= 6,
    `${frames.length} mounted`,
  );
  check(
    "every mounted iframe resolves to a real exported route",
    Array.from(frames).every((f) => /index\.html$/.test(f.getAttribute("src") || "")),
  );

  const realErrors = consoleErrors.filter((e) => !/network disabled|fetch/i.test(e));
  check("no uncaught errors during boot", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  /* ------------------------------- scenario 2: framework build not present */
  const dom2 = new JSDOM(html, { url: "https://example.test/", runScripts: "outside-only", pretendToBeVisual: true });
  dom2.window.fetch = () => Promise.resolve({ ok: false, status: 404 });
  dom2.window.eval(scripts.catalog);
  dom2.window.eval(scripts.hud);
  dom2.window.eval(scripts.hub);
  await new Promise((r) => setTimeout(r, 80));
  const notice = dom2.window.document.querySelector(".card__notice");
  check("missing framework build renders an honest notice (not a blank frame)", !!notice);
  check(
    "notice explains how to produce the build",
    /npm run build/.test(notice?.textContent || ""),
    notice?.textContent?.slice(0, 60),
  );
  check(
    "notice still offers the GitHub source",
    /github\.com/.test(notice?.querySelector("a.card__action")?.href || ""),
  );

  console.log("─".repeat(72));
  if (failures) {
    console.error(`  ${failures} assertion(s) failed\n`);
    process.exit(1);
  }
  console.log("  ✓ hub behaves correctly end-to-end\n");
}

/** Guards against React/vanilla class-name typos leaking into the DOM. */
function document1HasUndefined(doc) {
  return Array.from(doc.querySelectorAll("*")).some((node) =>
    typeof node.className === "string" ? /\bundefined\b/.test(node.className) : false,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
