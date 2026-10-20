(() => {
  "use strict";
  const API_BASE = "https://vayntr-esports.onrender.com";
  const SESSION_KEY = "vayntr-member-session";
  const $ = (selector) => document.querySelector(selector);
  const statusNode = $("#memberStatus");
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
        error.data = data;
        throw error;
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function safeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function showGate(stateMessage) {
    gate.hidden = false;
    area.hidden = true;
    const registerForm = $("#memberRegisterForm");
    const loginForm = $("#memberLoginForm");
    const mfaForm = $("#memberMfaForm");
    if (mfaForm) mfaForm.hidden = true;
    if (registerForm) registerForm.hidden = false;
    if (loginForm) loginForm.hidden = false;
    setStatus(statusNode, stateMessage || "");
  }

  // --- Proof-of-work solver (same leading-zero-bits rule as the backend) ---
  function digestHasLeadingZeroBits(bytes, bits) {
    let count = 0;
    for (const byte of bytes) {
      if (byte === 0) { count += 8; if (count >= bits) return true; continue; }
      count += Math.clz32(byte) - 24;
      return count >= bits;
    }
    return true;
  }

  async function solvePow(challenge) {
    const salt = String((challenge && challenge.salt) || "");
    const bits = Number((challenge && challenge.difficultyBits) || 16);
    const encoder = new TextEncoder();
    for (let nonce = 0; nonce < 8000000; nonce += 1) {
      const digest = new Uint8Array(await window.crypto.subtle.digest("SHA-256", encoder.encode(salt + ":" + nonce)));
      if (digestHasLeadingZeroBits(digest, bits)) return String(nonce);
      if (nonce % 2000 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    return null;
  }

  // --- Panel switching between the two-step verification stage and the sign-in forms ---
  function showMfaStage(mfaToken, message) {
    const registerForm = $("#memberRegisterForm");
    const loginForm = $("#memberLoginForm");
    const mfaForm = $("#memberMfaForm");
    if (registerForm) registerForm.hidden = true;
    if (loginForm) loginForm.hidden = true;
    if (mfaForm) {
      mfaForm.hidden = false;
      mfaForm.dataset.mfaToken = mfaToken;
      mfaForm.querySelector("input")?.focus();
    }
    setStatus(statusNode, message || "Enter the current 6-digit code from your authenticator app.");
  }

  function handleMfaStage(mfaToken, message) {
    if (!mfaToken) { showGate("Sign-in is incomplete. Please try again."); return; }
    showMfaStage(mfaToken, message);
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

  function renderMfaPanel(member) {
    const panel = $("#memberMfaPanel");
    if (!panel || !member) return;
    panel.hidden = false;
    const enrolled = member.mfaEnabled === true;
    const stateNode = $("#memberMfaState");
    const enrollButton = $("#memberMfaEnrollButton");
    const enrollPanel = $("#memberMfaEnrollPanel");
    const disableRow = $("#memberMfaDisableRow");
    if (stateNode) stateNode.textContent = enrolled
      ? "Your account requires an authenticator code at every sign-in. A compromised password alone cannot unlock it."
      : "MFA is off. Turn it on so that a stolen password cannot sign someone in as you.";
    if (enrollButton) enrollButton.textContent = enrolled ? "Re-enroll authenticator" : "Set up authenticator app";
    if (enrollPanel) enrollPanel.hidden = true;
    if (disableRow) disableRow.hidden = !enrolled;
    if (enrollButton) enrollButton.hidden = false;
  }

  function avatarUrl(member, bust) {
    const id = member && member.id ? String(member.id) : "";
    if (!id) return "";
    return API_BASE + "/api/members/" + encodeURIComponent(id) + "/avatar" + (bust ? "?t=" + Date.now() : "");
  }

  function renderAvatarAndBio(member) {
    if (!member) return;
    const preview = $("#memberAvatarPreview");
    const fallback = $("#memberAvatarFallback");
    const removeButton = $("#memberAvatarRemove");
    const hasUpload = member.hasAvatar === true;
    if (preview) {
      if (hasUpload) {
        preview.src = avatarUrl(member, true);
        preview.hidden = false;
        if (fallback) fallback.hidden = true;
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
        if (fallback) {
          fallback.textContent = (member.displayName || "V").trim().charAt(0).toUpperCase();
          fallback.hidden = false;
        }
      }
    }
    if (removeButton) removeButton.hidden = !hasUpload;
    const expiry = new Date();
    const bioInput = $("#memberBioInput");
    if (bioInput && document.activeElement !== bioInput) bioInput.value = member.bio || "";
    const ageToggle = $("#memberAgePublic");
    if (ageToggle) ageToggle.checked = member.showAgeOnProfile === true;
    const file = $("#memberAvatarFile");
    if (file) file.value = "";
  }

  function showProfile(member) {
    memberState = member;
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
        ["Public age allowed", member.showAgeOnProfile ? "Yes" : "No"],
        ["Profile picture", member.hasAvatar ? "Uploaded image" : "Default initials badge"],
        ["MFA", member.mfaEnabled ? "On (authenticator app)" : "Off"]
      ];
      for (const [label, value] of rows) {
        const term = document.createElement("dt");
        term.textContent = label;
        const desc = document.createElement("dd");
        desc.textContent = value;
        details.append(term, desc);
      }
    }
    fillSocialForm(member.socialLinks);
    renderMfaPanel(member);
    renderAvatarAndBio(member);
    setStatus($("#memberProfileStatus"), "");
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

  // --- Registration (invite code + verified application name + hardened password) ---
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
      setStatus($("#memberProfileStatus"), data.message || "Account created.", "success");
    } catch (error) {
      setStatus(statusNode, error.message || "Could not create the account. Please try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  // --- Sign-in: password stage with proof-of-work retry, then MFA stage ---
  $("#memberLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const button = $("#memberLoginButton");
    if (button) button.disabled = true;
    const basePayload = {
      name: form.elements.name.value.trim(),
      password: form.elements.password.value
    };
    setStatus(statusNode, "Signing in…");
    try {
      let data = await api("/api/accounts/login", { method: "POST", body: JSON.stringify(basePayload) });
      if (data.mfaRequired) {
        form.reset();
        return handleMfaStage(data.mfaToken, data.message);
      }
      if (data.session && data.session.token) {
        saveSessionToken(data.session.token);
        form.reset();
        showProfile(data.member);
        return;
      }
      throw new Error("Sign-in failed unexpectedly. Please try again.");
    } catch (error) {
      if (error.status !== 401 && error.status !== 400 && error.status !== 423) {
        setStatus(statusNode, error.message || "Sign-in failed. Please try again.", "error");
        if (button) button.disabled = false;
        return;
      }
      // Lockout: surface the remaining time and stop.
      if (error.status === 423) {
        setStatus(statusNode, error.message + " Try again when the lock expires.", "error");
        if (button) button.disabled = false;
        return;
      }
      const challenge = error.data && error.data.pow;
      if (!challenge) {
        setStatus(statusNode, error.message || "Sign-in failed. Please try again.", "error");
        if (button) button.disabled = false;
        return;
      }
      // Repeated failed attempts: solve the proof-of-work challenge and try once more.
      setStatus(statusNode, "Solving the bot-check challenge (a few seconds)…");
      const nonce = await solvePow(challenge);
      if (!nonce) {
        setStatus(statusNode, "The security check could not complete. Please try again.", "error");
        if (button) button.disabled = false;
        return;
      }
      try {
        const retry = await api("/api/accounts/login", {
          method: "POST",
          body: JSON.stringify({ ...basePayload, powNonce: nonce, powSalt: challenge.salt })
        });
        if (retry.mfaRequired) {
          form.reset();
          return handleMfaStage(retry.mfaToken, retry.message);
        }
        if (retry.session && retry.session.token) {
          saveSessionToken(retry.session.token);
          form.reset();
          showProfile(retry.member);
          setStatus(statusNode, "");
          return;
        }
        setStatus(statusNode, "Sign-in failed unexpectedly. Please try again.", "error");
      } catch (retryError) {
        setStatus(statusNode, retryError.message || "Sign-in failed. Please try again.", "error");
      } finally {
        if (button) button.disabled = false;
        return;
      }
    }
  });

  // --- MFA second stage at sign-in ---
  $("#memberMfaForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const mfaToken = form.dataset.mfaToken || "";
    const button = $("#memberMfaButton");
    if (button) button.disabled = true;
    setStatus(statusNode, "Verifying your authenticator code…");
    try {
      const data = await api("/api/accounts/login/verify", {
        method: "POST",
        body: JSON.stringify({ mfaToken, code: form.elements.code.value.trim() })
      });
      if (data.session && data.session.token) {
        saveSessionToken(data.session.token);
        form.reset();
        delete form.dataset.mfaToken;
        showProfile(data.member);
        setStatus(statusNode, "");
        return;
      }
      throw new Error("Verification failed unexpectedly. Please sign in again.");
    } catch (error) {
      setStatus(statusNode, error.message || "That code was not accepted. Please try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  // --- Self-service social links editor ---
  $("#memberSocialForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const button = $("#memberSocialSave");
    if (button) button.disabled = true;
    setStatus($("#memberProfileStatus"), "Saving your social links…");
    try {
      const links = [form.elements.link1.value, form.elements.link2.value, form.elements.link3.value]
        .map((value) => value.trim())
        .filter(Boolean)
        .map((url) => ({ label: "", url }));
      const result = await api("/api/me/social-links", { method: "POST", body: JSON.stringify({ links }) });
      if (memberState) memberState.socialLinks = result.socialLinks;
      setStatus($("#memberProfileStatus"), result.message || "Social links saved.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus($("#memberProfileStatus"), error.message || "Could not save social links.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  // --- Self-service profile picture (PNG/JPEG/WebP, ≤ 300 KB, uploaded as raw bytes) ---
  const MAX_AVATAR_BYTES = 300 * 1024;
  const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

  $("#memberAvatarUpload")?.addEventListener("click", async () => {
    const input = $("#memberAvatarFile");
    const button = $("#memberAvatarUpload");
    const statusNode2 = $("#memberAvatarStatus");
    const file = input && input.files ? input.files[0] : null;
    if (!file) return setStatus(statusNode2, "Choose an image file first.", "error");
    if (!AVATAR_TYPES.has(file.type)) return setStatus(statusNode2, "The picture must be a PNG, JPEG, or WebP image.", "error");
    if (file.size > MAX_AVATAR_BYTES) return setStatus(statusNode2, "Profile pictures must be 300 KB or smaller.", "error");
    if (button) button.disabled = true;
    setStatus(statusNode2, "Uploading your profile picture…");
    try {
      const buffer = await file.arrayBuffer();
      const result = await api("/api/me/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: buffer
      });
      if (memberState) { memberState.hasAvatar = true; renderAvatarAndBio(memberState); }
      setStatus(statusNode2, result.message || "Profile picture uploaded.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus(statusNode2, error.message || "Could not upload the picture.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberAvatarRemove")?.addEventListener("click", async () => {
    const button = $("#memberAvatarRemove");
    const statusNode2 = $("#memberAvatarStatus");
    if (button) button.disabled = true;
    setStatus(statusNode2, "Removing your profile picture…");
    try {
      const result = await api("/api/me/avatar", { method: "DELETE" });
      if (memberState) { memberState.hasAvatar = false; renderAvatarAndBio(memberState); }
      setStatus(statusNode2, result.message || "Profile picture removed.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus(statusNode2, error.message || "Could not remove the picture.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  // --- Self-service public bio & age visibility ---
  $("#memberBioForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const button = $("#memberBioSave");
    const statusNode2 = $("#memberBioStatus");
    const bioInput = $("#memberBioInput");
    const ageToggle = $("#memberAgePublic");
    if (button) button.disabled = true;
    setStatus(statusNode2, "Saving your public bio…");
    try {
      const result = await api("/api/me/profile", {
        method: "POST",
        body: JSON.stringify({ bio: bioInput ? bioInput.value : "", showAgeOnProfile: ageToggle ? ageToggle.checked : false })
      });
      if (memberState) {
        memberState.bio = bioInput ? bioInput.value.trim() : "";
        memberState.showAgeOnProfile = Boolean(ageToggle && ageToggle.checked);
      }
      setStatus(statusNode2, result.message || "Bio saved.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus(statusNode2, error.message || "Could not save the bio.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  // --- MFA enrollment, activation, disable ---
  $("#memberMfaEnrollButton")?.addEventListener("click", async () => {
    const button = $("#memberMfaEnrollButton");
    if (button) button.disabled = true;
    setStatus($("#memberProfileStatus"), "Generating your authenticator secret…");
    try {
      const data = await api("/api/me/mfa/enroll", { method: "POST" });
      const enrollPanel = $("#memberMfaEnrollPanel");
      const secretNode = $("#memberMfaSecret");
      const uriNode = $("#memberMfaOtpauth");
      if (secretNode) secretNode.textContent = data.secret;
      if (uriNode) uriNode.href = data.uri;
      if (enrollPanel) enrollPanel.hidden = false;
      setStatus($("#memberProfileStatus"), data.message || "Add the secret, then confirm with a current code.", "success");
    } catch (error) {
      if (error.status === 401) {
        clearSessionToken();
        return showGate("Your session has expired. Please sign in again.");
      }
      setStatus($("#memberProfileStatus"), error.message || "Could not start MFA setup.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberMfaActivate")?.addEventListener("click", async () => {
    const button = $("#memberMfaActivate");
    const code = ($("#memberMfaConfirmCode") || {}).value || "";
    if (button) button.disabled = true;
    setStatus($("#memberProfileStatus"), "Confirming your authenticator code…");
    try {
      const data = await api("/api/me/mfa/activate", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      const enrollPanel = $("#memberMfaEnrollPanel");
      const disableRow = $("#memberMfaDisableRow");
      if (enrollPanel) enrollPanel.hidden = true;
      if (disableRow) disableRow.hidden = false;
      if (memberState) memberState.mfaEnabled = true;
      renderMfaPanel(memberState);
      setStatus($("#memberProfileStatus"), data.message || "MFA is on.", "success");
    } catch (error) {
      setStatus($("#memberProfileStatus"), error.message || "Could not enable MFA.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberMfaDisable")?.addEventListener("click", async () => {
    if (!window.confirm("Turn multi-factor authentication off? A stolen password would then be enough to sign in as you.")) return;
    const button = $("#memberMfaDisable");
    const code = ($("#memberMfaDisableCode") || {}).value || "";
    if (button) button.disabled = true;
    setStatus($("#memberProfileStatus"), "Disabling MFA…");
    try {
      const data = await api("/api/me/mfa/disable", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      if (memberState) memberState.mfaEnabled = false;
      renderMfaPanel(memberState);
      setStatus($("#memberProfileStatus"), data.message || "MFA is off.", "success");
    } catch (error) {
      setStatus($("#memberProfileStatus"), error.message || "Could not disable MFA.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#memberSignOut")?.addEventListener("click", async () => {
    try { await api("/api/accounts/logout", { method: "POST" }); } catch {}
    clearSessionToken();
    memberState = null;
    showGate("Signed out. Your password is safe; your session ended on the backend too.");
  });

  if (getSessionToken()) loadProfile();
  else showGate("Members create an account with their invite code, or sign in below.");
})();
