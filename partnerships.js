(() => {
  "use strict";
  const form = document.getElementById("partnershipForm");
  if (!form) return;
  const status = document.getElementById("partnershipStatus");
  const submit = document.getElementById("partnershipSubmit");
  const API_BASE = "https://vayntr-esports.onrender.com";

  let partnershipsAvailable = false;
  const controls = [...form.querySelectorAll("input, select, textarea, button")];
  controls.forEach((control) => { control.disabled = true; });

  function setStatusText(text, state) {
    status.textContent = text;
    status.dataset.state = state || "";
  }

  function clearRetry() {
    const retry = status?.querySelector("button");
    retry?.remove();
  }

  function appendRetry() {
    if (!status || status.querySelector("button")) return;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button--outline";
    retry.textContent = "Check availability again ↗";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Checking…";
      checkPartnershipAvailability();
    });
    status.appendChild(retry);
  }

  // Mirrors recruitment.js: the form stays disabled until the API confirms
  // partnership intake is actually possible, so nobody types into a dead form.
  async function checkPartnershipAvailability() {
    clearRetry();
    try {
      // no-store so a retry after Render wakes up is never answered from the browser cache.
      const response = await fetch(API_BASE + "/api/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      const features = data.features || {};
      partnershipsAvailable = response.ok && Boolean(features.partnershipInquiries && features.staffReviewConfigured);
      if (partnershipsAvailable) {
        controls.forEach((control) => { control.disabled = false; });
        setStatusText("Partnership intake is open. VAYNTR reviews inquiries manually and replies by email.", "success");
      } else {
        setStatusText("Partnership intake is temporarily paused until the database and secure staff review are ready. No details have been submitted.", "warning");
        appendRetry();
      }
    } catch {
      partnershipsAvailable = false;
      setStatusText("Availability could not be verified. The form is paused and no details have been submitted.", "error");
      appendRetry();
    }
  }
  checkPartnershipAvailability();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatusText("");
    if (!partnershipsAvailable) {
      setStatusText("Partnership intake is temporarily paused. Please try again later.", "warning");
      return;
    }
    if (!form.reportValidity()) return;
    const messageValue = form.elements.message.value.trim();
    if (messageValue.length < 30) {
      form.elements.message.setCustomValidity("Describe the collaboration in at least 30 characters.");
      form.elements.message.reportValidity();
      form.elements.message.setCustomValidity("");
      return;
    }
    // https links only, matching the server's validation; empty boxes stay empty strings.
    const linkFields = [form.elements.website, form.elements.proposalUrl];
    for (const field of linkFields) {
      const value = field.value.trim();
      if (!value) continue;
      let parsed;
      try { parsed = new URL(value); } catch {
        field.setCustomValidity("Enter a valid link starting with https://");
        field.reportValidity();
        field.setCustomValidity("");
        return;
      }
      if (parsed.protocol !== "https:") {
        field.setCustomValidity("Links must start with https://");
        field.reportValidity();
        field.setCustomValidity("");
        return;
      }
    }
    const payload = {
      orgName: form.elements.orgName.value.trim(),
      contactName: form.elements.contactName.value.trim(),
      email: form.elements.email.value.trim(),
      partnershipType: form.elements.partnershipType.value,
      budget: form.elements.budget.value,
      timeline: form.elements.timeline.value.trim(),
      website: form.elements.website.value.trim(),
      proposalUrl: form.elements.proposalUrl.value.trim(),
      message: messageValue,
      followUp: form.elements.followUp.checked,
      consent: form.elements.privacyConsent.checked
    };
    submit.disabled = true;
    submit.textContent = "Submitting inquiry…";
    setStatusText("Sending your inquiry securely to VAYNTR.", "");
    try {
      const response = await fetch(API_BASE + "/api/partnerships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The inquiry could not be submitted. Please try again.");
      form.reset();
      setStatusText("Inquiry received. VAYNTR reviews partnership inquiries manually and will contact you by email.", "success");
    } catch (error) {
      setStatusText(error.message || "Unable to reach the partnership service. Nothing was submitted; please try again later.", "error");
    } finally {
      submit.disabled = !partnershipsAvailable;
      submit.innerHTML = 'Submit inquiry <span aria-hidden="true">↗</span>';
    }
  });
})();
