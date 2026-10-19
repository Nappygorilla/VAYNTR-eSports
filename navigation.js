(() => {
  "use strict";

  // Warm same-site HTML documents so common page-to-page clicks feel immediate.
  // Standard links remain in place, so browser history, new-tab links and no-JS navigation still work.
  const basePath = new URL(".", window.location.href).pathname;
  const prefetched = new Set();
  const primedForPrerender = new Set();
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  function getInternalDocument(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return null;
    let url;
    try { url = new URL(anchor.href, window.location.href); } catch { return null; }
    if (url.origin !== window.location.origin || !url.pathname.startsWith(basePath)) return null;
    if (url.pathname.endsWith("/staff-applications.html") || url.pathname.endsWith("/404.html")) return null;
    if (!(url.pathname === basePath || /\.html?$/i.test(url.pathname))) return null;
    if (url.pathname === window.location.pathname && !url.search) return null;
    url.hash = "";
    return url.href;
  }

  function prefetch(url) {
    if (!url || prefetched.has(url) || saveData) return;
    prefetched.add(url);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url;
    document.head.appendChild(hint);
  }

  function prerenderOnIntent(url) {
    if (!url || primedForPrerender.has(url) || saveData) return;
    // API-backed pages can wake Render or issue duplicate data requests while prerendered.
    // They can still be prefetched as documents, but only static pages are prerendered.
    const parsed = new URL(url, window.location.href);
    if (/(?:^|\/)(?:index|roster|news|results|media|player)\.html?$/i.test(parsed.pathname)) return;
    primedForPrerender.add(url);
    // Browsers without Speculation Rules ignore the hint and use the normal navigation.
    if (!("HTMLScriptElement" in window) || !("supports" in HTMLScriptElement) ||
        !HTMLScriptElement.supports("speculationrules")) return;
    const rules = document.createElement("script");
    rules.type = "speculationrules";
    rules.textContent = JSON.stringify({
      prerender: [{ source: "list", urls: [url], eagerness: "immediate" }]
    });
    document.head.appendChild(rules);
  }

  document.addEventListener("pointerover", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const url = getInternalDocument(anchor);
    prefetch(url);
    prerenderOnIntent(url);
  }, { passive: true });

  document.addEventListener("focusin", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const url = getInternalDocument(anchor);
    prefetch(url);
    prerenderOnIntent(url);
  });

  const warmPageLinks = () => {
    if (saveData) return;
    document.querySelectorAll("a[href]").forEach((anchor) => prefetch(getInternalDocument(anchor)));
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warmPageLinks, { timeout: 1800 });
  } else {
    window.setTimeout(warmPageLinks, 900);
  }
})();