/* Browser-only interaction layer; rendering itself lives in map-engine.js. */
(function () {
  'use strict';

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const WIDTH = 960;
  const HEIGHT = 600;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const view = MapEngine.createView(WIDTH, HEIGHT);
  MapEngine.fitWorld(view);

  function draw() {
    MapEngine.render(ctx, view, 1);
    document.getElementById('state').textContent =
      'zoom ' + view.zoom.toFixed(4) +
      '  center (' + Math.round(view.centerX) + ', ' + Math.round(view.centerY) + ' m)';
  }

  let dragging = false;
  let last = null;
  canvas.addEventListener('pointerdown', function (event) {
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    view.centerX -= dx / view.zoom;
    view.centerY -= dy / view.zoom;
    draw();
  });
  canvas.addEventListener('pointerup', function (event) {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const anchorX = view.centerX + (mx - WIDTH / 2) / view.zoom;
    const anchorY = view.centerY + (my - HEIGHT / 2) / view.zoom;
    view.zoom = Math.min(2, Math.max(0.02, view.zoom * factor));
    view.centerX = anchorX - (mx - WIDTH / 2) / view.zoom;
    view.centerY = anchorY - (my - HEIGHT / 2) / view.zoom;
    draw();
  }, { passive: false });

  ['terrain', 'roads', 'water'].forEach(function (name) {
    document.getElementById('layer-' + name).addEventListener('change', function (event) {
      view.layers[name] = event.target.checked;
      draw();
    });
  });

  document.getElementById('reset').addEventListener('click', function () {
    MapEngine.fitWorld(view);
    draw();
  });

  document.getElementById('export').addEventListener('click', function () {
    const scale = 4;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = WIDTH * scale;
    exportCanvas.height = HEIGHT * scale;
    MapEngine.render(exportCanvas.getContext('2d'), view, scale);

    const link = document.createElement('a');
    link.download = 'map-4x.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();

    const payload = {
      format: 'map-export/1',
      viewport: { width: WIDTH, height: HEIGHT },
      exportScale: scale,
      view: {
        zoom: view.zoom,
        centerX: view.centerX,
        centerY: view.centerY,
        layers: Object.assign({}, view.layers),
      },
      legend: MapEngine.legendEntries(view),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const jsonLink = document.createElement('a');
    jsonLink.download = 'layers.json';
    jsonLink.href = URL.createObjectURL(blob);
    jsonLink.click();
  });

  draw();
})();
