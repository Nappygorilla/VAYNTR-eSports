(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const boot = $("#boot");

  // VAYNTR API hosted on Render. Never put server secrets in this public file.
  const API_BASE = "https://vayntr-esports.onrender.com";
  const SESSION_KEY = "vayntr-session";
  const readSession = () => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  };
  const writeSession = (data) => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); return true; }
    catch { return false; }
  };
  const clearSession = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch {} };
  async function apiRequest(path, options = {}) {
    const session = readSession();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (session?.token) headers.Authorization = "Bearer " + session.token;
    const response = await fetch(API_BASE + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
    return data;
  }
  window.vayntrApi = { request: apiRequest, getSession: readSession, signOut: clearSession };


  // Keep the branded intro brief and never trap users if JavaScript is delayed.
  if (boot) {
    const dismiss = () => boot.classList.add("is-done");
    if (reducedMotion) dismiss();
    else window.setTimeout(dismiss, 1550);
    window.setTimeout(dismiss, 3500);
  }

  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
  $("[data-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });

  const menuToggle = $("#menuToggle");
  const primaryNav = $("#primaryNav");
  const closeMenu = () => {
    primaryNav?.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open navigation");
  };
  menuToggle?.addEventListener("click", () => {
    const open = primaryNav?.classList.toggle("is-open") ?? false;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });
  $$("#primaryNav a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  const toast = $("#toast");
  let toastTimer;
  function announce(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  const fov = $("#fov");
  const sensitivity = $("#sensitivity");
  const platform = $("#platform");
  const curve = $("#curve");
  const audio = $("#audio");
  const profileName = $("#profileName");
  const profileSummary = $("#profileSummary");
  function updateProfile() {
    if (!fov || !sensitivity || !platform || !curve || !audio) return;
    $("#fovOut").value = fov.value;
    $("#sensitivityOut").value = sensitivity.value;
    const audioLabel = audio.value === "Footstep clarity"
      ? "Footstep focus"
      : audio.value === "Reduce loud effects" ? "Reduced effects" : "Balanced baseline";
    profileName.textContent = platform.value + " / " + audioLabel;
    profileSummary.textContent = "FOV " + fov.value + " · Sens " + sensitivity.value + " · " + curve.value;
  }
  [fov, sensitivity, platform, curve, audio].forEach((control) => control?.addEventListener("input", updateProfile));
  try {
    const saved = JSON.parse(localStorage.getItem("vayntr-settings-profile") || "null");
    if (saved && fov && sensitivity && platform && curve && audio) {
      if (Number.isFinite(saved.fov) && saved.fov >= 80 && saved.fov <= 120) fov.value = String(saved.fov);
      if (Number.isFinite(saved.sensitivity) && saved.sensitivity >= 1 && saved.sensitivity <= 20) sensitivity.value = String(saved.sensitivity);
      if ([...platform.options].some((option) => option.value === saved.platform)) platform.value = saved.platform;
      if ([...curve.options].some((option) => option.value === saved.curve)) curve.value = saved.curve;
      if ([...audio.options].some((option) => option.value === saved.audio)) audio.value = saved.audio;
    }
  } catch {
    // Ignore malformed or unavailable browser storage and keep the defaults.
  }
  updateProfile();

  $("#saveProfile")?.addEventListener("click", () => {
    const profile = {
      platform: platform.value,
      fov: Number(fov.value),
      sensitivity: Number(sensitivity.value),
      curve: curve.value,
      audio: audio.value,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem("vayntr-settings-profile", JSON.stringify(profile));
      announce("Profile saved in this browser only.");
    } catch {
      announce("Browser storage is unavailable; profile was not saved.");
    }
  });


  // Account forms use the Render API. Sessions are kept in sessionStorage for this tab.
  const registerForm = $("#registerForm");
  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $('button[type="submit"]', registerForm);
    const status = $("#authStatus");
    if (submit) submit.disabled = true;
    if (status) status.textContent = "Creating your account…";
    try {
      const data = await apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify({
        displayName: $("#displayName", registerForm).value,
        email: $("#email", registerForm).value,
        password: $("#password", registerForm).value
      })});
      if (!writeSession(data)) throw new Error("This browser cannot keep a session. Check privacy settings and try again.");
      window.location.href = "member-dashboard.html";
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally { if (submit) submit.disabled = false; }
  });
  const loginForm = $("#loginForm");
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $('button[type="submit"]', loginForm);
    const status = $("#authStatus");
    if (submit) submit.disabled = true;
    if (status) status.textContent = "Signing in…";
    try {
      const data = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({
        email: $("#email", loginForm).value,
        password: $("#password", loginForm).value
      })});
      if (!writeSession(data)) throw new Error("This browser cannot keep a session. Check privacy settings and try again.");
      window.location.href = "member-dashboard.html";
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally { if (submit) submit.disabled = false; }
  });
  const accountPanel = $("#accountPanel");
  if (accountPanel) {
    const session = readSession();
    if (!session?.token) {
      accountPanel.innerHTML = '<span class="pill">Sign-in required</span><h2>Access your account.</h2><p>Sign in to view your account profile. Registration is available, but member-only team tools are still being built.</p><div class="hero__actions"><a class="button button--primary" href="login.html">Sign in</a><a class="button button--outline" href="register.html">Create account</a></div>';
    } else {
      accountPanel.innerHTML = '<span class="pill">Checking session…</span><h2>Loading your profile.</h2><p id="accountStatus" role="status" aria-live="polite"></p>';
      apiRequest("/api/auth/me").then(({ user }) => {
        accountPanel.innerHTML = '<span class="pill">Account connected</span><h2>Welcome, ' + escapeHtml(user.display_name) + '.</h2><p>Email: ' + escapeHtml(user.email) + '</p><p>Role: ' + escapeHtml(user.role) + '</p><p>Member-only tools are still being built. Your account is connected to the VAYNTR API.</p><button class="button button--outline" id="signOutButton" type="button">Sign out</button>';
        $("#signOutButton", accountPanel)?.addEventListener("click", () => { clearSession(); window.location.reload(); });
      }).catch((error) => {
        clearSession();
        accountPanel.innerHTML = '<span class="pill">Session expired</span><h2>Please sign in again.</h2><p>' + escapeHtml(error.message) + '</p><a class="button button--primary" href="login.html">Sign in</a>';
      });
    }
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  // Update active section cues without requiring a framework.
  if ("IntersectionObserver" in window) {
    const sections = $$(".section-anchor[id]");
    const navLinks = $$("#primaryNav a");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          if (link.getAttribute("href") === "#" + entry.target.id) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    sections.forEach((section) => observer.observe(section));
  }
})();