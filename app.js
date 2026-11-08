/* VoxelSynth workspace controller. No network access, no dependencies. */
(function () {
  'use strict';

  var V = window.VoxelSynth;
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('viewport');
  var ctx = canvas.getContext('2d');

  var state = {
    grid: null,
    mesh: null,
    yawDeg: 35,
    pitchDeg: 28,
    slice: 0,
    zoom: 1,
    operation: 'add',
    primitive: 'box',
    wireframe: false,
    showSlice: true,
    sliceOnly: false,
    theme: 'light',
    faces: [],
    sliceCells: []
  };

  function numberInput(id, fallback) {
    var el = $(id);
    var n = Number(el.value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmt(n, digits) {
    if (!Number.isFinite(n)) return 'n/a';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------------------------------------------------------- */
  /* Projection                                                       */
  /* ---------------------------------------------------------------- */

  function view() {
    var a = state.yawDeg * Math.PI / 180;
    var e = state.pitchDeg * Math.PI / 180;
    return {
      cosA: Math.cos(a), sinA: Math.sin(a),
      sinE: Math.sin(e), cosE: Math.cos(e),
      camera: [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)]
    };
  }

  function project(p, v, originX, originY, scale) {
    var X = p[0] * v.cosA + p[1] * v.sinA;
    var Y = -p[0] * v.sinA + p[1] * v.cosA;
    return [
      originX + X * scale,
      originY - (Y * v.sinE + p[2] * v.cosE) * scale,
      -Y * v.cosE + p[2] * v.sinE,
      X, Y
    ];
  }

  function fitScale() {
    var g = state.grid;
    var wMm = g.nx * g.pitchMm, dMm = g.ny * g.pitchMm, hMm = g.nz * g.pitchMm;
    var v = view();
    var corners = [];
    for (var i = 0; i < 8; i++) {
      corners.push([(i & 1) * wMm, (i & 2 ? 1 : 0) * dMm, (i & 4 ? 1 : 0) * hMm]);
    }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    corners.forEach(function (c) {
      var q = project(c, v, 0, 0, 1);
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    });
    var margin = 42;
    var sx = (canvas.width - 2 * margin) / Math.max(1, maxX - minX);
    var sy = (canvas.height - 2 * margin) / Math.max(1, maxY - minY);
    return {
      scale: Math.min(sx, sy) * state.zoom,
      originX: canvas.width / 2 - ((minX + maxX) / 2) * Math.min(sx, sy) * state.zoom,
      originY: canvas.height / 2 - ((minY + maxY) / 2) * Math.min(sx, sy) * state.zoom,
      center: [wMm / 2, dMm / 2, hMm / 2]
    };
  }

  /* ---------------------------------------------------------------- */
  /* Face construction                                                */
  /* ---------------------------------------------------------------- */

  var FACE_DEFS = [
    { axis: 0, sign: 1, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], normal: [1, 0, 0], shade: 0.72 },
    { axis: 0, sign: -1, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], normal: [-1, 0, 0], shade: 0.58 },
    { axis: 1, sign: 1, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], normal: [0, 1, 0], shade: 0.86 },
    { axis: 1, sign: -1, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], normal: [0, -1, 0], shade: 0.66 },
    { axis: 2, sign: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], normal: [0, 0, 1], shade: 1 },
    { axis: 2, sign: -1, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], normal: [0, 0, -1], shade: 0.48 }
  ];

  function isFaceVisible(def, v) {
    var d = def.normal[0] * v.camera[0] + def.normal[1] * v.camera[1] + def.normal[2] * v.camera[2];
    return d > 0.001;
  }

  function neighbourFilled(x, y, z, def) {
    return V.getVoxel(state.grid, x + def.normal[0], y + def.normal[1], z + def.normal[2]) === 1;
  }

  function buildFaces() {
    var g = state.grid;
    var p = g.pitchMm;
    var v = view();
    var fit = fitScale();
    var faces = [];
    var visible = FACE_DEFS.filter(function (def) { return isFaceVisible(def, v); });
    for (var z = 0; z < g.nz; z++) {
      for (var y = 0; y < g.ny; y++) {
        for (var x = 0; x < g.nx; x++) {
          if (!V.getVoxel(g, x, y, z) || (state.showSlice && state.sliceOnly && z > state.slice)) continue;
          for (var f = 0; f < visible.length; f++) {
            var def = visible[f];
            if (neighbourFilled(x, y, z, def)) continue;
            var pts = [];
            var center = [0, 0, 0];
            for (var c = 0; c < 4; c++) {
              var corner = def.corners[c];
              var world = [(x + corner[0]) * p, (y + corner[1]) * p, (z + corner[2]) * p];
              center[0] += world[0] / 4;
              center[1] += world[1] / 4;
              center[2] += world[2] / 4;
              pts.push(project(world, v, fit.originX, fit.originY, fit.scale));
            }
            var depth = center[0] * v.camera[0] + center[1] * v.camera[1] + center[2] * v.camera[2];
            faces.push({ pts: pts, depth: depth, def: def, voxel: [x, y, z], shade: def.shade });
          }
        }
      }
    }
    faces.sort(function (m, n) { return m.depth - n.depth; });
    state.faces = faces;
    state.sliceCells = buildSliceCells(v, fit);
    return fit;
  }

  function buildSliceCells(v, fit) {
    var g = state.grid;
    var p = g.pitchMm;
    var cells = [];
    if (!state.showSlice) return cells;
    var z0 = state.slice;
    for (var y = 0; y < g.ny; y++) {
      for (var x = 0; x < g.nx; x++) {
        var pts = [
          project([x * p, y * p, z0 * p], v, fit.originX, fit.originY, fit.scale),
          project([(x + 1) * p, y * p, z0 * p], v, fit.originX, fit.originY, fit.scale),
          project([(x + 1) * p, (y + 1) * p, z0 * p], v, fit.originX, fit.originY, fit.scale),
          project([x * p, (y + 1) * p, z0 * p], v, fit.originX, fit.originY, fit.scale)
        ];
        var cx = (x + 0.5) * p, cy = (y + 0.5) * p, cz = z0 * p;
        cells.push({
          pts: pts, voxel: [x, y, z0], filled: !!V.getVoxel(g, x, y, z0),
          depth: cx * v.camera[0] + cy * v.camera[1] + cz * v.camera[2]
        });
      }
    }
    return cells;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function shadeColor(hex, factor) {
    var h = hex.replace('#', '');
    var rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return 'rgb(' + rgb.map(function (c) { return Math.round(Math.min(255, c * factor)); }).join(',') + ')';
  }

  function drawPolygon(pts, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 1; ctx.stroke(); }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var fit = buildFaces();
    var base = cssVar('--voxel-a') || '#4b8ff5';
    var edge = cssVar('--panel-alt') || '#f7f9fc';
    var line = cssVar('--line') || '#d9e0ea';

    for (var i = 0; i < state.faces.length; i++) {
      var face = state.faces[i];
      var pts = face.pts.map(function (q) { return [q[0], q[1]]; });
      var fill = state.wireframe ? null : shadeColor(base, face.shade);
      drawPolygon(pts, fill, state.wireframe ? base : edge, state.wireframe ? 1 : 0.7);
    }

    if (state.showSlice) {
      var sliceColor = cssVar('--slice') || '#f2a33c';
      for (var j = 0; j < state.sliceCells.length; j++) {
        var cell = state.sliceCells[j];
        var poly = cell.pts.map(function (q) { return [q[0], q[1]]; });
        ctx.globalAlpha = cell.filled ? 0.30 : 0.10;
        drawPolygon(poly, sliceColor, null);
        ctx.globalAlpha = 0.85;
        drawPolygon(poly, null, sliceColor, cell.filled ? 1.3 : 0.6);
        ctx.globalAlpha = 1;
      }
    }

    drawAxes(fit, view());
  }

  function drawAxes(fit, v) {
    var g = state.grid;
    var len = Math.min(g.nx, g.ny, g.nz) * g.pitchMm * 0.42;
    var origin = project([0, 0, 0], v, fit.originX, fit.originY, fit.scale);
    var axes = [
      { p: [len, 0, 0], color: '#e05656', label: 'X' },
      { p: [0, len, 0], color: '#3aa76d', label: 'Y' },
      { p: [0, 0, len], color: '#4b8ff5', label: 'Z' }
    ];
    ctx.font = 'bold 12px ui-monospace, monospace';
    axes.forEach(function (axis) {
      var q = project(axis.p, v, fit.originX, fit.originY, fit.scale);
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = axis.color;
      ctx.fillText(axis.label, q[0] + 5, q[1] - 4);
    });
    ctx.strokeStyle = lineColor();
    ctx.lineWidth = 1;
  }

  function lineColor() { return cssVar('--line') || '#d9e0ea'; }

  /* ---------------------------------------------------------------- */
  /* Picking                                                          */
  /* ---------------------------------------------------------------- */

  function pointInPolygon(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1];
      var xj = pts[j][0], yj = pts[j][1];
      var intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function canvasPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    return [
      (evt.clientX - rect.left) * canvas.width / rect.width,
      (evt.clientY - rect.top) * canvas.height / rect.height
    ];
  }

  function pickVoxel(px, py) {
    for (var j = state.sliceCells.length - 1; j >= 0; j--) {
      var cell = state.sliceCells[j];
      if (pointInPolygon(px, py, cell.pts)) return { voxel: cell.voxel, remove: cell.filled };
    }
    for (var i = state.faces.length - 1; i >= 0; i--) {
      var face = state.faces[i];
      if (pointInPolygon(px, py, face.pts)) return { voxel: face.voxel, remove: true };
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Diagnostics and exports                                          */
  /* ---------------------------------------------------------------- */

  function recompute() {
    var infill = numberInput('infill', 100);
    state.mesh = V.extractManifoldMesh(state.grid, { infillPercent: infill });
    updateDiagnostics();
    render();
    updateChips();
  }

  function updateDiagnostics() {
    var s = state.mesh.stats;
    var material = $('material').value;
    var mass = V.estimateMass(state.mesh, {
      material: material,
      infillPercent: s.infillPercent
    });
    var rows = [
      ['Solid voxels', fmt(s.voxelCount, 0)],
      ['Exposed faces', fmt(s.exposedFaceCount, 0)],
      ['Naive triangles', fmt(s.naiveTriangleCount, 0)],
      ['Greedy quads', fmt(s.quadCount, 0)],
      ['Output triangles', fmt(s.triangleCount, 0)],
      ['Merge ratio', fmt(s.mergeRatio, 2) + ' x'],
      ['Surface area', fmt(s.surfaceAreaMm2, 1) + ' mm2'],
      ['Enclosed volume', fmt(s.volumeCm3, 2) + ' cm3'],
      ['Bounds (X/Y/Z)', s.boundingBoxMm.size.map(function (n) { return fmt(n, 1); }).join(' / ') + ' mm'],
      ['Euler (V - E + F)', fmt(s.eulerCharacteristic, 0)],
      ['Genus estimate', fmt(s.genusEstimate, 1)],
      ['Vertices', fmt(s.uniqueVertices, 0)],
      ['Edges', fmt(s.uniqueEdges, 0)],
      ['Watertight', s.watertight ? 'Yes' : 'No'],
      ['Unmatched edges', fmt(s.unmatchedEdges, 0)],
      ['Infill', fmt(s.infillPercent, 0) + ' %'],
      [material + ' mass', fmt(mass.grams, 2) + ' g']
    ];
    $('diag-body').innerHTML = rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('');
    var badge = $('health-badge');
    if (s.watertight) {
      badge.textContent = 'Watertight manifold. Every directed edge is paired.';
      badge.className = 'health';
    } else {
      badge.textContent = s.triangleCount ? 'Open surface. Check unmatched edges.' : 'Empty grid. Add a primitive to begin.';
      badge.className = 'health bad';
    }
  }

  function updateChips() {
    $('mode-chip').textContent = state.primitive + ' / ' + state.operation;
    $('slice-chip').textContent = 'Z layer ' + (state.slice + 1) + ' / ' + state.grid.nz +
      (state.sliceOnly ? ' (slice only)' : '');
    $('slice').max = String(state.grid.nz - 1);
    $('slice-out').textContent = String(state.slice + 1);
    $('yaw-out').textContent = state.yawDeg + ' deg';
    $('pitch-out').textContent = state.pitchDeg + ' deg';
  }

  function exportedText(kind) {
    var name = $('export-name').value;
    switch (kind) {
      case 'ascii-stl': return { text: V.exportAsciiSTL(state.mesh, name), ext: 'stl', mime: 'model/stl' };
      case 'obj': return { text: V.exportOBJ(state.mesh, name), ext: 'obj', mime: 'model/obj' };
      case 'scad': return { text: V.exportOpenSCAD(state.grid), ext: 'scad', mime: 'text/plain' };
      case 'json': return { text: JSON.stringify(V.serializeGrid(state.grid), null, 2), ext: 'json', mime: 'application/json' };
      default: return null;
    }
  }

  function showToast(message) {
    var toast = $('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function safeName() {
    return ($('export-name').value || 'voxelsynth_model').replace(/[^A-Za-z0-9_.-]+/g, '_');
  }

  function handleExport(kind) {
    var base = safeName();
    if (kind === 'binary-stl') {
      var bytes = V.exportBinarySTL(state.mesh, base);
      downloadBlob(new Blob([bytes], { type: 'model/stl' }), base + '.stl');
      showToast('Binary STL downloaded. ' + state.mesh.triangles.length + ' facets.');
      return;
    }
    var payload = exportedText(kind);
    if (!payload) return;
    downloadBlob(new Blob([payload.text], { type: payload.mime }), base + '.' + payload.ext);
    showToast(payload.ext.toUpperCase() + ' downloaded.');
  }

  function handleCopy(kind) {
    var payload = exportedText(kind);
    if (!payload) return;
    var done = function () { showToast(payload.ext.toUpperCase() + ' copied to clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload.text).then(done, function () { legacyCopy(payload.text, done); });
    } else {
      legacyCopy(payload.text, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (err) { showToast('Clipboard unavailable. Use the download button instead.'); }
    ta.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  function loadPreset(name) {
    var nx = Math.round(numberInput('grid-nx', 24));
    var ny = Math.round(numberInput('grid-ny', 18));
    var nz = Math.round(numberInput('grid-nz', 12));
    var pitch = numberInput('grid-pitch', 2);
    state.grid = V.loadPreset(name, {
      nx: Math.max(4, Math.min(48, nx)),
      ny: Math.max(4, Math.min(48, ny)),
      nz: Math.max(2, Math.min(32, nz)),
      pitchMm: Math.max(0.5, Math.min(10, pitch))
    });
    state.slice = 0;
    $('slice').value = '0';
    recompute();
    showToast('Loaded ' + name + '.');
  }

  function applyPrimitive() {
    var p = state.grid.pitchMm;
    var cx = numberInput('prim-x', 6) * p;
    var cy = numberInput('prim-y', 6) * p;
    var cz = numberInput('prim-z', 4) * p;
    var w = numberInput('prim-w', 10) * p;
    var d = numberInput('prim-d', 10) * p;
    var r = numberInput('prim-r', 8) * p;
    var h = numberInput('prim-h', 8) * p;
    var g = state.grid;
    var op = state.operation;
    if (state.primitive === 'box') {
      if (op === 'add') V.addBox(g, cx, cy, cz, w, d, h);
      else V.subtractBox(g, cx, cy, cz, w, d, h);
    } else if (state.primitive === 'cylinder') {
      if (op === 'add') V.addCylinder(g, cx, cy, cz, r, h, 'z');
      else V.subtractCylinder(g, cx, cy, cz, r, h, 'z');
    } else {
      if (op === 'add') V.addSphere(g, cx, cy, cz, r);
      else V.subtractSphere(g, cx, cy, cz, r);
    }
    recompute();
    showToast(state.primitive + ' ' + op + ' applied.');
  }

  function setSegment(group, value) {
    var buttons = document.querySelectorAll(group);
    buttons.forEach(function (b) {
      var on = b.dataset.op === value || b.dataset.prim === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    $('theme-toggle').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    try { localStorage.setItem('voxelsynth-theme', theme); } catch (err) { /* storage may be blocked */ }
    render();
  }

  function setView(yaw, pitch) {
    state.yawDeg = yaw;
    state.pitchDeg = pitch;
    $('yaw').value = String(yaw);
    $('pitch').value = String(pitch);
    updateChips();
    render();
  }

  function bindEvents() {
    $('load-preset').addEventListener('click', function () { loadPreset($('preset-select').value); });
    $('preset-select').addEventListener('change', function () { loadPreset(this.value); });
    $('reset-grid').addEventListener('click', function () {
      state.grid = V.createGrid(
        Math.round(numberInput('grid-nx', 24)),
        Math.round(numberInput('grid-ny', 18)),
        Math.round(numberInput('grid-nz', 12)),
        numberInput('grid-pitch', 2)
      );
      $('slice').value = '0';
      state.slice = 0;
      recompute();
      showToast('Grid reset.');
    });
    $('apply-grid').addEventListener('click', function () { $('reset-grid').click(); });
    $('apply-primitive').addEventListener('click', applyPrimitive);

    document.querySelectorAll('[data-op]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.operation = b.dataset.op;
        setSegment('[data-op]', state.operation);
        updateChips();
      });
    });
    document.querySelectorAll('[data-prim]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.primitive = b.dataset.prim;
        setSegment('[data-prim]', state.primitive);
        updateChips();
      });
    });

    $('mirror-x').addEventListener('click', function () { V.mirrorGrid(state.grid, 'x'); recompute(); showToast('Mirrored along X.'); });
    $('mirror-y').addEventListener('click', function () { V.mirrorGrid(state.grid, 'y'); recompute(); showToast('Mirrored along Y.'); });
    $('apply-shell').addEventListener('click', function () {
      V.shellGrid(state.grid, numberInput('shell-wall', 3));
      recompute();
      showToast('Shell applied.');
    });

    $('infill').addEventListener('input', recompute);
    $('material').addEventListener('change', recompute);
    $('theme-toggle').addEventListener('click', function () {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
    $('help-toggle').addEventListener('click', function () {
      var panel = $('help-panel');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    });

    $('yaw').addEventListener('input', function () { state.yawDeg = Number(this.value); updateChips(); render(); });
    $('pitch').addEventListener('input', function () { state.pitchDeg = Number(this.value); updateChips(); render(); });
    $('slice').addEventListener('input', function () { state.slice = Number(this.value); updateChips(); render(); });
    $('view-top').addEventListener('click', function () { setView(0, 89); });
    $('view-front').addEventListener('click', function () { setView(0, 2); });
    $('view-iso').addEventListener('click', function () { setView(35, 28); });
    $('toggle-wire').addEventListener('click', function () {
      state.wireframe = !state.wireframe;
      this.setAttribute('aria-pressed', String(state.wireframe));
      this.classList.toggle('btn-primary', state.wireframe);
      render();
    });
    $('toggle-slice').addEventListener('click', function () {
      state.showSlice = !state.showSlice;
      this.setAttribute('aria-pressed', String(state.showSlice));
      this.classList.toggle('btn-primary', state.showSlice);
      render();
    });
    $('cycle-slice-mode').addEventListener('click', function () {
      state.sliceOnly = !state.sliceOnly;
      this.textContent = state.sliceOnly ? 'Show full model' : 'Slice only';
      this.setAttribute('aria-pressed', String(state.sliceOnly));
      updateChips();
      render();
    });

    document.querySelectorAll('[data-export]').forEach(function (b) {
      b.addEventListener('click', function () { handleExport(b.dataset.export); });
    });
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { handleCopy(b.dataset.copy); });
    });

    var drag = null;
    canvas.addEventListener('pointerdown', function (evt) {
      drag = { x: evt.clientX, y: evt.clientY, yaw: state.yawDeg, pitch: state.pitchDeg, moved: false };
      canvas.setPointerCapture(evt.pointerId);
    });
    canvas.addEventListener('pointermove', function (evt) {
      if (!drag) return;
      var dx = evt.clientX - drag.x, dy = evt.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        state.yawDeg = Math.max(-180, Math.min(180, drag.yaw + dx * 0.4));
        state.pitchDeg = Math.max(-80, Math.min(80, drag.pitch + dy * 0.3));
        $('yaw').value = String(Math.round(state.yawDeg));
        $('pitch').value = String(Math.round(state.pitchDeg));
        updateChips();
        render();
      }
    });
    canvas.addEventListener('pointerup', function (evt) {
      if (drag && !drag.moved) {
        var pt = canvasPoint(evt);
        var hit = pickVoxel(pt[0], pt[1]);
        if (hit) {
          var cell = hit.voxel;
          V.setVoxel(state.grid, cell[0], cell[1], cell[2], hit.remove ? 0 : 1);
          recompute();
          showToast('Voxel ' + cell.join(',') + (hit.remove ? ' cleared.' : ' added.'));
        }
      }
      drag = null;
    });
    canvas.addEventListener('wheel', function (evt) {
      evt.preventDefault();
      state.zoom = Math.max(0.4, Math.min(3, state.zoom * (evt.deltaY > 0 ? 0.92 : 1.08)));
      render();
    }, { passive: false });

    document.addEventListener('keydown', function (evt) {
      var tag = (evt.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      var key = evt.key;
      var handled = true;
      switch (key) {
        case '1': $('preset-select').value = 'deskOrganizer'; loadPreset('deskOrganizer'); break;
        case '2': $('preset-select').value = 'sdCardVault'; loadPreset('sdCardVault'); break;
        case '3': $('preset-select').value = 'cableComb'; loadPreset('cableComb'); break;
        case '4': $('preset-select').value = 'rpiPicoMount'; loadPreset('rpiPicoMount'); break;
        case 'b': state.primitive = 'box'; setSegment('[data-prim]', 'box'); updateChips(); break;
        case 'c': state.primitive = 'cylinder'; setSegment('[data-prim]', 'cylinder'); updateChips(); break;
        case 's': state.primitive = 'sphere'; setSegment('[data-prim]', 'sphere'); updateChips(); break;
        case 'a': state.operation = 'add'; setSegment('[data-op]', 'add'); updateChips(); break;
        case 'd': state.operation = 'subtract'; setSegment('[data-op]', 'subtract'); updateChips(); break;
        case 'm': $('mirror-x').click(); break;
        case 'h': $('apply-shell').click(); break;
        case 't': $('theme-toggle').click(); break;
        case 'r': $('reset-grid').click(); break;
        case '?': $('help-toggle').click(); break;
        case 'ArrowLeft': state.yawDeg = Math.max(-180, state.yawDeg - 5); $('yaw').value = String(state.yawDeg); updateChips(); render(); break;
        case 'ArrowRight': state.yawDeg = Math.min(180, state.yawDeg + 5); $('yaw').value = String(state.yawDeg); updateChips(); render(); break;
        case 'ArrowUp': state.pitchDeg = Math.min(80, state.pitchDeg + 5); $('pitch').value = String(state.pitchDeg); updateChips(); render(); break;
        case 'ArrowDown': state.pitchDeg = Math.max(-80, state.pitchDeg - 5); $('pitch').value = String(state.pitchDeg); updateChips(); render(); break;
        case 'PageUp': setSlice(state.slice + 1); break;
        case 'PageDown': setSlice(state.slice - 1); break;
        default: handled = false;
      }
      if (handled) evt.preventDefault();
    });

    window.addEventListener('resize', function () { render(); });
  }

  function setSlice(value) {
    state.slice = Math.max(0, Math.min(state.grid.nz - 1, value));
    $('slice').value = String(state.slice);
    updateChips();
    render();
  }

  function init() {
    var stored = 'light';
    try { stored = localStorage.getItem('voxelsynth-theme') || 'light'; } catch (err) { /* storage may be blocked */ }
    state.grid = V.loadPreset('deskOrganizer', { pitchMm: 2, nx: 24, ny: 18, nz: 12 });
    state.theme = stored === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    $('theme-toggle').textContent = state.theme === 'dark' ? 'Light theme' : 'Dark theme';
    bindEvents();
    recompute();
  }

  init();
})();
