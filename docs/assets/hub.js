/* ============================================================================
   hub.js — The Catalog showroom controller.

   Responsibilities
     1. load the manifest (data/catalog.json, or the file:// fallback in data/catalog.js)
     2. render live counters, the discipline rail, the tag rail and one card per variation
     3. filter + search across id/title/vibe/stack/tags/interaction
     4. mount preview iframes lazily (IntersectionObserver + a hard concurrency cap, because
        every WebGL variation holds a real GL context and browsers cap live contexts)
     5. probe whether a framework build exists, and say so honestly when it does not
     6. drive the full-screen "stage" overlay, including postMessage requests from the
        variation's own HUD (the Expand button), hash deep-links and keyboard control
   ========================================================================= */
(function () {
  "use strict";

  var MAX_LIVE_FRAMES = 6; // browsers throttle beyond ~8-16 GL contexts; stay well clear

  // `?live=N` caps how many previews run at once. The default stays at six because a showroom with
  // live artwork is the point — but six simultaneous WebGL scenes on a software rasterizer (a
  // headless capture, a locked-down laptop) is minutes per frame, so the budget has to be a dial,
  // not a constant. N=0 renders the composed posters only, which is also the honest state for a
  // device with no GPU at all.
  (function applyLiveBudget() {
    try {
      var requested = new URLSearchParams(window.location.search).get("live");
      if (requested === null) return;
      var value = parseInt(requested, 10);
      if (isNaN(value)) return;
      MAX_LIVE_FRAMES = Math.max(0, Math.min(6, value));
    } catch (err) {
      /* no URL API: keep the default */
    }
  })();

  var state = {
    manifest: null,
    variations: [],
    discipline: "all",
    topic: "all",
    tag: "all",
    query: "",
    webglOnly: false,
    view: "grid",
  };

  var cards = new Map(); // card element → variation
  var availability = new Map(); // variation id → boolean | null (unknown)
  var live = new Set(); // cards with a mounted iframe
  var pending = new Set(); // cards requesting a mount
  var lastSeen = new Map();

  var dom = {};

  /* ------------------------------------------------------------------ helpers */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function debounce(fn, wait) {
    var timer = 0;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  /** matchMedia is absent in some embedded webviews (and in jsdom) — never assume it exists. */
  function prefersReducedMotion() {
    try {
      return typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    } catch (error) {
      return false;
    }
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(function () {
        return legacyCopy(value);
      });
    }
    return legacyCopy(value);
  }

  function legacyCopy(value) {
    return new Promise(function (resolve) {
      var helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try {
        document.execCommand("copy");
      } catch (error) {
        /* nothing else we can do — the UI still reports the attempt */
      }
      helper.remove();
      resolve();
    });
  }

  /* ------------------------------------------------------------------ shell */

  /* The hub is one page in two languages and two themes. Everything user-facing goes through
     `t()` / `pick()` so a language flip is a re-render, not a reload. */
  function t(key) {
    return window.CatalogChrome ? window.CatalogChrome.t(key) : key;
  }

  function pick(record, field) {
    return window.CatalogChrome ? window.CatalogChrome.pick(record, field) : record[field];
  }

  function label(record) {
    return window.CatalogChrome ? window.CatalogChrome.label(record) : record.label;
  }

  function topicById(id) {
    var topics = state.manifest.topics || [];
    for (var i = 0; i < topics.length; i += 1) if (topics[i].id === id) return topics[i];
    return null;
  }

  /* ------------------------------------------------------------------ manifest */

  function loadManifest() {
    if (window.__CATALOG__) return Promise.resolve(window.__CATALOG__);

    return fetch("data/catalog.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("manifest " + res.status);
        return res.json();
      })
      .catch(function (error) {
        console.warn("[catalog] could not load the manifest:", error);
        return { variations: [], disciplines: [], counts: { total: 0 }, meta: {} };
      });
  }

  function counts() {
    var unique = function (list) {
      return list.filter(function (value, index) {
        return list.indexOf(value) === index;
      });
    };
    var stacks = [];
    var engines = [];
    var engineKeywords = ["gsap", "motion", "scrolltrigger", "observer", "lenis", "splittext", "waapi", "raf"];

    state.variations.forEach(function (v) {
      stacks = stacks.concat(v.stack);
      v.stack.forEach(function (tech) {
        var lower = tech.toLowerCase();
        if (engineKeywords.some(function (keyword) { return lower.indexOf(keyword) !== -1; })) {
          engines.push(tech);
        }
      });
    });

    return {
      variations: state.variations.length,
      batches: unique(state.variations.map(function (v) { return v.batch; })).length,
      stacks: unique(stacks).length,
      engines: unique(engines).length,
      heroes: state.variations.filter(function (v) { return v.discipline === "Hero"; }).length,
      webgl: state.variations.filter(function (v) { return v.perf && v.perf.webgl; }).length,
      disciplines: unique(state.variations.map(function (v) { return v.discipline; })).length,
      tags: unique(
        state.variations.reduce(function (all, v) { return all.concat(v.tags); }, []),
      ),
    };
  }

  /* ------------------------------------------------------------------ rendering */

  function renderCounters() {
    var tally = counts();
    var set = function (id, value) {
      var node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    set("stat-variations", String(tally.variations).padStart(2, "0"));
    set("stat-batches", String(tally.batches).padStart(2, "0"));
    set("stat-stacks", String(tally.stacks).padStart(2, "0"));
    set("fact-hero", String(tally.heroes).padStart(2, "0"));
    set("fact-webgl", String(tally.webgl).padStart(2, "0"));
    set("fact-engines", String(tally.engines).padStart(2, "0"));
    set("fact-disciplines", String(tally.disciplines).padStart(2, "0"));

    if (dom.footerMeta && state.manifest) {
      var meta = state.manifest.meta || {};
      dom.footerMeta.textContent =
        (meta.name || "The Catalog") + " · v" + (meta.version || "—") + " · manifest " +
        (state.manifest.generatedAt ? state.manifest.generatedAt.slice(0, 10) : "local");
    }
  }

  function renderDisciplineRail() {
    dom.disciplineRail.innerHTML = "";
    dom.disciplineRail.dataset.label = t("disciplines");

    var all = el("button", "chip is-active", t("all") + " (" + state.variations.length + ")");
    all.type = "button";
    all.dataset.discipline = "all";
    all.setAttribute("aria-pressed", "true");
    dom.disciplineRail.appendChild(all);

    (state.manifest.disciplines || []).forEach(function (discipline) {
      var count = state.variations.filter(function (v) { return v.discipline === discipline.id; }).length;
      var button = el("button", "chip", label(discipline).replace(/ &.*/, "") + " (" + count + ")");
      button.type = "button";
      button.dataset.discipline = discipline.id;
      button.title = window.CatalogChrome ? window.CatalogChrome.blurb(discipline) : discipline.blurb || "";
      button.setAttribute("lang", state.manifest.defaultLocale || "en");
      button.setAttribute("aria-pressed", "false");
      button.disabled = count === 0;
      button.style.opacity = count === 0 ? "0.38" : "";
      dom.disciplineRail.appendChild(button);
    });
  }

  /**
   * The topic rail is the middle rung of the structure the catalogue promised:
   * discipline → topic → variation. It narrows to the topics that the currently
   * selected discipline actually owns, so the rail never offers a dead end.
   */
  function renderTopicRail() {
    if (!dom.topicRail) return;
    dom.topicRail.innerHTML = "";
    dom.topicRail.dataset.label = t("topics");

    var inScope = state.variations.filter(function (v) {
      return state.discipline === "all" || v.discipline === state.discipline;
    });
    var present = {};
    inScope.forEach(function (v) {
      if (v.topic) present[v.topic] = (present[v.topic] || 0) + 1;
    });

    if (!Object.keys(present).length) {
      dom.topicRail.hidden = true;
      return;
    }
    dom.topicRail.hidden = false;

    var all = el("button", "chip is-active", t("all") + " (" + inScope.length + ")");
    all.type = "button";
    all.dataset.topic = "all";
    all.setAttribute("aria-pressed", "true");
    dom.topicRail.appendChild(all);

    Object.keys(present).forEach(function (id) {
      var topic = topicById(id);
      if (!topic) return;
      var button = el("button", "chip", label(topic) + " (" + present[id] + ")");
      button.type = "button";
      button.dataset.topic = id;
      button.title = window.CatalogChrome ? window.CatalogChrome.blurb(topic) : topic.blurb || "";
      button.setAttribute("aria-pressed", "false");
      dom.topicRail.appendChild(button);
    });
  }

  function renderTagRail() {
    dom.tagRail.innerHTML = "";
    dom.tagRail.dataset.label = t("topics");

    var tally = counts().tags.slice(0, 18);
    var all = el("button", "chip is-active", t("all"));
    all.type = "button";
    all.dataset.tag = "all";
    all.setAttribute("aria-pressed", "true");
    dom.tagRail.appendChild(all);

    tally.forEach(function (tag) {
      var button = el("button", "chip", tag.replace(/-/g, " "));
      button.type = "button";
      button.dataset.tag = tag;
      button.setAttribute("aria-pressed", "false");
      dom.tagRail.appendChild(button);
    });
  }

  function buildCard(variation) {
    var card = el("article", "card");
    card.style.setProperty("--card-accent", variation.accent);
    card.dataset.discipline = variation.discipline;
    card.dataset.tags = variation.tags.join(",");
    card.dataset.webgl = variation.perf && variation.perf.webgl ? "1" : "0";
    if (variation.status === "planned") {
      card.dataset.planned = "1";
      frame_prepare(card);
    }
    card.id = "card-" + variation.slug;
    card.dataset.haystack = [
      variation.id,
      variation.title,
      variation.titleFa,
      variation.vibe,
      variation.vibeFa,
      variation.stack.join(" "),
      variation.tags.join(" "),
      variation.interaction,
      variation.interactionFa,
      variation.topic,
      variation.discipline,
    ]
      .join(" ")
      .toLowerCase();

    var handlers = {
      onOpen: openStage,
      onCopy: function (value, button) {
        copyText(value).then(function () {
          var original = button.textContent;
          button.textContent = "Copied ✓";
          setTimeout(function () {
            button.textContent = original;
          }, 1500);
        });
      },
    };

    card.appendChild(window.CatalogHUD.renderCardHUD(variation, handlers));

    var frame = el("div", "card__frame");
    var placeholder = el("div", "card__placeholder");
    placeholder.appendChild(el("span", "card__spinner"));
    placeholder.appendChild(el("span", null, "live preview mounts as you scroll"));
    placeholder.appendChild(el("b", null, variation.id));
    frame.appendChild(placeholder);
    card.appendChild(frame);

    card.appendChild(
      window.CatalogHUD.renderTagRail(variation, function (tag) {
        state.tag = tag;
        syncRailActive();
        applyFilters();
        dom.catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );

    cards.set(card, variation);
    return card;
  }

  /** Give the frame its "planned" caption in the active language (CSS prints it). */
  function frame_prepare(card) {
    var frame = card.querySelector(".card__frame");
    if (!frame) return;
    var note = t("comingSoon") + "\n" + t("openPreview");
    frame.dataset.plannedNote = note;
  }

  /* ------------------------------------------------------------------ filtering */

  function isVisible(variation, needle) {
    if (state.discipline !== "all" && variation.discipline !== state.discipline) return false;
    if (state.topic !== "all" && variation.topic !== state.topic) return false;
    if (state.tag !== "all" && variation.tags.indexOf(state.tag) === -1) return false;
    if (state.webglOnly && !(variation.perf && variation.perf.webgl)) return false;
    if (needle) {
      var card = document.getElementById("card-" + variation.slug);
      var haystack = card ? card.dataset.haystack : "";
      if (haystack.indexOf(needle) === -1) return false;
    }
    return true;
  }

  function applyFilters() {
    var needle = state.query.trim().toLowerCase();
    var visible = 0;

    cards.forEach(function (variation, card) {
      var show = isVisible(variation, needle);
      card.hidden = !show;
      if (show) {
        visible += 1;
        if (!document.documentElement.dataset.reducedMotion) {
          card.classList.add("is-entering");
          window.requestAnimationFrame(function () {
            card.classList.remove("is-entering");
          });
        }
      } else {
        releaseFrame(card);
      }
    });

    dom.empty.hidden = visible > 0;
    dom.empty.querySelector("[data-i18n]") &&
      (dom.empty.querySelector("[data-i18n]").textContent = t("noResults"));
    var scope = [];
    if (state.discipline !== "all") {
      var discipline = (state.manifest.disciplines || []).filter(function (d) {
        return d.id === state.discipline;
      })[0];
      if (discipline) scope.push(label(discipline));
    }
    if (state.topic !== "all") {
      var topic = topicById(state.topic);
      if (topic) scope.push(label(topic));
    }
    if (state.tag !== "all") scope.push("#" + state.tag);
    dom.results.textContent =
      t("showing") + " " + visible + " " + t("of") + " " + state.variations.length + " " + t("variations") +
      (scope.length ? " · " + scope.join(" · ") : "") +
      (needle ? ' · "' + state.query.trim() + '"' : "");
  }

  function syncRailActive() {
    [dom.disciplineRail, dom.tagRail].forEach(function (rail) {
      Array.prototype.forEach.call(rail.querySelectorAll(".chip"), function (chip) {
        var active =
          (chip.dataset.discipline && chip.dataset.discipline === state.discipline) ||
          (chip.dataset.tag && chip.dataset.tag === state.tag);
        chip.classList.toggle("is-active", !!active);
        chip.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  }

  /* ------------------------------------------------------------------ frames */

  function frameSrcFor(variation) {
    // Always address the concrete file: directory indexes resolve on Pages, but not on file://.
    return variation.href + "index.html";
  }

  function probeAvailability(variation) {
    if (availability.has(variation.id)) return Promise.resolve(availability.get(variation.id));

    // file:// blocks fetch entirely, and some older engines have no fetch at all — in both cases
    // assume the route exists and let the iframe's own error handler report otherwise.
    if (location.protocol === "file:" || typeof fetch !== "function") {
      availability.set(variation.id, true);
      return Promise.resolve(true);
    }

    return fetch(frameSrcFor(variation), { method: "HEAD", cache: "no-cache" })
      .then(function (res) {
        availability.set(variation.id, res.ok);
        return res.ok;
      })
      .catch(function () {
        availability.set(variation.id, false);
        return false;
      });
  }

  function showBuildNotice(card, variation) {
    var frame = card.querySelector(".card__frame");
    if (frame.querySelector(".card__notice")) return;

    var notice = el("div", "card__notice");
    notice.appendChild(el("strong", null, "framework build missing"));
    var copy = el("p", null);
    copy.appendChild(document.createTextNode("This variation ships from "));
    copy.appendChild(el("code", null, variation.source));
    copy.appendChild(
      document.createTextNode(
        " and is exported into docs/framework/ at build time. Run it locally with npm run build, or read the source on GitHub.",
      ),
    );
    notice.appendChild(copy);

    var actions = el("div", "card__actions");
    var source = el("a", "card__action card__action--primary", "Read the source ↗");
    source.href = window.CatalogHUD.GITHUB + "/tree/main/" + variation.source;
    source.target = "_blank";
    source.rel = "noreferrer noopener";
    actions.appendChild(source);

    var workflow = el("a", "card__action", "View build workflow ↗");
    workflow.href = window.CatalogHUD.GITHUB + "/blob/main/.github/workflows/deploy.yml";
    workflow.target = "_blank";
    workflow.rel = "noreferrer noopener";
    actions.appendChild(workflow);
    notice.appendChild(actions);

    frame.appendChild(notice);
  }

  function mountFrame(card) {
    var variation = cards.get(card);
    if (!variation || live.has(card)) return;
    // A planned variation has no page yet: mounting it would put a 404 inside the card.
    if (variation.status === "planned") return;
    var frame = card.querySelector(".card__frame");
    if (!frame || frame.querySelector("iframe")) return;
    // Claim the slot synchronously: availability probing is async, so two pumps could otherwise
    // both pass this guard and mount the same card twice.
    live.add(card);

    var iframe = document.createElement("iframe");
    iframe.src = frameSrcFor(variation);
    iframe.title = variation.id + " — live preview";
    iframe.loading = "lazy";
    iframe.setAttribute("allow", "fullscreen; autoplay");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.addEventListener("load", function () {
      iframe.classList.add("is-live");
      frame.classList.add("is-live");
    });
    iframe.addEventListener("error", function () {
      releaseFrame(card);
      showBuildNotice(card, variation);
    });

    probeAvailability(variation).then(function (available) {
      if (!available) {
        live.delete(card);
        showBuildNotice(card, variation);
        return;
      }
      if (card.hidden || !live.has(card)) {
        // The card scrolled away (or was filtered out) while we probed — do not mount it.
        live.delete(card);
        return;
      }
      frame.appendChild(iframe);
    });
  }

  function releaseFrame(card) {
    pending.delete(card);
    live.delete(card);
    var frame = card.querySelector(".card__frame");
    if (!frame) return;
    var iframe = frame.querySelector("iframe");
    if (iframe) {
      iframe.src = "about:blank"; // release the GL context immediately before detaching
      iframe.remove();
    }
    frame.classList.remove("is-live");
    // NOTE: deliberately no pump() here — see the comment on pump().
  }

  /**
   * Mounts queued cards nearest-to-viewport-centre first, staying under the context cap.
   *
   * Two invariants matter here:
   *   1. The cap check must happen *outside* the iteration. An earlier version called releaseFrame()
   *      — which recursively calls pump() — from inside the loop that was also mounting, so each
   *      pass remounted what the previous pass had just torn down: a leaked, GL-backed iframe per
   *      pump. Verified fixed in a real browser: 4 → 0 → 4 → 0 across scroll cycles, no growth.
   *   2. releaseFrame() must never be called from pump(). The IntersectionObserver owns eviction;
   *      pump() only decides whether there is room to mount.
   */
  function pump() {
    if (!pending.size) return;

    var mid = window.innerHeight / 2;
    var queue = Array.from(pending).sort(function (a, b) {
      return Math.abs(a.getBoundingClientRect().top - mid) - Math.abs(b.getBoundingClientRect().top - mid);
    });

    for (var i = 0; i < queue.length; i += 1) {
      var card = queue[i];
      pending.delete(card);
      if (card.hidden) continue;
      if (live.size >= MAX_LIVE_FRAMES) continue; // no room; a later pump retries after an eviction
      mountFrame(card);
    }
  }

  function observeFrames() {
    if (!("IntersectionObserver" in window)) {
      // No IO (very old browsers): mount the first few and move on.
      Array.from(cards.keys()).slice(0, MAX_LIVE_FRAMES).forEach(mountFrame);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var card = entry.target;
          lastSeen.set(card, performance.now());
          if (entry.isIntersecting) pending.add(card);
          else releaseFrame(card);
        });
        pump();
      },
      { rootMargin: "320px 0px", threshold: 0.01 },
    );

    cards.forEach(function (_variation, card) {
      observer.observe(card);
    });
  }

  /* ------------------------------------------------------------------ stage overlay */

  var lastFocused = null;

  function openStage(variation) {
    lastFocused = document.activeElement;
    dom.stage.hidden = false;
    document.body.style.overflow = "hidden";
    dom.stageId.textContent = variation.id;
    dom.stageTitle.textContent = variation.title + " — " + variation.vibe;
    dom.stageFoot.textContent = variation.interaction;
    dom.stageOpen.href = frameSrcFor(variation);
    dom.stageSource.href = window.CatalogHUD.GITHUB + "/tree/main/" + variation.source;
    dom.stageReload.onclick = function () {
      dom.stageFrame.src = frameSrcFor(variation);
    };
    dom.stageFrame.src = frameSrcFor(variation);
    history.replaceState(null, "", "#/" + variation.route);

    var closer = dom.stage.querySelector("[data-close].chip");
    if (closer) closer.focus();
  }

  function closeStage() {
    if (dom.stage.hidden) return;
    dom.stage.hidden = true;
    document.body.style.overflow = "";
    dom.stageFrame.src = "about:blank";
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openFromHash() {
    var hash = window.location.hash.replace(/^#\/?/, "");
    if (!hash) return;
    var match = state.variations.filter(function (v) {
      return hash === v.route || hash === v.slug || hash === v.id;
    })[0];
    if (match) openStage(match);
  }

  /* ------------------------------------------------------------------ wiring */

  function wireTopicRail() {
    if (!dom.topicRail) return;
    dom.topicRail.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-topic]");
      if (!chip) return;
      state.topic = chip.dataset.topic;
      syncRailActive();
      applyFilters();
    });
  }

  function wire() {
    dom.search.addEventListener(
      "input",
      debounce(function (event) {
        state.query = event.target.value;
        applyFilters();
      }, 140),
    );

    dom.disciplineRail.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip || chip.disabled) return;
      state.discipline = chip.dataset.discipline;
      state.topic = "all";
      renderTopicRail();
      syncRailActive();
      applyFilters();
    });

    dom.tagRail.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      state.tag = chip.dataset.tag;
      syncRailActive();
      applyFilters();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (button) {
      button.addEventListener("click", function () {
        state.view = button.dataset.view;
        dom.cards.dataset.view = state.view;
        Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (other) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        });
      });
    });

    dom.webglOnly.addEventListener("change", function (event) {
      state.webglOnly = event.target.checked;
      applyFilters();
    });

    document.addEventListener("keydown", function (event) {
      var typing = /input|textarea|select/i.test((event.target && event.target.tagName) || "");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        dom.search.focus();
        dom.search.select();
        return;
      }
      if (event.key === "Escape") {
        if (!dom.stage.hidden) closeStage();
        else if (typing) event.target.blur();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (typing || !dom.stage.hidden) return;
        var list = Array.from(cards.keys()).filter(function (card) {
          return !card.hidden;
        });
        var index = list.indexOf(document.activeElement && document.activeElement.closest(".card"));
        if (index === -1) return;
        var next = list[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        next.scrollIntoView({ behavior: "smooth", block: "center" });
        var focusable = next.querySelector(".card__action");
        if (focusable) focusable.focus({ preventScroll: true });
      }
    });

    dom.stage.addEventListener("click", function (event) {
      if (event.target.closest("[data-close]")) closeStage();
    });

    window.addEventListener("hashchange", function () {
      if (!window.location.hash) closeStage();
      else openFromHash();
    });

    // The variation's own HUD (inside the iframe) can ask the hub to expand it.
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "catalog:expand") return;
      var match = state.variations.filter(function (v) { return v.id === event.data.id; })[0];
      if (match) openStage(match);
    });

    window.addEventListener(
      "resize",
      debounce(function () {
        pump();
      }, 200),
    );
  }

  /* ------------------------------------------------------------------ boot */

  function cacheDom() {
    dom = {
      catalog: document.getElementById("catalog"),
      cards: document.getElementById("cards"),
      empty: document.getElementById("empty"),
      results: document.getElementById("results"),
      search: document.getElementById("search"),
      webglOnly: document.getElementById("webgl-only"),
      disciplineRail: document.getElementById("discipline-rail"),
      topicRail: document.getElementById("topic-rail"),
      tagRail: document.getElementById("tag-rail"),
      footerMeta: document.getElementById("footer-meta"),
      stage: document.getElementById("stage"),
      stageId: document.getElementById("stage-id"),
      stageTitle: document.getElementById("stage-title"),
      stageFoot: document.getElementById("stage-foot"),
      stageOpen: document.getElementById("stage-open"),
      stageSource: document.getElementById("stage-source"),
      stageReload: document.getElementById("stage-reload"),
      stageFrame: document.getElementById("stage-frame"),
    };
  }

  function boot() {
    cacheDom();
    if (prefersReducedMotion()) document.documentElement.dataset.reducedMotion = "1";

    loadManifest().then(function (manifest) {
      state.manifest = manifest;
      state.variations = manifest.variations || [];

      // The shell owns language, direction and theme for the whole catalogue.
      if (window.CatalogChrome) window.CatalogChrome.init(manifest);

      renderCounters();
      renderDisciplineRail();
      renderTopicRail();
      renderTagRail();

      var fragment = document.createDocumentFragment();
      state.variations.forEach(function (variation) {
        fragment.appendChild(buildCard(variation));
      });
      dom.cards.appendChild(fragment);
      dom.cards.dataset.view = state.view;

      applyFilters();
      wire();
      wireTopicRail();
      observeFrames();
      openFromHash();

      // A language flip re-renders every part of the grid that carries copy. Rebuilding the cards
      // is deliberate: each one holds a HUD, a tag rail and a preview frame, and patching those in
      // place would leave a dozen half-translated strings behind.
      if (window.CatalogChrome) {
        window.CatalogChrome.on(function () {
          renderDisciplineRail();
          renderTopicRail();
          renderTagRail();
          var bySlug = {};
          state.variations.forEach(function (v) { bySlug[v.slug] = v; });
          var fresh = document.createDocumentFragment();
          state.variations.forEach(function (variation) {
            fresh.appendChild(buildCard(variation));
          });
          dom.cards.innerHTML = "";
          dom.cards.appendChild(fresh);
          cards.clear();
          Array.prototype.forEach.call(dom.cards.children, function (card) {
            var slug = card.id.replace(/^card-/, "");
            if (bySlug[slug]) cards.set(card, bySlug[slug]);
          });
          observeFrames();
          applyFilters();
        });
      }

      if (!state.variations.length) {
        dom.results.textContent = "manifest empty — run npm run catalog:sync";
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
