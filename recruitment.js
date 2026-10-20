(() => {
  "use strict";
  const form = document.getElementById("recruitmentForm");
  if (!form) return;
  const status = document.getElementById("submissionStatus");
  const submit = document.getElementById("recruitmentSubmit");
  const API_BASE = "https://vayntr-esports.onrender.com";

  let recruitmentAvailable = false;
  const controls = [...form.querySelectorAll("input, select, textarea, button")];
  controls.forEach((control) => { control.disabled = true; });

  function clearRetry() {
    const retry = status?.querySelector("button");
    retry?.remove();
  }

  function appendRetry() {
    if (!status || status.querySelector("button")) return;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button--outline";
    retry.textContent = "Check availability again ↗".trim();
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Checking…";
      checkRecruitmentAvailability();
    });
    status.appendChild(retry);
  }

  async function checkRecruitmentAvailability() {
    clearRetry();
    try {
      // no-store so a retry after Render wakes up is never answered from the browser cache.
      const response = await fetch(API_BASE + "/api/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      const features = data.features || {};
      recruitmentAvailable = response.ok &&
        Boolean(features.recruitmentApplications && features.staffReviewConfigured);
      if (recruitmentAvailable) {
        controls.forEach((control) => { control.disabled = false; });
        status.textContent = "Applications are open. VAYNTR contacts applicants manually after review. Make sure your YouTube video is Unlisted or Public before submitting.";
        status.dataset.state = "success";
      } else {
        status.textContent = "Applications are temporarily paused until the database and secure staff-review access are ready. No application details have been submitted.";
        status.dataset.state = "warning";
        appendRetry();
      }
    } catch {
      recruitmentAvailable = false;
      status.textContent = "Recruitment availability could not be verified. The form is paused and no application details have been submitted.";
      status.dataset.state = "error";
      appendRetry();
    }
  }
  checkRecruitmentAvailability();

  function normalizeYouTubeUrl(value) {
    let url;
    try { url = new URL(value.trim()); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    let canonical = "";
    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
      canonical = "https://www.youtube.com/watch?v=" + id;
    } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") {
        id = url.searchParams.get("v") || "";
        canonical = "https://www.youtube.com/watch?v=" + id;
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && ["shorts", "embed", "live"].includes(parts[0])) {
          id = parts[1];
          canonical = "https://www.youtube.com/" + parts[0] + "/" + id;
        }
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? canonical : null;
  }

  // Media team applicants may skip the division; their first social link is required instead.
  // Player and media tracks hide each other's sections, and hidden required fields must be
  // un-required so form.reportValidity() never blocks submission on an input you cannot see.
  const trackSelect = form.elements.track;
  const gameSelect = form.elements.game;
  const youtubeField = form.elements.youtubeUrl;
  const social1Field = form.elements.socialUrl1;
  const mediaHint = document.getElementById("mediaGameHint");
  const youtubeHint = document.getElementById("youtubeHint");
  const mediaSection = form.querySelector("[data-media-only]");
  const mediaSkillBoxes = [...form.querySelectorAll("input[name='mediaSkill']")];
  const bestContentField = form.elements.bestContentUrl;
  const mediaToolsField = form.elements.mediaTools;
  const hasMicField = form.elements.hasMic;
  const hasMicCard = hasMicField ? hasMicField.closest(".field") : null;
  const scheduleAgreementField = form.elements.scheduleAgreement;
  const scheduleAgreementCard = scheduleAgreementField ? scheduleAgreementField.closest(".field") : null;
  function clearMediaAnswers() {
    mediaSkillBoxes.forEach((box) => { box.checked = false; });
    if (bestContentField) bestContentField.value = "";
    if (mediaToolsField) mediaToolsField.value = "";
  }
  function applyTrackRequirements() {
    const isMedia = trackSelect.value === "media";
    gameSelect.required = !isMedia;
    youtubeField.required = !isMedia;
    social1Field.required = isMedia;
    if (mediaSection) mediaSection.hidden = !isMedia;
    if (bestContentField) bestContentField.required = isMedia;
    if (hasMicField) hasMicField.required = !isMedia;
    if (hasMicCard) hasMicCard.hidden = isMedia;
    if (scheduleAgreementField) scheduleAgreementField.required = !isMedia;
    if (scheduleAgreementCard) scheduleAgreementCard.hidden = isMedia;
    if (!isMedia) clearMediaAnswers();
    if (mediaHint) mediaHint.hidden = !isMedia;
    if (youtubeHint) {
      youtubeHint.hidden = isMedia;
      youtubeHint.textContent = isMedia
        ? "Media team: a gameplay video is not required — at least one social link is."
        : "Paste the link to the actual video. YouTube watch, Shorts, and youtu.be links are supported.";
    }
  }
  trackSelect.addEventListener("change", applyTrackRequirements);
  applyTrackRequirements();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    if (!recruitmentAvailable) {
      status.textContent = "Applications are temporarily paused. Please try again later.";
      status.dataset.state = "warning";
      return;
    }
    if (!form.reportValidity()) return;
    // Declare track before any validation that reads it (previously it was referenced first,
    // which crashed the submission of an incomplete player application).
    const track = form.elements.track.value;
    const youtubeUrl = normalizeYouTubeUrl(form.elements.youtubeUrl.value);
    // Media team applicants may apply without a gameplay video.
    if (!youtubeUrl && track === "player") {
      form.elements.youtubeUrl.setCustomValidity("Enter a direct link to a YouTube video (not a channel or playlist).");
      form.elements.youtubeUrl.reportValidity();
      form.elements.youtubeUrl.setCustomValidity("");
      return;
    }
    const mediaSkills = mediaSkillBoxes.filter((box) => box.checked).map((box) => box.value);
    if (track === "media" && !mediaSkills.length) {
      status.textContent = "Media team applicants must select at least one thing they make (clips, casting, design…).";
      status.dataset.state = "error";
      submit.disabled = !recruitmentAvailable;
      return;
    }
    const payload = {
      displayName: form.elements.displayName.value.trim(),
      email: form.elements.email.value.trim(),
      age: form.elements.age.value,
      showAgeOnProfile: form.elements.showAgeOnProfile.checked,
      track,
      platform: form.elements.platform.value,
      game: form.elements.game.value,
      socialUrl1: form.elements.socialUrl1.value.trim(),
      socialUrl2: form.elements.socialUrl2.value.trim(),
      socialUrl3: form.elements.socialUrl3.value.trim(),
      inGameHandle: form.elements.inGameHandle.value.trim(),
      rankLevel: form.elements.rankLevel.value.trim(),
      competitiveExperience: form.elements.competitiveExperience.value.trim(),
      proudestMoment: form.elements.proudestMoment.value.trim(),
      gameDetails: form.elements.gameDetails.value.trim(),
      availability: form.elements.availability.value,
      timezoneRegion: form.elements.timezoneRegion.value,
      scheduleWindow: form.elements.scheduleWindow.value,
      feedbackStory: form.elements.feedbackStory.value.trim(),
      hasMic: track === "media" ? "" : form.elements.hasMic.value,
      whyVayntr: form.elements.whyVayntr.value.trim(),
      otherRosterStatus: form.elements.otherRosterStatus.value,
      scheduleAgreement: track === "media" ? false : form.elements.scheduleAgreement.checked,
      mediaSkills: track === "media" ? mediaSkills : [],
      mediaTools: track === "media" ? form.elements.mediaTools.value.trim() : "",
      bestContentUrl: track === "media" ? form.elements.bestContentUrl.value.trim() : "",
      youtubeUrl: youtubeUrl || "",
      privacyConsent: form.elements.privacyConsent.checked,
      ageConfirmed: form.elements.ageConfirmed.checked,
      message: form.elements.message.value.trim()
    };
    if (track === "media" && !payload.socialUrl1) {
      status.textContent = "Media team applicants must include at least one social media link.";
      status.dataset.state = "error";
      submit.disabled = !recruitmentAvailable;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Submitting application…";
    status.textContent = "Sending your application securely to VAYNTR.";
    try {
      const response = await fetch(API_BASE + "/api/recruitment/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The application could not be submitted. Please try again.");
      form.reset();
      status.textContent = "Application received successfully. VAYNTR will review your submission and contact you by email manually.";
      status.dataset.state = "success";
    } catch (error) {
      status.textContent = error.message || "Unable to reach the application service. Your application has not been confirmed; please try again later.";
      status.dataset.state = "error";
    } finally {
      submit.disabled = !recruitmentAvailable;
      submit.innerHTML = 'Submit application <span aria-hidden="true">↗</span>';
    }
  });
})();
