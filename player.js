(() => {
  "use strict";

  const API_BASE = "https://vayntr-esports.onrender.com";
  const root = document.getElementById("playerProfile");
  if (!root) return;

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

  function status(message, state) {
    const node = root.querySelector(".player-profile__status");
    if (!node) return;
    node.textContent = message;
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  }

  function showUnavailable(title, message, retryable = false) {
    root.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "empty-state";
    text(panel, "span", "pill", "PLAYER PROFILE");
    text(panel, "h2", "", title);
    text(panel, "p", "", message);
    const back = document.createElement("a");
    back.className = "button button--outline";
    back.href = "roster";
    back.textContent = "Back to roster";
    panel.appendChild(back);
    if (retryable) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button button--primary";
      retry.textContent = "Try again";
      retry.addEventListener("click", load);
      panel.appendChild(retry);
    }
    root.appendChild(panel);
  }

  function addExternalLink(parent, value, label) {
    const safeUrl = safeHttpsUrl(value);
    if (!safeUrl) return;
    const link = document.createElement("a");
    link.className = "button button--outline";
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label + " ↗";
    parent.appendChild(link);
  }

  // Consented member social links come from the validated JSONB array; the legacy single URL is folded in.
  function memberSocialLinks(player) {
    const seen = new Set();
    const links = [];
    const arrayLinks = Array.isArray(player.social_links) ? player.social_links : [];
    for (const entry of arrayLinks) {
      const safeUrl = entry && typeof entry === "object" ? safeHttpsUrl(entry.url) : "";
      if (!safeUrl || seen.has(safeUrl)) continue;
      seen.add(safeUrl);
      links.push({ label: (entry.label && typeof entry.label === "string" && entry.label.trim()) || "Social", url: safeUrl });
    }
    const legacy = safeHttpsUrl(player.social_url);
    if (legacy && !seen.has(legacy)) links.push({ label: "Player socials", url: legacy });
    return links;
  }

  function renderPlayer(player) {
    root.replaceChildren();
    const layout = document.createElement("div");
    layout.className = "player-profile__layout";

    const art = document.createElement("div");
    art.className = "player-profile__art";
    // A member-uploaded picture (stored in the backend database) takes priority over linked artwork.
    const uploadedAvatarUrl = player.has_avatar && /^\d+$/.test(String(player.id || ""))
      ? API_BASE + "/api/members/" + player.id + "/avatar"
      : "";
    const imageUrl = uploadedAvatarUrl || safeHttpsUrl(player.profile_image_url);
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "player-profile__image";
      image.src = imageUrl;
      image.alt = (uploadedAvatarUrl ? "Profile picture for " : "Player artwork for ") + String(player.display_name || "VAYNTR player");
      image.loading = "eager";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        const placeholder = document.createElement("div");
        placeholder.className = "player-profile__placeholder";
        placeholder.setAttribute("role", "img");
        placeholder.setAttribute("aria-label", "No player artwork available");
        placeholder.textContent = "V";
        image.replaceWith(placeholder);
      }, { once: true });
      art.appendChild(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "player-profile__placeholder";
      placeholder.setAttribute("role", "img");
        placeholder.setAttribute("aria-label", "No player artwork available");
      placeholder.textContent = "V";
      art.appendChild(placeholder);
    }

    const copy = document.createElement("div");
    copy.className = "player-profile__copy";
    text(copy, "p", "eyebrow", "VAYNTR / PLAYER PROFILE");
    text(copy, "p", "player-profile__division", player.game || "VAYNTR roster");
    const name = String(player.display_name || "VAYNTR player");
    text(copy, "h1", "player-profile__name", name);
    const meta = document.createElement("div");
    meta.className = "player-profile__meta";
    if (player.platform) {
      const platform = document.createElement("span");
      platform.className = "pill";
      platform.textContent = String(player.platform);
      meta.appendChild(platform);
    }
    if (player.role) {
      const role = document.createElement("span");
      role.className = "pill pill--red";
      role.textContent = String(player.role);
      meta.appendChild(role);
    }
    // The API only returns age when the player consented to a public age; it is NULL otherwise.
    if (player.age != null) {
      const agePill = document.createElement("span");
      agePill.className = "pill";
      agePill.textContent = "Age " + player.age;
      meta.appendChild(agePill);
    }
    copy.appendChild(meta);

    if (player.bio) text(copy, "p", "player-profile__bio", player.bio);
    else text(copy, "p", "player-profile__bio", "This player has not added a public bio yet.");

    const actions = document.createElement("div");
    actions.className = "player-profile__actions";
    for (const social of memberSocialLinks(player)) {
      addExternalLink(actions, social.url, social.label);
    }
    addExternalLink(actions, player.highlight_url, "Watch highlights");

    const share = document.createElement("button");
    share.type = "button";
    share.className = "button button--primary";
    share.textContent = "Copy profile link";
    share.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        status("Profile link copied.", "success");
      } catch {
        status("Copy was blocked by the browser. Copy the address from the address bar.", "error");
      }
    });
    actions.appendChild(share);

    const backToRoster = document.createElement("a");
    backToRoster.className = "button button--outline";
    backToRoster.href = "roster";
    backToRoster.textContent = "Back to roster";
    actions.appendChild(backToRoster);

    copy.appendChild(actions);

    const statusNode = text(copy, "p", "player-profile__status", "");
    statusNode.setAttribute("role", "status");
    statusNode.setAttribute("aria-live", "polite");

    layout.append(art, copy);
    root.appendChild(layout);
    document.title = name + " | VAYNTR Player Profile";
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = "Official VAYNTR player profile for " + name + " in " + String(player.game || "competitive esports") + ".";
    const heading = document.querySelector(".page-hero h1");
    if (heading) heading.textContent = "PLAYER PROFILE.";
  }

  async function load() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";
    if (!/^\d+$/.test(id)) {
      showUnavailable("Player not found.", "This profile link is missing a valid player ID. Browse the current roster to find confirmed players.");
      return;
    }

    root.setAttribute("aria-busy", "true");
    root.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "empty-state";
    text(loading, "span", "pill", "VAYNTR / PLAYER PROFILE");
    text(loading, "h2", "", "Loading player profile…");
    text(loading, "p", "", "Retrieving approved public roster details.");
    root.appendChild(loading);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(API_BASE + "/api/roster", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Roster service unavailable.");
      const players = Array.isArray(data.players) ? data.players : [];
      const player = players.find((item) => String(item.id) === id);
      if (!player) {
        showUnavailable("Player profile not found.", "This player may have been removed from the public roster. Visit the roster page to see the currently confirmed team.");
        return;
      }
      renderPlayer(player);
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "The roster API took too long to respond. It may be waking up from an idle period."
        : "The player profile could not be loaded right now. Please try again shortly.";
      showUnavailable("Profile temporarily unavailable.", message, true);
    } finally {
      window.clearTimeout(timeout);
      root.setAttribute("aria-busy", "false");
    }
  }

  load();
})();