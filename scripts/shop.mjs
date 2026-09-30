/**
 * shop.mjs — the commerce track, emitted from `sites/shop.json`.
 *
 * Seven pages over one engine: two storefronts, two product pages that are deliberately not shop
 * templates, a cart, and one-step and four-step checkout. The pages carry their content in the
 * markup (bilingual pairs in `data-i18n-fa`, exactly like the rest of the catalogue), and every
 * price, count and total is computed in the browser by `docs/assets/shop.js` from the same records.
 *
 * Prices are integers in euros and are rendered through one formatter, so a total can never be a
 * string that disagrees with its rows.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { head, foot, embed, esc, bi } from "./site.mjs";

const CURRENCY = "€";

/** `1 840 €` — grouped, with a thin space, the way a price list reads. */
function money(value) {
  const grouped = String(Math.round(value * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  return `${grouped} ${CURRENCY}`;
}

/** A product or digital-good card: the unit the cart actually adds. */
function goodCard(item, kind) {
  const compare = item.compare
    ? `<span class="shop__price-was">${esc(money(item.compare))}</span>`
    : "";
  return `        <article class="shop__good" data-good data-id="${esc(item.id)}" data-sku="${esc(item.sku)}" data-price="${item.price}" data-kind="${kind}" data-material="${esc(item.material || item.kind || "")}" data-name-en="${esc(item.name.en)}" data-name-fa="${esc(item.name.fa)}">
          <div class="shop__good-top">
            <span class="shop__sku force-ltr">${esc(item.sku)}</span>
${item.badge ? `            <span class="shop__badge" data-i18n="badge${esc(item.badge)}">${esc(item.badge)}</span>` : ""}
          </div>
          <h3 class="shop__good-name"${bi(item.name.fa)}>${esc(item.name.en)}</h3>
          <p class="shop__good-blurb"${bi(item.blurb.fa)}>${esc(item.blurb.en)}</p>
          <dl class="shop__specs">
${(item.specs || [])
  .map(
    (spec) => `            <div><dt${bi(spec.label.fa)}>${esc(spec.label.en)}</dt><dd${bi(spec.value.fa)}>${esc(spec.value.en)}</dd></div>`,
  )
  .join("\n")}
          </dl>
          <div class="shop__good-foot">
            <p class="shop__price">
              <span class="shop__price-now">${esc(money(item.price))}</span>
              ${compare}
            </p>
            <div class="shop__buy">
              <div class="shop__qty" role="group" aria-label="Quantity">
                <button type="button" class="shop__qty-step" data-qty="-1" aria-label="Fewer">−</button>
                <span class="shop__qty-value" data-qty-value>1</span>
                <button type="button" class="shop__qty-step" data-qty="1" aria-label="More">+</button>
              </div>
              <button type="button" class="shop__add" data-add data-i18n="addToCart">Add to cart</button>
            </div>
          </div>
        </article>`;
}

/** The filter row both storefronts use. The chips are real buttons with `aria-pressed`. */
function filterRow(filters) {
  return `        <div class="shop__filters" role="group" aria-label="Filter">
${filters
  .map(
    (filter, index) =>
      `          <button type="button" class="shop__chip${index === 0 ? " is-active" : ""}" data-filter="${esc(filter.id)}" aria-pressed="${index === 0}"><span${bi(filter.label.fa)}>${esc(filter.label.en)}</span><span class="shop__chip-count" data-count="${esc(filter.id)}">0</span></button>`,
  )
  .join("\n")}
        </div>
        <p class="shop__empty" data-empty hidden data-i18n="shopEmpty">Nothing in this filter.</p>`;
}

function storefront({ data, kind, base }) {
  const section = kind === "physical" ? data.physical : data.digital;
  const products = section.products;
  const stock = products.length;

  const hero =
    kind === "physical"
      ? `        <section class="shop__campaign">
          <div class="shop__campaign-copy">
            <p class="shop__label"${bi(section.hero.label.fa)}>${esc(section.hero.label.en)}</p>
            <h2 class="shop__campaign-title" data-i18n="shopCampaignTitle">The catalogue is the campaign</h2>
            <p class="shop__campaign-body" data-i18n="shopCampaignBody">Every panel on this page is a live variation, mounted exactly as it is on its own component page.</p>
          </div>
${embed({
            base,
            src: section.hero.embed,
            alt: "The campaign panel",
            caption: section.hero.caption.en,
            captionFa: section.hero.caption.fa,
            height: "52svh",
          })}
        </section>`
      : "";

  return `    <main class="shop" id="main">
      <header class="shop__head">
        <p class="shop__kicker force-ltr"${bi(section.kicker.fa)}>${esc(section.kicker.en)}</p>
        <h1 class="shop__title"${bi(section.title.fa)}>${esc(section.title.en)}</h1>
        <p class="shop__lede"${bi(section.lede.fa)}>${esc(section.lede.en)}</p>
      </header>

${hero}

      <section class="shop__shelf" aria-labelledby="shelf-title">
        <div class="shop__shelf-head">
          <h2 class="shop__shelf-title" id="shelf-title" data-i18n="shopShelf">${kind === "physical" ? "On the shelf" : "In the vault"}</h2>
          <p class="shop__shelf-meta"><span data-shelf-count>${stock}</span> <span data-i18n="shopItems">items</span></p>
        </div>
${filterRow(section.filters)}
        <div class="shop__grid" data-grid>
${products.map((item) => goodCard(item, kind)).join("\n")}
        </div>
      </section>

${chequeSection(base)}
    </main>`;
}

/** The three guarantees every storefront carries — real content, not decoration. */
function chequeSection() {
  return `      <section class="shop__assurance">
${[
  ["shopA1", "Every total is computed", "shopA1b", "Prices, quantities and tax are calculated in the page, from the same records the cart uses."],
  ["shopA2", "No dark patterns", "shopA2b", "No countdown timers, no fake scarcity, no pre-ticked boxes."],
  ["shopA3", "Bilingual and dual-theme", "shopA3b", "Persian and English, day and night — every control checked in all four."],
]
  .map(
    ([titleKey, title, bodyKey, body]) => `        <article class="shop__assure">
          <h3 data-i18n="${titleKey}">${esc(title)}</h3>
          <p data-i18n="${bodyKey}">${esc(body)}</p>
        </article>`,
  )
  .join("\n")}
      </section>`;
}

function productPage({ data, which, base }) {
  if (which === "chroma") return productChroma(data, base);
  return productEditorial(data, base);
}

function productChroma(data, base) {
  const product = data.productChroma;
  return `    <main class="shop" id="main">
      <header class="shop__head">
        <p class="shop__kicker force-ltr">${esc(product.id)}</p>
        <h1 class="shop__title"${bi(product.name.fa)}>${esc(product.name.en)}</h1>
        <p class="shop__lede"${bi(product.lede.fa)}>${esc(product.lede.en)}</p>
      </header>

      <section class="shop__stage-row">
        <div class="shop__stage" data-finish-stage aria-live="polite">
          <p class="shop__label"${bi(product.stage.label.fa)}>${esc(product.stage.label.en)}</p>
${embed({
  base,
  src: product.stage.embed,
  caption: product.stage.caption,
  height: "44svh",
})}
        </div>

        <aside class="shop__buy-panel">
          <h2 class="shop__buy-title" data-i18n="shopChooseFinish">Choose a finish</h2>
          <div class="shop__finishes" role="radiogroup" aria-label="Finish">
${product.finishes
  .map(
    (finish, index) => `            <button type="button" class="shop__finish${index === 0 ? " is-active" : ""}" role="radio" aria-checked="${index === 0}" data-finish="${esc(finish.id)}" data-price="${finish.price}" style="--finish: ${esc(finish.accent)}">
              <span class="shop__finish-swatch" aria-hidden="true"></span>
              <span class="shop__finish-text">
                <span class="shop__finish-name"${bi(finish.name.fa)}>${esc(finish.name.en)}</span>
                <span class="shop__finish-note"${bi(finish.note.fa)}>${esc(finish.note.en)}</span>
              </span>
              <span class="shop__finish-price force-ltr">${esc(money(finish.price))}</span>
            </button>`,
  )
  .join("\n")}
          </div>

          <dl class="shop__specs shop__specs--panel">
${product.specs
  .map((spec) => `            <div><dt${bi(spec.label.fa)}>${esc(spec.label.en)}</dt><dd${bi(spec.value.fa)}>${esc(spec.value.en)}</dd></div>`)
  .join("\n")}
          </dl>

          <div class="shop__panel-foot">
            <p class="shop__price shop__price--large">
              <span class="shop__price-now" data-finish-price>${esc(money(product.finishes[0].price))}</span>
            </p>
            <div class="shop__buy">
              <div class="shop__qty" role="group" aria-label="Quantity">
                <button type="button" class="shop__qty-step" data-qty="-1" aria-label="Fewer">−</button>
                <span class="shop__qty-value" data-qty-value>1</span>
                <button type="button" class="shop__qty-step" data-qty="1" aria-label="More">+</button>
              </div>
              <button type="button" class="shop__add" data-add data-good
                data-id="P-CHROMA" data-sku="FS-901" data-price="${product.finishes[0].price}"
                data-kind="physical" data-name-en="${esc(product.name.en)}" data-name-fa="${esc(product.name.fa)}"
                data-i18n="addToCart">Add to cart</button>
            </div>
          </div>
        </aside>
      </section>

      <section class="shop__copy">
${product.copy
  .map(
    (block) => `        <article class="shop__copy-block">
          <h2${bi(block.heading.fa)}>${esc(block.heading.en)}</h2>
          <p${bi(block.body.fa)}>${esc(block.body.en)}</p>
        </article>`,
  )
  .join("\n")}
      </section>
${chequeSection(base)}
    </main>`;
}

function productEditorial(data, base) {
  const product = data.productEditorial;
  return `    <main class="shop" id="main">
      <header class="shop__head shop__head--editorial">
        <p class="shop__kicker force-ltr">${esc(product.id)}</p>
        <h1 class="shop__title"${bi(product.name.fa)}>${esc(product.name.en)}</h1>
        <p class="shop__lede"${bi(product.lede.fa)}>${esc(product.lede.en)}</p>
      </header>

      <div class="shop__editorial">
        <article class="shop__longform">
${product.article
  .map(
    (block, index) => `          <section class="shop__chapter">
            <h2${bi(block.heading.fa)}>${esc(block.heading.en)}</h2>
            <p${bi(block.body.fa)}>${esc(block.body.en)}</p>
          </section>
${index === 0 ? `          <blockquote class="shop__pull"${bi(product.pullQuote.fa)}>${esc(product.pullQuote.en)}</blockquote>\n` : ""}`,
  )
  .join("\n")}
        </article>

        <aside class="shop__buy-panel shop__buy-panel--sticky">
          <p class="shop__sku force-ltr">${esc(product.id)}</p>
          <h2 class="shop__buy-title"${bi(product.name.fa)}>${esc(product.name.en)}</h2>
          <p class="shop__price shop__price--large">
            <span class="shop__price-now">${esc(money(product.price))}</span>
            <span class="shop__price-was">${esc(money(product.compare))}</span>
          </p>
          <dl class="shop__specs shop__specs--panel">
${product.specs
  .map((spec) => `            <div><dt${bi(spec.label.fa)}>${esc(spec.label.en)}</dt><dd${bi(spec.value.fa)}>${esc(spec.value.en)}</dd></div>`)
  .join("\n")}
          </dl>
          <div class="shop__buy">
            <div class="shop__qty" role="group" aria-label="Quantity">
              <button type="button" class="shop__qty-step" data-qty="-1" aria-label="Fewer">−</button>
              <span class="shop__qty-value" data-qty-value>1</span>
              <button type="button" class="shop__qty-step" data-qty="1" aria-label="More">+</button>
            </div>
            <button type="button" class="shop__add" data-add data-good
              data-id="P-LONGTABLE" data-sku="FS-770" data-price="${product.price}"
              data-kind="physical" data-name-en="${esc(product.name.en)}" data-name-fa="${esc(product.name.fa)}"
              data-i18n="addToCart">Add to cart</button>
          </div>
          <p class="shop__panel-note" data-i18n="shopLeadTime">Made to order — six to eight weeks.</p>
        </aside>
      </div>
${chequeSection(base)}
    </main>`;
}

function cartPage(data, base) {
  const cart = data.cart;
  return `    <main class="shop" id="main">
      <header class="shop__head">
        <p class="shop__kicker force-ltr"${bi(cart.kicker.fa)}>${esc(cart.kicker.en)}</p>
        <h1 class="shop__title"${bi(cart.title.fa)}>${esc(cart.title.en)}</h1>
        <p class="shop__lede"${bi(cart.lede.fa)}>${esc(cart.lede.en)}</p>
      </header>

      <section class="shop__cart">
        <div class="shop__cart-main" data-cart-host>
          <p class="shop__cart-empty" data-cart-empty hidden${bi(cart.empty.fa)}>${esc(cart.empty.en)}</p>
          <ul class="shop__lines" data-cart-lines></ul>
        </div>

        <aside class="shop__totals" aria-labelledby="totals-title">
          <h2 class="shop__totals-title" id="totals-title" data-i18n="shopTotals">Order summary</h2>
          <form class="shop__promo" data-promo novalidate>
            <label class="shop__field">
              <span class="shop__field-label"${bi(cart.promo.label.fa)}>${esc(cart.promo.label.en)}</span>
              <input type="text" name="promo" class="shop__input force-ltr" placeholder="STUDIO10" autocomplete="off" />
            </label>
            <button type="submit" class="shop__chip shop__chip--action" data-i18n="shopApply">Apply</button>
          </form>
          <p class="shop__promo-note" data-promo-note${bi(cart.promo.hint.fa)}>${esc(cart.promo.hint.en)}</p>

          <dl class="shop__totals-rows">
            <div><dt data-i18n="shopSubtotal">Subtotal</dt><dd class="force-ltr" data-total="subtotal">—</dd></div>
            <div data-discount-row hidden><dt data-i18n="shopDiscount">Discount</dt><dd class="force-ltr" data-total="discount">—</dd></div>
            <div><dt data-i18n="shopShipping">Shipping</dt><dd class="force-ltr" data-total="shipping">—</dd></div>
            <div><dt data-i18n="shopTax">VAT (21%)</dt><dd class="force-ltr" data-total="tax">—</dd></div>
            <div class="shop__totals-grand"><dt data-i18n="shopTotal">Total</dt><dd class="force-ltr" data-total="total">—</dd></div>
          </dl>

          <a class="shop__cta" href="checkout.html" data-checkout-link data-i18n="shopToCheckout">Checkout</a>
          <a class="shop__cta shop__cta--ghost" href="index.html" data-i18n="shopKeepShopping">Keep shopping</a>
        </aside>
      </section>
    </main>`;
}

function checkoutFields(data, groups) {
  const fields = data.checkout.fields.filter((field) => groups.includes(field.id));
  return fields
    .map(
      (field) => `            <label class="shop__field">
              <span class="shop__field-label"${bi(field.label.fa)}>${esc(field.label.en)}</span>
              <input type="${esc(field.type)}" name="${esc(field.id)}" class="shop__input" autocomplete="${esc(field.autoComplete || "on")}" data-validate="${esc(field.id)}" />
              <span class="shop__field-error" data-error-for="${esc(field.id)}" hidden></span>
            </label>`,
    )
    .join("\n");
}

function paymentFields(data) {
  const payment = data.checkout.payment;
  return `            <label class="shop__field shop__field--wide">
              <span class="shop__field-label"${bi(payment.card.fa)}>${esc(payment.card.en)}</span>
              <input type="text" name="card" class="shop__input force-ltr" inputmode="numeric" autocomplete="cc-number" data-validate="card" placeholder="4242 4242 4242 4242" />
              <span class="shop__field-error" data-error-for="card" hidden></span>
            </label>
            <label class="shop__field">
              <span class="shop__field-label"${bi(payment.expiry.fa)}>${esc(payment.expiry.en)}</span>
              <input type="text" name="expiry" class="shop__input force-ltr" inputmode="numeric" autocomplete="cc-exp" placeholder="04/29" data-validate="expiry" />
              <span class="shop__field-error" data-error-for="expiry" hidden></span>
            </label>
            <label class="shop__field">
              <span class="shop__field-label"${bi(payment.cvc.fa)}>${esc(payment.cvc.en)}</span>
              <input type="text" name="cvc" class="shop__input force-ltr" inputmode="numeric" autocomplete="cc-csc" placeholder="123" data-validate="cvc" />
              <span class="shop__field-error" data-error-for="cvc" hidden></span>
            </label>
            <p class="shop__panel-note shop__field--wide"${bi(payment.note.fa)}>${esc(payment.note.en)}</p>`;
}

function checkoutOne(data, base) {
  const checkout = data.checkout.oneStep;
  return `    <main class="shop" id="main">
      <header class="shop__head">
        <p class="shop__kicker force-ltr"${bi(checkout.kicker.fa)}>${esc(checkout.kicker.en)}</p>
        <h1 class="shop__title"${bi(checkout.title.fa)}>${esc(checkout.title.en)}</h1>
        <p class="shop__lede"${bi(checkout.lede.fa)}>${esc(checkout.lede.en)}</p>
      </header>

      <form class="shop__checkout" data-checkout-one novalidate>
        <div class="shop__checkout-main">
          <fieldset class="shop__fieldset">
            <legend data-i18n="shopContact">Contact</legend>
            <div class="shop__fields">
${checkoutFields(data, ["name", "email"])}
            </div>
          </fieldset>

          <fieldset class="shop__fieldset">
            <legend data-i18n="shopAddress">Address</legend>
            <div class="shop__fields">
${checkoutFields(data, ["address", "city", "postcode", "country"])}
            </div>
          </fieldset>

          <fieldset class="shop__fieldset">
            <legend data-i18n="shopDelivery">Delivery</legend>
            <div class="shop__radios" data-delivery-group>
${data.checkout.delivery
  .map(
    (option, index) => `              <label class="shop__radio">
                <input type="radio" name="delivery" value="${esc(option.id)}" data-price="${option.price}"${index === 0 ? " checked" : ""} />
                <span class="shop__radio-label"${bi(option.label.fa)}>${esc(option.label.en)}</span>
                <span class="shop__radio-price force-ltr">${option.price === 0 ? "" : esc(money(option.price))}</span>
              </label>`,
  )
  .join("\n")}
            </div>
          </fieldset>

          <fieldset class="shop__fieldset">
            <legend data-i18n="shopPayment">Payment</legend>
            <div class="shop__fields">
${paymentFields(data)}
            </div>
          </fieldset>

          <p class="shop__form-error" data-form-error hidden role="alert"></p>
          <button type="submit" class="shop__cta shop__cta--wide" data-i18n="shopPlaceOrder">Place order</button>
          <p class="shop__success" data-success hidden${bi(checkout.success.fa)}>${esc(checkout.success.en)}</p>
        </div>

        <aside class="shop__totals shop__totals--sticky" aria-labelledby="checkout-totals">
          <h2 class="shop__totals-title" id="checkout-totals" data-i18n="shopYourOrder">Your order</h2>
          <ul class="shop__lines shop__lines--compact" data-cart-lines data-lines-variant="compact"></ul>
          <dl class="shop__totals-rows">
            <div><dt data-i18n="shopSubtotal">Subtotal</dt><dd class="force-ltr" data-total="subtotal">—</dd></div>
            <div data-discount-row hidden><dt data-i18n="shopDiscount">Discount</dt><dd class="force-ltr" data-total="discount">—</dd></div>
            <div><dt data-i18n="shopShipping">Shipping</dt><dd class="force-ltr" data-total="shipping">—</dd></div>
            <div><dt data-i18n="shopTax">VAT (21%)</dt><dd class="force-ltr" data-total="tax">—</dd></div>
            <div class="shop__totals-grand"><dt data-i18n="shopTotal">Total</dt><dd class="force-ltr" data-total="total">—</dd></div>
          </dl>
        </aside>
      </form>
    </main>`;
}

function checkoutRitual(data, base) {
  const ritual = data.checkout.ritual;
  return `    <main class="shop" id="main">
      <header class="shop__head">
        <p class="shop__kicker force-ltr"${bi(ritual.kicker.fa)}>${esc(ritual.kicker.en)}</p>
        <h1 class="shop__title"${bi(ritual.title.fa)}>${esc(ritual.title.en)}</h1>
        <p class="shop__lede"${bi(ritual.lede.fa)}>${esc(ritual.lede.en)}</p>
      </header>

      <div class="shop__ritual" data-ritual data-step="0">
        <ol class="shop__steps" data-steps>
${ritual.steps
  .map(
    (step, index) => `          <li class="shop__step${index === 0 ? " is-current" : ""}" data-step-item="${index}">
            <span class="shop__step-index force-ltr">${String(index + 1).padStart(2, "0")}</span>
            <span class="shop__step-text">
              <span class="shop__step-label"${bi(step.label.fa)}>${esc(step.label.en)}</span>
              <span class="shop__step-note"${bi(step.note.fa)}>${esc(step.note.en)}</span>
            </span>
          </li>`,
  )
  .join("\n")}
        </ol>

        <form class="shop__ritual-form" data-ritual-form novalidate>
          <section class="shop__ritual-panel" data-step-panel="0">
            <h2 class="shop__panel-title" data-i18n="shopReviewCart">Review your cart</h2>
            <p class="shop__cart-empty" data-cart-empty hidden${bi(data.cart.empty.fa)}>${esc(data.cart.empty.en)}</p>
            <ul class="shop__lines" data-cart-lines data-lines-variant="full"></ul>
          </section>

          <section class="shop__ritual-panel" data-step-panel="1" hidden>
            <h2 class="shop__panel-title" data-i18n="shopWhereItGoes">Where it goes</h2>
            <div class="shop__fields">
${checkoutFields(data, ["name", "email", "address", "city", "postcode", "country"])}
            </div>
          </section>

          <section class="shop__ritual-panel" data-step-panel="2" hidden>
            <h2 class="shop__panel-title" data-i18n="shopHowFast">How fast</h2>
            <div class="shop__radios" data-delivery-group>
${data.checkout.delivery
  .map(
    (option, index) => `              <label class="shop__radio">
                <input type="radio" name="delivery" value="${esc(option.id)}" data-price="${option.price}"${index === 0 ? " checked" : ""} />
                <span class="shop__radio-label"${bi(option.label.fa)}>${esc(option.label.en)}</span>
                <span class="shop__radio-price force-ltr">${option.price === 0 ? "" : esc(money(option.price))}</span>
              </label>`,
  )
  .join("\n")}
            </div>
          </section>

          <section class="shop__ritual-panel" data-step-panel="3" hidden>
            <h2 class="shop__panel-title" data-i18n="shopPayment">Payment</h2>
            <div class="shop__fields">
${paymentFields(data)}
            </div>
          </section>

          <p class="shop__form-error" data-form-error hidden role="alert"></p>
          <div class="shop__ritual-actions">
            <button type="button" class="shop__cta shop__cta--ghost" data-step-back data-i18n="shopBack" hidden>Back</button>
            <button type="button" class="shop__cta" data-step-next data-i18n="shopContinue">Continue</button>
            <button type="submit" class="shop__cta" data-step-finish data-i18n="shopFinish" hidden>Pay and finish</button>
          </div>
          <p class="shop__success" data-success hidden${bi(ritual.success.fa)}>${esc(ritual.success.en)}</p>
        </form>

        <aside class="shop__totals shop__totals--sticky">
          <h2 class="shop__totals-title" data-i18n="shopYourOrder">Your order</h2>
          <ul class="shop__lines shop__lines--compact" data-cart-lines data-lines-variant="compact"></ul>
          <dl class="shop__totals-rows">
            <div><dt data-i18n="shopSubtotal">Subtotal</dt><dd class="force-ltr" data-total="subtotal">—</dd></div>
            <div data-discount-row hidden><dt data-i18n="shopDiscount">Discount</dt><dd class="force-ltr" data-total="discount">—</dd></div>
            <div><dt data-i18n="shopShipping">Shipping</dt><dd class="force-ltr" data-total="shipping">—</dd></div>
            <div><dt data-i18n="shopTax">VAT (21%)</dt><dd class="force-ltr" data-total="tax">—</dd></div>
            <div class="shop__totals-grand"><dt data-i18n="shopTotal">Total</dt><dd class="force-ltr" data-total="total">—</dd></div>
          </dl>
        </aside>
      </div>
    </main>`;
}

/** The shop's own bar: the catalogue switches, the shop's nav, and the cart pill. */
function shopBar(data, base, active) {
  return `    <header class="shop__bar">
      <div class="shop__bar-row">
        <a class="shop__brand" href="index.html">
          <span class="shop__brand-dot" aria-hidden="true"></span>
          <span class="shop__brand-name"${bi(data.site.name.fa)}>${esc(data.site.name.en)}</span>
        </a>
        <nav class="shop__nav" aria-label="Shop">
${data.nav
  .map(
    (item) =>
      `          <a class="shop__nav-link${item.href === active ? " is-active" : ""}" href="${esc(item.href)}"${bi(item.label.fa)}>${esc(item.label.en)}</a>`,
  )
  .join("\n")}
        </nav>
        <div class="shop__bar-actions">
          <div class="lang-switch" data-lang-switch>
            <button type="button" class="lang-switch__button" data-lang="en">EN</button>
            <button type="button" class="lang-switch__button" data-lang="fa">فا</button>
          </div>
          <button type="button" class="theme-switch" data-theme-toggle data-i18n-aria="themeToggle" aria-label="Switch theme">
            <span data-theme-label-icon aria-hidden="true">◐</span>
          </button>
          <button type="button" class="shop__cart-pill" data-cart-open>
            <span data-i18n="shopCart">Cart</span>
            <span class="shop__cart-count force-ltr" data-cart-count>0</span>
          </button>
          <a class="shop__bar-link" href="${base}guide/index.html" data-i18n="guide">Guide</a>
        </div>
      </div>
    </header>`;
}

export async function emitShop({ root, manifest, variations }) {
  const docs = join(root, "docs");
  const data = JSON.parse(await readFileSafe(join(root, "sites", "shop.json")));
  const written = [];

  await rm(join(docs, "sites", "shop"), { recursive: true, force: true });
  const write = async (rel, html) => {
    const target = join(docs, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, html, "utf8");
    written.push(rel);
  };

  const base = "../../";
  const shell = (title, titleFa, description, descriptionFa, active, body) =>
    head({
      base,
      title,
      titleFa,
      description,
      descriptionFa,
      accent: "#c6a15b",
      styles: [`${base}assets/site.css`, `${base}assets/shop.css`],
      scripts: [`${base}assets/site.js`, `${base}assets/shop.js`],
      bodyClass: "shop-page",
    }) +
    shopBar(data, base, active) +
    body +
    foot({ base, scripts: [] });

  const pages = [
    {
      file: "sites/shop/index.html",
      active: "index.html",
      title: `${data.site.name.en} — ${data.physical.title.en}`,
      titleFa: `${data.site.name.fa} — ${data.physical.title.fa}`,
      description: data.physical.lede.en,
      descriptionFa: data.physical.lede.fa,
      body: () => storefront({ data, kind: "physical", base }),
    },
    {
      file: "sites/shop/digital.html",
      active: "digital.html",
      title: `${data.site.name.en} — ${data.digital.title.en}`,
      titleFa: `${data.site.name.fa} — ${data.digital.title.fa}`,
      description: data.digital.lede.en,
      descriptionFa: data.digital.lede.fa,
      body: () => storefront({ data, kind: "digital", base }),
    },
    {
      file: "sites/shop/product-chroma.html",
      active: "index.html",
      title: `${data.productChroma.name.en} — ${data.site.name.en}`,
      titleFa: `${data.productChroma.name.fa} — ${data.site.name.fa}`,
      description: data.productChroma.lede.en,
      descriptionFa: data.productChroma.lede.fa,
      body: () => productPage({ data, which: "chroma", base }),
    },
    {
      file: "sites/shop/product-editorial.html",
      active: "index.html",
      title: `${data.productEditorial.name.en} — ${data.site.name.en}`,
      titleFa: `${data.productEditorial.name.fa} — ${data.site.name.fa}`,
      description: data.productEditorial.lede.en,
      descriptionFa: data.productEditorial.lede.fa,
      body: () => productPage({ data, which: "editorial", base }),
    },
    {
      file: "sites/shop/cart.html",
      active: "cart.html",
      title: `${data.cart.title.en} — ${data.site.name.en}`,
      titleFa: `${data.cart.title.fa} — ${data.site.name.fa}`,
      description: data.cart.lede.en,
      descriptionFa: data.cart.lede.fa,
      body: () => cartPage(data, base),
    },
    {
      file: "sites/shop/checkout.html",
      active: "checkout.html",
      title: `${data.checkout.oneStep.title.en} — ${data.site.name.en}`,
      titleFa: `${data.checkout.oneStep.title.fa} — ${data.site.name.fa}`,
      description: data.checkout.oneStep.lede.en,
      descriptionFa: data.checkout.oneStep.lede.fa,
      body: () => checkoutOne(data, base),
    },
    {
      file: "sites/shop/checkout-ritual.html",
      active: "checkout.html",
      title: `${data.checkout.ritual.title.en} — ${data.site.name.en}`,
      titleFa: `${data.checkout.ritual.title.fa} — ${data.site.name.fa}`,
      description: data.checkout.ritual.lede.en,
      descriptionFa: data.checkout.ritual.lede.fa,
      body: () => checkoutRitual(data, base),
    },
  ];

  for (const page of pages) {
    await write(page.file, shell(page.title, page.titleFa, page.description, page.descriptionFa, page.active, page.body()));
  }

  return { written, data };
}

/** The shop is generated from a JSON file on disk; read it with a helpful error if it is missing. */
async function readFileSafe(path) {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`sites/shop.json is missing or unreadable: ${error.message}`);
  }
}
