(() => {
  "use strict";
  const API_BASE = "https://vayntr-esports.onrender.com";
  const TOKEN_KEY = "vayntr-staff-session";
  const $ = (selector, root = document) => root.querySelector(selector);
  const loginPanel = $("#staffLoginPanel");
  const reviewPanel = $("#staffReviewPanel");
  const loginForm = $("#staffLoginForm");
  const loginStatus = $("#staffLoginStatus");
  const reviewStatus = $("#staffReviewStatus");
  const list = $("#applicationsList");
  const manualEmailFollowup = $("#manualEmailFollowup");
  const loginButton = $("#staffLoginButton");
  let activeView = "overview";
  let token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {}

  function setStatus(node, message, state) {
    if (!node) return;
    node.textContent = message || "";
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  }

  function activateView(name) {
    const requested = document.querySelector('[data-staff-view="' + name + '"]');
    if (!requested) return;
    activeView = name;
    document.querySelectorAll("[data-staff-view]").forEach((view) => {
      view.hidden = view.dataset.staffView !== name;
    });
    document.querySelectorAll("[data-staff-tab]").forEach((tab) => {
      const active = tab.dataset.staffTab === name;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  }

  async function loadOverview() {
    const databaseStatus = $("#overviewDatabaseStatus");
    const databaseNote = $("#overviewDatabaseNote");
    try {
      const data = await api("/api/status");
      const features = data.features || {};
      const ready = Boolean(features.recruitmentApplications && features.staffReviewConfigured);
      if (databaseStatus) {
        databaseStatus.textContent = features.recruitmentApplications ? "CONNECTED" : "CHECK";
        databaseStatus.dataset.state = features.recruitmentApplications ? "success" : "warning";
      }
      if (databaseNote) databaseNote.textContent = features.recruitmentApplications
        ? (ready ? "API and database are reachable." : "Database is reachable; check staff-token configuration.")
        : "Database/API readiness needs attention.";
      setStatus($("#portalActionStatus"),
        ready ? "Portal connected. Recruitment and staff review are configured." : "Portal loaded, but recruitment readiness needs attention.",
        ready ? "success" : "warning");
    } catch (error) {
      if (databaseStatus) {
        databaseStatus.textContent = "OFFLINE";
        databaseStatus.dataset.state = "error";
      }
      if (databaseNote) databaseNote.textContent = "Could not read the API feature status.";
      setStatus($("#portalActionStatus"), error.message || "Unable to check backend status.", "error");
    }
  }

  async function refreshActiveView() {
    if (activeView === "applications") return loadApplications();
    if (activeView === "roster") return loadRoster();
    if (activeView === "overview") {
      await Promise.all([loadApplications(false), loadOverview()]);
      return;
    }
    await loadOverview();
  }

  async function api(path, options = {}) {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(API_BASE + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "The request failed.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function signOut() {
    token = "";
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    reviewPanel.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    list.replaceChildren();
    activateView("overview");
    if (manualEmailFollowup) {
      manualEmailFollowup.hidden = true;
      manualEmailFollowup.replaceChildren();
    }
    setStatus(loginStatus, "Signed out.", "success");
  }

  function addText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text == null ? "" : String(text);
    parent.appendChild(element);
    return element;
  }

  function showManualEmailFollowup(contact, decision) {
    if (!manualEmailFollowup) return;
    manualEmailFollowup.replaceChildren();
    const email = String(contact && contact.email || "").trim();
    const displayName = String(contact && contact.displayName || "applicant");
    const accepted = decision === "accept";

    addText(manualEmailFollowup, "p", "eyebrow", "Manual follow-up / " + (accepted ? "accepted" : "declined"));
    addText(manualEmailFollowup, "h3", "staff-application__name", accepted ? "WELCOME TO VAYNTR." : "RECRUITMENT DECISION.");
    addText(manualEmailFollowup, "p", "", accepted
      ? "The player is on the public roster and the application is deleted. Compose your welcome email here, or find their contact in the accepted roster below."
      : "The application is deleted and no roster entry was created. You can compose the denial email now; no email is sent until you press Send in your mail app.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addText(manualEmailFollowup, "p", "form-note", "The applicant email could not be opened as a mail link. Contact details may need to be checked.");
      manualEmailFollowup.hidden = false;
      return;
    }
    addText(manualEmailFollowup, "p", "staff-application__meta", "To: " + email);
    const subject = accepted ? "VAYNTR Esports | Welcome to the Roster" : "VAYNTR Esports | Recruitment Decision";
    const message = accepted
      ? "Hi " + displayName + ",\n\nYour application to VAYNTR Esports has been accepted. Welcome to the roster! We will follow up with any onboarding steps and expectations.\n\nVAYNTR Esports"
      : "Hi " + displayName + ",\n\nThank you for applying to VAYNTR Esports. After reviewing your application, we are unable to offer you a roster spot at this time. We appreciate your interest and wish you the best.\n\nVAYNTR Esports";
    const link = document.createElement("a");
    link.className = "button button--primary";
    link.href = "mailto:" + encodeURIComponent(email).replace("%40", "@") +
      "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(message);
    link.textContent = accepted ? "Compose welcome email ↗" : "Compose denial email ↗";
    link.setAttribute("aria-label", (accepted ? "Compose welcome email for " : "Compose denial email for ") + displayName);
    manualEmailFollowup.appendChild(link);
    manualEmailFollowup.hidden = false;
  }

  function renderApplication(application) {
    const card = document.createElement("article");
    card.className = "application-panel staff-application";

    const top = document.createElement("div");
    top.className = "staff-application__top";
    const identity = document.createElement("div");
    addText(identity, "h3", "staff-application__name", application.display_name);
    addText(identity, "p", "staff-application__meta", application.email);
    top.appendChild(identity);
    addText(top, "span", "pill", "AWAITING DECISION");
    card.appendChild(top);

    const details = document.createElement("div");
    details.className = "staff-application__details";
    addText(details, "p", "", "Game / division: " + application.game);
    addText(details, "p", "", "Platform: " + application.platform);
    addText(details, "p", "", "Submitted: " + (application.created_at ? new Date(application.created_at).toLocaleString() : "Unknown"));
    card.appendChild(details);

    const videoBlock = document.createElement("div");
    videoBlock.className = "staff-application__video";
    addText(videoBlock, "b", "", "Applicant's YouTube video");
    if (application.youtube_url) {
      const link = document.createElement("a");
      link.href = application.youtube_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open submitted video ↗";
      videoBlock.appendChild(link);
    } else {
      addText(videoBlock, "p", "form-note", "This older application has no YouTube link.");
    }
    card.appendChild(videoBlock);

    if (application.message) {
      const note = document.createElement("div");
      note.className = "staff-application__note";
      addText(note, "b", "", "Additional information");
      addText(note, "p", "", application.message);
      card.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "staff-application__actions";
    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.className = "button button--primary";
    acceptButton.textContent = "Accept & add to roster";
    const denyButton = document.createElement("button");
    denyButton.type = "button";
    denyButton.className = "button button--outline";
    denyButton.textContent = "Deny & delete application";

    async function decide(decision) {
      const accepting = decision === "accept";
      const message = accepting
        ? "Accept " + application.display_name + "? They will be added to the public roster and this application will be deleted. Their email will remain private in the staff roster so you can contact them manually."
        : "Deny " + application.display_name + "? This permanently deletes the application without adding them to the roster.";
      if (!window.confirm(message)) return;

      acceptButton.disabled = true;
      denyButton.disabled = true;
      setStatus(reviewStatus, accepting ? "Adding player to roster…" : "Deleting application…");
      try {
        const result = await api("/api/staff/applications/" + encodeURIComponent(application.id) + "/decision", {
          method: "POST",
          body: JSON.stringify({ decision })
        });
        await loadApplications(false);
        showManualEmailFollowup(result.contact, decision);
        setStatus(reviewStatus, result.message || (accepting
          ? "Applicant accepted and added to roster."
          : "Application denied and deleted."), "success");
      } catch (error) {
        if (error.status === 401 || error.status === 403) signOut();
        setStatus(reviewStatus, error.message || "Unable to process this application.", "error");
      } finally {
        acceptButton.disabled = false;
        denyButton.disabled = false;
      }
    }

    acceptButton.addEventListener("click", () => decide("accept"));
    denyButton.addEventListener("click", () => decide("deny"));
    actions.append(acceptButton, denyButton);
    card.appendChild(actions);
    return card;
  }

  async function loadApplications(showLoading = true) {
    if (showLoading) setStatus(reviewStatus, "Loading applications…");
    list.replaceChildren();
    try {
      const firstOpen = reviewPanel.hidden;
      const result = await api("/api/staff/applications");
      loginPanel.hidden = true;
      reviewPanel.hidden = false;
      const applications = Array.isArray(result.applications) ? result.applications : [];
      const appCount = String(applications.length);
      if ($("#overviewApplicationCount")) $("#overviewApplicationCount").textContent = appCount;
      if ($("#applicationTabCount")) $("#applicationTabCount").textContent = appCount;
      if (firstOpen) activateView("overview");
      if (applications.length === 0) {
        addText(list, "div", "empty-state", "No applications have been submitted yet.");
        await loadRoster(false);
        await loadOverview();
        setStatus(reviewStatus, "Queue loaded. No applications are waiting.", "success");
        return;
      }
      for (const application of applications) list.appendChild(renderApplication(application));
      await loadRoster(false);
      await loadOverview();
      setStatus(reviewStatus, "Loaded " + applications.length + " application(s).", "success");
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        signOut();
        setStatus(loginStatus, "Access denied. Check that STAFF_REVIEW_TOKEN is configured correctly in Render and paste the exact value here.", "error");
      } else if (reviewPanel.hidden) {
        setStatus(loginStatus, error.message || "Unable to connect to the review service.", "error");
      } else {
        setStatus(reviewStatus, error.message || "Unable to load applications.", "error");
      }
    }
  }

  async function loadRoster(showLoading = true) {
    const rosterList = $("#staffRosterList");
    const rosterStatus = $("#staffRosterStatus");
    if (!rosterList || !rosterStatus) return;
    if (showLoading) setStatus(rosterStatus, "Loading accepted roster…");
    rosterList.replaceChildren();
    try {
      const result = await api("/api/staff/roster");
      const players = Array.isArray(result.players) ? result.players : [];
      const rosterCount = String(players.length);
      if ($("#overviewRosterCount")) $("#overviewRosterCount").textContent = rosterCount;
      if ($("#rosterTabCount")) $("#rosterTabCount").textContent = rosterCount;
      if (players.length === 0) {
        addText(rosterList, "div", "empty-state", "No players have been accepted yet.");
        setStatus(rosterStatus, "Accepted roster is empty.", "success");
        return;
      }
      for (const player of players) {
        const card = document.createElement("article");
        card.className = "application-panel staff-application staff-roster-player";
        const top = document.createElement("div");
        top.className = "staff-application__top";
        const identity = document.createElement("div");
        addText(identity, "h3", "staff-application__name", player.display_name);
        addText(identity, "p", "staff-application__meta", player.email);
        top.appendChild(identity);
        addText(top, "span", "pill pill--red", "ROSTER MEMBER");
        card.appendChild(top);
        const details = document.createElement("div");
        details.className = "staff-application__details";
        addText(details, "p", "", "Game / division: " + player.game);
        addText(details, "p", "", "Platform: " + player.platform);
        addText(details, "p", "", "Added: " + (player.accepted_at ? new Date(player.accepted_at).toLocaleDateString() : "Unknown"));
        card.appendChild(details);

        const actions = document.createElement("div");
        actions.className = "staff-roster-actions";
        const emailLink = document.createElement("a");
        emailLink.className = "button button--outline";
        emailLink.href = "mailto:" + encodeURIComponent(String(player.email || "")).replace("%40", "@") +
          "?subject=" + encodeURIComponent("VAYNTR Esports | Player Check-In");
        emailLink.textContent = "Email player ↗";
        emailLink.setAttribute("aria-label", "Compose email to " + player.display_name);
        actions.appendChild(emailLink);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "button button--outline staff-remove-player";
        removeButton.textContent = "Remove from roster";
        removeButton.addEventListener("click", async () => {
          const message = "Remove " + player.display_name + " from the public VAYNTR roster? Their roster contact record will also be deleted. This cannot be undone.";
          if (!window.confirm(message)) return;
          removeButton.disabled = true;
          setStatus(rosterStatus, "Removing player from roster…");
          try {
            const result = await api("/api/staff/roster/" + encodeURIComponent(player.id) + "/remove", { method: "POST" });
            await loadRoster(false);
            setStatus(rosterStatus, result.message || "Player removed from the public roster.", "success");
            setStatus($("#portalActionStatus"), result.message || "Player removed.", "success");
          } catch (error) {
            if (error.status === 401 || error.status === 403) signOut();
            setStatus(rosterStatus, error.message || "Unable to remove this player.", "error");
          } finally {
            removeButton.disabled = false;
          }
        });
        actions.appendChild(removeButton);
        card.appendChild(actions);
        rosterList.appendChild(card);
      }
      setStatus(rosterStatus, players.length + " roster member(s). Email addresses are visible only in this protected staff area.", "success");
    } catch (error) {
      if (error.status === 401 || error.status === 403) signOut();
      setStatus(rosterStatus, error.message || "Unable to load the accepted roster.", "error");
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    loginButton.disabled = true;
    setStatus(loginStatus, "Checking staff access…");
    token = loginForm.elements.accessKey.value;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
    loginForm.elements.accessKey.value = "";
    try {
      await loadApplications();
    } finally {
      loginButton.disabled = false;
    }
  });

  document.querySelectorAll("[data-staff-tab]").forEach((tab) => {
    tab.addEventListener("click", async () => {
      activateView(tab.dataset.staffTab);
      if (activeView === "applications") await loadApplications();
      else if (activeView === "roster") await loadRoster();
      else await loadOverview();
    });
  });
  document.querySelectorAll("[data-open-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      activateView(button.dataset.openView);
      if (activeView === "applications") await loadApplications();
      else if (activeView === "roster") await loadRoster();
      else await loadOverview();
    });
  });
  $("#refreshApplications").addEventListener("click", () => loadApplications());
  $("#refreshRoster")?.addEventListener("click", () => loadRoster());
  $("#refreshCurrentView").addEventListener("click", () => refreshActiveView());
  $("#staffSignOut").addEventListener("click", signOut);
  if (token) loadApplications();
})();
