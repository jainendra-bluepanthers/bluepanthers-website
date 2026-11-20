(function () {
  "use strict";
  document.documentElement.classList.add("js");

  // Mobile menu
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      }
    });
  }

  // Reveal on scroll
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }

  // Enquiry form -> Formspree
  var FORM_ENDPOINT = "https://formspree.io/f/xnpdqzqj";
  var form = document.getElementById("enquiry");
  if (!form) return;
  var msg = form.querySelector(".form-msg");
  var button = form.querySelector("button[type=submit]");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var ok = true;
    ["f-name", "f-email", "f-message"].forEach(function (id) {
      var el = document.getElementById(id);
      var valid = el.value.trim() !== "" && (el.type !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));
      el.classList.toggle("invalid", !valid);
      if (!valid) ok = false;
    });
    if (!ok) { msg.textContent = "Please fill in your name, a valid email and a message."; return; }

    button.disabled = true;
    msg.textContent = "Sending…";
    try {
      var r = await fetch(FORM_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(form) });
      if (!r.ok) throw new Error("bad status");
      form.reset();
      msg.textContent = "Thank you. Your enquiry has been sent, and we will reply soon.";
    } catch (err) {
      msg.textContent = "Could not send. Please email jainendra@bluepanthers.in instead.";
    } finally {
      button.disabled = false;
    }
  });
})();
