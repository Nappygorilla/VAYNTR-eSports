(() => {
  "use strict";
  const API_BASE = "https://vayntr-esports.onrender.com";
  const page = document.body.dataset.contentPage;
  const selectors = { news: "#publicContent", results: "#publicContent", media: "#publicContent", home: "#homeNewsPreview" };
  const host = document.querySelector(selectors[page] || "");
  if (!host) return;
  const endpoint = { news: "/api/news", results: "/api/results", media: "/api/media", home: "/api/news" }[page];

  function text(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? "" : String(value);
    parent.appendChild(node);
    return node;
  }
  function externalLink(parent, url, label) {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return;
      const link = document.createElement("a");
      link.href = parsed.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.className = "button button--outline";
      link.textContent = label + " ↗";
      parent.appendChild(link);
    } catch {}
  }
  function showEmpty(message, failure=false) {
    host.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "empty-state";
    text(panel, "span", "pill", failure ? "Feed temporarily unavailable" : "Nothing published yet");
    text(panel, "h2", "", failure ? "The feed could not load." : "Updates are being prepared.");
    text(panel, "p", "", message);
    host.appendChild(panel);
  }
  function cardFor(item, isHome) {
    const card = document.createElement("article");
    card.className = page === "results" ? "content-card content-card--result" : "content-card";
    if (item.image_url) {
      try {
        const parsed = new URL(item.image_url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
          const image = document.createElement("img");
          image.className = "content-card__image";
          image.src = parsed.href;
          image.alt = item.title ? "Artwork for " + item.title : "VAYNTR media artwork";
          image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
          image.addEventListener("error", () => image.remove(), { once: true });
          card.appendChild(image);
        }
      } catch {}
    }
    const body = document.createElement("div");
    body.className = "content-card__body";
    const dateSource = item.played_at || item.created_at;
    const date = dateSource ? new Date(dateSource).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "Date not specified";
    text(body,"p","content-card__eyebrow",(item.category || item.content_type || "VAYNTR") + " · " + date);
    text(body,"h3","",item.title || "Untitled");
    if (page === "results") {
      const line = [item.game,item.event_name,item.opponent ? "vs "+item.opponent : "",item.score,item.outcome].filter(Boolean).join(" · ");
      if (line) text(body,"p","content-card__result-line",line);
    }
    if (item.excerpt) text(body,"p","content-card__excerpt",item.excerpt);
    if (!isHome && item.body) text(body,"p","content-card__body-copy",item.body);
    if (page === "media" && item.game) text(body,"p","content-card__excerpt",item.game);
    const actions=document.createElement("div");actions.className="content-card__actions";
    externalLink(actions,item.source_url,page==="media"?"Watch / open media":page==="results"?"Source / proof":"Read source");
    if (actions.childElementCount) body.appendChild(actions);
    card.appendChild(body);
    return card;
  }
  async function load() {
    try {
      const response = await fetch(API_BASE + endpoint, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Feed unavailable");
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        if (page === "home") {
          showEmpty("VAYNTR will publish approved announcements and sourced competitive analysis here. No posts are published yet.");
        } else if (page === "results") {
          showEmpty("Verified match results will appear here after staff publish the record and confirm its source.");
        } else if (page === "media") {
          showEmpty("Approved clips, player highlights, and team media will appear here once added through the protected staff portal.");
        } else {
          showEmpty("No official articles are published yet. Staff can add announcements and guides through the protected content desk.");
        }
        return;
      }
      host.replaceChildren();
      if (page === "home" || page === "news") host.classList.add("news-grid");
      const visible = page === "home" ? items.slice(0,3) : items;
      for (const item of visible) host.appendChild(cardFor(item,page==="home"));
    } catch {
      showEmpty("The VAYNTR API is temporarily unavailable. Please refresh in a little while.",true);
    }
  }
  load();
})();