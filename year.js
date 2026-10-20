document.querySelectorAll("[data-year]").forEach((n) => { n.textContent = String(new Date().getFullYear()); });
