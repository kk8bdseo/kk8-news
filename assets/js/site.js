/* KK8 Bangladesh — minimal vanilla JS. Mobile nav + FAQ accordion only (CLAUDE.md §2). */
(function () {
  'use strict';

  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('mobileNav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.hidden = open;
    });
  }

  /* Accordions are progressive: markup renders open and readable without JS,
     so the FAQ content is always crawlable and never hidden from indexing. */
  var qs = document.querySelectorAll('.faq-q');
  Array.prototype.forEach.call(qs, function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    btn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
  });
})();
