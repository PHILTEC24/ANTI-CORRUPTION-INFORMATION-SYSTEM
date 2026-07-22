// Toggles the mobile navigation menu open/closed
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  const actions = document.querySelector(".nav-actions");

  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    if (actions) actions.classList.toggle("mobile-shown", isOpen);
  });
});
