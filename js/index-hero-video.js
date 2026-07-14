(function () {
  var video = document.getElementById('heroVideo');
  var btn   = document.getElementById('videoToggle');
  if (!video || !btn) return;

  function sync() {
    var playing = !video.paused && !video.ended;
    btn.dataset.state = playing ? 'playing' : 'paused';
    btn.setAttribute('aria-label', playing ? 'Pause background video' : 'Play background video');
  }

  btn.addEventListener('click', function () {
    if (video.paused) video.play(); else video.pause();
  });
  video.addEventListener('play',  sync);
  video.addEventListener('pause', sync);
  sync();
})();
