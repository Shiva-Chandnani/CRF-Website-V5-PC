(function () {
  var tabs   = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.panel');

  function activate(target) {
    tabs.forEach(function (t) {
      var on = t.dataset.target === target;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      var on = p.id === 'panel-' + target;
      p.classList.toggle('is-active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { activate(t.dataset.target); });
  });

  // Honor URL hash so /book-appointment.html#online deep-links straight in
  var hash = (location.hash || '').replace('#', '');
  if (hash === 'online' || hash === 'in-person') activate(hash);
})();
