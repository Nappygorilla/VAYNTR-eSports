(() => {
  "use strict";

  const API_BASE = "https://vayntr-esports.onrender.com";
  const page = document.body.dataset.contentPage;
  const selectors = { news: "#publicContent", results: "#publicContent", media: "#publicContent", home: "#homeNewsPreview" };
  const endpoints = { news: "/api/news", results: "/api/results", media: "/api/media", home: "/api/news" };
  const host = document.querySelector(selectors[page] || "");
  const endpoint = endpoints[page];
  if (!host || !endpoint) return;

  let allItems = [];
  let searchInput = null;
  let countStatus = null;
  let isLoading = false;

  function text(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? "" : String(value);
    parent.appendChild(node);
    return node;
  }

  function safeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function externalLink(parent, url, label) {
    const safeUrl = safeHttpsUrl(url);
    if (!safeUrl) return;
    const link = document.createElement("a");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "button button--outline";
    link.textContent = label + " ↗";
    parent.appendChild(link);
  }

  function formatDate(value) {
    if (!value) return "Date not specified";
    let date;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return "Date not specified";
      }
    } else {
      date = new Date(value);
    }
    if (Number.isNaN(date.getTime())) return "Date not specified";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function showEmpty(message, failure = false) {
    host.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "empty-state";
    text(panel, "span", "pill", failure ? "Feed temporarily unavailable" : "No matching items");
    text(panel, "h2", "", failure ? "The feed could not load." : "Nothing to show here yet.");
    text(panel, "p", "", message);
    if (failure) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button button--outline";
      retry.textContent = isLoading ? "Loading…" : "Try again";
      retry.disabled = isLoading;
      retry.addEventListener("click", () => load());
      panel.appendChild(retry);
    }
    host.appendChild(panel);
  }

  function cardFor(item, isHome) {
    const card = document.createElement("article");
    card.className = page === "results" ? "content-card content-card--result" : "content-card";

    const imageUrl = safeHttpsUrl(item.image_url);
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "content-card__image";
      image.src = imageUrl;
      image.alt = item.title ? "Artwork for " + item.title : "VAYNTR media artwork";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      card.appendChild(image);
    }

    const body = document.createElement("div");
    body.className = "content-card__body";
    const dateSource = item.played_at || item.created_at;
    text(body, "p", "content-card__eyebrow", (item.category || item.content_type || "VAYNTR") + " · " + formatDate(dateSource));
    text(body, "h3", "", item.title || "Untitled");

    if (page === "results") {
      const trustLine = document.createElement("p");
      trustLine.className = "content-card__trustline";
      text(trustLine, "span", "content-card__trust-pill", "Verified result");
      text(trustLine, "span", "content-card__trust-copy", "Staff-verified · evidence link attached");
      body.appendChild(trustLine);
    } else if (page === "news") {
      text(body, "p", "content-card__source-note", safeHttpsUrl(item.source_url)
        ? "External source link provided."
        : "No external source link provided.");
    } else if (page === "media") {
      text(body, "p", "content-card__source-note", safeHttpsUrl(item.source_url)
        ? "Media source link provided."
        : "Image asset only · no external media link.");
    }

    if (page === "results") {
      const line = [item.game, item.event_name, item.opponent ? "vs " + item.opponent : "", item.score, item.outcome]
        .filter(Boolean).join(" · ");
      if (line) text(body, "p", "content-card__result-line", line);
    }
    if (item.excerpt) text(body, "p", "content-card__excerpt", item.excerpt);
    if (!isHome && item.body) text(body, "p", "content-card__body-copy", item.body);
    if (page === "media" && item.game) text(body, "p", "content-card__excerpt", item.game);

    const actions = document.createElement("div");
    actions.className = "content-card__actions";
    externalLink(actions, item.source_url, page === "media" ? "Watch / open media" : page === "results" ? "Open evidence" : "Open source article");
    if (actions.childElementCount) body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function itemDate(item) {
    const date = new Date(item.played_at || item.created_at || 0).getTime();
    return Number.isNaN(date) ? 0 : date;
  }

  function renderItems() {
    const query = searchInput ? searchInput.value.trim().toLocaleLowerCase() : "";
    const matches = allItems.filter((item) => {
      if (!query) return true;
      return [item.title, item.category, item.content_type, item.excerpt, item.body, item.game, item.event_name,
        item.opponent, item.score, item.outcome].some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
    const visible = page === "home" ? matches.slice(0, 3) : matches;
    host.replaceChildren();
    if (!visible.length) {
      const panel = document.createElement("div");
      panel.className = "empty-state";
      text(panel, "span", "pill", allItems.length ? "No search matches" : "Nothing published yet");
      text(panel, "h2", "", allItems.length ? "No items match that search." : "Updates are being prepared.");
      text(panel, "p", "", allItems.length ? "Try another title, game, event, or keyword." : "Staff-published updates will appear here when available.");
      host.appendChild(panel);
    } else {
      for (const item of visible) host.appendChild(cardFor(item, page === "home"));
    }
    if (countStatus) {
      countStatus.textContent = query
        ? matches.length + " of " + allItems.length + " item(s)"
        : allItems.length + " item(s)";
    }
    host.setAttribute("aria-busy", "false");
  }

  function ensureSearchTools() {
    if (page === "home" || !host || searchInput) return;
    const toolbar = document.createElement("div");
    toolbar.className = "public-feed-tools";
    const label = document.createElement("label");
    label.className = "public-feed-tools__label";
    label.textContent = page === "results" ? "SEARCH MATCH RECORDS" : page === "media" ? "SEARCH MEDIA" : "SEARCH INTEL";
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "public-feed-tools__input";
    searchInput.placeholder = page === "results" ? "Search game, event, opponent…" : page === "media" ? "Search clips, games, titles…" : "Search titles and topics…";
    searchInput.setAttribute("aria-label", label.textContent);
    searchInput.autocomplete = "off";
    label.appendChild(searchInput);
    countStatus = document.createElement("p");
    countStatus.className = "public-feed-tools__count";
    countStatus.setAttribute("role", "status");
    countStatus.setAttribute("aria-live", "polite");
    countStatus.textContent = "Loading…";
    toolbar.append(label, countStatus);
    host.before(toolbar);
    searchInput.addEventListener("input", renderItems);
  }

  async function load() {
    if (isLoading) return;
    isLoading = true;
    host.setAttribute("aria-busy", "true");
    const retryButton = host.querySelector("button");
    if (retryButton) { retryButton.disabled = true; retryButton.textContent = "Loading…"; }
    if (countStatus) countStatus.textContent = "Loading…";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(API_BASE + endpoint, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Feed unavailable");
      const receivedItems = Array.isArray(data.items) ? data.items : [];
      allItems = receivedItems.filter((item) => {
        if (!item || typeof item !== "object") return false;
        if (page === "results") {
          return item.verified === true && Boolean(safeHttpsUrl(item.source_url));
        }
        if (page === "media") {
          return Boolean(safeHttpsUrl(item.source_url) || safeHttpsUrl(item.image_url));
        }
        return true;
      }).slice().sort((a, b) => itemDate(b) - itemDate(a));
      if (!allItems.length) {
        if (page === "home") showEmpty("VAYNTR will publish approved announcements and sourced competitive analysis here. No posts are published yet.");
        else if (page === "results" && receivedItems.length) showEmpty("A result is shown only when staff verification is present and a usable HTTPS evidence link is attached. Check the Content Desk for records missing either requirement.");
        else if (page === "results") showEmpty("Verified match results will appear after staff publish the record and confirm its source.");
        else if (page === "media" && receivedItems.length) showEmpty("Published media needs a usable HTTPS source link or image asset before it can appear. Check the media entry in the protected Content Desk.");
        else if (page === "media") showEmpty("Approved clips, player highlights, and team media will appear here once added through the protected staff portal.");
        else showEmpty("No official articles are published yet. Staff can add announcements and guides through the protected content desk.");
        if (countStatus) countStatus.textContent = "0 items";
        host.setAttribute("aria-busy", "false");
        return;
      }
      if (page === "home" || page === "news") host.classList.add("news-grid");
      ensureSearchTools();
      renderItems();
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "The request took too long. The API may be waking up; try again."
        : "The VAYNTR API is temporarily unavailable. Please try again in a little while.";
      showEmpty(message, true);
      if (countStatus) countStatus.textContent = "Feed unavailable";
      host.setAttribute("aria-busy", "false");
    } finally {
      window.clearTimeout(timeout);
      isLoading = false;
      const retryButtonAfter = host.querySelector("button");
      if (retryButtonAfter && retryButtonAfter.textContent === "Loading…") {
        retryButtonAfter.disabled = false;
        retryButtonAfter.textContent = "Try again";
      }
      host.setAttribute("aria-busy", "false");
    }
  }

  ensureSearchTools();
  load();
})();