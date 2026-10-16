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
  $$("[data-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });

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


  // Accessible keyboard- and click-operated focus tabs on the homepage.
  const focusTabs = $("[data-focus-tab]");
  const focusPanels = $("[data-focus-panel]");
  if (focusTabs.length && focusPanels.length) {
    const activateFocusTab = (activeTab, moveFocus = false) => {
      const activeName = activeTab.dataset.focusTab;
      focusTabs.forEach((tab) => {
        const selected = tab === activeTab;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      focusPanels.forEach((panel) => {
        panel.hidden = panel.dataset.focusPanel !== activeName;
      });
      if (moveFocus) activeTab.focus({ preventScroll: true });
    };
    focusTabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateFocusTab(tab));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = index;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % focusTabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + focusTabs.length) % focusTabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = focusTabs.length - 1;
        else return;
        event.preventDefault();
        activateFocusTab(focusTabs[nextIndex], true);
      });
    });
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

  // Scroll polish: progress indicator, reveal-on-scroll, and a back-to-top control.
  // Everything is progressively enhanced; reduced-motion users see content immediately.
  const publicPage = !document.querySelector("[data-staff-view]");
  if (publicPage) {
    const progress = document.createElement("div");
    progress.className = "scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    const progressBar = document.createElement("span");
    progressBar.className = "scroll-progress__bar";
    progress.appendChild(progressBar);
    document.body.appendChild(progress);

    const backToTop = document.createElement("button");
    backToTop.className = "back-to-top";
    backToTop.type = "button";
    backToTop.setAttribute("aria-label", "Back to top");
    backToTop.setAttribute("title", "Back to top");
    backToTop.innerHTML = '<span aria-hidden="true">↑</span>';
    document.body.appendChild(backToTop);
    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    });

    let scrollFrame = 0;
    const updateScrollChrome = () => {
      scrollFrame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const amount = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      progressBar.style.transform = "scaleX(" + amount + ")";
      backToTop.classList.toggle("is-visible", window.scrollY > 520);
    };
    const scheduleScrollChrome = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(updateScrollChrome);
    };
    window.addEventListener("scroll", scheduleScrollChrome, { passive: true });
    window.addEventListener("resize", scheduleScrollChrome, { passive: true });
    updateScrollChrome();

    if (!reducedMotion && "IntersectionObserver" in window) {
      const revealSelector = ".section > .container, .page-hero .container, .feature-card, .content-card, .roster-player-card, .recruit-cta, .application-panel";
      const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      }, { root: null, rootMargin: "0px 0px -7% 0px", threshold: 0.08 });

      const observeReveal = (element) => {
        if (!(element instanceof Element) || !element.matches(revealSelector)) return;
        if (element.closest("[hidden]") || element.classList.contains("scroll-reveal")) return;
        element.classList.add("scroll-reveal");
        const siblings = element.parentElement
          ? [...element.parentElement.children].filter((node) => node.matches(".feature-card, .content-card, .roster-player-card"))
          : [];
        if (siblings.length > 1) {
          element.style.setProperty("--reveal-delay", Math.min(siblings.indexOf(element), 3) * 75 + "ms");
        }
        revealObserver.observe(element);
      };

      const collectRevealTargets = (root) => {
        if (root instanceof Element) observeReveal(root);
        root.querySelectorAll?.(revealSelector).forEach(observeReveal);
      };

      collectRevealTargets(document);
      // Feed and roster cards are rendered after their API calls complete; observe those too.
      const revealMutationObserver = new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach(collectRevealTargets));
      });
      revealMutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

})();