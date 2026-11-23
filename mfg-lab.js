/*
 * VoxelSynth manufacturing lab
 * Zero dependencies. Deterministic six-orientation printability analysis,
 * layer cross-section profiles, a SHA-256 bound audit brief, a strict
 * #vs= share-hash codec and an in-page self-test runner.
 * Mass, support and time figures are deterministic voxel-geometry
 * estimates, not physical slicer G-code runs.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./voxel.js'));
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return factory(root.VoxelSynth); });
  } else {
    root.VoxelSynthMfg = factory(root.VoxelSynth);
  }
})(typeof self !== 'undefined' ? self : this, function (V) {
  'use strict';

  var MODULE_VERSION = '1.0.0';
  var MAX_GRID_CELLS = 2000000;
  var ORIENTATIONS = [
    { id: '+z', label: '+Z upright' },
    { id: '-z', label: '-Z upside down' },
    { id: '+x', label: '+X side up' },
    { id: '-x', label: '-X side up' },
    { id: '+y', label: '+Y end up' },
    { id: '-y', label: '-Y end up' }
  ];
  var ORIENT_MAP = {};
  ORIENTATIONS.forEach(function (o) { ORIENT_MAP[o.id] = o; });
  var ORIENTATION_IDS = ORIENTATIONS.map(function (o) { return o.id; });
  var LAYER_HEIGHTS_MM = [0.12, 0.20, 0.28];
  var MATERIALS = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };
  /* Deterministic volumetric print-time model: a fixed extrusion rate plus
   * a fixed per-layer overhead. It is an order-of-magnitude planning
   * figure, never a slicer prediction. */
  var PRINT_FLOW_MM3_S = 12;
  var LAYER_OVERHEAD_S = 6;
  var SHARE_PREFIX = '#vs=';
  var SHARE_VERSION = 1;

  function needV() {
    if (!V || typeof V.sha256Hex !== 'function') throw new Error('the manufacturing lab needs the VoxelSynth engine');
    return V;
  }

  /* ---------------------------------------------------------------- */
  /* Grid helpers (duck-typed against the engine's lattice shape)      */
  /* ---------------------------------------------------------------- */

  function assertGridLike(grid) {
    if (!grid || !Number.isInteger(grid.nx) || !Number.isInteger(grid.ny) || !Number.isInteger(grid.nz) ||
        grid.nx <= 0 || grid.ny <= 0 || grid.nz <= 0 ||
        Object.prototype.toString.call(grid.data) !== '[object Uint8Array]' ||
        grid.data.length !== grid.nx * grid.ny * grid.nz || grid.data.length > MAX_GRID_CELLS ||
        !Number.isFinite(grid.pitchMm) || grid.pitchMm < 1e-6 || grid.pitchMm > 1e6) {
      throw new TypeError('expected a complete VoxelSynth Uint8Array grid');
    }
  }

  function makeGrid(nx, ny, nz, pitchMm) {
    return { nx: nx, ny: ny, nz: nz, pitchMm: pitchMm, data: new Uint8Array(nx * ny * nz) };
  }

  function cloneGridLike(grid) {
    assertGridLike(grid);
    var copy = makeGrid(grid.nx, grid.ny, grid.nz, grid.pitchMm);
    copy.data.set(grid.data);
    return copy;
  }

  function solidCount(grid) {
    var total = 0;
    for (var i = 0; i < grid.data.length; i++) total += grid.data[i] ? 1 : 0;
    return total;
  }

  /* ---------------------------------------------------------------- */
  /* Rigid 90-degree lattice orientations                              */
  /*                                                                   */
  /* Every transform is a signed permutation matrix with determinant   */
  /* +1 (a proper rotation) mapping the named source axis onto the     */
  /* build direction. Source +Z up is the stock orientation.           */
  /* ---------------------------------------------------------------- */

  function orientGrid(grid, orientation) {
    assertGridLike(grid);
    var nx = grid.nx, ny = grid.ny, nz = grid.nz, p = grid.pitchMm;
    var out, x, y, z, base;
    switch (orientation) {
      case '+z':
        return cloneGridLike(grid);
      case '-z':
        out = makeGrid(nx, ny, nz, p);
        for (z = 0; z < nz; z++) {
          for (y = 0; y < ny; y++) {
            base = nx * (y + ny * z);
            for (x = 0; x < nx; x++) {
              if (grid.data[base + x]) out.data[x + nx * ((ny - 1 - y) + ny * (nz - 1 - z))] = 1;
            }
          }
        }
        return out;
      case '+x':
        out = makeGrid(nz, ny, nx, p);
        for (z = 0; z < nz; z++) {
          for (y = 0; y < ny; y++) {
            base = nx * (y + ny * z);
            for (x = 0; x < nx; x++) {
              if (grid.data[base + x]) out.data[(nz - 1 - z) + nz * (y + ny * x)] = 1;
            }
          }
        }
        return out;
      case '-x':
        out = makeGrid(nz, ny, nx, p);
        for (z = 0; z < nz; z++) {
          for (y = 0; y < ny; y++) {
            base = nx * (y + ny * z);
            for (x = 0; x < nx; x++) {
              if (grid.data[base + x]) out.data[z + nz * (y + ny * (nx - 1 - x))] = 1;
            }
          }
        }
        return out;
      case '+y':
        out = makeGrid(nx, nz, ny, p);
        for (z = 0; z < nz; z++) {
          for (y = 0; y < ny; y++) {
            base = nx * (y + ny * z);
            for (x = 0; x < nx; x++) {
              if (grid.data[base + x]) out.data[x + nx * ((nz - 1 - z) + nz * y)] = 1;
            }
          }
        }
        return out;
      case '-y':
        out = makeGrid(nx, nz, ny, p);
        for (z = 0; z < nz; z++) {
          for (y = 0; y < ny; y++) {
            base = nx * (y + ny * z);
            for (x = 0; x < nx; x++) {
              if (grid.data[base + x]) out.data[x + nx * (z + nz * (ny - 1 - y))] = 1;
            }
          }
        }
        return out;
      default:
        throw new RangeError('unknown orientation: ' + orientation);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Options                                                           */
  /* ---------------------------------------------------------------- */

  function normalizeLabOptions(options) {
    var o = options || {};
    var material = String(o.material === undefined ? 'PLA' : o.material).toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(MATERIALS, material)) throw new RangeError('unknown material: ' + material);
    var layerMm = o.layerMm === undefined ? 0.20 : Number(o.layerMm);
    if (!Number.isFinite(layerMm)) throw new RangeError('layerMm must be finite');
    if (layerMm < 0.01 || layerMm > 5) throw new RangeError('layerMm must be between 0.01 and 5 mm');
    var infill = o.infillPercent === undefined ? 100 : Number(o.infillPercent);
    if (!Number.isFinite(infill)) throw new RangeError('infillPercent must be finite');
    infill = Math.min(100, Math.max(0, infill));
    var orientation = o.orientation === undefined ? '+z' : String(o.orientation);
    if (!Object.prototype.hasOwnProperty.call(ORIENT_MAP, orientation)) throw new RangeError('unknown orientation: ' + orientation);
    return {
      material: material,
      densityGPerCm3: MATERIALS[material],
      layerMm: layerMm,
      infillPercent: infill,
      orientation: orientation
    };
  }

  /* ---------------------------------------------------------------- */
  /* Per-orientation printability analysis                             */
  /* ---------------------------------------------------------------- */

  /* Analyzes a lattice that is already in its build orientation. The
   * build plate is z = 0. Support columns are the empty cells below the
   * lowest solid cell of each (x, y) column. */
  function analyzeOriented(grid, opts) {
    var nx = grid.nx, ny = grid.ny, nz = grid.nz, p = grid.pitchMm;
    var layer = nx * ny, total = grid.data.length;
    var colMin = new Int32Array(layer).fill(nz);
    var maxZ = -1, solidCells = 0, i;
    for (i = 0; i < total; i++) {
      if (!grid.data[i]) continue;
      var col = i % layer;
      var z = (i - col) / layer;
      if (z < colMin[col]) colMin[col] = z;
      if (z > maxZ) maxZ = z;
      solidCells++;
    }
    var bedCells = 0, supportCells = 0;
    for (i = 0; i < layer; i++) {
      if (grid.data[i]) bedCells++;
      if (colMin[i] > 0 && colMin[i] < nz) supportCells += colMin[i];
    }
    var overhangCells = 0;
    for (i = layer; i < total; i++) {
      if (grid.data[i] && !grid.data[i - layer]) overhangCells++;
    }
    var comp = new Int32Array(total).fill(-1);
    var queue = new Int32Array(total);
    var clusterCount = 0, floatingClusters = 0;
    var dirs = [1, -1, nx, -nx, layer, -layer];
    for (var start = 0; start < total; start++) {
      if (!grid.data[start] || comp[start] !== -1) continue;
      var touchesPlate = false, head = 0, tail = 0;
      queue[tail++] = start; comp[start] = clusterCount;
      while (head < tail) {
        i = queue[head++];
        var cx = i % nx, rest = (i - cx) / nx, cy = rest % ny, cz = (rest - cy) / ny;
        if (cz === 0) touchesPlate = true;
        for (var d = 0; d < 6; d++) {
          var nb = i + dirs[d];
          if (nb < 0 || nb >= total || !grid.data[nb] || comp[nb] !== -1) continue;
          var bx = nb % nx, rest2 = (nb - bx) / nx, by = rest2 % ny;
          if (Math.abs(bx - cx) + Math.abs(by - cy) + Math.abs((rest2 - by) / ny - cz) !== 1) continue;
          comp[nb] = clusterCount; queue[tail++] = nb;
        }
      }
      clusterCount++;
      if (!touchesPlate) floatingClusters++;
    }
    var buildHeightMm = (maxZ + 1) * p;
    var layers = Math.ceil(buildHeightMm / opts.layerMm);
    var solidMm3 = solidCells * Math.pow(p, 3);
    var supportMm3 = supportCells * Math.pow(p, 3);
    var massG = (solidMm3 / 1000) * (opts.infillPercent / 100) * opts.densityGPerCm3;
    var extrudeMm3 = (solidMm3 + supportMm3) * (opts.infillPercent / 100);
    var printSeconds = extrudeMm3 / PRINT_FLOW_MM3_S + layers * LAYER_OVERHEAD_S;
    return {
      nx: nx, ny: ny, nz: nz, pitchMm: p,
      solidCells: solidCells,
      bedCells: bedCells,
      footprintMm2: bedCells * p * p,
      overhangCells: overhangCells,
      overhangAreaMm2: overhangCells * p * p,
      solidComponents: clusterCount,
      floatingClusters: floatingClusters,
      supportCells: supportCells,
      supportMm3: supportMm3,
      buildHeightMm: buildHeightMm,
      layers: layers,
      solidMm3: solidMm3,
      massG: massG,
      printSeconds: printSeconds,
      printMinutes: printSeconds / 60,
      printable: floatingClusters === 0
    };
  }

  function analyzeOrientation(grid, orientation, options) {
    assertGridLike(grid);
    if (!Object.prototype.hasOwnProperty.call(ORIENT_MAP, String(orientation))) {
      throw new RangeError('unknown orientation: ' + orientation);
    }
    var opts = normalizeLabOptions(options);
    var report = analyzeOriented(orientGrid(grid, orientation), opts);
    report.orientation = orientation;
    report.label = ORIENT_MAP[orientation].label;
    return report;
  }

  /* Rank by fewest floating clusters, then least support volume, then
   * fewest overhang cells, then shortest print time. Ties resolve in the
   * canonical orientation order so the verdict is deterministic. */
  function compareOrientations(grid, options) {
    assertGridLike(grid);
    var opts = normalizeLabOptions(options);
    var rows = ORIENTATIONS.map(function (o) {
      var report = analyzeOriented(orientGrid(grid, o.id), opts);
      report.orientation = o.id;
      report.label = o.label;
      return report;
    });
    var best = null, bestRank = null;
    rows.forEach(function (row) {
      var rank = [row.floatingClusters, row.supportCells, row.overhangCells, row.printSeconds];
      if (bestRank === null || rank[0] < bestRank[0] ||
          (rank[0] === bestRank[0] && (rank[1] < bestRank[1] ||
          (rank[1] === bestRank[1] && (rank[2] < bestRank[2] ||
          (rank[2] === bestRank[2] && rank[3] < bestRank[3])))))) {
        best = row; bestRank = rank;
      }
    });
    return {
      rows: rows,
      best: best,
      material: opts.material,
      densityGPerCm3: opts.densityGPerCm3,
      layerMm: opts.layerMm,
      infillPercent: opts.infillPercent
    };
  }

  /* Per-Z-slice cross-section profile of the lattice in one build
   * orientation: solid cells and area, unsupported overhang cells and
   * the empty support cells at that level. */
  function layerProfile(grid, orientation) {
    assertGridLike(grid);
    if (!Object.prototype.hasOwnProperty.call(ORIENT_MAP, String(orientation))) {
      throw new RangeError('unknown orientation: ' + orientation);
    }
    var g = orientGrid(grid, orientation);
    var nx = g.nx, ny = g.ny, nz = g.nz, p = g.pitchMm;
    var layer = nx * ny;
    var colMin = new Int32Array(layer).fill(nz);
    var i;
    for (i = 0; i < g.data.length; i++) {
      if (!g.data[i]) continue;
      var col = i % layer, z = (i - col) / layer;
      if (z < colMin[col]) colMin[col] = z;
    }
    var layers = [];
    for (z = 0; z < nz; z++) {
      var cells = 0, overhang = 0, support = 0;
      var off = layer * z;
      for (i = 0; i < layer; i++) {
        if (g.data[off + i]) {
          cells++;
          if (z > 0 && !g.data[off + i - layer]) overhang++;
        } else if (colMin[i] > z && colMin[i] < nz) {
          support++;
        }
      }
      layers.push({ z: z, cells: cells, areaMm2: cells * p * p, overhangCells: overhang, supportCells: support });
    }
    return { orientation: orientation, nx: nx, ny: ny, nz: nz, pitchMm: p, layers: layers };
  }

  /* ---------------------------------------------------------------- */
  /* Canonical text helpers                                            */
  /* ---------------------------------------------------------------- */

  function round6(value) {
    return Math.round(value * 1e6) / 1e6;
  }

  function utf8Bytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var cp = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return new Uint8Array(out);
  }

  /* JSON with recursively sorted keys so the digest binds one canonical
   * byte stream on every platform. */
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k]); }).join(',') + '}';
  }

  function csvEscape(value) {
    var s = String(value);
    if (s.length && (s.charCodeAt(0) < 0x20 || /^[\t ]*[=+\-@]/.test(s))) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ---------------------------------------------------------------- */
  /* SHA-256 bound audit brief                                         */
  /* ---------------------------------------------------------------- */

  var bundleCache = new Map();

  function stateKeyOf(grid, opts) {
    needV();
    return grid.nx + 'x' + grid.ny + 'x' + grid.nz + '@' + grid.pitchMm +
      '|' + V.sha256Hex(grid.data) + '|' + opts.material + '|' + opts.layerMm +
      '|' + opts.infillPercent + '|' + opts.orientation;
  }

  function rowPayload(row) {
    return {
      orientation: row.orientation,
      label: row.label,
      dims: [row.nx, row.ny, row.nz],
      bedCells: row.bedCells,
      footprintMm2: round6(row.footprintMm2),
      overhangCells: row.overhangCells,
      overhangAreaMm2: round6(row.overhangAreaMm2),
      solidComponents: row.solidComponents,
      floatingClusters: row.floatingClusters,
      supportCells: row.supportCells,
      supportMm3: round6(row.supportMm3),
      buildHeightMm: round6(row.buildHeightMm),
      layers: row.layers,
      solidMm3: round6(row.solidMm3),
      massG: round6(row.massG),
      printMinutes: round6(row.printMinutes),
      printable: row.printable
    };
  }

  function buildCsv(payload) {
    var lines = [
      '# VoxelSynth manufacturing brief',
      '# sha256=' + payload.sha256,
      '# model=' + payload.model.nx + 'x' + payload.model.ny + 'x' + payload.model.nz + ' pitch_mm=' + payload.model.pitchMm + ' solid_cells=' + payload.model.solidCells,
      '# occupancy_sha256=' + payload.model.occupancySha256,
      '# material=' + payload.settings.material + ' layer_height_mm=' + payload.settings.layerMm + ' infill_percent=' + payload.settings.infillPercent + ' selected_orientation=' + payload.settings.selectedOrientation,
      '# estimates=deterministic voxel-geometry estimates, not physical slicer G-code runs',
      'orientation,label,bed_cells,footprint_mm2,overhang_cells,overhang_mm2,floating_clusters,support_mm3,build_height_mm,layers,mass_g,print_minutes,verdict'
    ];
    payload.orientations.forEach(function (row) {
      lines.push([
        csvEscape(row.orientation),
        csvEscape(row.label),
        row.bedCells, row.footprintMm2, row.overhangCells, row.overhangAreaMm2,
        row.floatingClusters, row.supportMm3, row.buildHeightMm, row.layers,
        row.massG, row.printMinutes,
        csvEscape(row.orientation === payload.best.orientation ? 'optimal' : row.printable ? 'printable' : 'needs support')
      ].join(','));
    });
    return lines.join('\n') + '\n';
  }

  function buildMarkdown(payload) {
    var lines = [
      '# VoxelSynth manufacturing brief',
      '',
      'SHA-256 audit digest: `' + payload.sha256 + '`',
      '',
      '## Model',
      '',
      '- Lattice ' + payload.model.nx + ' x ' + payload.model.ny + ' x ' + payload.model.nz + ' cells at ' + payload.model.pitchMm + ' mm pitch',
      '- Solid cells: ' + payload.model.solidCells,
      '- Occupancy SHA-256: `' + payload.model.occupancySha256 + '`',
      '',
      '## Settings',
      '',
      '- Material ' + payload.settings.material + ' (' + payload.settings.densityGPerCm3 + ' g/cm3)',
      '- Layer height ' + payload.settings.layerMm + ' mm',
      '- Infill ' + payload.settings.infillPercent + ' %',
      '- Selected orientation ' + payload.settings.selectedOrientation,
      '',
      '## Six orientation comparison',
      '',
      '| Orientation | Footprint mm2 | Overhang cells | Floating | Support mm3 | Height mm | Layers | Mass g | Time min |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ];
    payload.orientations.forEach(function (row) {
      var name = row.label + (row.orientation === payload.best.orientation ? ' (optimal)' : '');
      lines.push('| ' + name + ' | ' + row.footprintMm2 + ' | ' + row.overhangCells + ' | ' + row.floatingClusters +
        ' | ' + row.supportMm3 + ' | ' + row.buildHeightMm + ' | ' + row.layers + ' | ' + row.massG + ' | ' + row.printMinutes + ' |');
    });
    lines.push('');
    lines.push('## Layer cross-section profile (' + payload.layerProfile.orientation + ')');
    lines.push('');
    lines.push('| Layer | Solid cells | Area mm2 | Overhang cells | Support cells |');
    lines.push('| ---: | ---: | ---: | ---: | ---: |');
    payload.layerProfile.layers.forEach(function (l) {
      lines.push('| ' + l.z + ' | ' + l.cells + ' | ' + round6(l.areaMm2) + ' | ' + l.overhangCells + ' | ' + l.supportCells + ' |');
    });
    lines.push('');
    lines.push('Mass, support and time figures are deterministic voxel-geometry estimates, not physical slicer G-code runs.');
    lines.push('');
    lines.push('---');
    lines.push('Audit digest SHA-256: `' + payload.sha256 + '`');
    lines.push('');
    return lines.join('\n');
  }

  /* One canonical digest-stamped bundle per state key. The on-page
   * fingerprint, the JSON export, the CSV provenance header and the
   * Markdown footer all read this same object, so they can never drift. */
  function auditBundle(grid, options) {
    assertGridLike(grid);
    var opts = normalizeLabOptions(options);
    var key = stateKeyOf(grid, opts);
    if (bundleCache.has(key)) return bundleCache.get(key);
    var report = compareOrientations(grid, opts);
    var profile = layerProfile(grid, opts.orientation);
    var sans = {
      tool: 'VoxelSynth manufacturing brief',
      version: MODULE_VERSION,
      engine: V.version,
      model: {
        nx: grid.nx, ny: grid.ny, nz: grid.nz, pitchMm: grid.pitchMm,
        totalCells: grid.data.length,
        solidCells: solidCount(grid),
        occupancySha256: V.sha256Hex(grid.data)
      },
      settings: {
        material: opts.material,
        densityGPerCm3: opts.densityGPerCm3,
        layerMm: opts.layerMm,
        infillPercent: opts.infillPercent,
        selectedOrientation: opts.orientation
      },
      estimator: {
        flowMm3PerSecond: PRINT_FLOW_MM3_S,
        layerOverheadSeconds: LAYER_OVERHEAD_S,
        basis: 'extrusion volume at infill rate plus a fixed per-layer overhead'
      },
      orientations: report.rows.map(rowPayload),
      best: { orientation: report.best.orientation, supportMm3: round6(report.best.supportMm3), printMinutes: round6(report.best.printMinutes) },
      layerProfile: {
        orientation: profile.orientation,
        layers: profile.layers.map(function (l) { return { z: l.z, cells: l.cells, areaMm2: round6(l.areaMm2), overhangCells: l.overhangCells, supportCells: l.supportCells }; })
      },
      disclosure: 'Mass, support and time figures are deterministic voxel-geometry estimates, not physical slicer G-code runs.'
    };
    var digest = V.sha256Hex(utf8Bytes(stableStringify(sans)));
    var payload = Object.assign({ sha256: digest }, sans);
    var bundle = {
      key: key,
      digest: digest,
      payload: payload,
      report: report,
      json: JSON.stringify(payload, null, 2) + '\n',
      csv: '',
      markdown: ''
    };
    bundle.csv = buildCsv(payload);
    bundle.markdown = buildMarkdown(payload);
    if (bundleCache.size >= 24) bundleCache.delete(bundleCache.keys().next().value);
    bundleCache.set(key, bundle);
    return bundle;
  }

  /* Recomputes the digest over every stamped field except the digest
   * itself. Accepts a bundle or a bare stamped payload. */
  function verifyBundle(bundle) {
    var payload = bundle && bundle.payload ? bundle.payload : bundle;
    if (!payload || typeof payload !== 'object' || typeof payload.sha256 !== 'string') {
      throw new TypeError('verify needs a stamped audit payload');
    }
    var sans = {};
    Object.keys(payload).forEach(function (k) { if (k !== 'sha256') sans[k] = payload[k]; });
    var actual = needV().sha256Hex(utf8Bytes(stableStringify(sans)));
    return { ok: actual === payload.sha256, expected: payload.sha256, actual: actual };
  }

  /* Interactive proof that the digest detects edits: one field of a
   * cloned payload is changed and verification must fail. */
  function tamperDemo(bundle) {
    if (!bundle || !bundle.payload) throw new TypeError('tamper demo needs an audit bundle');
    var mutated = JSON.parse(JSON.stringify(bundle.payload));
    mutated.model.solidCells += 1;
    var check = verifyBundle(mutated);
    return {
      ok: check.ok,
      changedField: 'model.solidCells',
      expected: mutated.sha256,
      actual: check.actual,
      detected: !check.ok
    };
  }

  /* ---------------------------------------------------------------- */
  /* #vs= share-hash codec                                             */
  /* ---------------------------------------------------------------- */

  function b64urlEncode(bytes) {
    var bin = '', chunk = 8192;
    for (var i = 0; i < bytes.length; i += chunk) {
      var end = Math.min(i + chunk, bytes.length);
      for (var j = i; j < end; j++) bin += String.fromCharCode(bytes[j]);
    }
    var b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(text, label) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) {
      throw new TypeError(label + ' uses non canonical characters');
    }
    var b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin;
    try {
      bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    } catch (error) {
      throw new TypeError(label + ' is not valid base64url');
    }
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    if (b64urlEncode(bytes) !== text) throw new TypeError(label + ' is not canonical base64url');
    return bytes;
  }

  function packOccupancy(data) {
    var bytes = new Uint8Array(Math.ceil(data.length / 8));
    for (var i = 0; i < data.length; i++) {
      if (data[i]) bytes[i >> 3] |= 1 << (i & 7);
    }
    return b64urlEncode(bytes);
  }

  function unpackOccupancy(text, total) {
    var byteCount = Math.ceil(total / 8);
    var expectedLength = Math.floor((byteCount * 8 + 5) / 6);
    if (typeof text !== 'string' || text.length !== expectedLength) {
      throw new TypeError('occupancy bits have the wrong length');
    }
    var bytes = b64urlDecode(text, 'occupancy bits');
    if (bytes.length !== byteCount) throw new TypeError('occupancy bits decode to the wrong size');
    var tail = byteCount * 8 - total;
    if (tail > 0 && (bytes[byteCount - 1] & ((0xff << (8 - tail)) & 0xff)) !== 0) {
      throw new TypeError('occupancy bits are not canonical');
    }
    var out = new Uint8Array(total);
    for (var i = 0; i < total; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    return out;
  }

  function sculptureIds() {
    return needV().listSculpturePresets().map(function (item) { return item.id; });
  }

  /* Strict shape check: every field must be an own property picked from
   * the whitelist. Prototype-related names and unknown keys reject the
   * whole hash. */
  var SHARE_KEYS = ['v', 'n', 'k', 'c', 'x', 'y', 'z', 'p', 'o', 'm', 'l', 'i'];

  function decodeShareHash(hash) {
    if (typeof hash !== 'string' || hash.slice(0, SHARE_PREFIX.length) !== SHARE_PREFIX) {
      throw new TypeError('share hash must start with ' + SHARE_PREFIX);
    }
    var match = /^[A-Za-z0-9_-]+$/.exec(hash.slice(SHARE_PREFIX.length));
    if (!match) throw new TypeError('share hash has a malformed payload');
    var bytes = b64urlDecode(hash.slice(SHARE_PREFIX.length), 'share payload');
    var text = '';
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 0x80) throw new TypeError('share payload must be ASCII JSON');
      text += String.fromCharCode(bytes[i]);
    }
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (error) {
      throw new TypeError('share payload is not valid JSON');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('share payload must be a flat object');
    var keys = Object.keys(obj);
    if (keys.some(function (k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; })) {
      throw new TypeError('share payload carries forbidden keys');
    }
    if (keys.some(function (k) { return SHARE_KEYS.indexOf(k) === -1; })) {
      throw new TypeError('share payload carries unknown keys');
    }
    function own(k) { return Object.prototype.hasOwnProperty.call(obj, k); }
    function need(k) { if (!own(k)) throw new TypeError('share payload misses ' + k); return obj[k]; }
    var state = {};
    if (need('v') !== SHARE_VERSION) throw new TypeError('unsupported share version');
    state.v = SHARE_VERSION;
    ['x', 'y', 'z'].forEach(function (k) {
      var n = need(k);
      if (!Number.isInteger(n) || n <= 0) throw new TypeError('share ' + k + ' must be a positive integer');
      state[k] = n;
    });
    if (state.x * state.y * state.z > MAX_GRID_CELLS) throw new TypeError('share lattice exceeds the cell limit');
    var pitch = need('p');
    if (!Number.isFinite(pitch) || pitch < 1e-6 || pitch > 1e6) throw new TypeError('share pitch out of range');
    state.p = pitch;
    var orientation = need('o');
    if (!Object.prototype.hasOwnProperty.call(ORIENT_MAP, orientation)) throw new TypeError('share orientation is unknown');
    state.o = orientation;
    var material = need('m');
    if (!Object.prototype.hasOwnProperty.call(MATERIALS, material)) throw new TypeError('share material is unknown');
    state.m = material;
    var layer = need('l');
    if (typeof layer !== 'number' || !LAYER_HEIGHTS_MM.some(function (h) { return Math.abs(h - layer) < 1e-9; })) {
      throw new TypeError('share layer height must be a canonical value');
    }
    state.l = layer;
    var infill = need('i');
    if (!Number.isFinite(infill) || infill < 0 || infill > 100) throw new TypeError('share infill out of range');
    state.i = infill;
    var hasPreset = own('n'), hasCells = own('c');
    if (hasPreset === hasCells) throw new TypeError('share payload needs exactly one of preset or cells');
    state.n = null; state.k = null; state.cells = null;
    if (hasPreset) {
      if (typeof obj.n !== 'string') throw new TypeError('share preset must be a name string');
      needV();
      if (!Object.prototype.hasOwnProperty.call(V.presets, obj.n)) throw new TypeError('share preset is unknown');
      if (own('k')) {
        if (obj.k !== 'part' && obj.k !== 'sculpture') throw new TypeError('share kind is unknown');
        var sculpture = sculptureIds().indexOf(obj.n) !== -1;
        if ((obj.k === 'sculpture') !== sculpture) throw new TypeError('share kind disagrees with the preset');
        state.k = obj.k;
      }
      state.n = obj.n;
    } else {
      state.cells = unpackOccupancy(need('c'), state.x * state.y * state.z);
    }
    return state;
  }

  /* Rebuilds the lattice a decoded share hash describes. Preset states
   * regenerate deterministically; cell states unpack raw occupancy. */
  function shareGrid(state) {
    if (!state || typeof state !== 'object') throw new TypeError('expected a decoded share state');
    if (state.n !== null && state.n !== undefined) {
      needV();
      var grid = V.loadPreset(state.n, { nx: state.x, ny: state.y, nz: state.z, pitchMm: state.p });
      if (grid.nx !== state.x || grid.ny !== state.y || grid.nz !== state.z) {
        throw new TypeError('share preset regenerated at the wrong size');
      }
      return grid;
    }
    if (!state.cells || state.cells.length !== state.x * state.y * state.z) {
      throw new TypeError('share state carries no valid occupancy');
    }
    var out = makeGrid(state.x, state.y, state.z, state.p);
    out.data.set(state.cells);
    return out;
  }

  function encodeShareState(input) {
    if (!input || typeof input !== 'object') throw new TypeError('share encoding needs a state object');
    var grid = input.grid;
    assertGridLike(grid);
    var opts = normalizeLabOptions({
      material: input.material,
      layerMm: input.layerMm,
      infillPercent: input.infillPercent,
      orientation: input.orientation
    });
    if (LAYER_HEIGHTS_MM.indexOf(opts.layerMm) === -1) {
      throw new RangeError('share links carry the canonical layer heights 0.12, 0.20 and 0.28 mm');
    }
    if (opts.infillPercent !== input.infillPercent && input.infillPercent !== undefined) {
      throw new RangeError('share infill must stay inside 0 to 100');
    }
    var obj = { v: SHARE_VERSION };
    var name = input.presetName;
    var preset = null;
    if (name !== undefined && name !== null) {
      needV();
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(V.presets, name)) {
        throw new RangeError('share preset is unknown');
      }
      var regenerated = V.loadPreset(name, { nx: grid.nx, ny: grid.ny, nz: grid.nz, pitchMm: grid.pitchMm });
      var identical = regenerated.nx === grid.nx && regenerated.ny === grid.ny && regenerated.nz === grid.nz &&
        regenerated.data.length === grid.data.length &&
        regenerated.data.every(function (value, i) { return value === grid.data[i]; });
      if (identical) preset = name;
    }
    if (preset) {
      obj.n = preset;
      obj.k = sculptureIds().indexOf(preset) !== -1 ? 'sculpture' : 'part';
    } else {
      obj.c = packOccupancy(grid.data);
    }
    obj.x = grid.nx; obj.y = grid.ny; obj.z = grid.nz; obj.p = grid.pitchMm;
    obj.o = opts.orientation; obj.m = opts.material; obj.l = opts.layerMm; obj.i = opts.infillPercent;
    return SHARE_PREFIX + b64urlEncode(utf8Bytes(JSON.stringify(obj)));
  }

  /* ---------------------------------------------------------------- */
  /* In-page deterministic self-tests                                  */
  /* ---------------------------------------------------------------- */

  function cantileverFixture() {
    var grid = makeGrid(10, 6, 8, 1.5);
    for (var z = 0; z < 3; z++) {
      for (var y = 0; y < 6; y++) {
        for (var x = 0; x < 4; x++) grid.data[x + 10 * (y + 6 * z)] = 1;
      }
    }
    for (var x2 = 4; x2 < 10; x2++) grid.data[x2 + 10 * (2 + 6 * 5)] = 1;
    return grid;
  }

  function runSelfTests(grid) {
    var results = [];
    function check(id, name, fn) {
      var detail = '', pass = false;
      try {
        var value = fn();
        detail = value === undefined ? '' : String(value);
        pass = true;
      } catch (error) {
        detail = String(error && error.message ? error.message : error);
      }
      results.push({ id: id, name: name, pass: pass, detail: detail });
    }
    function expect(condition, message) {
      if (!condition) throw new Error(message || 'self-test expectation failed');
    }
    var subject = grid || cantileverFixture();
    assertGridLike(subject);
    var opts = { material: 'PLA', layerMm: 0.20, infillPercent: 100 };

    check('engine-link', 'VoxelSynth engine is linked with a SHA-256 primitive', function () {
      expect(V && typeof V.sha256Hex === 'function', 'engine not linked');
      return 'engine ' + V.version;
    });
    check('sha256-empty', 'SHA-256 empty-message known answer', function () {
      var hex = V.sha256Hex(new Uint8Array(0));
      expect(hex === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', hex);
      return hex.slice(0, 16);
    });
    check('sha256-abc', 'SHA-256 abc known answer', function () {
      var hex = V.sha256Hex(utf8Bytes('abc'));
      expect(hex === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', hex);
      return hex.slice(0, 16);
    });
    check('sha256-a', 'SHA-256 single byte known answer', function () {
      var hex = V.sha256Hex(utf8Bytes('a'));
      expect(hex === 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', hex);
      return hex.slice(0, 16);
    });
    check('orient-cells', 'All six orientations preserve the exact solid cell count', function () {
      var count = solidCount(subject);
      ORIENTATION_IDS.forEach(function (o) {
        expect(solidCount(orientGrid(subject, o)) === count, 'count changed at ' + o);
      });
      return count + ' cells';
    });
    check('orient-euler', 'All six orientations preserve V - E + F', function () {
      var chi = V.analyzeMesh(V.extractManifoldMesh(subject)).eulerCharacteristic;
      ORIENTATION_IDS.forEach(function (o) {
        var rotated = V.analyzeMesh(V.extractManifoldMesh(orientGrid(subject, o))).eulerCharacteristic;
        expect(rotated === chi, 'chi changed at ' + o);
      });
      return 'X = ' + chi;
    });
    check('prism-clean', 'A solid rectangular prism overhangs nowhere in +Z', function () {
      var prism = makeGrid(6, 5, 4, 2);
      prism.data.fill(1);
      var row = analyzeOrientation(prism, '+z', opts);
      expect(row.overhangCells === 0 && row.supportCells === 0 && row.floatingClusters === 0, 'prism needs support');
      return 'overhang 0';
    });
    check('support-monotone', 'Extending a cantilever never reduces support volume', function () {
      var a = cantileverFixture();
      var b = cloneGridLike(a);
      for (var x = 4; x < 10; x++) b.data[x + 10 * (3 + 6 * 5)] = 1;
      var ra = analyzeOrientation(a, '+z', opts);
      var rb = analyzeOrientation(b, '+z', opts);
      expect(rb.supportMm3 > ra.supportMm3, 'support shrank');
      return ra.supportMm3 + ' < ' + rb.supportMm3 + ' mm3';
    });
    check('layer-sum', 'Layer profile cells sum to the voxel count', function () {
      var profile = layerProfile(subject, '+z');
      var sum = profile.layers.reduce(function (t, l) { return t + l.cells; }, 0);
      expect(sum === solidCount(subject), 'sum mismatch');
      return sum + ' cells over ' + profile.layers.length + ' layers';
    });
    check('layers-monotone', 'Thicker layers never increase the layer count', function () {
      var rows = LAYER_HEIGHTS_MM.map(function (h) {
        return analyzeOrientation(subject, '+z', { material: 'PLA', layerMm: h, infillPercent: 100 }).layers;
      });
      expect(rows[0] >= rows[1] && rows[1] >= rows[2], 'layer count inverted');
      return rows.join(' >= ');
    });
    check('csv-escape', 'CSV cells starting with formula characters are escaped', function () {
      expect(csvEscape('=CMD()') === "'=CMD()", csvEscape('=CMD()'));
      expect(csvEscape('+z') === "'+z", csvEscape('+z'));
      expect(csvEscape('@SUM') === "'@SUM", csvEscape('@SUM'));
      return 'formula-safe';
    });
    check('digest-parity', 'JSON, CSV and Markdown carry one identical digest', function () {
      var bundle = auditBundle(subject, opts);
      expect(bundle.json.indexOf(bundle.digest) !== -1, 'json misses digest');
      expect(bundle.csv.indexOf('# sha256=' + bundle.digest) !== -1, 'csv misses digest');
      expect(bundle.markdown.indexOf('Audit digest SHA-256: `' + bundle.digest + '`') !== -1, 'md misses digest');
      return bundle.digest.slice(0, 16);
    });
    check('tamper', 'Digest verification detects a mutated payload field', function () {
      var bundle = auditBundle(subject, opts);
      expect(verifyBundle(bundle).ok === true, 'clean bundle failed');
      var demo = tamperDemo(bundle);
      expect(demo.detected === true && demo.ok === false, 'tamper not detected');
      return 'detected';
    });
    check('share-roundtrip', 'A #vs= hash restores every field and every cell', function () {
      var encoded = encodeShareState({
        grid: subject, presetName: null,
        orientation: '-x', material: 'PETG', layerMm: 0.28, infillPercent: 40
      });
      var decoded = decodeShareHash(encoded);
      var rebuilt = shareGrid(decoded);
      expect(decoded.o === '-x' && decoded.m === 'PETG' && decoded.l === 0.28 && decoded.i === 40, 'field mismatch');
      expect(rebuilt.data.length === subject.data.length && rebuilt.data.every(function (v, i) { return v === subject.data[i]; }), 'occupancy mismatch');
      return encoded.length + ' chars';
    });
    check('share-proto', 'Hostile __proto__ and constructor keys are refused', function () {
      ['__proto__', 'constructor', 'prototype'].forEach(function (key) {
        var bad = {};
        bad[key] = {};
        var hash = SHARE_PREFIX + b64urlEncode(utf8Bytes(JSON.stringify(bad)));
        var refused = false;
        try { decodeShareHash(hash); } catch (error) { refused = true; }
        expect(refused, key + ' slipped through');
      });
      return 'refused';
    });
    check('share-hostile', 'Malformed, truncated and non-canonical hashes fail closed', function () {
      var good = encodeShareState({ grid: subject, orientation: '+z', material: 'PLA', layerMm: 0.20, infillPercent: 100 });
      [good.slice(0, -2), good + '!', '#vx=' + good.slice(4), SHARE_PREFIX + 'AAAA', SHARE_PREFIX].forEach(function (bad) {
        var refused = false;
        try { decodeShareHash(bad); } catch (error) { refused = true; }
        expect(refused, 'accepted ' + bad.slice(0, 24));
      });
      return 'closed';
    });
    check('floating', 'A detached voxel island counts one floating cluster', function () {
      var lone = makeGrid(4, 4, 6, 1);
      lone.data[1 + 4 * (1 + 4 * 3)] = 1;
      var row = analyzeOrientation(lone, '+z', opts);
      expect(row.floatingClusters === 1 && row.printable === false, 'island missed');
      var grounded = makeGrid(4, 4, 6, 1);
      grounded.data[1 + 4 * (1 + 4 * 0)] = 1;
      expect(analyzeOrientation(grounded, '+z', opts).floatingClusters === 0, 'grounded voxel flagged');
      return '1 floating';
    });
    return { results: results, passed: results.filter(function (r) { return r.pass; }).length, total: results.length };
  }

  return {
    version: MODULE_VERSION,
    engineReady: !!V,
    ORIENTATIONS: ORIENTATIONS.map(function (o) { return { id: o.id, label: o.label }; }),
    ORIENTATION_IDS: ORIENTATION_IDS.slice(),
    LAYER_HEIGHTS_MM: LAYER_HEIGHTS_MM.slice(),
    MATERIALS: Object.assign({}, MATERIALS),
    PRINT_FLOW_MM3_S: PRINT_FLOW_MM3_S,
    LAYER_OVERHEAD_S: LAYER_OVERHEAD_S,
    SHARE_PREFIX: SHARE_PREFIX,
    orientGrid: orientGrid,
    analyzeOrientation: analyzeOrientation,
    analyzeOriented: function (grid, options) { return analyzeOriented(grid, normalizeLabOptions(options)); },
    compareOrientations: compareOrientations,
    layerProfile: layerProfile,
    normalizeLabOptions: normalizeLabOptions,
    auditBundle: auditBundle,
    verifyBundle: verifyBundle,
    tamperDemo: tamperDemo,
    stateKeyOf: function (grid, options) { return stateKeyOf(grid, normalizeLabOptions(options)); },
    stableStringify: stableStringify,
    csvEscape: csvEscape,
    utf8Bytes: utf8Bytes,
    packOccupancy: packOccupancy,
    unpackOccupancy: unpackOccupancy,
    encodeShareState: encodeShareState,
    decodeShareHash: decodeShareHash,
    shareGrid: shareGrid,
    runSelfTests: runSelfTests
  };
});
