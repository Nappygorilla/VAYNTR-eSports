(() => {
  "use strict";
  const API_BASE = "https://vayntr-esports.onrender.com";
  const SESSION_KEY = "vayntr-member-session";
  const $ = (selector) => document.querySelector(selector);
  const statusNode = $("#memberStatus");
  const profileStatus = $("#memberProfileStatus");
  const gate = $("#memberGate");
  const area = $("#memberArea");

  function setStatus(node, message, state) {
    if (!node) return;
    node.textContent = message || "";
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  }

  function getSessionToken() {
    try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch { return ""; }
  }
  function saveSessionToken(token) {
    try { sessionStorage.setItem(SESSION_KEY, token); return true; } catch { return false; }
  }
  function clearSessionToken() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  async function api(path, options = {}) {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    const token = getSessionToken();
    if (token) headers.Authorization = "Bearer " + token;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(API_BASE + path, { ...options, headers, cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "The request could not be completed. Please try again.");
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function showGate(stateMessage) {
    gate.hidden = false;
    area.hidden = true;
    setStatus(statusNode, stateMessage || "");
  }

  function safeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function fillSocialForm(links) {
    const form = $("#memberSocialForm");
    if (!form) return;
    const inputs = [form.elements.link1, form.elements.link2, form.elements.link3];
    inputs.forEach((input) => { if (input) input.value = ""; });
    (Array.isArray(links) ? links : []).forEach((link, index) => {
      if (index < inputs.length && inputs[index]) inputs[index].value = safeHttpsUrl(link && link.url);
    });
  }

  function showProfile(member) {
    gate.hidden = true;
    area.hidden = false;
    const nameNode = $("#memberProfileName");
    if (nameNode) nameNode.textContent = (member.displayName || "VAYNTR member").toUpperCase() + ".";
    const metaNode = $("#memberProfileMeta");
    if (metaNode) {
      const kind = member.memberType === "media" ? "Media team" : "Player roster";
      const since = member.memberSince ? new Date(member.memberSince).toLocaleDateString() : "unknown";
      metaNode.textContent = kind + " · member since " + since;
    }
    const details = $("#memberProfileDetails");
    if (details) {
      details.replaceChildren();
      const rows = [
        ["Division / game", member.game || "Not set yet"],
        ["Platform", member.platform || "Not set"],
        ["Role", member.role || "Player"],
        ["Public age", member.age != null ? String(member.age) : "Private"],
        ["Public age allowed", member.showAgeOnProfile ? "Yes" : "No"]
      ];
      for (const [label, value] of rows) {
        const term = document.createElement("dt");
        term.textContent = label;
        const desc = document.createElement("dd");
        desc.textContent = value;
        details.append(term, desc);
      }
    }
    const profileLink = $("#memberProfileLink");
    const rosterPlayerId = member.id || member.rosterPlayerId;
    void rosterPlayerId;
    if (profileLink) profileLink.href = "roster.html#main";
    fillSocialForm(member.socialLinks);
    setStatus(profileStatus, "");
  }

  async function loadProfile() {
    if (!getSessionToken()) return showGate("Sign in to view your member profile.");
    setStatus(statusNode, "Loading your member profile…");
    try {
      const data = await api("/api/me");
      showProfile(data.member);
      setStatus(statusNode, "");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        showGate(error.message || "Your session has expired. Please sign in again.");
      } else {
        showGate(error.message || "The member service is unavailable right now. Please try again shortly.");
      }
    }
  }

  $("#memberRegisterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const button = $("#memberRegisterButton");
    if (button) button.disabled = true;
    setStatus(statusNode, "Verifying your invite code and name…");
    try {
      const data = await api("/api/accounts/register", {
        method: "POST",
        body: JSON.stringify({
          code: form.elements.code.value.trim(),
          name: form.elements.name.value.trim(),
          password: form.elements.password.value
        })
      });
      if (data.session && data.session.token) saveSessionToken(data.session.token);
      form.reset();
      showProfile(data.member);
      setStatus(profileStatus, data.message || "Account created.", "success");
    } catch (error) {
      setStatus(statusNode, error.message || "Could not create the account. Please try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const button = $("#memberLoginButton");
    if (button) button.disabled = true;
    setStatus(statusNode, "Signing in…");
    try {
      const data = await api("/api/accounts/login", {
        method: "POST",
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          password: form.elements.password.value
        })
      });
      if (data.session && data.session.token) saveSessionToken(data.session.token);
      form.reset();
      showProfile(data.member);
    } catch (error) {
      setStatus(statusNode, error.message || "Sign-in failed. Please try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberSocialForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const button = $("#memberSocialSave");
    if (button) button.disabled = true;
    const data = await api("/api/me").catch(() => null);
    setStatus(profileStatus, "Saving your social links…");
    try {
      const links = [form.elements.link1.value, form.elements.link2.value, form.elements.link3.value]
        .map((value) => value.trim())
        .filter(Boolean)
        .map((url) => ({ label: "", url }));
      const result = await api("/api/me/social-links", { method: "POST", body: JSON.stringify({ links }) });
      const member = (data && data.member) || {};
      fillSocialForm(result.socialLinks && result.socialLinks.length ? result.socialLinks : member.socialLinks);
      setStatus(profileStatus, result.message || "Social links saved.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus(profileStatus, error.message || "Could not save social links.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberSignOut")?.addEventListener("click", async () => {
    try { await api("/api/accounts/logout", { method: "POST" }); } catch {}
    clearSessionToken();
    showGate("Signed out. Your password is safe; your session ended on the backend too.");
  });

  if (getSessionToken()) loadProfile();
  else showGate("Members create an account with their invite code, or sign in below.");
})();
