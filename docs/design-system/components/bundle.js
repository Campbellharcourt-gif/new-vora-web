/* VORA preview helpers: the reveal/replay behaviour from the motion system, as plain functions. */
(function () {
  "use strict";

  function reduced(el) {
    var scope = el && el.closest ? el.closest("[data-motion]") : null;
    if (scope) return scope.getAttribute("data-motion") === "reduced";
    var rootPref = document.documentElement.getAttribute("data-motion");
    if (rootPref) return rootPref === "reduced";
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function targetsOf(root) {
    return Array.prototype.slice.call(root.querySelectorAll("[data-reveal]"));
  }

  /* Arm reveals under root, then reveal each target once when 15% of it is in view.
     In reduced motion nothing is armed, so everything simply stays visible.
     A safety timeout reveals everything after 2.5 s whatever happens. */
  function reveal(root) {
    root = root || document.body;
    var targets = targetsOf(root);
    if (reduced(root) || !("IntersectionObserver" in window)) {
      root.classList.remove("v-armed");
      return;
    }
    root.classList.add("v-armed");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    targets.forEach(function (t) { io.observe(t); });
    window.setTimeout(function () {
      targets.forEach(function (t) { t.classList.add("is-in"); });
    }, 2500);
  }

  /* Play the reveals under root again (for demonstrations). */
  function replay(root) {
    root = root || document.body;
    var targets = targetsOf(root);
    if (reduced(root)) {
      root.classList.remove("v-armed");
      targets.forEach(function (t) { t.classList.add("is-in"); });
      return;
    }
    root.classList.add("v-armed");
    targets.forEach(function (t) { t.classList.remove("is-in"); });
    void root.offsetWidth;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        targets.forEach(function (t) { t.classList.add("is-in"); });
      });
    });
  }

  /* Set a determinate survey line (0..1). */
  function progress(el, value) {
    var v = Math.max(0, Math.min(1, Number(value) || 0));
    el.style.setProperty("--p", String(v));
    el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  }

  window.VORA = { reduced: reduced, reveal: reveal, replay: replay, progress: progress };
})();
