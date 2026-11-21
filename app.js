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
    sliceCells: [],
    viewportWidth: 900, viewportHeight: 620, dpr: 1,
    selected: [0, 0, 0], hover: null, inset: null,
    undo: [], redo: [], presetName: 'deskOrganizer', verification: null, infillPercent: 100, material: 'PLA',
    artMode: false, turntable: false, turntableTimer: null, lighting: false,
    sliceAxis: 'z', printCheck: false, printStats: null, floatingSet: null, overhangSet: null, thinSet: null,
    symmetry: 'off', gallery: false, galleryPaused: false, galleryTimer: null, galleryOwnsTurntable: false, occBounds: null
  };

  var SCULPTURE_INFO = {
    gyroidPavilion: { title: 'Minimalist Gyroid Pavilion', formula: 'sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0', caption: 'A triply periodic minimal surface carved into a solid block. The winding tunnels keep the shell watertight while light passes through every window.' },
    mengerLantern: { title: 'Menger Sponge Lantern', formula: 'base-3 digits with at most one middle digit', caption: 'A recursive cube that removes its center at every scale. What remains is a lattice of open galleries, each framed by the same rule repeated.' },
    helicalRibbon: { title: 'Helical Kinetic Ribbon', formula: 'theta(z) = theta0 + 2*pi*2*z / height', caption: 'Three ribbons advance in fixed step with height. The sculpture freezes a rotation that would otherwise continue beyond the frame.' },
    voronoiAmphitheater: { title: 'Voronoi Terraced Amphitheater', formula: 'height = f(nearest, second nearest seed)', caption: 'Competing seed points carve stepped terraces. Height records the distance between the nearest two sites, so the boundaries become aisles.' }
  };

  function numberInput(id, fallback) {
    var el = $(id);
    var n = Number(el.value);
    if (!String(el.value).trim() || !Number.isFinite(n)) throw new RangeError(id + ' needs a finite number');
    return n;
  }

  function fmt(n, digits) {
    if (!Number.isFinite(n)) return 'n/a';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------------------------------------------------------- */
  /* Orthographic Isometric Projection                                */
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

  /* Occupied millimetre bounds of the lattice: used for tighter framing
   * and the ground shadow. Falls back to the full lattice when empty. */
  function occupiedBounds() {
    var g = state.grid, p = g.pitchMm;
    var lo = [g.nx, g.ny, g.nz], hi = [-1, -1, -1];
    for (var z = 0; z < g.nz; z++) {
      for (var y = 0; y < g.ny; y++) {
        for (var x = 0; x < g.nx; x++) {
          if (!V.getVoxel(g, x, y, z)) continue;
          if (x < lo[0]) lo[0] = x;
          if (x > hi[0]) hi[0] = x;
          if (y < lo[1]) lo[1] = y;
          if (y > hi[1]) hi[1] = y;
          if (z < lo[2]) lo[2] = z;
          if (z > hi[2]) hi[2] = z;
        }
      }
    }
    if (hi[0] < 0) return { min: [0, 0, 0], max: [g.nx * p, g.ny * p, g.nz * p] };
    return {
      min: [lo[0] * p, lo[1] * p, lo[2] * p],
      max: [(hi[0] + 1) * p, (hi[1] + 1) * p, (hi[2] + 1) * p]
    };
  }

  function fitScale() {
    var g = state.grid;
    var p = g.pitchMm;
    var b = occupiedBounds();
    state.occBounds = b;
    var v = view();
    var corners = [];
    for (var i = 0; i < 8; i++) {
      corners.push([
        (i & 1) ? b.max[0] : b.min[0],
        (i & 2) ? b.max[1] : b.min[1],
        (i & 4) ? b.max[2] : b.min[2]
      ]);
    }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    corners.forEach(function (c) {
      var q = project(c, v, 0, 0, 1);
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    });
    var margin = 48;
    var sx = Math.max(1, state.viewportWidth - 2 * margin) / Math.max(1, maxX - minX);
    var reservedTop = state.viewportWidth < 680 ? 150 : 40;
    var sy = Math.max(1, state.viewportHeight - reservedTop - 2 * margin) / Math.max(1, maxY - minY);
    var s = Math.min(sx, sy) * state.zoom;
    return {
      scale: s,
      originX: (state.viewportWidth * 0.48) - ((minX + maxX) / 2) * s,
      originY: (reservedTop + (state.viewportHeight - reservedTop) * 0.52) - ((minY + maxY) / 2) * s,
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
    };
  }

  /* Slice axis helpers: the cross-section plane can sit on X, Y or Z. */
  function sliceAxisIndex() { return state.sliceAxis === 'x' ? 0 : state.sliceAxis === 'y' ? 1 : 2; }

  /* In-plane axes for the slice grid: Z slice shows XY, X shows YZ, Y shows XZ. */
  function slicePlaneAxes() {
    var a = sliceAxisIndex();
    return a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
  }

  function sliceAxisSize() {
    var g = state.grid;
    return [g.nx, g.ny, g.nz][sliceAxisIndex()];
  }

  /* ---------------------------------------------------------------- */
  /* Face construction                                                */
  /* ---------------------------------------------------------------- */

  var FACE_DEFS = [
    { axis: 0, sign: 1, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], normal: [1, 0, 0], shade: 0.76 },
    { axis: 0, sign: -1, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], normal: [-1, 0, 0], shade: 0.60 },
    { axis: 1, sign: 1, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], normal: [0, 1, 0], shade: 0.88 },
    { axis: 1, sign: -1, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], normal: [0, -1, 0], shade: 0.68 },
    { axis: 2, sign: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], normal: [0, 0, 1], shade: 1.00 },
    { axis: 2, sign: -1, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], normal: [0, 0, -1], shade: 0.50 }
  ];

  function isFaceVisible(def, v) {
    var d = def.normal[0] * v.camera[0] + def.normal[1] * v.camera[1] + def.normal[2] * v.camera[2];
    return d > 0.001;
  }

  function neighbourFilled(x, y, z, def) {
    if (state.sliceOnly) {
      var c = [x, y, z];
      var a = sliceAxisIndex();
      if (c[a] + def.normal[a] > state.slice) return false;
    }
    return V.getVoxel(state.grid, x + def.normal[0], y + def.normal[1], z + def.normal[2]) === 1;
  }

  function buildFaces() {
    var g = state.grid;
    var p = g.pitchMm;
    var v = view();
    var fit = fitScale();
    var faces = [];
    var visible = FACE_DEFS.filter(function (def) { return isFaceVisible(def, v); });
    var a = sliceAxisIndex();
    for (var z = 0; z < g.nz; z++) {
      for (var y = 0; y < g.ny; y++) {
        for (var x = 0; x < g.nx; x++) {
          var clipped = state.sliceOnly && (a === 0 ? x : a === 1 ? y : z) > state.slice;
          if (!V.getVoxel(g, x, y, z) || clipped) continue;
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

  /* The cut plane is a row of cells perpendicular to the slice axis; the
   * two in-plane axes form its grid. */
  function buildSliceCells(v, fit) {
    var g = state.grid;
    var p = g.pitchMm;
    var cells = [];
    if (!state.showSlice) return cells;
    var a = sliceAxisIndex();
    var uv = slicePlaneAxes();
    var nU = [g.nx, g.ny, g.nz][uv[0]], nV = [g.nx, g.ny, g.nz][uv[1]];
    var s0 = state.slice;
    var cornerWorld = function (i, j, di, dj) {
      var w = [0, 0, 0];
      w[a] = s0 * p;
      w[uv[0]] = (i + di) * p;
      w[uv[1]] = (j + dj) * p;
      return w;
    };
    for (var j = 0; j < nV; j++) {
      for (var i = 0; i < nU; i++) {
        var pts = [
          cornerWorld(i, j, 0, 0), cornerWorld(i, j, 1, 0),
          cornerWorld(i, j, 1, 1), cornerWorld(i, j, 0, 1)
        ].map(function (w) { return project(w, v, fit.originX, fit.originY, fit.scale); });
        var voxel = [0, 0, 0];
        voxel[a] = s0; voxel[uv[0]] = i; voxel[uv[1]] = j;
        var wc = [0, 0, 0];
        wc[a] = s0 * p; wc[uv[0]] = (i + 0.5) * p; wc[uv[1]] = (j + 0.5) * p;
        cells.push({
          pts: pts, voxel: voxel, filled: !!V.getVoxel(g, voxel[0], voxel[1], voxel[2]),
          depth: wc[0] * v.camera[0] + wc[1] * v.camera[1] + wc[2] * v.camera[2]
        });
      }
    }
    return cells;
  }

  /* ---------------------------------------------------------------- */
  /* CAD & Layer Cross-Section Rendering                              */
  /* ---------------------------------------------------------------- */

  function shadeColor(hex, factor) {
    var h = hex.replace('#', '');
    if (h.length !== 6) h = '647382';
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

  function drawBuildPlateCage(fit, v) {
    var g = state.grid;
    var p = g.pitchMm;
    var wMm = g.nx * p, dMm = g.ny * p;
    var lineCol = cssVar('--line-strong') || '#8d897f';

    /* Floor grid on z = 0 build plate. */
    ctx.strokeStyle = lineColor();
    ctx.lineWidth = 0.7;
    var stepX = Math.max(1, Math.round(4 / p)) * p;
    for (var x = 0; x <= wMm + 0.001; x += stepX) {
      var a0 = project([x, 0, 0], v, fit.originX, fit.originY, fit.scale);
      var a1 = project([x, dMm, 0], v, fit.originX, fit.originY, fit.scale);
      ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
    }
    for (var y = 0; y <= dMm + 0.001; y += stepX) {
      var b0 = project([0, y, 0], v, fit.originX, fit.originY, fit.scale);
      var b1 = project([wMm, y, 0], v, fit.originX, fit.originY, fit.scale);
      ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke();
    }

    /* Outer build volume bounding box. */
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 1.1;
    var baseCorners = [
      project([0, 0, 0], v, fit.originX, fit.originY, fit.scale),
      project([wMm, 0, 0], v, fit.originX, fit.originY, fit.scale),
      project([wMm, dMm, 0], v, fit.originX, fit.originY, fit.scale),
      project([0, dMm, 0], v, fit.originX, fit.originY, fit.scale)
    ];
    drawPolygon(baseCorners, null, lineCol, 1.2);
  }

  var AXIS_NAME = ['X', 'Y', 'Z'];
  var PLANE_NAME = ['YZ', 'XZ', 'XY'];

  function drawLayerInspectorHUD(sliceColor) {
    var g = state.grid;
    var a = sliceAxisIndex();
    var uv = slicePlaneAxes();
    var nU = [g.nx, g.ny, g.nz][uv[0]], nV = [g.nx, g.ny, g.nz][uv[1]];
    var s0 = state.slice;
    var boxW = state.viewportWidth < 520 ? 154 : 202;
    var boxH = state.viewportWidth < 520 ? 150 : 180;
    var x0 = state.viewportWidth - boxW - 14;
    var y0 = 14;
    var panelBg = cssVar('--panel') || '#efede8';
    var borderCol = cssVar('--line-strong') || '#8d897f';
    var inkCol = cssVar('--ink') || '#1b1d20';
    var softCol = cssVar('--ink-soft') || '#565a60';

    ctx.save();
    ctx.fillStyle = panelBg;
    ctx.fillRect(x0, y0, boxW, boxH);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x0, y0, boxW, boxH);

    /* Header bar in inspector inset. */
    ctx.fillStyle = sliceColor;
    ctx.fillRect(x0, y0, boxW, 22);
    ctx.fillStyle = cssVar('--accent-ink') || (state.theme === 'dark' ? '#23201d' : '#ffffff');
    ctx.font = 'bold 10.5px ui-monospace, monospace';
    ctx.fillText(AXIS_NAME[a] + ' LAYER ' + (s0 + 1) + '/' + sliceAxisSize() + ' / ' + PLANE_NAME[a], x0 + 8, y0 + 15);

    var padX = 12;
    var availW = boxW - 2 * padX;
    var availH = boxH - 52;
    var cellPx = Math.min(availW / nU, availH / nV);
    var gridW = cellPx * nU;
    var gridH = cellPx * nV;
    var gx0 = x0 + Math.floor((boxW - gridW) / 2);
    var gy0 = y0 + 28 + Math.floor((availH - gridH) / 2);

    state.inset = { x: x0, y: y0, width: boxW, height: boxH, gx: gx0, gy: gy0, cell: cellPx, gridWidth: gridW, gridHeight: gridH };
    var solidOnSlice = 0;
    for (var j = 0; j < nV; j++) {
      for (var i = 0; i < nU; i++) {
        var voxel = [0, 0, 0];
        voxel[a] = s0; voxel[uv[0]] = i; voxel[uv[1]] = j;
        var filled = V.getVoxel(g, voxel[0], voxel[1], voxel[2]) === 1;
        var cx = gx0 + i * cellPx;
        var cy = gy0 + (nV - 1 - j) * cellPx;
        if (filled) {
          solidOnSlice++;
          ctx.fillStyle = sliceColor;
          ctx.fillRect(cx, cy, Math.max(0.5, cellPx - 0.6), Math.max(0.5, cellPx - 0.6));
        } else {
          ctx.fillStyle = state.theme === 'dark' ? '#141619' : '#dcd8cf';
          ctx.fillRect(cx, cy, Math.max(0.5, cellPx - 0.6), Math.max(0.5, cellPx - 0.6));
        }
        if (sameCell(state.selected, voxel) ||
            (state.hover && state.hover.voxel && sameCell(state.hover.voxel, voxel))) {
          ctx.strokeStyle = inkCol; ctx.lineWidth = 1.8; ctx.strokeRect(cx, cy, cellPx, cellPx);
        }
      }
    }

    ctx.fillStyle = inkCol;
    ctx.font = '10.5px ui-monospace, monospace';
    var aMm = (s0 * g.pitchMm).toFixed(1);
    ctx.fillText(AXIS_NAME[a] + '=' + aMm + 'mm | ' + solidOnSlice + ' solid cells', x0 + 8, y0 + boxH - 8);
    ctx.fillStyle = softCol;
    ctx.restore();
  }

  function drawTelemetryHeader() {
    if (state.viewportWidth < 680) return;
    var g = state.grid;
    var inkCol = cssVar('--ink') || '#1b1d20';
    var softCol = cssVar('--ink-soft') || '#565a60';
    var panelBg = cssVar('--panel') || '#efede8';
    var borderCol = cssVar('--line-strong') || '#8d897f';

    ctx.save();
    ctx.fillStyle = panelBg;
    ctx.fillRect(12, 12, 344, 42);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, 344, 42);
    ctx.fillStyle = inkCol;
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(
      'ENV ' + (g.nx * g.pitchMm) + 'x' + (g.ny * g.pitchMm) + 'x' + (g.nz * g.pitchMm) +
      'mm | YAW ' + Math.round(state.yawDeg) + ' | PITCH ' + Math.round(state.pitchDeg) +
      ' | ZOOM ' + state.zoom.toFixed(2) + 'x',
      20,
      28
    );
    /* Live topology proof: Euler characteristic, genus, manifold verdict. */
    var s = state.mesh ? state.mesh.stats : null;
    if (s) {
      ctx.fillStyle = s.watertight ? (cssVar('--good') || '#22633b') : (cssVar('--warn') || '#963e13');
      var proof = s.triangleCount
        ? 'X ' + fmt(s.eulerCharacteristic, 0) + ' | G ' + (s.genusEstimate === null ? 'n/a' : fmt(s.genusEstimate, 0)) +
          ' | ' + (s.watertight ? '2-MANIFOLD' : 'CONTACT')
        : 'EMPTY LATTICE';
      ctx.fillText(proof, 20, 45);
    }
    ctx.fillStyle = softCol;
    ctx.restore();
  }

  function syncCanvas() {
    var rect = canvas.getBoundingClientRect();
    state.viewportWidth = Math.max(1, rect.width || 900);
    state.viewportHeight = Math.max(1, rect.height || 620);
    state.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var width = Math.round(state.viewportWidth * state.dpr);
    var height = Math.round(state.viewportHeight * state.dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function sameCell(a, b) { return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

  /* Honest voxel shadow: every occupied column casts its footprint quad on
   * the build plate, so floating clusters visibly hover above it. */
  function drawGroundShadow(fit, v) {
    var g = state.grid, p = g.pitchMm;
    var a = sliceAxisIndex();
    var cols = {};
    for (var z = 0; z < g.nz; z++) {
      for (var y = 0; y < g.ny; y++) {
        for (var x = 0; x < g.nx; x++) {
          var clipped = state.sliceOnly && (a === 0 ? x : a === 1 ? y : z) > state.slice;
          if (!clipped && V.getVoxel(g, x, y, z)) cols[x + ',' + y] = true;
        }
      }
    }
    ctx.save();
    ctx.globalAlpha = state.theme === 'dark' ? 0.26 : 0.12;
    ctx.fillStyle = state.theme === 'dark' ? '#000000' : '#2a2f35';
    Object.keys(cols).forEach(function (key) {
      var xy = key.split(','), x = Number(xy[0]), y = Number(xy[1]);
      var pts = [
        project([x * p, y * p, 0], v, fit.originX, fit.originY, fit.scale),
        project([(x + 1) * p, y * p, 0], v, fit.originX, fit.originY, fit.scale),
        project([(x + 1) * p, (y + 1) * p, 0], v, fit.originX, fit.originY, fit.scale),
        project([x * p, (y + 1) * p, 0], v, fit.originX, fit.originY, fit.scale)
      ];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function render() {
    if (!state.grid) return;
    syncCanvas();
    ctx.clearRect(0, 0, state.viewportWidth, state.viewportHeight);
    var g = state.grid;
    var fit = buildFaces();
    var v = view();
    var base = state.lighting ? (state.theme === 'dark' ? '#e0bd7d' : '#c69a55') : (cssVar('--voxel-a') || '#647382');
    var edge = state.theme === 'dark' ? '#181a1e' : '#2d333b';
    var sliceColor = cssVar('--slice') || '#d4581d';
    var floatCol = state.theme === 'dark' ? '#ff7d72' : '#b3271f';
    var overhangCol = state.theme === 'dark' ? '#ffb06a' : '#b45c00';
    var thinCol = state.theme === 'dark' ? '#78d7e8' : '#1c6a80';

    drawBuildPlateCage(fit, v);
    drawGroundShadow(fit, v);

    for (var i = 0; i < state.faces.length; i++) {
      var face = state.faces[i];
      var pts = face.pts.map(function (q) { return [q[0], q[1]]; });
      var fill = state.wireframe ? null : shadeColor(base, face.shade);
      var stroke = state.wireframe ? base : edge;
      /* Printability overlay: red faces belong to clusters floating above
       * the plate, amber faces are downward overhangs above z = 0, and blue
       * outlines identify cells only one voxel thick along any axis. */
      if (state.printCheck && state.floatingSet) {
        var idx = face.voxel[0] + g.nx * (face.voxel[1] + g.ny * face.voxel[2]);
        if (state.floatingSet.has(idx)) { fill = floatCol; stroke = floatCol; }
        else if (state.overhangSet && state.overhangSet.has(idx)) { fill = overhangCol; stroke = overhangCol; }
        else if (state.thinSet && state.thinSet.has(idx)) { stroke = thinCol; }
      }
      var lineWidth = state.wireframe ? 1.0 : 0.35;
      if (state.printCheck && stroke === thinCol && !state.wireframe) lineWidth = 1.6;
      drawPolygon(pts, fill, stroke, lineWidth);
      if (sameCell(face.voxel, state.hover && state.hover.voxel) || sameCell(face.voxel, state.selected)) {
        ctx.globalAlpha = 0.65; drawPolygon(pts, sliceColor, cssVar('--ink'), 1.5); ctx.globalAlpha = 1;
      }
    }

    if (state.showSlice) {
      for (var j = 0; j < state.sliceCells.length; j++) {
        var cell = state.sliceCells[j];
        var poly = cell.pts.map(function (q) { return [q[0], q[1]]; });
        ctx.globalAlpha = cell.filled ? 0.18 : 0.025;
        drawPolygon(poly, sliceColor, null);
        ctx.globalAlpha = 0.45;
        drawPolygon(poly, null, sliceColor, cell.filled ? 0.8 : 0.35);
        ctx.globalAlpha = 1;
      }
    }

    drawAxes(fit, v);
    drawTelemetryHeader();
    drawLayerInspectorHUD(sliceColor);
  }

  function drawAxes(fit, v) {
    /* Corner isometric axis triad + world origin axes. */
    var g = state.grid;
    var len = Math.min(g.nx, g.ny, g.nz) * g.pitchMm * 0.42;
    var origin = project([0, 0, 0], v, fit.originX, fit.originY, fit.scale);
    var axes = [
      { p: [len, 0, 0], unit: [1, 0, 0], color: '#d6453a', label: '+X' },
      { p: [0, len, 0], unit: [0, 1, 0], color: '#2e8b57', label: '+Y' },
      { p: [0, 0, len], unit: [0, 0, 1], color: '#2b6cb0', label: '+Z' }
    ];
    ctx.font = 'bold 11.5px ui-monospace, monospace';
    axes.forEach(function (axis) {
      var q = project(axis.p, v, fit.originX, fit.originY, fit.scale);
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = axis.color;
      ctx.fillText(axis.label, q[0] + 4, q[1] - 4);
    });

    /* Fixed bottom-left HUD triad. */
    var hudX = 52;
    var hudY = state.viewportHeight - 54;
    var hudLen = 28;
    var o0 = project([0, 0, 0], v, 0, 0, 1);
    axes.forEach(function (axis) {
      var u = project(axis.unit, v, 0, 0, 1);
      var dx = (u[0] - o0[0]) * hudLen;
      var dy = (u[1] - o0[1]) * hudLen;
      ctx.beginPath();
      ctx.moveTo(hudX, hudY);
      ctx.lineTo(hudX + dx, hudY + dy);
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.fillStyle = axis.color;
      ctx.fillText(axis.label.slice(1), hudX + dx * 1.25 - 4, hudY + dy * 1.25 + 4);
    });
    ctx.strokeStyle = lineColor();
    ctx.lineWidth = 1;
  }

  function lineColor() { return cssVar('--line') || '#b9b5ab'; }

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
      (evt.clientX - rect.left) * state.viewportWidth / Math.max(1, rect.width),
      (evt.clientY - rect.top) * state.viewportHeight / Math.max(1, rect.height)
    ];
  }

  function pickVoxel(px, py) {
    var inset = state.inset;
    if (inset && px >= inset.x && py >= inset.y && px < inset.x + inset.width && py < inset.y + inset.height) {
      var a = sliceAxisIndex();
      var uv = slicePlaneAxes();
      var g = state.grid;
      var nU = [g.nx, g.ny, g.nz][uv[0]], nV = [g.nx, g.ny, g.nz][uv[1]];
      var iu = Math.floor((px - inset.gx) / inset.cell);
      var iv = nV - 1 - Math.floor((py - inset.gy) / inset.cell);
      if (px >= inset.gx && py >= inset.gy && px < inset.gx + inset.gridWidth && py < inset.gy + inset.gridHeight && iu >= 0 && iu < nU && iv >= 0 && iv < nV) {
        var voxel = [0, 0, 0];
        voxel[a] = state.slice; voxel[uv[0]] = iu; voxel[uv[1]] = iv;
        if (V.inBounds(g, voxel[0], voxel[1], voxel[2])) {
          return { voxel: voxel, remove: !!V.getVoxel(g, voxel[0], voxel[1], voxel[2]), source: 'Layer inset' };
        }
      }
      return { blocked: true };
    }
    for (var j = state.sliceCells.length - 1; j >= 0; j--) {
      var cell = state.sliceCells[j];
      if (pointInPolygon(px, py, cell.pts)) return { voxel: cell.voxel, remove: cell.filled, source: 'Layer plane' };
    }
    for (var i = state.faces.length - 1; i >= 0; i--) {
      var face = state.faces[i];
      if (pointInPolygon(px, py, face.pts)) return { voxel: face.voxel, remove: true, source: 'Surface ' + ['X', 'Y', 'Z'][face.def.axis] + (face.def.sign > 0 ? '+' : '-') };
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Diagnostics and exports                                          */
  /* ---------------------------------------------------------------- */

  function recompute(preparedMesh) {
    var infill = state.infillPercent;
    state.mesh = preparedMesh || V.extractManifoldMesh(state.grid, { infillPercent: infill });
    updateDiagnostics();
    render();
    updateChips();
    updateInspector();
    updateArtPlate();
    updateTourCaption();
    updateHistoryButtons();
  }

  function updateDiagnostics() {
    var s = state.mesh.stats;
    var material = state.material;
    var mass = V.estimateMass(state.mesh, {
      material: material,
      infillPercent: s.infillPercent
    });
    /* Occupancy-level printability: floating clusters need supports, thin
     * cells print below the lattice resolution, overhangs need cooling. */
    var pr = V.analyzePrintability(state.grid);
    state.printStats = pr;
    state.floatingSet = new Set(pr.floatingCellIndices);
    state.overhangSet = new Set(pr.overhangCellIndices);
    state.thinSet = new Set(pr.thinWallCellIndices);
    var rows = [
      ['Solid voxels', fmt(s.voxelCount, 0)],
      ['Exposed faces', fmt(s.exposedFaceCount, 0)],
      ['Naive triangles', fmt(s.naiveTriangleCount, 0)],
      ['Greedy quads', fmt(s.quadCount, 0)],
      ['Output triangles', fmt(s.triangleCount, 0)],
      ['Culling ratio', fmt(s.mergeRatio, 2) + ' x'],
      ['Surface area', fmt(s.surfaceAreaMm2, 1) + ' mm2'],
      ['Enclosed volume', fmt(s.volumeCm3, 2) + ' cm3'],
      ['Bounds (X/Y/Z)', s.boundingBoxMm.size.map(function (n) { return fmt(n, 1); }).join(' / ') + ' mm'],
      ['Euler (V - E + F)', fmt(s.eulerCharacteristic, 0)],
      ['Surface components', fmt(s.surfaceComponents, 0)],
      ['Total genus', s.genusEstimate === null ? 'n/a' : fmt(s.genusEstimate, 0)],
      ['Vertices', fmt(s.uniqueVertices, 0)],
      ['Edges', fmt(s.uniqueEdges, 0)],
      ['Watertight', s.watertight ? 'Yes' : 'No'],
      ['Boundary edges', fmt(s.boundaryEdges, 0)],
      ['Edge contacts', fmt(s.nonManifoldEdges, 0)],
      ['Invalid vertex links', fmt(s.nonManifoldVertices, 0)],
      ['Winding errors', fmt(s.windingErrors, 0)],
      ['Volume error', fmt(s.volumeErrorMm3, 8) + ' mm3'],
      ['Overhang cells', fmt(pr.overhangCells, 0) + ' (' + fmt(pr.overhangAreaMm2, 0) + ' mm2)'],
      ['Thin cells X/Y/Z', fmt(pr.thinX, 0) + ' / ' + fmt(pr.thinY, 0) + ' / ' + fmt(pr.thinZ, 0)],
      ['Solid components', fmt(pr.solidComponents, 0)],
      ['Floating clusters', fmt(pr.floatingClusters, 0)],
      ['Print verdict', pr.printable ? 'Printable: every cluster sits on the plate' : 'Floating: ' + fmt(pr.floatingClusters, 0) + ' cluster(s) need support'],
      ['Infill', fmt(s.infillPercent, 0) + ' %'],
      [material + ' mass', fmt(mass.grams, 2) + ' g']
    ];
    var body = $('diag-body');
    body.textContent = '';
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (value) { var td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      body.appendChild(tr);
    });
    $('metric-volume').textContent = fmt(s.volumeCm3, 2) + ' cm3';
    $('metric-triangles').textContent = fmt(s.triangleCount, 0);
    $('metric-topology').textContent = s.watertight ? 'Verified' : s.triangleCount ? 'Check contacts' : 'Empty';
    document.querySelectorAll('[data-export], [data-copy]').forEach(function (button) {
      var kind = button.dataset.export || button.dataset.copy;
      button.disabled = kind !== 'json' && kind !== 'vox' && !s.watertight;
    });
    $('verify-exports').disabled = !s.watertight;
    var badge = $('health-badge');
    var proof = $('euler-proof');
    if (s.watertight) {
      badge.textContent = 'MANIFOLD PASS | X = ' + fmt(s.eulerCharacteristic, 0) + ' | G = ' + fmt(s.genusEstimate, 0) +
        ' | ' + fmt(s.surfaceComponents, 0) + ' closed surface' + (s.surfaceComponents === 1 ? '' : 's');
      badge.className = 'health';
      proof.textContent = 'V - E + F: ' + fmt(s.uniqueVertices, 0) + ' - ' + fmt(s.uniqueEdges, 0) + ' + ' +
        fmt(s.triangleCount, 0) + ' = ' + fmt(s.eulerCharacteristic, 0) + '. Every edge has 2 owners, every vertex link forms one ring.';
    } else {
      badge.textContent = s.triangleCount ? 'CONTACT DETECTED / inspect edge and vertex links' : 'EMPTY LATTICE: Add a CSG primitive.';
      badge.className = 'health bad';
      proof.textContent = s.triangleCount
        ? 'Topology proof unavailable: ' + fmt(s.nonManifoldEdges + s.nonManifoldVertices + s.boundaryEdges, 0) +
          ' offending edge or vertex feature(s) must be resolved.'
        : 'Topology proof pending: the lattice holds no surface yet.';
    }
  }

  function updateChips() {
    $('mode-chip').textContent = state.primitive + ' / ' + state.operation;
    var axisLetter = AXIS_NAME[sliceAxisIndex()];
    $('slice-chip').textContent = axisLetter + ' layer ' + (state.slice + 1) + ' / ' + sliceAxisSize() +
      (state.sliceOnly ? ' (slice only)' : '');
    $('slice-axis-label').textContent = axisLetter;
    $('slice').max = String(sliceAxisSize() - 1);
    $('slice').value = String(state.slice);
    $('slice-out').textContent = String(state.slice + 1);
    $('yaw-out').textContent = fmt(state.yawDeg, 0) + ' deg';
    $('pitch-out').textContent = fmt(state.pitchDeg, 0) + ' deg';
    var hint = state.primitive === 'box' ? 'Box origin and dimensions are measured in cells.' :
      state.primitive === 'cylinder' ? 'X/Y are the center, Z is the base. Radius and height are in cells.' :
      'X/Y/Z are the sphere center. Radius is measured in cells.';
    $('primitive-hint').textContent = hint;
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
    var name = String($('export-name').value || 'voxelsynth_model').trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
    return name.replace(/^[_.]+|[_.]+$/g, '').slice(0, 80) || 'voxelsynth_model';
  }

  function requireGeometry() {
    if (!state.mesh.stats.watertight) throw new RangeError('Part exports need a nonempty manifold. Resolve edge or point contacts first.');
  }

  function verifyPayload(kind, payload) {
    if (kind === 'json') { V.deserializeGrid(JSON.parse(payload)); return; }
    /* VOX carries raw occupancy, so it verifies without a manifold mesh. */
    if (kind === 'vox') {
      var vg = V.parseVOX(payload);
      if (vg.nx !== state.grid.nx || vg.ny !== state.grid.ny || vg.nz !== state.grid.nz ||
          vg.data.some(function (v, i) { return v !== (state.grid.data[i] ? 1 : 0); })) {
        throw new Error('VOX occupancy did not round trip');
      }
      return;
    }
    requireGeometry();
    if (kind === 'scad') {
      var grid = V.parseOpenSCAD(payload);
      if (grid.data.some(function (v, i) { return v !== (state.grid.data[i] ? 1 : 0); })) throw new Error('OpenSCAD occupancy did not round trip');
      return;
    }
    var parsed = kind === 'binary-stl' ? V.parseBinarySTL(payload) :
      kind === 'ply' ? V.parsePLY(payload) :
      kind === 'obj' ? V.parseOBJ(payload) : V.parseAsciiSTL(payload);
    var stats = V.analyzeMesh(parsed), original = state.mesh.stats;
    if (!stats.watertight || stats.triangleCount !== original.triangleCount ||
        Math.abs(stats.volumeMm3 - original.volumeMm3) / original.volumeMm3 > 1e-5) {
      throw new Error('Export geometry did not round trip');
    }
  }

  function handleExport(kind) {
    var base = safeName();
    if (kind === 'binary-stl' || kind === 'ply' || kind === 'vox') {
      if (kind !== 'vox') requireGeometry();
      var bytes = kind === 'binary-stl' ? V.exportBinarySTL(state.mesh, base) :
        kind === 'ply' ? V.exportPLY(state.mesh, base) : V.exportVOX(state.grid);
      verifyPayload(kind, bytes);
      var ext = kind === 'binary-stl' ? 'stl' : kind;
      var mime = kind === 'vox' ? 'application/octet-stream' : 'model/' + ext;
      downloadBlob(new Blob([bytes], { type: mime }), base + '.' + ext);
      var detail = kind === 'vox' ? state.grid.data.length + ' cells.' :
        state.mesh.triangles.length + ' facets.';
      showToast((kind === 'binary-stl' ? 'Binary STL' : ext.toUpperCase()) + ' verified and downloaded. ' + detail);
      return;
    }
    if (kind !== 'json') requireGeometry();
    var payload = exportedText(kind);
    if (!payload) throw new RangeError('Unknown export format');
    verifyPayload(kind, payload.text);
    downloadBlob(new Blob([payload.text], { type: payload.mime }), base + '.' + payload.ext);
    showToast(payload.ext.toUpperCase() + ' verified and downloaded.');
  }

  function handleCopy(kind) {
    if (kind !== 'json') requireGeometry();
    var payload = exportedText(kind);
    if (!payload) throw new RangeError('Unknown copy format');
    verifyPayload(kind, payload.text);
    var done = function () { showToast(payload.ext.toUpperCase() + ' copied to clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(payload.text).then(done, function () { legacyCopy(payload.text, done); });
    }
    legacyCopy(payload.text, done);
  }

  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try {
      if (document.execCommand('copy') !== true) throw new Error('Clipboard unavailable. Download the file instead.');
      done();
    } finally { ta.remove(); }
  }

  function protectedAction(fn) {
    function report(error) {
      if (error && error.name === 'ReferenceError') { console.error(error); throw error; }
      showToast(error.message);
    }
    return function () {
      try {
        var result = fn.apply(this, arguments);
        if (result && typeof result.then === 'function') return result.catch(report);
        return result;
      } catch (error) { report(error); }
    };
  }

  function on(id, event, handler, options) { $(id).addEventListener(event, protectedAction(handler), options); }

  function editorGrid(grid) {
    if (grid.nx > 48 || grid.ny > 48 || grid.nz > 32) throw new RangeError('Editor supports at most 48 x 48 x 32 cells.');
    return grid;
  }

  function readLattice() {
    return editorGrid(V.createGrid(numberInput('grid-nx'), numberInput('grid-ny'), numberInput('grid-nz'), numberInput('grid-pitch')));
  }

  function syncLatticeInputs() {
    ['nx', 'ny', 'nz'].forEach(function (axis) { $('grid-' + axis).value = String(state.grid[axis]); });
    $('grid-pitch').value = String(state.grid.pitchMm);
  }

  function snapshot() {
    return { grid: V.cloneGrid(state.grid), slice: state.slice, selected: state.selected.slice(), presetName: state.presetName };
  }

  function invalidateVerification() {
    state.verification = null;
    $('verification-result').textContent = 'Geometry changed. Run a self-check for this revision.';
    $('verification-result').className = 'verification-result';
  }

  function updateHistoryButtons() {
    $('undo').disabled = state.undo.length === 0;
    $('redo').disabled = state.redo.length === 0;
    document.querySelectorAll('[data-showcase]').forEach(function (button) {
      var active = button.dataset.showcase === state.presetName;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function changeGrid(action, message, presetName) {
    var before = snapshot();
    var next = editorGrid(action(V.cloneGrid(state.grid)));
    var unchanged = next.nx === state.grid.nx && next.ny === state.grid.ny && next.nz === state.grid.nz && next.pitchMm === state.grid.pitchMm &&
      next.data.every(function (value, i) { return value === state.grid.data[i]; });
    if (!unchanged) {
      var preparedMesh = V.extractManifoldMesh(next, { infillPercent: state.infillPercent });
      state.undo.push(before);
      if (state.undo.length > 32) state.undo.shift();
      state.redo = [];
      state.grid = next;
      state.presetName = presetName || null;
      state.slice = Math.min(state.slice, next.nz - 1);
      clearHover();
      invalidateVerification();
      syncLatticeInputs();
      recompute(preparedMesh);
    } else { updateHistoryButtons(); }
    showToast(unchanged ? 'No geometry changed. Check the primitive position and dimensions.' : message);
  }

  function restoreSnapshot(saved) {
    state.grid = saved.grid; state.slice = saved.slice; state.selected = saved.selected; state.presetName = saved.presetName;
    clearHover(); invalidateVerification(); syncLatticeInputs(); recompute();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot()); restoreSnapshot(state.undo.pop()); showToast('Previous geometry restored.');
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot()); restoreSnapshot(state.redo.pop()); showToast('Geometry change restored.');
  }

  function loadPreset(name, showcase) {
    var options;
    if (!showcase) {
      var lattice = readLattice();
      if (lattice.nx < 4 || lattice.ny < 4 || lattice.nz < 4) throw new RangeError('Part recipes need at least 4 cells on each axis.');
      options = { nx: lattice.nx, ny: lattice.ny, nz: lattice.nz, pitchMm: lattice.pitchMm };
    }
    changeGrid(function () { return V.loadPreset(name, options); }, 'Loaded ' + name + '. Every cell is editable.', name);
    state.presetName = name;
    $('preset-select').value = name;
    state.slice = Math.floor(state.grid.nz / 2);
    state.selected[2] = state.slice;
    state.zoom = 1;
    setView(35, 28);
    updateInspector(); updateHistoryButtons();
  }

  /* ---------------------------------------------------------------- */
  /* Sculpture and art mode                                           */
  /* ---------------------------------------------------------------- */

  function setArtMode(enabled) {
    state.artMode = !!enabled;
    $('art-section').hidden = !state.artMode;
    var button = $('art-mode-toggle');
    button.setAttribute('aria-pressed', String(state.artMode));
    button.textContent = state.artMode ? 'CAD mode' : 'Sculpture mode';
    if (!state.artMode) {
      stopTurntable();
      stopGallery();
      if (state.lighting) toggleLighting();
    }
    updateArtPlate();
  }

  /* The plate describes the lattice actually on screen: a sculpture title
   * only applies while that preset's occupancy is loaded. */
  function sculptureKey() { return SCULPTURE_INFO[state.presetName] ? state.presetName : null; }

  function updateArtPlate() {
    var key = sculptureKey();
    var info = key ? SCULPTURE_INFO[key] : null;
    var stats = state.mesh.stats;
    $('art-plate-title').textContent = info ? info.title : 'Editable lattice';
    $('art-plate-badge').textContent = stats.watertight ? 'MANIFOLD' : 'CHECK TOPOLOGY';
    $('art-plate-badge').className = stats.watertight ? 'art-badge' : 'art-badge bad';
    $('art-metric-voxels').textContent = fmt(stats.voxelCount, 0);
    $('art-metric-area').textContent = fmt(stats.surfaceAreaMm2, 1) + ' mm2';
    $('art-metric-volume').textContent = fmt(stats.volumeCm3, 2) + ' cm3';
    $('art-metric-triangles').textContent = fmt(stats.triangleCount, 0);
    $('art-formula').textContent = info ? info.formula : 'Custom cell occupancy on the shared integer lattice';
    document.querySelectorAll('[data-sculpture]').forEach(function (button) {
      var active = !!key && button.dataset.sculpture === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function loadSculpture(name) {
    if (!SCULPTURE_INFO[name]) throw new RangeError('unknown sculpture preset: ' + name);
    loadPreset(name, true);
    state.slice = Math.floor(state.grid.nz / 2);
    state.selected[2] = state.slice;
    updateInspector(); updateArtPlate(); updateTourCaption();
    showToast(infoTitle(name) + ' loaded on the editable lattice.');
  }

  function infoTitle(name) { return SCULPTURE_INFO[name] ? SCULPTURE_INFO[name].title : 'Sculpture'; }

  function stopTurntable() {
    if (state.turntableTimer !== null) { clearInterval(state.turntableTimer); state.turntableTimer = null; }
    state.turntable = false;
    $('turntable-toggle').setAttribute('aria-pressed', 'false');
    $('turntable-toggle').textContent = 'Play turntable';
  }

  function toggleTurntable() {
    if (state.turntable) { stopTurntable(); return; }
    state.turntable = true;
    $('turntable-toggle').setAttribute('aria-pressed', 'true');
    $('turntable-toggle').textContent = 'Pause turntable';
    state.turntableTimer = setInterval(function () {
      var next = state.yawDeg + 2;
      if (next > 180) next -= 360;
      setView(next, state.pitchDeg);
    }, 50);
  }

  /* Gallery cycles all four sculpture presets on a turntable with a curator's
   * caption for each work. Pause keeps the position; stop restores whatever
   * turntable state the visitor had before the tour began. */
  var GALLERY_ORDER = ['gyroidPavilion', 'mengerLantern', 'helicalRibbon', 'voronoiAmphitheater'];

  function updateTourCaption() {
    var caption = $('tour-caption');
    var key = sculptureKey();
    if (!state.gallery || !key) { caption.hidden = true; caption.textContent = ''; return; }
    var info = SCULPTURE_INFO[key];
    var position = GALLERY_ORDER.indexOf(key) + 1;
    caption.textContent = '';
    var number = document.createElement('strong');
    number.textContent = 'Work ' + position + ' / ' + GALLERY_ORDER.length;
    var story = document.createElement('span');
    story.textContent = info.title + '. ' + info.caption;
    caption.appendChild(number);
    caption.appendChild(story);
    caption.hidden = false;
  }

  function startGalleryTimer() {
    state.galleryTimer = setInterval(function () {
      var next = GALLERY_ORDER[(GALLERY_ORDER.indexOf(sculptureKey() || '') + 1) % GALLERY_ORDER.length];
      loadSculpture(next);
    }, 6500);
  }

  function stopGallery() {
    if (state.galleryTimer !== null) { clearInterval(state.galleryTimer); state.galleryTimer = null; }
    if (state.galleryOwnsTurntable && state.turntable) stopTurntable();
    state.gallery = false;
    state.galleryPaused = false;
    state.galleryOwnsTurntable = false;
    $('gallery-toggle').setAttribute('aria-pressed', 'false');
    $('gallery-toggle').textContent = 'Play gallery';
    $('gallery-exit').hidden = true;
    updateTourCaption();
  }

  function toggleGallery() {
    if (state.gallery && !state.galleryPaused) {
      /* Pause: hold the current work and caption, keep the tour position. */
      if (state.galleryTimer !== null) { clearInterval(state.galleryTimer); state.galleryTimer = null; }
      state.galleryPaused = true;
      $('gallery-toggle').setAttribute('aria-pressed', 'false');
      $('gallery-toggle').textContent = 'Resume gallery';
      updateTourCaption();
      return;
    }
    if (state.gallery && state.galleryPaused) {
      state.galleryPaused = false;
      $('gallery-toggle').setAttribute('aria-pressed', 'true');
      $('gallery-toggle').textContent = 'Pause gallery';
      if (!state.turntable) { toggleTurntable(); state.galleryOwnsTurntable = true; }
      startGalleryTimer();
      updateTourCaption();
      return;
    }
    state.gallery = true;
    state.galleryPaused = false;
    $('gallery-exit').hidden = false;
    $('gallery-toggle').setAttribute('aria-pressed', 'true');
    $('gallery-toggle').textContent = 'Pause gallery';
    state.galleryOwnsTurntable = !state.turntable;
    if (state.galleryOwnsTurntable) toggleTurntable();
    if (!sculptureKey()) loadSculpture(GALLERY_ORDER[0]);
    else updateTourCaption();
    startGalleryTimer();
  }

  function toggleLighting() {
    state.lighting = !state.lighting;
    $('lighting-toggle').setAttribute('aria-pressed', String(state.lighting));
    $('lighting-toggle').textContent = state.lighting ? 'Studio lighting' : 'Exhibition lighting';
    $('art-section').classList.toggle('exhibition', state.lighting);
    render();
  }

  /* PNG output is encoded locally so the plate needs no canvas.toBlob path.
   * A stored (uncompressed) deflate stream keeps the writer dependency-free;
   * the 4-byte big endian adler32 trailer must fit inside the allocation. */
  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    var out = new Uint8Array(12 + data.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function encodePNG(width, height, pixels) {
    var raw = new Uint8Array((width * 3 + 1) * height);
    for (var y = 0; y < height; y++) {
      var row = y * (width * 3 + 1);
      raw[row] = 0;
      for (var x = 0; x < width * 3; x++) raw[row + 1 + x] = pixels[y * width * 3 + x];
    }
    var header = new Uint8Array(13), hv = new DataView(header.buffer);
    hv.setUint32(0, width); hv.setUint32(4, height);
    header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
    var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlibDeflate(raw)), pngChunk('IEND', new Uint8Array(0))];
    var total = parts.reduce(function (sum, part) { return sum + part.length; }, 0);
    var png = new Uint8Array(total), offset = 0;
    parts.forEach(function (part) { png.set(part, offset); offset += part.length; });
    return png;
  }

  /* Single fixed-Huffman DEFLATE block with greedy LZ77 matches. The plate is
   * mostly flat color, so run matches shrink a 4.2 MB stored stream to a few
   * dozen KB without adding a compression dependency. */
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var FIXED_LEN = (function () {
    var codes = new Uint16Array(286), bits = new Uint8Array(286);
    for (var i = 0; i <= 143; i++) { bits[i] = 8; codes[i] = 0x30 + i; }
    for (var j = 144; j <= 255; j++) { bits[j] = 9; codes[j] = 0x190 + j - 144; }
    for (var k = 256; k <= 279; k++) { bits[k] = 7; codes[k] = k - 256; }
    for (var m = 280; m <= 287; m++) { bits[m] = 8; codes[m] = 0xc0 + m - 280; }
    return { codes: codes, bits: bits };
  })();

  function adler32(data) {
    var a = 1, b = 0;
    for (var i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }

  function zlibDeflate(data) {
    var bytes = [], bitBuffer = 0, bitCount = 0;
    function put(value, count) {
      bitBuffer |= value << bitCount; bitCount += count;
      while (bitCount >= 8) { bytes.push(bitBuffer & 255); bitBuffer >>>= 8; bitCount -= 8; }
    }
    function symbol(code, length) { put(reverse(FIXED_LEN.codes[code], length), length); }
    function reverse(value, count) {
      var out = 0;
      for (var i = 0; i < count; i++) { out = (out << 1) | (value & 1); value >>>= 1; }
      return out;
    }
    function emitLength(length) {
      var code = 28;
      for (var i = 0; i < LEN_BASE.length; i++) if (length >= LEN_BASE[i] && length <= LEN_BASE[i] + (1 << LEN_EXTRA[i]) - 1) { code = i; break; }
      symbol(257 + code, FIXED_LEN.bits[257 + code]);
      if (LEN_EXTRA[code]) put(length - LEN_BASE[code], LEN_EXTRA[code]);
    }
    function emitDistance(distance) {
      var code = 29;
      for (var i = 0; i < DIST_BASE.length; i++) if (distance >= DIST_BASE[i] && distance <= DIST_BASE[i] + (1 << DIST_EXTRA[i]) - 1) { code = i; break; }
      put(reverse(code, 5), 5);
      if (DIST_EXTRA[code]) put(distance - DIST_BASE[code], DIST_EXTRA[code]);
    }
    put(1, 1); put(1, 2); /* BFINAL = 1, BTYPE = 01 fixed Huffman. */
    var head = new Int32Array(32768).fill(-1), prev = new Int32Array(data.length).fill(-1);
    var i = 0;
    while (i < data.length) {
      var bestLength = 0, bestDistance = 0;
      if (i + 2 < data.length) {
        var hash = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & 32767;
        var candidate = head[hash], attempts = 0;
        while (candidate >= 0 && i - candidate <= 32768 && attempts++ < 96) {
          var distance = i - candidate, limit = Math.min(258, data.length - i);
          var length = 0;
          while (length < limit && data[candidate + length] === data[i + length]) length++;
          if (length >= 4 && length > bestLength) { bestLength = length; bestDistance = distance; }
          candidate = prev[candidate];
        }
        prev[i] = head[hash]; head[hash] = i;
      }
      if (bestLength >= 4) {
        emitLength(bestLength); emitDistance(bestDistance);
        for (var k = 1; k < bestLength && i + k + 2 < data.length; k++) {
          var h = ((data[i + k] << 10) ^ (data[i + k + 1] << 5) ^ data[i + k + 2]) & 32767;
          prev[i + k] = head[h]; head[h] = i + k;
        }
        i += bestLength;
      } else {
        var value = data[i] <= 143 ? data[i] + 0x30 : 0x190 + data[i] - 144;
        put(reverse(value, data[i] <= 143 ? 8 : 9), data[i] <= 143 ? 8 : 9);
        i++;
      }
    }
    symbol(256, FIXED_LEN.bits[256]);
    if (bitCount) bytes.push(bitBuffer & 255);
    var checksum = adler32(data);
    return new Uint8Array([0x78, 0x01].concat(bytes, [(checksum >>> 24) & 255, (checksum >>> 16) & 255, (checksum >>> 8) & 255, checksum & 255]));
  }

  function drawPlatePixel(pixels, width, height, x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    var at = (y * width + x) * 3;
    pixels[at] = color[0]; pixels[at + 1] = color[1]; pixels[at + 2] = color[2];
  }

  function drawPlateRect(pixels, width, height, x0, y0, w, h, color) {
    for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) drawPlatePixel(pixels, width, height, x, y, color);
  }

  var PLATE_FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
    '8': '111101111101111', '9': '111101111001111',
    'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011', 'D': '110101101101110',
    'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101',
    'I': '111010010010111', 'J': '001001001101010', 'K': '101101110101101', 'L': '100100100100111',
    'M': '101111111101101', 'N': '101111111111101', 'O': '010101101101010', 'P': '110101110100100',
    'Q': '010101101111011', 'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010',
    'U': '101101101101111', 'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101',
    'Y': '101101010010010', 'Z': '111001010100111',
    ' ': '000000000000000', '-': '000000111000000', '/': '001001010100100', '.': '000000000000010',
    ',': '000000000010100', ':': '000010000010000'
  };

  function plateTextWidth(text, scale) { return text.length * 4 * scale; }

  function drawPlateText(pixels, width, height, text, x, y, scale, color) {
    var cursor = x;
    for (var i = 0; i < text.length; i++) {
      var glyph = PLATE_FONT[text[i].toUpperCase()] || PLATE_FONT[' '];
      for (var row = 0; row < 5; row++) for (var col = 0; col < 3; col++) {
        if (glyph[row * 3 + col] !== '1') continue;
        drawPlateRect(pixels, width, height, cursor + col * scale, y + row * scale, scale, scale, color);
      }
      cursor += 4 * scale;
    }
  }

  /* Word-wrap into lines that fit the measured glyph grid. */
  function plateWrappedLines(text, maxChars) {
    var words = String(text).toUpperCase().split(/\s+/), lines = [], line = '';
    words.forEach(function (word) {
      var candidate = line ? line + ' ' + word : word;
      if (candidate.length > maxChars && line) { lines.push(line); line = word; }
      else line = candidate;
    });
    if (line) lines.push(line);
    return lines;
  }

  function exportExhibitionPlate() {
    var width = 1400, height = 1000;
    var pixels = new Uint8Array(width * height * 3);
    var bg = state.lighting ? [30, 27, 21] : [24, 29, 34];
    var frame = [state.lighting ? 38 : 33, state.lighting ? 34 : 40, state.lighting ? 26 : 46];
    var ink = state.lighting ? [232, 208, 154] : [226, 233, 238];
    var soft = state.lighting ? [165, 143, 101] : [147, 161, 172];
    var accent = state.lighting ? [220, 174, 91] : [209, 117, 67];
    var margin = 56;
    drawPlateRect(pixels, width, height, 0, 0, width, height, bg);
    drawPlateRect(pixels, width, height, margin, margin, width - 2 * margin, height - 2 * margin, frame);
    drawPlateRect(pixels, width, height, margin, margin, width - 2 * margin, 2, accent);
    drawPlateRect(pixels, width, height, margin, height - margin - 2, width - 2 * margin, 2, accent);
    drawPlateText(pixels, width, height, 'VOXELSYNTH', 92, 92, 4, accent);

    var plateKey = sculptureKey();
    var title = (plateKey ? SCULPTURE_INFO[plateKey].title : 'EDITABLE LATTICE').toUpperCase();
    var titleScale = Math.max(2, Math.min(6, Math.floor((width - 184) / (title.length * 4))));
    drawPlateText(pixels, width, height, title, 92, 146, titleScale, ink);
    drawPlateRect(pixels, width, height, 92, 146 + titleScale * 5 + 20, width - 184, 2, soft);

    if (plateKey) {
      var info = SCULPTURE_INFO[plateKey];
      var position = GALLERY_ORDER.indexOf(plateKey) + 1;
      var caption = 'WORK ' + position + ' / ' + GALLERY_ORDER.length + '. ' + info.caption;
      var capLines = plateWrappedLines(caption, 128);
      capLines.slice(0, 3).forEach(function (line, index) {
        drawPlateText(pixels, width, height, line, 92, 238 + index * 22, 2, soft);
      });
    }

    buildFaces();
    var points = [];
    state.faces.forEach(function (face) { face.pts.forEach(function (p) { points.push([p[0], p[1], p[2]]); }); });
    if (points.length) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      points.forEach(function (p) {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
      var scale = Math.min((width - 360) / Math.max(1, maxX - minX), (height - 610) / Math.max(1, maxY - minY));
      var ox = width / 2 - (minX + maxX) / 2 * scale;
      var oy = 500 - (minY + maxY) / 2 * scale;
      var depth = points.map(function (p) { return p[2]; }).sort(function (a, b) { return a - b; });
      var midDepth = depth[Math.floor(depth.length / 2)] || 0;
      state.faces.forEach(function (face) {
        var color = face.pts.reduce(function (sum, p) { return sum + p[2]; }, 0) / face.pts.length > midDepth ? accent : soft;
        var poly = face.pts.map(function (p) { return [Math.round(ox + p[0] * scale), Math.round(oy + p[1] * scale)]; });
        for (var y = minPolyY(poly); y <= maxPolyY(poly); y++) {
          var xs = [];
          for (var i = 0; i < poly.length; i++) {
            var a = poly[i], b = poly[(i + 1) % poly.length];
            if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
          }
          xs.sort(function (p, q) { return p - q; });
          for (var k = 0; k + 1 < xs.length; k += 2) {
            for (var x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) drawPlatePixel(pixels, width, height, x, y, color);
          }
        }
      });
    }

    var stats = state.mesh.stats;
    var g = state.grid;
    var badge = stats.watertight ? 'WATERTIGHT' : 'CHECK TOPOLOGY';
    var topY = height - 286;
    drawPlateRect(pixels, width, height, 92, topY, width - 184, 2, accent);
    var left = [
      'VOXELS ' + fmt(stats.voxelCount, 0),
      'AREA ' + fmt(stats.surfaceAreaMm2, 1) + ' MM2',
      'VOLUME ' + fmt(stats.volumeCm3, 2) + ' CM3',
      'TRIANGLES ' + fmt(stats.triangleCount, 0)
    ];
    var right = [
      'EULER X ' + fmt(stats.eulerCharacteristic, 0),
      'GENUS G ' + (stats.genusEstimate === null ? 'NA' : fmt(stats.genusEstimate, 0)),
      'LATTICE ' + g.nx + ' X ' + g.ny + ' X ' + g.nz,
      'PITCH ' + fmt(g.pitchMm, 3) + ' MM'
    ];
    left.forEach(function (line, index) { drawPlateText(pixels, width, height, line, 92, topY + 24 + index * 42, 3, ink); });
    right.forEach(function (line, index) { drawPlateText(pixels, width, height, line, 720, topY + 24 + index * 42, 3, ink); });
    drawPlateRect(pixels, width, height, 92, height - 100, width - 184, 2, soft);
    drawPlateText(pixels, width, height, 'SIX VERIFIED EXPORT FORMATS', 92, height - 78, 2, soft);
    drawPlateText(pixels, width, height, badge, width - 92 - plateTextWidth(badge, 3), height - 82, 3, stats.watertight ? accent : [220, 90, 70]);
    var bytes = encodePNG(width, height, pixels);
    downloadBlob(new Blob([bytes], { type: 'image/png' }), safeName() + '-plate.png');
    showToast('Exhibition plate exported at 1400 x 1000 PNG.');
    return bytes.length;
  }

  function minPolyY(poly) { return Math.round(Math.min.apply(null, poly.map(function (p) { return p[1]; }))); }
  function maxPolyY(poly) { return Math.round(Math.max.apply(null, poly.map(function (p) { return p[1]; }))); }

  /* Wraps a grid mutation so it lands on both sides of the chosen mirror
   * plane; subtractive edits mirror the delta, not the whole lattice. */
  function withSymmetry(action) {
    return function (grid) {
      return state.symmetry === 'off' ? action(grid) : V.applySymmetricEdit(grid, state.symmetry, action);
    };
  }

  function applyPrimitive() {
    var p = state.grid.pitchMm;
    var x = numberInput('prim-x') * p, y = numberInput('prim-y') * p, z = numberInput('prim-z') * p;
    var w, d, r, h;
    if (state.primitive === 'box') { w = numberInput('prim-w') * p; d = numberInput('prim-d') * p; h = numberInput('prim-h') * p; }
    if (state.primitive !== 'box') r = numberInput('prim-r') * p;
    if (state.primitive === 'cylinder') h = numberInput('prim-h') * p;
    var prefix = state.operation === 'add' ? 'add' : 'subtract';
    changeGrid(withSymmetry(function (grid) {
      if (state.primitive === 'box') return V[prefix + 'Box'](grid, x, y, z, w, d, h);
      if (state.primitive === 'cylinder') return V[prefix + 'Cylinder'](grid, x, y, z, r, h, 'z');
      return V[prefix + 'Sphere'](grid, x, y, z, r);
    }), state.primitive + ' ' + state.operation + ' applied' + (state.symmetry === 'off' ? '.' : ' with ' + state.symmetry.toUpperCase() + ' symmetry.'));
  }

  function setSymmetry(axis) {
    if (state.symmetry === axis) return;
    state.symmetry = axis;
    document.querySelectorAll('[data-sym]').forEach(function (button) {
      var active = button.dataset.sym === axis;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    showToast(axis === 'off' ? 'Live symmetry off.' : 'Live symmetry on ' + axis.toUpperCase() + ': every edit mirrors across the lattice midpoint.');
  }

  function setSegment(group, value) {
    document.querySelectorAll(group).forEach(function (button) {
      var active = button.dataset.op === value || button.dataset.prim === value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    $('theme-toggle').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    try { localStorage.setItem('voxelsynth-theme', theme); } catch (error) { /* Theme still works without storage. */ }
    render();
  }

  function setView(yaw, pitch) {
    clearHover();
    state.yawDeg = Math.max(-180, Math.min(180, yaw));
    state.pitchDeg = Math.max(-80, Math.min(90, pitch));
    $('yaw').value = String(state.yawDeg); $('pitch').value = String(state.pitchDeg);
    updateChips(); render();
  }

  function cellText(cell) {
    var center = cell.map(function (n) { return fmt((n + 0.5) * state.grid.pitchMm, 6); }).join(', ');
    return 'Cell ' + cell.join(', ') + ' / center [' + center + '] mm / ' + (V.getVoxel(state.grid, cell[0], cell[1], cell[2]) ? 'solid' : 'air');
  }

  function clearHover() {
    state.hover = null;
    $('hover-readout').textContent = 'Hover over a face or the inset to inspect its coordinates.';
  }

  function updateInspector() {
    var limits = [state.grid.nx, state.grid.ny, state.grid.nz];
    ['x', 'y', 'z'].forEach(function (axis, i) {
      state.selected[i] = Math.max(0, Math.min(limits[i] - 1, Math.round(state.selected[i])));
      $('inspect-' + axis).value = String(state.selected[i]); $('inspect-' + axis).max = String(limits[i] - 1);
    });
    $('inspect-readout').textContent = cellText(state.selected);
  }

  function setSlice(value) {
    state.slice = Math.max(0, Math.min(sliceAxisSize() - 1, Math.round(value)));
    state.selected[sliceAxisIndex()] = state.slice; $('slice').value = String(state.slice);
    clearHover(); updateChips(); updateInspector(); render();
  }

  function setSliceAxis(axis) {
    if (state.sliceAxis === axis) return;
    state.sliceAxis = axis;
    state.slice = Math.max(0, Math.min(sliceAxisSize() - 1, state.slice));
    state.selected[sliceAxisIndex()] = state.slice;
    document.querySelectorAll('[data-slice-axis]').forEach(function (button) {
      var active = button.dataset.sliceAxis === axis;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    clearHover(); updateChips(); updateInspector(); render();
  }

  function toggleSelected() {
    var cell = state.selected.slice();
    changeGrid(withSymmetry(function (grid) { V.setVoxel(grid, cell[0], cell[1], cell[2], !V.getVoxel(grid, cell[0], cell[1], cell[2])); return grid; }),
      'Cell ' + cell.join(', ') + ' toggled' + (state.symmetry === 'off' ? '.' : ' with ' + state.symmetry.toUpperCase() + ' symmetry.'));
  }

  function importText(text) {
    if (typeof text !== 'string' || text.length > 1000000) throw new RangeError('Project text must be smaller than 1 MB.');
    var next = editorGrid(V.deserializeGrid(JSON.parse(text)));
    changeGrid(function () { return next; }, 'Project restored with exact cell occupancy.');
  }

  function bindEvents() {
    on('art-mode-toggle', 'click', function () { setArtMode(!state.artMode); });
    on('turntable-toggle', 'click', toggleTurntable);
    on('lighting-toggle', 'click', toggleLighting);
    on('art-export-plate', 'click', function () { exportExhibitionPlate(); });
    document.querySelectorAll('[data-sculpture]').forEach(function (button) {
      button.addEventListener('click', protectedAction(function () { stopGallery(); loadSculpture(button.dataset.sculpture); }));
    });
    on('gallery-toggle', 'click', toggleGallery);
    on('gallery-exit', 'click', function () { stopGallery(); showToast('Gallery tour closed. Your turntable state was restored.'); });
    document.querySelectorAll('[data-sym]').forEach(function (button) {
      button.addEventListener('click', function () { setSymmetry(button.dataset.sym); });
    });
    on('load-preset', 'click', function () { loadPreset($('preset-select').value, false); });
    on('preset-select', 'change', function () { loadPreset(this.value, false); });
    document.querySelectorAll('[data-showcase]').forEach(function (button) {
      button.addEventListener('click', protectedAction(function () { loadPreset(button.dataset.showcase, true); }));
    });
    on('reset-grid', 'click', function () {
      changeGrid(function (grid) { grid.data.fill(0); return grid; }, 'Part cleared. The lattice dimensions are preserved.');
    });
    on('apply-grid', 'click', function () { changeGrid(function () { return readLattice(); }, 'New empty lattice created.'); });
    on('apply-primitive', 'click', applyPrimitive);
    on('undo', 'click', undo); on('redo', 'click', redo);
    document.querySelectorAll('[data-op]').forEach(function (button) {
      button.addEventListener('click', function () { state.operation = button.dataset.op; setSegment('[data-op]', state.operation); updateChips(); });
    });
    document.querySelectorAll('[data-prim]').forEach(function (button) {
      button.addEventListener('click', function () { state.primitive = button.dataset.prim; setSegment('[data-prim]', state.primitive); updateChips(); });
    });
    on('mirror-x', 'click', function () { changeGrid(function (grid) { return V.mirrorGrid(grid, 'x'); }, 'Mirrored across X.'); });
    on('mirror-y', 'click', function () { changeGrid(function (grid) { return V.mirrorGrid(grid, 'y'); }, 'Mirrored across Y.'); });
    on('apply-shell', 'click', function () {
      var wall = numberInput('shell-wall');
      changeGrid(function (grid) { return V.shellGrid(grid, wall); }, 'Shell created with wall rounded up to complete cell layers.');
    });
    on('infill', 'input', function () { state.infillPercent = Math.max(0, Math.min(100, numberInput('infill'))); recompute(); });
    on('material', 'change', function () {
      if (this.value !== 'PLA' && this.value !== 'PETG') throw new RangeError('Choose PLA or PETG.');
      state.material = this.value; updateDiagnostics();
    });
    on('theme-toggle', 'click', function () { setTheme(state.theme === 'dark' ? 'light' : 'dark'); });
    on('help-toggle', 'click', function () {
      var panel = $('help-panel'); panel.hidden = !panel.hidden; this.setAttribute('aria-expanded', String(!panel.hidden));
    });
    on('yaw', 'input', function () { setView(numberInput('yaw'), state.pitchDeg); });
    on('pitch', 'input', function () { setView(state.yawDeg, numberInput('pitch')); });
    on('slice', 'input', function () { setSlice(numberInput('slice')); });
    on('view-top', 'click', function () { setView(0, 90); });
    on('view-front', 'click', function () { setView(0, 0); });
    on('view-iso', 'click', function () { state.zoom = 1; setView(35, 28); });
    on('toggle-wire', 'click', function () { state.wireframe = !state.wireframe; this.setAttribute('aria-pressed', String(state.wireframe)); render(); });
    on('toggle-slice', 'click', function () { state.showSlice = !state.showSlice; this.setAttribute('aria-pressed', String(state.showSlice)); render(); });
    document.querySelectorAll('[data-slice-axis]').forEach(function (button) {
      button.addEventListener('click', function () { setSliceAxis(button.dataset.sliceAxis); });
    });
    on('toggle-print', 'click', function () {
      state.printCheck = !state.printCheck; this.setAttribute('aria-pressed', String(state.printCheck));
      $('print-legend').hidden = !state.printCheck;
      if (state.printCheck) showToast('Printability view: amber undersides need support, red clusters float, blue outlines mark thin walls.');
      render();
    });
    on('cycle-slice-mode', 'click', function () {
      state.sliceOnly = !state.sliceOnly; this.setAttribute('aria-pressed', String(state.sliceOnly));
      this.textContent = state.sliceOnly ? 'Show full part' : 'Clip above layer'; updateChips(); render();
    });
    ['x', 'y', 'z'].forEach(function (axis, i) {
      on('inspect-' + axis, 'change', function () {
        var value = numberInput('inspect-' + axis);
        if (!Number.isInteger(value)) throw new RangeError('Inspector coordinates must be whole cells.');
        state.selected[i] = value; updateInspector();
        if (i === sliceAxisIndex()) state.slice = state.selected[i];
        updateChips(); render();
      });
    });
    on('toggle-voxel', 'click', toggleSelected);
    on('verify-exports', 'click', function () {
      state.verification = V.verifyExports(state.grid);
      $('verification-result').textContent = state.verification.formats.length + ' formats passed + project occupancy. Maximum relative volume error: ' + state.verification.maxRelativeVolumeError.toExponential(2) + '.';
      $('verification-result').className = 'verification-result good';
      showToast('Round trip passed: ' + state.verification.formats.map(function (f) { return f.name; }).join(', ') + ' + project JSON.');
    });
    document.querySelectorAll('[data-export]').forEach(function (button) {
      button.addEventListener('click', protectedAction(function () { handleExport(button.dataset.export); }));
    });
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', protectedAction(function () { return handleCopy(button.dataset.copy); }));
    });
    on('open-project', 'click', function () { $('import-project').click(); });
    on('import-project', 'change', async function () {
      var file = this.files && this.files[0];
      if (!file) return;
      try {
        if (file.size > 1000000) throw new RangeError('Project file must be smaller than 1 MB.');
        importText(await file.text());
      } finally { this.value = ''; }
    });

    var drag = null;
    on('viewport', 'pointerdown', function (event) {
      if (drag) return;
      if (event.button !== undefined && event.button !== 0) return;
      clearHover();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yawDeg, pitch: state.pitchDeg, moved: false };
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    });
    on('viewport', 'pointermove', function (event) {
      if (drag) {
        if (drag.id !== event.pointerId) return;
        var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) setView(drag.yaw + dx * 0.4, drag.pitch + dy * 0.3);
        return;
      }
      var point = canvasPoint(event), hit = pickVoxel(point[0], point[1]);
      state.hover = hit && hit.voxel ? hit : null;
      $('hover-readout').textContent = state.hover ? state.hover.source + ' / ' + cellText(state.hover.voxel) : 'Hover over a face or the inset to inspect its coordinates.';
      render();
    });
    on('viewport', 'pointerup', function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved) {
        var point = canvasPoint(event), hit = pickVoxel(point[0], point[1]);
        if (hit && hit.voxel) { state.selected = hit.voxel.slice(); state.slice = hit.voxel[sliceAxisIndex()]; toggleSelected(); }
      }
      drag = null;
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    on('viewport', 'pointercancel', function (event) { if (drag && drag.id === event.pointerId) drag = null; });
    on('viewport', 'lostpointercapture', function (event) { if (drag && drag.id === event.pointerId) drag = null; });
    on('viewport', 'pointerleave', function () { if (!drag) { clearHover(); render(); } });
    on('viewport', 'wheel', function (event) {
      event.preventDefault();
      if (event.deltaY === 0) return;
      state.zoom = Math.max(0.4, Math.min(3, state.zoom * (event.deltaY > 0 ? 0.92 : 1.08))); render();
    }, { passive: false });

    document.addEventListener('keydown', protectedAction(function (event) {
      var target = event.target || {}, tag = (target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || target.isContentEditable) return;
      var key = event.key;
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z' && !event.altKey) {
        event.preventDefault(); if (event.shiftKey) redo(); else undo(); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (target === canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].indexOf(key) >= 0) {
        event.preventDefault();
        if (key === ' ' || key === 'Enter') toggleSelected();
        else {
          if (key === 'ArrowLeft') state.selected[0]--;
          if (key === 'ArrowRight') state.selected[0]++;
          if (key === 'ArrowDown') state.selected[1]--;
          if (key === 'ArrowUp') state.selected[1]++;
          updateInspector(); render();
        }
        return;
      }
      var presets = ['deskOrganizer', 'sdCardVault', 'cableComb', 'rpiPicoMount', 'sdfDock'];
      var index = Number(key) - 1;
      if (/^[1-5]$/.test(key)) { event.preventDefault(); loadPreset(presets[index], true); return; }
      var handled = true;
      switch (key.toLowerCase()) {
        case 'b': state.primitive = 'box'; setSegment('[data-prim]', 'box'); updateChips(); break;
        case 'c': state.primitive = 'cylinder'; setSegment('[data-prim]', 'cylinder'); updateChips(); break;
        case 's': state.primitive = 'sphere'; setSegment('[data-prim]', 'sphere'); updateChips(); break;
        case 'a': state.operation = 'add'; setSegment('[data-op]', 'add'); updateChips(); break;
        case 'd': state.operation = 'subtract'; setSegment('[data-op]', 'subtract'); updateChips(); break;
        case 'm': $('mirror-x').click(); break;
        case 'x': setSymmetry(state.symmetry === 'x' ? 'off' : 'x'); break;
        case 'y': setSymmetry(state.symmetry === 'y' ? 'off' : 'y'); break;
        case 'h': $('apply-shell').click(); break;
        case 't': $('theme-toggle').click(); break;
        case 'r': $('reset-grid').click(); break;
        case '?': $('help-toggle').click(); break;
        case 'arrowleft': setView(state.yawDeg - 5, state.pitchDeg); break;
        case 'arrowright': setView(state.yawDeg + 5, state.pitchDeg); break;
        case 'arrowup': setView(state.yawDeg, state.pitchDeg + 5); break;
        case 'arrowdown': setView(state.yawDeg, state.pitchDeg - 5); break;
        case 'pageup': setSlice(state.slice + 1); break;
        case 'pagedown': setSlice(state.slice - 1); break;
        default: handled = false;
      }
      if (handled) event.preventDefault();
    }));
    window.addEventListener('resize', render);
    if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe(canvas);
  }

  function init() {
    var stored = 'light';
    try { stored = localStorage.getItem('voxelsynth-theme') || 'light'; } catch (error) { /* Local storage is optional. */ }
    state.grid = V.loadPreset('deskOrganizer');
    state.slice = Math.floor(state.grid.nz / 2); state.selected[2] = state.slice;
    state.theme = stored === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    $('theme-toggle').textContent = state.theme === 'dark' ? 'Light theme' : 'Dark theme';
    /* On phone-width screens keep the long diagnostics table behind its
     * summary so controls stay within reach; the full table remains one tap. */
    if (window.innerWidth <= 540) document.querySelectorAll('.diagnostics-details').forEach(function (details) { details.open = false; });
    syncLatticeInputs(); bindEvents(); recompute(); setArtMode(false);
    window.VoxelSynthStudio = {
      snapshot: function () { return V.serializeGrid(state.grid); },
      importText: importText,
      inspect: function () { return { selected: state.selected.slice(), slice: state.slice, sliceAxis: state.sliceAxis, yawDeg: state.yawDeg, pitchDeg: state.pitchDeg,
        width: state.viewportWidth, height: state.viewportHeight, dpr: state.dpr, zoom: state.zoom,
        inset: Object.assign({}, state.inset), faceCount: state.faces.length, sliceOnly: state.sliceOnly, showSlice: state.showSlice,
        stats: Object.assign({}, state.mesh.stats), history: { undo: state.undo.length, redo: state.redo.length },
        artMode: state.artMode, sculpture: sculptureKey(), turntable: state.turntable, lighting: state.lighting,
        symmetry: state.symmetry, gallery: state.gallery, galleryPaused: state.galleryPaused,
        galleryOwnsTurntable: state.galleryOwnsTurntable, printCheck: state.printCheck,
        print: state.printStats ? {
          printable: state.printStats.printable, overhangCells: state.printStats.overhangCells,
          floatingClusters: state.printStats.floatingClusters, thinWallCells: state.printStats.thinWallCells,
          solidComponents: state.printStats.solidComponents
        } : null }; }
    };
  }

  init();
})();
