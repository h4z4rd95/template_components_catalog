/**
 * shop.js — the cart engine, and every view over it.
 *
 * One state, four consumers: the storefronts add to it, the product pages configure it, the cart
 * edits it, and both checkouts read it. Because there is exactly one writer (`write()` below) and
 * one render pass (`render()`), the count in the bar and the rows in the cart cannot disagree —
 * which is the classic way a demo shop starts lying.
 *
 * What is real here and what is not, stated plainly:
 *   · real — persistence (`localStorage`), quantities, promo codes, shipping rules, VAT, the
 *     digital/physical split, per-step validation, and the fly-to-cart projection;
 *   · not — payment. Nothing is charged, and the checkout says so in both languages.
 *
 * Persian, RTL and day/night come from the shell (`chrome.js`): this file only re-renders the
 * *generated* nodes through `CatalogChrome.translateData`, which is why a row added while the page
 * is in Persian does not appear in English.
 */
(function () {
  "use strict";

  var chrome = window.CatalogChrome;
  var STORAGE_KEY = "catalog:cart";
  var PROMO_KEY = "catalog:promo";
  var VAT_RATE = 0.21;
  var FREE_SHIPPING_FROM = 120;
  var PROMOS = { STUDIO10: 0.1 };

  /* ------------------------------------------------------------------- state --- */

  /** A cart line: the product's identity, its price, and how many of it. */
  function lineKey(id, finish) {
    return finish ? id + ":" + finish : id;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.lines)) return { lines: [] };
      return { lines: parsed.lines.filter(function (line) { return line && line.id && line.qty > 0; }) };
    } catch (error) {
      return { lines: [] };
    }
  }

  var state = read();

  function write() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* private mode — the page still works, it just forgets on reload */
    }
    render();
  }

  function readPromo() {
    try {
      return window.localStorage.getItem(PROMO_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  var promo = readPromo();

  function t(key) {
    return chrome ? chrome.t(key) : key;
  }

  function locale() {
    var root = document.documentElement;
    return root.dataset.locale === "fa" ? "fa" : "en";
  }

  function nameOf(line) {
    return locale() === "fa" && line.nameFa ? line.nameFa : line.nameEn;
  }

  /* ------------------------------------------------------------------ totals --- */

  /**
   * Every number the shop shows, derived in one place.
   *
   * Shipping is a rule, not a field: digital-only carts never ship, physical carts ship free above
   * the threshold, and a chosen delivery option overrides both. VAT applies to goods, not to
   * shipping — the way a European invoice actually reads.
   */
  function totals() {
    var subtotal = 0;
    var physical = false;
    var count = 0;
    state.lines.forEach(function (line) {
      subtotal += line.price * line.qty;
      count += line.qty;
      if (line.kind !== "digital") physical = true;
    });

    var discount = promo && PROMOS[promo] ? subtotal * PROMOS[promo] : 0;
    var net = subtotal - discount;
    var shipping = 0;
    if (physical) {
      shipping = net >= FREE_SHIPPING_FROM ? 0 : 6;
      if (state.delivery === "express") shipping = 18;
      if (state.delivery === "pickup") shipping = 0;
    }
    var tax = net * VAT_RATE;
    return {
      subtotal: subtotal,
      discount: discount,
      shipping: shipping,
      tax: tax,
      total: net + shipping + tax,
      count: count,
      physical: physical,
    };
  }

  function money(value) {
    var grouped = String(Math.round(value * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
    return grouped + " €";
  }

  /* ------------------------------------------------------------------ actions --- */

  /** Add a good, or bump the line that already represents it. */
  function add(good) {
    var key = lineKey(good.id, good.finish);
    var existing = null;
    for (var i = 0; i < state.lines.length; i += 1) {
      if (state.lines[i].key === key) existing = state.lines[i];
    }
    if (existing) {
      existing.qty += good.qty || 1;
    } else {
      state.lines.push({
        key: key,
        id: good.id,
        sku: good.sku,
        finish: good.finish || "",
        nameEn: good.nameEn,
        nameFa: good.nameFa,
        price: good.price,
        kind: good.kind || "physical",
        qty: good.qty || 1,
      });
    }
    write();
    return key;
  }

  function setQty(key, qty) {
    state.lines = state.lines.map(function (line) {
      if (line.key !== key) return line;
      return Object.assign({}, line, { qty: qty });
    }).filter(function (line) { return line.qty > 0; });
    write();
  }

  function remove(key) {
    state.lines = state.lines.filter(function (line) { return line.key !== key; });
    write();
  }

  function clear() {
    state.lines = [];
    promo = "";
    state.delivery = "";
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PROMO_KEY);
    } catch (error) {
      /* ignore */
    }
    render();
  }

  function applyPromo(code) {
    var clean = String(code || "").trim().toUpperCase();
    if (PROMOS[clean]) {
      promo = clean;
      try {
        window.localStorage.setItem(PROMO_KEY, clean);
      } catch (error) {
        /* ignore */
      }
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------------- rendering --- */

  var linesHosts = [];
  var countHosts = [];
  var totalHosts = [];
  var emptyHosts = [];
  var discountRows = [];
  var checkoutLinks = [];

  /** A row in the cart: quantity stepper, remove button, and the line's own arithmetic. */
  function lineRow(line, variant) {
    var row = document.createElement("li");
    row.className = "shop__line" + (variant === "compact" ? " shop__line--compact" : "");
    row.setAttribute("data-line", line.key);
    row.setAttribute("data-qty", String(line.qty));

    var finish = line.finish ? '<span class="shop__line-finish">' + line.finish + "</span>" : "";
    var remove = variant === "compact"
      ? ""
      : '<button type="button" class="shop__line-remove" data-remove aria-label="' + esc(t("remove")) + '">×</button>';

    row.innerHTML =
      '<div class="shop__line-id">' +
        '<span class="shop__line-name"></span>' +
        '<span class="shop__line-meta"><span class="force-ltr">' + esc(line.sku) + "</span>" + finish + "</span>" +
      "</div>" +
      '<div class="shop__line-qty">' +
        '<button type="button" class="shop__qty-step" data-line-qty="-1" aria-label="' + esc(t("fewer")) + '">−</button>' +
        '<span class="shop__qty-value force-ltr">' + line.qty + "</span>" +
        '<button type="button" class="shop__qty-step" data-line-qty="1" aria-label="' + esc(t("more")) + '">+</button>' +
      "</div>" +
      '<p class="shop__line-price force-ltr">' + esc(money(line.price * line.qty)) + "</p>" +
      remove;

    // The name is set as text, not markup: it comes from a JSON file and may contain anything.
    var name = row.querySelector(".shop__line-name");
    name.textContent = line.nameEn;
    if (line.nameFa && line.nameFa !== line.nameEn) name.setAttribute("data-i18n-fa", line.nameFa);
    return row;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Repaint everything that depends on the cart — the only place any of it is written. */
  function render() {
    var sums = totals();

    countHosts.forEach(function (node) {
      node.textContent = String(sums.count);
      node.classList.toggle("is-empty", sums.count === 0);
    });

    emptyHosts.forEach(function (node) {
      node.hidden = sums.count > 0;
    });

    linesHosts.forEach(function (host) {
      var variant = host.getAttribute("data-lines-variant") || "full";
      var wasFilled = host.children.length > 0;
      host.textContent = "";
      state.lines.forEach(function (line) {
        host.appendChild(lineRow(line, variant === "compact" ? "compact" : "full"));
      });
      // The freshly written rows carry bilingual labels the shell has not translated yet.
      if (wasFilled !== host.children.length || host.children.length) {
        if (chrome) chrome.translateData(host);
      }
    });

    totalHosts.forEach(function (node) {
      var key = node.getAttribute("data-total");
      if (key === "shipping") {
        node.textContent = sums.physical ? (sums.shipping === 0 ? t("free") : money(sums.shipping)) : t("noShipping");
        return;
      }
      if (key === "discount") {
        node.textContent = sums.discount ? "−" + money(sums.discount) : money(0);
        return;
      }
      node.textContent = money(sums[key] || 0);
    });

    discountRows.forEach(function (row) {
      row.hidden = !sums.discount;
    });

    checkoutLinks.forEach(function (link) {
      link.classList.toggle("is-disabled", sums.count === 0);
      link.setAttribute("aria-disabled", sums.count === 0 ? "true" : "false");
    });

    document.body.classList.toggle("shop-has-items", sums.count > 0);
    document.dispatchEvent(new CustomEvent("catalog:cart", { detail: sums }));
  }

  /* ------------------------------------------------------------------- views --- */

  /** Collect every host the current page has, then paint once. */
  function collect() {
    linesHosts = Array.prototype.slice.call(document.querySelectorAll("[data-cart-lines]"));
    countHosts = Array.prototype.slice.call(document.querySelectorAll("[data-cart-count]"));
    totalHosts = Array.prototype.slice.call(document.querySelectorAll("[data-total]"));
    emptyHosts = Array.prototype.slice.call(document.querySelectorAll("[data-cart-empty]"));
    discountRows = Array.prototype.slice.call(document.querySelectorAll("[data-discount-row]"));
    checkoutLinks = Array.prototype.slice.call(document.querySelectorAll("[data-checkout-link]"));
  }

  /**
   * The fly-to-cart: a clone of the product card travels along a curve to the cart pill, so the
   * click has a consequence you can see. It is skipped under `prefers-reduced-motion` — the count
   * still updates, it just does not fly.
   */
  function flyToCart(from) {
    var pill = document.querySelector("[data-cart-open]");
    if (!pill) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var start = from.getBoundingClientRect();
    var end = pill.getBoundingClientRect();
    var ghost = document.createElement("span");
    ghost.className = "shop__ghost";
    ghost.style.setProperty("--from-x", start.left + start.width / 2 + "px");
    ghost.style.setProperty("--from-y", start.top + start.height / 2 + "px");
    ghost.style.setProperty("--to-x", end.left + end.width / 2 + "px");
    ghost.style.setProperty("--to-y", end.top + end.height / 2 + "px");
    document.body.appendChild(ghost);
    window.setTimeout(function () {
      ghost.remove();
      pill.classList.add("is-bumped");
      window.setTimeout(function () { pill.classList.remove("is-bumped"); }, 420);
    }, 720);
  }

  /** Quantity steppers on any card or panel. */
  function wireSteppers(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".shop__qty"), function (group) {
      var value = group.querySelector("[data-qty-value]");
      if (!value) return;
      Array.prototype.forEach.call(group.querySelectorAll("[data-qty]"), function (button) {
        if (button.dataset.wired === "1") return;
        button.dataset.wired = "1";
        button.addEventListener("click", function () {
          var next = Math.max(1, Math.min(99, Number(value.textContent) + Number(button.getAttribute("data-qty"))));
          value.textContent = String(next);
        });
      });
    });
  }

  function goodFrom(card, button) {
    var source = button || card;
    var quantity = card ? card.querySelector("[data-qty-value]") : null;
    return {
      id: source.getAttribute("data-id"),
      sku: source.getAttribute("data-sku"),
      price: Number(source.getAttribute("data-price")),
      kind: source.getAttribute("data-kind") || "physical",
      nameEn: source.getAttribute("data-name-en"),
      nameFa: source.getAttribute("data-name-fa"),
      finish: source.getAttribute("data-finish-label") || "",
      qty: quantity ? Number(quantity.textContent) : 1,
    };
  }

  /** Add buttons: cards carry their own record, the panel button reads the selected finish. */
  function wireAddButtons() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-add]"), function (button) {
      if (button.dataset.wired === "1") return;
      button.dataset.wired = "1";
      button.addEventListener("click", function () {
        var host = button.closest("[data-finish-stage], .shop__buy-panel");
        var stage = host && host.querySelector("[data-finish-stage]") ? host.querySelector("[data-finish-stage]") : host;
        var panel = button.closest(".shop__buy-panel");
        var card = button.closest("[data-good]");
        var good = goodFrom(panel || card, button.dataset.good === undefined ? button : null);

        if (panel) {
          var active = panel.querySelector(".shop__finish.is-active");
          if (active) {
            good.id = good.id;
            good.price = Number(active.getAttribute("data-price"));
            good.finish = active.querySelector(".shop__finish-name").textContent.trim();
            button.setAttribute("data-finish-label", good.finish);
          }
          var quantity = panel.querySelector("[data-qty-value]");
          good.qty = quantity ? Number(quantity.textContent) : 1;
        } else if (card) {
          good = goodFrom(card, card);
        }

        if (!good.id || !good.price) return;
        add(good);
        flyToCart(button);

        // The button itself confirms, rather than a drawer sliding over the shelf: a panel that
        // covers the page after every add makes shopping for a *second* thing impossible (it
        // intercepts the next click, which is exactly how this was caught). The pill already
        // shows the running total; the drawer is there when someone asks for it.
        var label = button.textContent;
        button.classList.add("is-added");
        button.textContent = t("added");
        window.setTimeout(function () {
          button.classList.remove("is-added");
          button.textContent = label;
          if (chrome) chrome.translateTree(document);
        }, 1300);
      });
    });
  }

  /** The cart drawer: a summary that can be dismissed, with the two obvious next moves. */
  var drawer = null;
  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement("div");
    drawer.className = "shop__drawer";
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="shop__drawer-backdrop" data-drawer-close></div>' +
      '<aside class="shop__drawer-panel" role="dialog" aria-modal="false" aria-label="' + esc(t("cart")) + '">' +
        '<header class="shop__drawer-head">' +
          '<h2 data-i18n="shopAdded">' + esc(t("added")) + "</h2>" +
          '<button type="button" class="shop__drawer-close" data-drawer-close aria-label="' + esc(t("close")) + '">×</button>' +
        "</header>" +
        '<p class="shop__drawer-line" data-drawer-line></p>' +
        '<dl class="shop__totals-rows shop__totals-rows--tight">' +
          '<div><dt data-i18n="shopSubtotal">' + esc(t("subtotal")) + '</dt><dd class="force-ltr" data-total="subtotal">—</dd></div>' +
          '<div class="shop__totals-grand"><dt data-i18n="shopTotal">' + esc(t("total")) + '</dt><dd class="force-ltr" data-total="total">—</dd></div>' +
        "</dl>" +
        '<div class="shop__drawer-actions">' +
          '<a class="shop__cta" href="cart.html" data-i18n="shopViewCart">' + esc(t("viewCart")) + "</a>" +
          '<button type="button" class="shop__cta shop__cta--ghost" data-drawer-close data-i18n="shopKeepShopping">' + esc(t("keepShopping")) + "</button>" +
        "</div>" +
      "</aside>";
    document.body.appendChild(drawer);
    Array.prototype.forEach.call(drawer.querySelectorAll("[data-drawer-close]"), function (node) {
      node.addEventListener("click", function () { drawer.hidden = true; });
    });
    return drawer;
  }

  function openDrawer(good) {
    var node = ensureDrawer();
    var line = node.querySelector("[data-drawer-line]");
    line.textContent = good.qty + " × " + (locale() === "fa" && good.nameFa ? good.nameFa : good.nameEn) +
      (good.finish ? " — " + good.finish : "");
    node.hidden = false;
    collect();
    render();
    if (chrome) {
      chrome.translateTree(node);
      chrome.translateData(node);
    }
  }

  function wireCartTriggers() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-cart-open]"), function (button) {
      if (button.dataset.wired === "1") return;
      button.dataset.wired = "1";
      button.addEventListener("click", function () {
        if (window.location.pathname.indexOf("cart.html") === -1) {
          window.location.href = "cart.html";
          return;
        }
        openDrawer({ qty: totals().count, nameEn: t("cart"), nameFa: t("cart"), finish: "" });
      });
    });
  }

  /** Cart-page interactions: quantity, removal (animated), and the promo form. */
  function wireCartPage() {
    document.addEventListener("click", function (event) {
      var removeButton = event.target.closest("[data-remove]");
      if (removeButton) {
        var row = removeButton.closest("[data-line]");
        var key = row && row.getAttribute("data-line");
        if (!key) return;
        // Choreography: the row collapses first, then the list closes the gap. Removing first and
        // animating after is how a cart ends up jumping.
        row.classList.add("is-leaving");
        window.setTimeout(function () { remove(key); }, 220);
        return;
      }

      var step = event.target.closest("[data-line-qty]");
      if (step) {
        var line = step.closest("[data-line]");
        var lineKeyValue = line && line.getAttribute("data-line");
        if (!lineKeyValue) return;
        var current = Number(line.getAttribute("data-qty"));
        setQty(lineKeyValue, Math.max(0, current + Number(step.getAttribute("data-line-qty"))));
      }
    });

    var promoForm = document.querySelector("[data-promo]");
    if (promoForm) {
      promoForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = promoForm.querySelector("input[name=promo]");
        var note = document.querySelector("[data-promo-note]");
        var ok = applyPromo(input ? input.value : "");
        if (note) {
          note.setAttribute("data-i18n-fa", t(ok ? "promoApplied" : "promoInvalid"));
          note.textContent = t(ok ? "promoApplied" : "promoInvalid");
          note.classList.toggle("is-ok", ok);
          note.classList.toggle("is-bad", !ok);
        }
        render();
      });
    }
  }

  /* ------------------------------------------------------------- validation --- */

  var RULES = {
    name: function (value) { return value.trim().length >= 2 || "required"; },
    email: function (value) { return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value.trim()) || "email"; },
    address: function (value) { return value.trim().length >= 4 || "required"; },
    city: function (value) { return value.trim().length >= 2 || "required"; },
    postcode: function (value) { return value.trim().length >= 3 || "required"; },
    country: function (value) { return value.trim().length >= 2 || "required"; },
    card: function (value) { return value.replace(/\D/g, "").length === 16 || "card"; },
    expiry: function (value) {
      var match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(value.trim());
      if (!match) return "expiry";
      var month = Number(match[1]);
      var year = 2000 + Number(match[2]);
      if (month < 1 || month > 12) return "expiry";
      var now = new Date();
      return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1) || "expiry";
    },
    cvc: function (value) { return /^\d{3,4}$/.test(value.trim()) || "cvc"; },
  };

  /** Validate one field; returns "" when it is fine. */
  function validateField(input) {
    var rule = RULES[input.getAttribute("data-validate")];
    if (!rule) return "";
    var result = rule(input.value || "");
    return result === true ? "" : result || "required";
  }

  function showFieldError(input, code) {
    var host = input.closest(".shop__field");
    var message = host && host.querySelector("[data-error-for='" + input.getAttribute("data-validate") + "']");
    if (host) host.classList.toggle("has-error", Boolean(code));
    input.setAttribute("aria-invalid", code ? "true" : "false");
    if (message) {
      message.hidden = !code;
      message.textContent = code ? t(code) : "";
    }
  }

  /** Validate a scope (a form, or one ritual panel) and focus the first offender. */
  function validateScope(scope) {
    var inputs = scope.querySelectorAll("[data-validate]");
    var first = null;
    Array.prototype.forEach.call(inputs, function (input) {
      var code = validateField(input);
      showFieldError(input, code);
      if (code && !first) first = input;
    });
    if (first) first.focus();
    return !first;
  }

  function wireValidation() {
    document.addEventListener("blur", function (event) {
      var input = event.target;
      if (input && input.matches && input.matches("[data-validate]")) showFieldError(input, validateField(input));
    }, true);
  }

  /* ------------------------------------------------------------- checkout(s) --- */

  function paymentSummary() {
    var sums = totals();
    return sums;
  }

  function wireOneStep() {
    var form = document.querySelector("[data-checkout-one]");
    if (!form) return;
    var error = form.querySelector("[data-form-error]");
    var success = form.querySelector("[data-success]");

    Array.prototype.forEach.call(form.querySelectorAll("[data-price]"), function (input) {
      input.addEventListener("change", function () {
        state.delivery = input.value;
        write();
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var sums = paymentSummary();
      if (!sums.count) {
        if (error) {
          error.hidden = false;
          error.textContent = t("cartEmpty");
        }
        return;
      }
      var ok = validateScope(form);
      if (error) {
        error.hidden = ok;
        if (!ok) error.textContent = t("fixFields");
      }
      if (!ok) return;
      if (success) {
        success.hidden = false;
        success.setAttribute("data-i18n-fa", t("orderPlaced"));
        success.textContent = t("orderPlaced");
        if (chrome) {
          chrome.translateTree(form);
          chrome.translateData(form);
        }
      }
      clear();
      collect();
      render();
    });
  }

  function wireRitual() {
    var root = document.querySelector("[data-ritual]");
    if (!root) return;
    var form = root.querySelector("[data-ritual-form]");
    var steps = Array.prototype.slice.call(root.querySelectorAll("[data-step-item]"));
    var panels = Array.prototype.slice.call(root.querySelectorAll("[data-step-panel]"));
    var back = root.querySelector("[data-step-back]");
    var next = root.querySelector("[data-step-next]");
    var finish = root.querySelector("[data-step-finish]");
    var error = root.querySelector("[data-form-error]");
    var success = root.querySelector("[data-success]");
    var index = 0;

    function paint() {
      root.setAttribute("data-step", String(index));
      steps.forEach(function (step, i) {
        step.classList.toggle("is-current", i === index);
        step.classList.toggle("is-done", i < index);
        step.setAttribute("aria-current", i === index ? "step" : "false");
      });
      panels.forEach(function (panel, i) { panel.hidden = i !== index; });
      if (back) back.hidden = index === 0;
      if (next) next.hidden = index === panels.length - 1;
      if (finish) finish.hidden = index !== panels.length - 1;
      if (error) error.hidden = true;
      var heading = panels[index] && panels[index].querySelector(".shop__panel-title");
      if (heading) heading.setAttribute("tabindex", "-1"), heading.focus({ preventScroll: true });
    }

    next && next.addEventListener("click", function () {
      var panel = panels[index];
      if (panel && !validateScope(panel)) {
        if (error) {
          error.hidden = false;
          error.textContent = t("fixFields");
        }
        return;
      }
      if (index === 0 && totals().count === 0) {
        if (error) {
          error.hidden = false;
          error.textContent = t("cartEmpty");
        }
        return;
      }
      index = Math.min(index + 1, panels.length - 1);
      paint();
    });

    back && back.addEventListener("click", function () {
      index = Math.max(index - 1, 0);
      paint();
    });

    Array.prototype.forEach.call(form.querySelectorAll("[data-price]"), function (input) {
      input.addEventListener("change", function () {
        state.delivery = input.value;
        write();
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!validateScope(panels[index])) {
        if (error) {
          error.hidden = false;
          error.textContent = t("fixFields");
        }
        return;
      }
      if (success) {
        success.hidden = false;
        success.setAttribute("data-i18n-fa", t("orderPlaced"));
        success.textContent = t("orderPlaced");
        if (chrome) {
          chrome.translateTree(form);
          chrome.translateData(form);
        }
      }
      clear();
      collect();
      render();
    });

    paint();
  }

  /* ------------------------------------------------------------------ filters --- */

  function wireFilters() {
    var chips = document.querySelectorAll("[data-filter]");
    if (!chips.length) return;
    var goods = Array.prototype.slice.call(document.querySelectorAll("[data-grid] [data-good]"));
    var empty = document.querySelector("[data-empty]");
    var countHost = document.querySelector("[data-shelf-count]");

    function counts() {
      var map = { all: 0 };
      goods.forEach(function (good) {
        var material = good.getAttribute("data-material") || "";
        map.all += 1;
        map[material] = (map[material] || 0) + 1;
      });
      return map;
    }

    function apply(id) {
      var shown = 0;
      goods.forEach(function (good) {
        var match = id === "all" || good.getAttribute("data-material") === id;
        good.hidden = !match;
        if (match) shown += 1;
      });
      Array.prototype.forEach.call(chips, function (chip) {
        var on = chip.getAttribute("data-filter") === id;
        chip.classList.toggle("is-active", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (empty) empty.hidden = shown > 0;
      if (countHost) countHost.textContent = String(shown);
    }

    var map = counts();
    Array.prototype.forEach.call(document.querySelectorAll("[data-count]"), function (node) {
      var key = node.getAttribute("data-count");
      node.textContent = String(map[key] || 0);
    });

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () { apply(chip.getAttribute("data-filter")); });
    });
  }

  /* ----------------------------------------------------------------- finishes --- */

  function wireFinishes() {
    var stage = document.querySelector("[data-finish-stage]");
    var panel = document.querySelector(".shop__buy-panel");
    if (!stage || !panel) return;
    var buttons = Array.prototype.slice.call(panel.querySelectorAll(".shop__finish"));
    var priceHost = panel.querySelector("[data-finish-price]");
    var add = panel.querySelector("[data-add]");
    var accent = stage;

    function select(button) {
      buttons.forEach(function (other) {
        var on = other === button;
        other.classList.toggle("is-active", on);
        other.setAttribute("aria-checked", on ? "true" : "false");
      });
      var price = Number(button.getAttribute("data-price"));
      if (priceHost) priceHost.textContent = money(price);
      if (add) {
        add.setAttribute("data-price", String(price));
        add.setAttribute("data-finish-label", button.querySelector(".shop__finish-name").textContent.trim());
      }
      // The stage tint follows the finish: the page is arguing that the colour is the product.
      var colour = button.style.getPropertyValue("--finish");
      if (accent && colour) accent.style.setProperty("--shop-finish", colour.trim());
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () { select(button); });
    });
    if (buttons[0]) select(buttons[0]);
  }

  /* --------------------------------------------------------------------- boot --- */

  function boot() {
    collect();
    wireSteppers(document);
    wireAddButtons();
    wireCartTriggers();
    wireCartPage();
    wireValidation();
    wireOneStep();
    wireRitual();
    wireFilters();
    wireFinishes();
    render();

    // A language switch re-renders every generated row in the new language.
    document.addEventListener("catalog:locale", function () {
      render();
    });
    if (chrome && chrome.on) {
      chrome.on("locale", function () { render(); });
      chrome.on("theme", function () { render(); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Exposed for the gate and for anything that wants to react to the cart.
  window.CatalogShop = {
    add: add,
    remove: remove,
    setQty: setQty,
    clear: clear,
    totals: totals,
    money: money,
    state: function () { return state; },
  };
})();
