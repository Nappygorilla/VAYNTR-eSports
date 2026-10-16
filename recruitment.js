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

  async function checkRecruitmentAvailability() {
    try {
      const response = await fetch(API_BASE + "/api/status");
      const data = await response.json().catch(() => ({}));
      recruitmentAvailable = response.ok &&
        Boolean(data.features && data.features.recruitmentApplications &&
          data.features.emailNotifications && data.features.staffReviewConfigured);
      if (recruitmentAvailable) {
        controls.forEach((control) => { control.disabled = false; });
        status.textContent = "Applications are open. Make sure your YouTube video is Unlisted or Public before submitting.";
        status.dataset.state = "success";
      } else {
        status.textContent = "Applications are temporarily paused while VAYNTR completes email-delivery and secure staff-review setup. No application details have been submitted.";
        status.dataset.state = "warning";
      }
    } catch {
      recruitmentAvailable = false;
      status.textContent = "Recruitment availability could not be verified. The form is paused and no application details have been submitted.";
      status.dataset.state = "error";
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    if (!recruitmentAvailable) {
      status.textContent = "Applications are temporarily paused. Please try again later.";
      status.dataset.state = "warning";
      return;
    }
    if (!form.reportValidity()) return;
    const youtubeUrl = normalizeYouTubeUrl(form.elements.youtubeUrl.value);
    if (!youtubeUrl) {
      form.elements.youtubeUrl.setCustomValidity("Enter a direct link to a YouTube video (not a channel or playlist).");
      form.elements.youtubeUrl.reportValidity();
      form.elements.youtubeUrl.setCustomValidity("");
      return;
    }
    const payload = {
      displayName: form.elements.displayName.value.trim(),
      email: form.elements.email.value.trim(),
      platform: form.elements.platform.value,
      game: form.elements.game.value,
      youtubeUrl,
      privacyConsent: form.elements.privacyConsent.checked,
      message: form.elements.message.value.trim()
    };
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
      status.textContent = data.notification && data.notification.sent
        ? "Application submitted successfully. Resend accepted your confirmation email request."
        : "Application saved successfully, but the confirmation email could not be sent yet. The VAYNTR team can still review your application.";
      status.dataset.state = data.notification && data.notification.sent ? "success" : "warning";
    } catch (error) {
      status.textContent = error.message || "Unable to reach the application service. Your application has not been confirmed; please try again later.";
      status.dataset.state = "error";
    } finally {
      submit.disabled = !recruitmentAvailable;
      submit.innerHTML = 'Submit application <span aria-hidden="true">↗</span>';
    }
  });
})();
