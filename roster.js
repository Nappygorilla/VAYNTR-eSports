(() => {
  "use strict";

  const API_BASE = "https://vayntr-esports.onrender.com";
  const groups = [
    { id: "warzone", game: "Call of Duty: Warzone", label: "Warzone" },
    { id: "cod", game: "Call of Duty Multiplayer", label: "Call of Duty Multiplayer" },
    { id: "rocketleague", game: "Rocket League", label: "Rocket League" },
    { id: "other", game: "Other / future division", label: "Other / future division" }
  ];

  function addText(parent, tag, className, value) {
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

  function addExternalLink(parent, url, label, accessibleLabel) {
    const safeUrl = safeHttpsUrl(url);
    if (!safeUrl) return;
    const link = document.createElement("a");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    if (accessibleLabel) link.setAttribute("aria-label", accessibleLabel);
    parent.appendChild(link);
  }

  function showEmpty(section, label, title, message, state) {
    section.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "empty-state";
    addText(panel, "span", "pill", label);
    const heading = addText(panel, "h2", "", title);
    heading.id = section.id + "RosterHeading";
    addText(panel, "p", "", message);
    if (state) panel.dataset.state = state;
    section.appendChild(panel);
  }

  function createPlayerCard(player) {
    const card = document.createElement("article");
    card.className = "roster-player-card";

    const displayName = String(player.display_name || "VAYNTR player");
    const top = document.createElement("div");
    top.className = "roster-player-card__top";
    addText(top, "span", "pill pill--red", "VAYNTR PLAYER");
    addText(top, "span", "roster-player-card__platform", player.platform || "Platform not listed");
    card.appendChild(top);

    const imageUrl = safeHttpsUrl(player.profile_image_url);
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "roster-player-card__image";
      image.src = imageUrl;
      image.alt = "Player artwork for " + displayName;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      card.appendChild(image);
    }

    addText(card, "h3", "roster-player-card__name", displayName);
    addText(card, "p", "roster-player-card__division", player.game || "Division not listed");
    if (player.role) addText(card, "p", "roster-player-card__role", player.role);
    if (player.bio) addText(card, "p", "roster-player-card__bio", player.bio);

    const links = document.createElement("div");
    links.className = "roster-player-card__links";
    const playerId = String(player.id == null ? "" : player.id);
    if (/^\d+$/.test(playerId)) {
      const profile = document.createElement("a");
      profile.href = "player.html?id=" + encodeURIComponent(playerId);
      profile.textContent = "View player profile ↗";
      profile.setAttribute("aria-label", "View " + displayName + "'s VAYNTR profile");
      links.appendChild(profile);
    }
    addExternalLink(links, player.social_url, "Player socials ↗", displayName + " social profile");
    addExternalLink(links, player.highlight_url, "Highlights ↗", displayName + " highlights");
    if (links.childElementCount) card.appendChild(links);
    return card;
  }

  async function loadRoster() {
    const sections = groups.map((group) => document.getElementById(group.id)).filter(Boolean);
    for (const section of sections) section.setAttribute("aria-busy", "true");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(API_BASE + "/api/roster", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Roster service unavailable.");
      const players = Array.isArray(data.players) ? data.players : [];

      for (const group of groups) {
        const section = document.getElementById(group.id);
        if (!section) continue;
        const playersForGroup = players.filter((player) =>
          (player.game || "") === group.game || (group.id === "other" &&
            !groups.slice(0, 3).some((known) => known.game === player.game))
        );
        if (!playersForGroup.length) {
          showEmpty(section, group.label, "No players confirmed yet", "Accepted VAYNTR players will appear here after staff approval.");
          continue;
        }
        section.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "roster-section-heading";
        addText(heading, "p", "eyebrow", group.label + " / confirmed roster");
        const rosterHeading = addText(heading, "h2", "", group.label.toUpperCase() + ".");
        rosterHeading.id = group.id + "RosterHeading";
        section.appendChild(heading);
        const grid = document.createElement("div");
        grid.className = "roster-player-grid";
        for (const player of playersForGroup) grid.appendChild(createPlayerCard(player));
        section.appendChild(grid);
      }
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "The roster request timed out. The API may be waking up; refresh to try again."
        : "We couldn't load the confirmed roster right now. Please refresh the page in a moment.";
      for (const group of groups) {
        const section = document.getElementById(group.id);
        if (section) showEmpty(section, group.label, "Roster temporarily unavailable", message, "error");
      }
    } finally {
      window.clearTimeout(timeout);
      for (const section of sections) section.setAttribute("aria-busy", "false");
    }
  }

  loadRoster();
})();