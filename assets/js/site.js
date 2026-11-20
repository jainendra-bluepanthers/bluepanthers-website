(function () {
  "use strict";

  // Mobile menu
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  // Dropdown menus (click / keyboard; hover handled in CSS on desktop)
  var menus = document.querySelectorAll(".has-menu");
  menus.forEach(function (item) {
    var btn = item.querySelector(".nav-link");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !item.classList.contains("open");
      menus.forEach(function (m) { m.classList.remove("open"); m.querySelector(".nav-link").setAttribute("aria-expanded", "false"); });
      item.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".has-menu")) {
      menus.forEach(function (m) { m.classList.remove("open"); m.querySelector(".nav-link").setAttribute("aria-expanded", "false"); });
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      menus.forEach(function (m) { m.classList.remove("open"); m.querySelector(".nav-link").setAttribute("aria-expanded", "false"); });
    }
  });

  // Forms -> Formspree
  var FORM_ENDPOINT = "https://formspree.io/f/xnpdqzqj";
  document.querySelectorAll("form[data-enquiry]").forEach(function (form) {
    var msg = form.querySelector(".form-msg");
    var button = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var ok = true;
      form.querySelectorAll("[required]").forEach(function (el) {
        var v = el.value.trim();
        var valid = v !== "" && (el.type !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
        el.classList.toggle("invalid", !valid);
        if (!valid) ok = false;
      });
      if (!ok) { msg.textContent = "Please complete the required fields (marked *) with a valid email."; return; }
      button.disabled = true;
      msg.textContent = "Sending…";
      try {
        var data = new FormData(form);
        data.append("_subject", "Website: " + (form.getAttribute("data-enquiry") || "enquiry"));
        var r = await fetch(FORM_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: data });
        if (!r.ok) throw new Error("status " + r.status);
        form.reset();
        msg.textContent = "Thank you. We have received your request and will reply by email.";
      } catch (err) {
        msg.textContent = "Could not send. Please email jainendra@bluepanthers.in instead.";
      } finally {
        button.disabled = false;
      }
    });
  });
})();
