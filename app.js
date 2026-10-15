(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const boot = $("#boot");

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