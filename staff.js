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
  const loginButton = $("#staffLoginButton");
  let token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {}

  function setStatus(node, message, state) {
    node.textContent = message || "";
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
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
    setStatus(loginStatus, "Signed out.", "success");
  }

  function addText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text == null ? "" : String(text);
    parent.appendChild(element);
    return element;
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
    addText(top, "span", "pill" + (["accepted", "declined"].includes(application.status) ? " pill--red" : ""), String(application.status || "received").toUpperCase());
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
      addText(videoBlock, "p", "form-note", "No video link exists for this older submission.");
    }
    card.appendChild(videoBlock);

    if (application.message) {
      const note = document.createElement("div");
      note.className = "staff-application__note";
      addText(note, "b", "", "Additional information");
      addText(note, "p", "", application.message);
      card.appendChild(note);
    }

    const statusBox = document.createElement("div");
    statusBox.className = "staff-application__actions";
    const label = addText(statusBox, "label", "", "Application status");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Application status for " + application.display_name);
    for (const value of ["received", "reviewing", "accepted", "declined"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      option.selected = value === application.status;
      select.appendChild(option);
    }
    label.appendChild(select);
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "button button--primary";
    saveButton.textContent = "Save status";
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      const requestedStatus = select.value;
      setStatus(reviewStatus, "Saving application status…");
      try {
        const result = await api("/api/staff/applications/" + encodeURIComponent(application.id) + "/status", {
          method: "POST",
          body: JSON.stringify({ status: requestedStatus })
        });
        if (requestedStatus === "accepted" || requestedStatus === "declined") {
          const notice = result.notification;
          if (notice && notice.reason === "already_notified") {
            setStatus(reviewStatus, "Status saved. This decision email had already been queued.", "success");
          } else if (notice && notice.sent) {
            setStatus(reviewStatus, "Status saved. Resend accepted the decision email request.", "success");
          } else {
            setStatus(reviewStatus, "Status saved, but the decision email was not sent. Check RESEND_FROM_EMAIL, domain verification, and the Render logs.", "warning");
          }
        } else {
          setStatus(reviewStatus, "Application status saved.", "success");
        }
        await loadApplications(false);
      } catch (error) {
        if (error.status === 401 || error.status === 403) signOut();
        setStatus(reviewStatus, error.message || "Unable to save status.", "error");
      } finally {
        saveButton.disabled = false;
      }
    });
    statusBox.appendChild(saveButton);
    card.appendChild(statusBox);
    return card;
  }

  async function loadApplications(showLoading = true) {
    if (showLoading) setStatus(reviewStatus, "Loading applications…");
    list.replaceChildren();
    try {
      const result = await api("/api/staff/applications");
      loginPanel.hidden = true;
      reviewPanel.hidden = false;
      if (!result.applications || result.applications.length === 0) {
        addText(list, "div", "empty-state", "No applications have been submitted yet.");
        setStatus(reviewStatus, "Queue loaded. No applications are waiting.", "success");
        return;
      }
      for (const application of result.applications) list.appendChild(renderApplication(application));
      setStatus(reviewStatus, "Loaded " + result.applications.length + " recent application(s).", "success");
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

  $("#refreshApplications").addEventListener("click", () => loadApplications());
  $("#staffSignOut").addEventListener("click", signOut);
  if (token) loadApplications();
})();
