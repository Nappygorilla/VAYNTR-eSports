(() => {
  "use strict";

  const API_BASE = "https://vayntr-esports.onrender.com";
  const groups = [
    { id: "warzone", game: "Call of Duty: Warzone", label: "Warzone" },
    { id: "cod", game: "Call of Duty Multiplayer", label: "Call of Duty Multiplayer" },
    { id: "rocketleague", game: "Rocket League", label: "Rocket League" },
    { id: "other", game: "Other / future division", label: "Other / future division" }
  ];

  function addText(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text == null ? "" : String(text);
    parent.appendChild(node);
    return node;
  }

  function showEmpty(section, label, title, message, state) {
    section.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "empty-state";
    addText(panel, "span", "pill", label);
    addText(panel, "h2", "", title);
    addText(panel, "p", "", message);
    if (state) panel.dataset.state = state;
    section.appendChild(panel);
  }

  function createPlayerCard(player) {
    const card = document.createElement("article");
    card.className = "roster-player-card";

    const top = document.createElement("div");
    top.className = "roster-player-card__top";
    addText(top, "span", "pill pill--red", "VAYNTR PLAYER");
    addText(top, "span", "roster-player-card__platform", player.platform);
    card.appendChild(top);

    if (player.profile_image_url) {
      try {
        const imageUrl = new URL(player.profile_image_url);
        if (imageUrl.protocol === "https:" && !imageUrl.username && !imageUrl.password) {
          const image = document.createElement("img");
          image.className = "roster-player-card__image";
          image.src = imageUrl.href;
          image.alt = "Portrait or player artwork for " + player.display_name;
          image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
          image.addEventListener("error", () => image.remove(), { once: true });
          card.appendChild(image);
        }
      } catch {}
    }
    addText(card, "h3", "roster-player-card__name", player.display_name);
    addText(card, "p", "roster-player-card__division", player.game);
    if (player.role) addText(card, "p", "roster-player-card__role", player.role);
    if (player.bio) addText(card, "p", "roster-player-card__bio", player.bio);
    const links = document.createElement("div");
    links.className = "roster-player-card__links";
    if (player.social_url) {
      const social = document.createElement("a");
      social.href = player.social_url; social.target = "_blank"; social.rel = "noopener noreferrer";
      social.textContent = "Player socials ↗";
      social.setAttribute("aria-label", player.display_name + " social profile");
      links.appendChild(social);
    }
    if (player.highlight_url) {
      const highlight = document.createElement("a");
      highlight.href = player.highlight_url; highlight.target = "_blank"; highlight.rel = "noopener noreferrer";
      highlight.textContent = "Highlights ↗";
      highlight.setAttribute("aria-label", player.display_name + " highlights");
      links.appendChild(highlight);
    }
    if (links.childElementCount) card.appendChild(links);
    return card;
  }

  async function loadRoster() {
    try {
      const response = await fetch(API_BASE + "/api/roster", { cache: "no-store" });
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
        addText(heading, "h2", "", group.label.toUpperCase() + ".");
        section.appendChild(heading);
        const grid = document.createElement("div");
        grid.className = "roster-player-grid";
        for (const player of playersForGroup) grid.appendChild(createPlayerCard(player));
        section.appendChild(grid);
      }
    } catch {
      for (const group of groups) {
        const section = document.getElementById(group.id);
        if (section) showEmpty(section, group.label, "Roster temporarily unavailable", "We couldn't load the confirmed roster right now. Please refresh the page in a moment.", "error");
      }
    }
  }

  loadRoster();
})();