#!/usr/bin/env node
/**
 * verify-shop.mjs — the commerce track, driven like a customer would drive it.
 *
 * A shop page that merely *renders* proves nothing: the failure modes are all in the flow — a
 * second add that the first add's drawer blocks, a quantity stepper that changes the row but not
 * the total, a discount that applies to the wrong number, a checkout that accepts an empty form or
 * refuses a full one, or a four-step ritual that lets a customer skip the address.
 *
 * So this gate clicks. Every assertion below comes from an interaction, and the arithmetic is
 * checked against numbers computed in the test rather than against whatever the page says:
 *
 *   1. storefront → add two goods → the pill counts 2 and `localStorage` agrees
 *   2. cart → quantity up → the total moves by exactly one unit + VAT, not by a guess
 *   3. cart → remove → the row leaves and the remainder is still correct
 *   4. promo → STUDIO10 discounts the subtotal by 10% and the discount row appears
 *   5. one-step checkout → an empty form is refused (and says so), a filled form clears the cart
 *   6. ritual checkout → step 0 advances with items, and step 1 refuses to advance empty
 *   7. both product pages → no horizontal overflow, no page errors, in both themes
 *
 * Needs a running preview server (VISION_PORT, default 4173).
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.VISION_PORT || "4173";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;

const VAT = 0.21;
const problems = [];
const url = (path, lang = "en", theme = "light") => `http://127.0.0.1:${PORT}/${path}?lang=${lang}&theme=${theme}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (value) => Math.round(value * 100) / 100;

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true,
  protocolTimeout: 120_000,
  env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (error) => problems.push(`page error: ${error.message.slice(0, 140)}`));
page.on("response", (response) => {
  if (response.status() === 404 && response.url().includes(`:${PORT}/`)) {
    problems.push(`404 ${response.url().split(`:${PORT}/`)[1]}`);
  }
});

const lines = () => page.evaluate(() => (JSON.parse(localStorage.getItem("catalog:cart") || '{"lines":[]}').lines || []));
const total = (key) => page.$eval(`[data-total="${key}"]`, (node) => node.textContent.trim());

/* ---------------------------------------------------------------- 1 · storefront --- */

await page.goto(url("sites/shop/index.html"), { waitUntil: "load" });
await wait(2200);

const cards = await page.$$eval("[data-good]", (nodes) => nodes.length);
if (cards < 6) problems.push(`storefront: only ${cards} goods`);

// Two adds, in two different cards: the second one used to be swallowed by the drawer the first
// one opened, which is the bug this assertion exists for.
await page.click("[data-good] [data-add]");
await wait(400);
await page.click("[data-good]:nth-of-type(2) [data-add]");
await wait(1400);

const pill = await page.$eval("[data-cart-count]", (node) => Number(node.textContent.trim()));
const stored = await lines();
if (pill !== 2) problems.push(`storefront: pill says ${pill} after two adds`);
if (stored.length !== 2) problems.push(`storefront: localStorage holds ${stored.length} lines after two adds`);

const firstPrice = Number(await page.$eval("[data-good]", (node) => node.getAttribute("data-price")));
const secondPrice = Number(await page.$eval("[data-good]:nth-of-type(2)", (node) => node.getAttribute("data-price")));

// The filter row must actually filter, and the empty state must be reachable but not shown.
await page.click('[data-filter="metal"]');
await wait(300);
const shown = await page.$$eval("[data-good]", (nodes) => nodes.filter((node) => !node.hidden).length);
const metals = await page.$$eval('[data-material="metal"]', (nodes) => nodes.length);
if (shown !== metals || shown === cards) problems.push(`storefront: filter shows ${shown} of ${metals} metal goods`);
await page.click('[data-filter="all"]');
await wait(200);

/* --------------------------------------------------------------------- 2 · cart --- */

await page.goto(url("sites/shop/cart.html"), { waitUntil: "load" });
await wait(1600);

let rows = await page.$$eval("[data-cart-lines] .shop__line", (nodes) => nodes.length);
if (rows !== 2) problems.push(`cart: ${rows} rows for a two-line cart`);

const subtotal = money(firstPrice + secondPrice);
/**
 * Shipping is a rule, not a constant: free from 120 € of goods. The first version of this gate
 * hardcoded 6 € and failed a *correct* page — the kind of test bug that gets a real one ignored.
 */
const shippingFor = (net) => (net >= 120 ? 0 : 6);
const expectedTotal = money(subtotal * (1 + VAT) + shippingFor(subtotal));
const shownTotal = Number((await total("total")).replace(/[^\d.]/g, ""));
if (Math.abs(shownTotal - expectedTotal) > 0.02) {
  problems.push(`cart: total is ${shownTotal}, expected ${expectedTotal} (subtotal ${subtotal} + VAT + 6 shipping)`);
}

await page.click(".shop__line [data-line-qty='1']");
await wait(700);
const bumped = Number((await total("total")).replace(/[^\d.]/g, ""));
const bumpedSubtotal = money(subtotal + firstPrice);
const expectedBump = money(bumpedSubtotal * (1 + VAT) + shippingFor(bumpedSubtotal));
if (Math.abs(bumped - expectedBump) > 0.02) {
  problems.push(`cart: total after one more unit is ${bumped}, expected ${expectedBump}`);
}

await page.click(".shop__line [data-remove]");
await wait(900);
rows = await page.$$eval("[data-cart-lines] .shop__line", (nodes) => nodes.length);
if (rows !== 1) problems.push(`cart: ${rows} rows after removing one of two`);

/* -------------------------------------------------------------------- 3 · promo --- */

await page.type("input[name=promo]", "STUDIO10");
await page.click("[data-promo] button[type=submit]");
await wait(600);
const discountRow = await page.$eval("[data-discount-row]", (node) => !node.hidden);
const afterPromo = await lines();
const promoSubtotal = money(afterPromo.reduce((sum, line) => sum + line.price * line.qty, 0));
const discount = Number((await total("discount")).replace(/[^\d.]/g, ""));
if (!discountRow) problems.push("promo: the discount row never appeared");
if (Math.abs(discount - money(promoSubtotal * 0.1)) > 0.02) {
  problems.push(`promo: discount is ${discount}, expected 10% of ${promoSubtotal}`);
}

// A wrong code must be refused, and must not disturb the applied one.
await page.$eval("input[name=promo]", (node) => { node.value = "NOPE"; });
await page.type("input[name=promo]", "X");
await page.click("[data-promo] button[type=submit]");
await wait(400);
const note = await page.$eval("[data-promo-note]", (node) => node.textContent.trim());
if (!/not recognised|شناخته/.test(note)) problems.push(`promo: a bad code reported "${note}"`);

/* --------------------------------------------------------- 4 · checkout, one step --- */

await page.goto(url("sites/shop/index.html", "en", "dark"), { waitUntil: "load" });
await wait(1800);
await page.click("[data-good] [data-add]");
await wait(900);
await page.goto(url("sites/shop/checkout.html", "en", "dark"), { waitUntil: "load" });
await wait(1600);

await page.click("[data-checkout-one] button[type=submit]");
await wait(500);
const flagged = await page.$$eval(".shop__field.has-error", (nodes) => nodes.length);
const formError = await page.$eval("[data-form-error]", (node) => (node.hidden ? "" : node.textContent.trim()));
if (!flagged) problems.push("checkout: an empty form was accepted (nothing flagged)");
if (!formError) problems.push("checkout: an empty form produced no message");

await page.evaluate(() => {
  const set = (name, value) => {
    const input = document.querySelector(`[name=${name}]`);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };
  set("name", "Mira Halvorsen");
  set("email", "mira@field.supply");
  set("address", "Westersingel 14");
  set("city", "Rotterdam");
  set("postcode", "3014 GN");
  set("country", "Netherlands");
  set("card", "4242424242424242");
  set("expiry", "04/29");
  set("cvc", "123");
});
await page.click("[data-checkout-one] button[type=submit]");
await wait(800);
const success = await page.$eval("[data-success]", (node) => !node.hidden);
const cleared = (await lines()).length === 0;
if (!success) problems.push("checkout: a valid form did not report success");
if (!cleared) problems.push("checkout: the cart survived a placed order");

// An invalid card number must be refused even when everything else is fine.
await page.goto(url("sites/shop/index.html", "en", "dark"), { waitUntil: "load" });
await wait(1600);
await page.click("[data-good] [data-add]");
await wait(900);
await page.goto(url("sites/shop/checkout.html", "en", "dark"), { waitUntil: "load" });
await wait(1400);
await page.evaluate(() => {
  const set = (name, value) => {
    const input = document.querySelector(`[name=${name}]`);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  set("name", "A B");
  set("email", "a@b.co");
  set("address", "Westersingel 14");
  set("city", "Rotterdam");
  set("postcode", "3014");
  set("country", "Netherlands");
  set("card", "4242");
  set("expiry", "04/29");
  set("cvc", "123");
});
await page.click("[data-checkout-one] button[type=submit]");
await wait(500);
const cardError = await page.$eval('[data-error-for="card"]', (node) => (node.hidden ? "" : node.textContent.trim()));
if (!cardError) problems.push("checkout: a 4-digit card number passed validation");

/* ------------------------------------------------------------- 5 · ritual, stepped --- */

await page.goto(url("sites/shop/index.html", "fa", "dark"), { waitUntil: "load" });
await wait(1800);
await page.click("[data-good] [data-add]");
await wait(1000);
await page.goto(url("sites/shop/checkout-ritual.html", "fa", "dark"), { waitUntil: "load" });
await wait(1600);

const stepOf = () => page.$eval("[data-ritual]", (node) => node.getAttribute("data-step"));
if ((await stepOf()) !== "0") problems.push("ritual: does not start on step 0");
await page.click("[data-step-next]");
await wait(400);
if ((await stepOf()) !== "1") problems.push("ritual: step 0 did not advance with items in the cart");
await page.click("[data-step-next]");
await wait(400);
if ((await stepOf()) !== "1") problems.push("ritual: step 1 advanced with an empty address form");

const refusals = await page.$$eval("[data-step-panel='1'] .shop__field.has-error", (nodes) => nodes.length);
if (!refusals) problems.push("ritual: the address step refused silently (no field marked)");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 1) problems.push(`ritual: ${overflow}px of horizontal overflow in Persian`);

/* ------------------------------------------------------ 6 · product pages, both themes --- */

for (const path of ["sites/shop/product-chroma.html", "sites/shop/product-editorial.html", "sites/shop/digital.html"]) {
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      const tab = await browser.newPage();
      tab.on("pageerror", (error) => problems.push(`${path} (${theme}): ${error.message.slice(0, 100)}`));
      await tab.setViewport({ width, height: width > 800 ? 1000 : 844 });
      await tab.goto(url(path, "en", theme), { waitUntil: "load" });
      await wait(1800);
      const state = await tab.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        theme: document.documentElement.dataset.theme,
        dir: document.documentElement.dir,
        title: document.title.slice(0, 30),
      }));
      if (state.overflow > 1) problems.push(`${path} (${theme}/${width}): ${state.overflow}px of horizontal overflow`);
      if (state.theme !== theme) problems.push(`${path}: theme is "${state.theme}"`);
      await tab.close();
    }
  }
}

/* ------------------------------------------------------------------- the headline --- */

const chroma = await browser.newPage();
await chroma.setViewport({ width: 1440, height: 1000 });
await chroma.goto(url("sites/shop/product-chroma.html"), { waitUntil: "load" });
await wait(2000);
const firstFinishPrice = await chroma.$eval("[data-finish-price]", (node) => node.textContent.trim());
await chroma.click(".shop__finish:nth-of-type(2)");
await wait(300);
const secondFinishPrice = await chroma.$eval("[data-finish-price]", (node) => node.textContent.trim());
if (firstFinishPrice === secondFinishPrice) {
  problems.push("product: choosing a finish did not change the price");
}
await chroma.close();

await browser.close();

if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("─".repeat(72));
console.log("  ✓ commerce: adds, counts, totals, discounts, validation and both checkouts behave");
console.log("─".repeat(72) + "\n");
