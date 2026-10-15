(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const boot = $("#boot");

  // Supabase connection (public browser config only). This initializes the client;
  // authentication and cloud profile syncing still need to be wired to the UI.
  const SUPABASE_URL = "https://exxewfphfdoywtiorwix.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Sybxc4QyqzbWrORV8SmSA_4b44gBTM";
  window.vayntrSupabaseReady = import("https://esm.sh/@supabase/supabase-js@2")
    .then(({ createClient }) => {
      window.vayntrSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      document.documentElement.dataset.supabase = "ready";
      return window.vayntrSupabase;
    })
    .catch((error) => {
      document.documentElement.dataset.supabase = "unavailable";
      console.error("VAYNTR backend client could not initialize.", error);
      return null;
    });


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

  const openApplication = $("#openApplication");
  const applicationPanel = $("#applicationPanel");
  openApplication?.addEventListener("click", () => {
    const open = applicationPanel?.hidden ?? true;
    if (!applicationPanel) return;
    applicationPanel.hidden = !open;
    openApplication.setAttribute("aria-expanded", String(open));
    openApplication.innerHTML = open
      ? 'Close application <span aria-hidden="true">×</span>'
      : 'Preview application <span aria-hidden="true">↗</span>';
    if (open) {
      applicationPanel.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      $("#appName")?.focus({ preventScroll: true });
    }
  });

  $("#applicationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    announce("Demo only: no application was sent or stored.");
  });


  // Member access code UI. Verification must be handled by a trusted backend;
  // never accept or store membership codes as valid in browser-only JavaScript.
  $("#memberCodeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = $("#memberCodeMessage");
    if (message) {
      message.textContent = "Code received, but verification is not available yet. Contact VAYNTR staff until member access is connected.";
    }
  });

  // Member dashboard preview: profile/settings are stored only in this browser.
  // This is not authentication or cloud account storage; production member data needs a trusted backend.
  const memberDashboardForm = $("#memberDashboardForm");
  if (memberDashboardForm) {
    const memberFields = [...memberDashboardForm.querySelectorAll("input, select, textarea")];
    const memberGreeting = $("#memberGreeting");
    const memberGameSummary = $("#memberGameSummary");
    const memberSaveStatus = $("#memberSaveStatus");
    const memberStorageKey = "vayntr-member-dashboard-profile";
    const refreshMemberSummary = () => {
      const username = $("#memberUsername")?.value.trim() || "New player";
      const game = $("#memberMainGame")?.value || "Warzone";
      const device = $("#memberPlatform")?.value || "PS5";
      if (memberGreeting) memberGreeting.textContent = username;
      if (memberGameSummary) memberGameSummary.textContent = game + " · " + device;
    };
    const readMemberForm = () => Object.fromEntries(memberFields.map((field) => [field.name, field.value]));
    const applyMemberForm = (data) => {
      memberFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(data, field.name)) field.value = String(data[field.name]);
      });
      refreshMemberSummary();
    };
    try {
      const savedMemberProfile = JSON.parse(localStorage.getItem(memberStorageKey) || "null");
      if (savedMemberProfile && typeof savedMemberProfile === "object") applyMemberForm(savedMemberProfile);
    } catch {
      if (memberSaveStatus) memberSaveStatus.textContent = "Saved browser data could not be read; you can still edit this preview.";
    }
    memberFields.forEach((field) => field.addEventListener("input", refreshMemberSummary));
    memberDashboardForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const profile = readMemberForm();
      try {
        localStorage.setItem(memberStorageKey, JSON.stringify(profile));
        refreshMemberSummary();
        if (memberSaveStatus) memberSaveStatus.textContent = "Saved on this device in this browser. It is not synced to a VAYNTR account.";
        announce("Dashboard preview saved in this browser.");
      } catch {
        if (memberSaveStatus) memberSaveStatus.textContent = "Browser storage is unavailable; changes could not be saved.";
        announce("Could not save in this browser.");
      }
    });
    $("#resetMemberProfile")?.addEventListener("click", () => {
      memberDashboardForm.reset();
      try { localStorage.removeItem(memberStorageKey); } catch { /* Keep default form values if storage is unavailable. */ }
      refreshMemberSummary();
      if (memberSaveStatus) memberSaveStatus.textContent = "Preview reset. Save again to keep these default values in this browser.";
      announce("Dashboard preview reset.");
    });
    refreshMemberSummary();
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