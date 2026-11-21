/*
 * VoxelSynth core engine
 * Zero dependencies. Runs in Node.js, classic browser scripts, and AMD loaders.
 * All geometry is computed on an integer lattice first, then scaled by pitchMm.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.VoxelSynth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_PLA_DENSITY = 1.24;
  var DEFAULT_PETG_DENSITY = 1.27;
  var AXIS_NAMES = ['x', 'y', 'z'];
  var MAX_GRID_CELLS = 2000000;
  var MAX_MESH_TRIANGLES = 250000;

  function assertPositiveInteger(value, label) {
    if (!Number.isFinite(value) || Math.floor(value) !== value || value <= 0) {
      throw new RangeError(label + ' must be a positive integer');
    }
  }

  function assertFinite(value, label) {
    if (!Number.isFinite(value)) throw new RangeError(label + ' must be finite');
  }

  function assertPositive(value, label) {
    assertFinite(value, label);
    if (value <= 0) throw new RangeError(label + ' must be positive');
  }

  function assertGeometry(values) {
    values.forEach(function (value) { assertFinite(value, 'geometry coordinate'); });
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /* ------------------------------------------------------------------ */
  /* Grid                                                                */
  /* ------------------------------------------------------------------ */

  function createGrid(nx, ny, nz, pitchMm) {
    assertPositiveInteger(nx, 'nx');
    assertPositiveInteger(ny, 'ny');
    assertPositiveInteger(nz, 'nz');
    if (pitchMm === undefined) pitchMm = 1;
    assertPositive(pitchMm, 'pitchMm');
    if (!Number.isSafeInteger(nx * ny * nz) || nx * ny * nz > MAX_GRID_CELLS) {
      throw new RangeError('grid exceeds the ' + MAX_GRID_CELLS + ' cell limit');
    }
    if (pitchMm < 1e-6 || pitchMm > 1e6) throw new RangeError('pitchMm must be between 0.000001 and 1000000');
    return {
      nx: nx,
      ny: ny,
      nz: nz,
      pitchMm: pitchMm,
      data: new Uint8Array(nx * ny * nz)
    };
  }

  function cloneGrid(grid) {
    assertGrid(grid);
    var copy = createGrid(grid.nx, grid.ny, grid.nz, grid.pitchMm);
    copy.data.set(grid.data);
    return copy;
  }

  function assertGrid(grid) {
    if (!grid || !Number.isInteger(grid.nx) || !Number.isInteger(grid.ny) || !Number.isInteger(grid.nz) ||
        grid.nx <= 0 || grid.ny <= 0 || grid.nz <= 0 || !ArrayBuffer.isView(grid.data) ||
        Object.prototype.toString.call(grid.data) !== '[object Uint8Array]' ||
        grid.data.length !== grid.nx * grid.ny * grid.nz || grid.data.length > MAX_GRID_CELLS ||
        !Number.isFinite(grid.pitchMm) || grid.pitchMm < 1e-6 || grid.pitchMm > 1e6) {
      throw new TypeError('expected a complete VoxelSynth Uint8Array grid');
    }
  }

  function indexOf(grid, x, y, z) {
    return x + grid.nx * (y + grid.ny * z);
  }

  function inBounds(grid, x, y, z) {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
      x >= 0 && y >= 0 && z >= 0 && x < grid.nx && y < grid.ny && z < grid.nz;
  }

  function getVoxel(grid, x, y, z) {
    if (!inBounds(grid, x, y, z)) return 0;
    return grid.data[indexOf(grid, x, y, z)] ? 1 : 0;
  }

  function setVoxel(grid, x, y, z, value) {
    if (!inBounds(grid, x, y, z)) return false;
    grid.data[indexOf(grid, x, y, z)] = value ? 1 : 0;
    return true;
  }

  function countVoxels(grid) {
    assertGrid(grid);
    var total = 0;
    for (var i = 0; i < grid.data.length; i++) total += grid.data[i] ? 1 : 0;
    return total;
  }

  function countExposedFaces(grid, stopAfter) {
    assertGrid(grid);
    var faces = 0;
    for (var z = 0; z < grid.nz; z++) {
      for (var y = 0; y < grid.ny; y++) {
        for (var x = 0; x < grid.nx; x++) {
          if (!getVoxel(grid, x, y, z)) continue;
          if (!getVoxel(grid, x - 1, y, z)) faces++;
          if (!getVoxel(grid, x + 1, y, z)) faces++;
          if (!getVoxel(grid, x, y - 1, z)) faces++;
          if (!getVoxel(grid, x, y + 1, z)) faces++;
          if (!getVoxel(grid, x, y, z - 1)) faces++;
          if (!getVoxel(grid, x, y, z + 1)) faces++;
          if (stopAfter !== undefined && faces > stopAfter) return faces;
        }
      }
    }
    return faces;
  }

  /*
   * The naive baseline emits six quads for every solid voxel with no culling,
   * which is twelve triangles per cell. Face culling and greedy merging both
   * reduce that number.
   */
  function naiveTriangleCount(grid) {
    return countVoxels(grid) * 12;
  }

  function cellsForRange(grid, minMm, maxMm, axisIndex, inclusiveMax) {
    assertGeometry([minMm, maxMm]);
    var limit = axisIndex === 0 ? grid.nx : (axisIndex === 1 ? grid.ny : grid.nz);
    var lo = clamp(Math.ceil(minMm / grid.pitchMm - 0.5), 0, limit);
    var hi = clamp(inclusiveMax ? Math.floor(maxMm / grid.pitchMm - 0.5) + 1 :
      Math.ceil(maxMm / grid.pitchMm - 0.5), 0, limit);
    return [lo, hi];
  }

  function forEachBoxCell(grid, min, size, callback) {
    assertGeometry(min.concat(size));
    if (size.some(function (v) { return v < 0; })) throw new RangeError('box sizes must be nonnegative');
    var xr = cellsForRange(grid, min[0], min[0] + size[0], 0);
    var yr = cellsForRange(grid, min[1], min[1] + size[1], 1);
    var zr = cellsForRange(grid, min[2], min[2] + size[2], 2);
    for (var z = zr[0]; z < zr[1]; z++) {
      for (var y = yr[0]; y < yr[1]; y++) {
        for (var x = xr[0]; x < xr[1]; x++) callback(x, y, z);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* CSG primitives, all dimensions are millimetres                      */
  /* ------------------------------------------------------------------ */

  function addBox(grid, minX, minY, minZ, sizeX, sizeY, sizeZ) {
    assertGrid(grid);
    forEachBoxCell(grid, [minX, minY, minZ], [sizeX, sizeY, sizeZ], function (x, y, z) {
      setVoxel(grid, x, y, z, 1);
    });
    return grid;
  }

  function subtractBox(grid, minX, minY, minZ, sizeX, sizeY, sizeZ) {
    assertGrid(grid);
    forEachBoxCell(grid, [minX, minY, minZ], [sizeX, sizeY, sizeZ], function (x, y, z) {
      setVoxel(grid, x, y, z, 0);
    });
    return grid;
  }

  function addSphere(grid, cx, cy, cz, radius) {
    return applySphere(grid, cx, cy, cz, radius, 1);
  }

  function subtractSphere(grid, cx, cy, cz, radius) {
    return applySphere(grid, cx, cy, cz, radius, 0);
  }

  function applySphere(grid, cx, cy, cz, radius, value) {
    assertGrid(grid);
    assertGeometry([cx, cy, cz]);
    assertPositive(radius, 'radius');
    var pitch = grid.pitchMm;
    var xr = cellsForRange(grid, cx - radius, cx + radius, 0, true);
    var yr = cellsForRange(grid, cy - radius, cy + radius, 1, true);
    var zr = cellsForRange(grid, cz - radius, cz + radius, 2, true);
    for (var z = zr[0]; z < zr[1]; z++) {
      var dz = (z + 0.5) * pitch - cz;
      for (var y = yr[0]; y < yr[1]; y++) {
        var dy = (y + 0.5) * pitch - cy;
        for (var x = xr[0]; x < xr[1]; x++) {
          var dx = (x + 0.5) * pitch - cx;
          if (Math.hypot(dx, dy, dz) <= radius) setVoxel(grid, x, y, z, value);
        }
      }
    }
    return grid;
  }

  function addCylinder(grid, cx, cy, cz, radius, height, axis) {
    return applyCylinder(grid, cx, cy, cz, radius, height, axis, 1);
  }

  function subtractCylinder(grid, cx, cy, cz, radius, height, axis) {
    return applyCylinder(grid, cx, cy, cz, radius, height, axis, 0);
  }

  function applyCylinder(grid, cx, cy, cz, radius, height, axis, value) {
    assertGrid(grid);
    assertGeometry([cx, cy, cz]);
    assertPositive(radius, 'radius');
    assertPositive(height, 'height');
    var a = normalizeAxis(axis);
    var pitch = grid.pitchMm;
    var center = [cx, cy, cz];
    var base = center[a];
    var u = (a + 1) % 3;
    var v = (a + 2) % 3;
    var ar = cellsForRange(grid, base, base + height, a);
    var ur = cellsForRange(grid, center[u] - radius, center[u] + radius, u, true);
    var vr = cellsForRange(grid, center[v] - radius, center[v] + radius, v, true);
    var cell = [0, 0, 0];
    for (var axisCell = ar[0]; axisCell < ar[1]; axisCell++) {
      var ac = (axisCell + 0.5) * pitch;
      if (ac < base || ac >= base + height) continue;
      for (var ui = ur[0]; ui < ur[1]; ui++) {
        var du = (ui + 0.5) * pitch - center[u];
        for (var vi = vr[0]; vi < vr[1]; vi++) {
          var dv = (vi + 0.5) * pitch - center[v];
          if (Math.hypot(du, dv) <= radius) {
            cell[a] = axisCell; cell[u] = ui; cell[v] = vi;
            setVoxel(grid, cell[0], cell[1], cell[2], value);
          }
        }
      }
    }
    return grid;
  }

  function normalizeAxis(axis) {
    if (axis === undefined || axis === null || axis === 'z' || axis === 'Z' || axis === 2) return 2;
    if (axis === 'x' || axis === 'X' || axis === 0) return 0;
    if (axis === 'y' || axis === 'Y' || axis === 1) return 1;
    throw new RangeError('axis must be x, y, or z');
  }

  function normalizeMirrorAxis(axis) {
    if (typeof axis === 'string') {
      var lower = axis.toLowerCase();
      if (lower === 'x' || lower === 'y' || lower === 'z') return lower;
    }
    if (axis === 0) return 'x';
    if (axis === 1) return 'y';
    if (axis === 2) return 'z';
    if (axis === undefined) return 'x';
    throw new RangeError('mirror axis must be x, y, or z');
  }

  function mirrorGrid(grid, axis) {
    assertGrid(grid);
    var which = normalizeMirrorAxis(axis);
    var source = cloneGrid(grid);
    var nx = source.nx, ny = source.ny, nz = source.nz;
    for (var z = 0; z < nz; z++) {
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          var sx = which === 'x' ? nx - 1 - x : x;
          var sy = which === 'y' ? ny - 1 - y : y;
          var sz = which === 'z' ? nz - 1 - z : z;
          grid.data[indexOf(grid, x, y, z)] = source.data[indexOf(source, sx, sy, sz)];
        }
      }
    }
    return grid;
  }

  /*
   * shellGrid keeps a wall of the requested thickness around every solid
   * region. Solid cells that survive k rounds of six neighbour erosion are
   * interior cells, so the shell is the original set minus that eroded core.
   * Exterior air outside the grid counts as empty during erosion.
   */
  function shellGrid(grid, wallThicknessMm) {
    assertGrid(grid);
    assertPositive(wallThicknessMm, 'wall thickness');
    var k = Math.min(Math.ceil(wallThicknessMm / grid.pitchMm), Math.ceil(Math.min(grid.nx, grid.ny, grid.nz) / 2));
    var current = new Uint8Array(grid.data);
    var nx = grid.nx, ny = grid.ny, nz = grid.nz;
    var original = grid.data;
    var next = null;
    for (var round = 0; round < k; round++) {
      next = new Uint8Array(current.length);
      for (var z = 0; z < nz; z++) {
        for (var y = 0; y < ny; y++) {
          for (var x = 0; x < nx; x++) {
            var i = x + nx * (y + ny * z);
            if (!current[i]) continue;
            var exposed = x === 0 || y === 0 || z === 0 ||
              x === nx - 1 || y === ny - 1 || z === nz - 1 ||
              !current[i - 1] || !current[i + 1] ||
              !current[i - nx] || !current[i + nx] ||
              !current[i - nx * ny] || !current[i + nx * ny];
            next[i] = exposed ? 0 : 1;
          }
        }
      }
      current = next;
    }
    for (var p = 0; p < original.length; p++) {
      original[p] = original[p] && !current[p] ? 1 : 0;
    }
    return grid;
  }

  function unionGrid(target, source) {
    assertGrid(target); assertGrid(source);
    if (target.pitchMm !== source.pitchMm) throw new RangeError('boolean grids must have matching pitch');
    var nx = Math.min(target.nx, source.nx);
    var ny = Math.min(target.ny, source.ny);
    var nz = Math.min(target.nz, source.nz);
    for (var z = 0; z < nz; z++) {
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          if (getVoxel(source, x, y, z)) setVoxel(target, x, y, z, 1);
        }
      }
    }
    return target;
  }

  function subtractGrid(target, source) {
    assertGrid(target); assertGrid(source);
    if (target.pitchMm !== source.pitchMm) throw new RangeError('boolean grids must have matching pitch');
    var nx = Math.min(target.nx, source.nx);
    var ny = Math.min(target.ny, source.ny);
    var nz = Math.min(target.nz, source.nz);
    for (var z = 0; z < nz; z++) {
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          if (getVoxel(source, x, y, z)) setVoxel(target, x, y, z, 0);
        }
      }
    }
    return target;
  }

  /*
   * Runs an edit on the grid, then propagates every changed cell to its
   * mirrored position on the chosen axis. Mirroring the delta (not the
   * whole occupancy) keeps subtract operations symmetric too.
   */
  function applySymmetricEdit(grid, axis, edit) {
    assertGrid(grid);
    var which = normalizeMirrorAxis(axis);
    if (typeof edit !== 'function') throw new TypeError('symmetric edit requires a function');
    var before = new Uint8Array(grid.data);
    edit(grid);
    var nx = grid.nx, ny = grid.ny, nz = grid.nz;
    for (var z = 0; z < nz; z++) {
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          var i = x + nx * (y + ny * z);
          if (grid.data[i] === before[i]) continue;
          var mx = which === 'x' ? nx - 1 - x : x;
          var my = which === 'y' ? ny - 1 - y : y;
          var mz = which === 'z' ? nz - 1 - z : z;
          grid.data[mx + nx * (my + ny * mz)] = grid.data[i];
        }
      }
    }
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /* Greedy face culling                                                  */
  /* ------------------------------------------------------------------ */

  function axisSize(grid, axis) {
    return axis === 0 ? grid.nx : (axis === 1 ? grid.ny : grid.nz);
  }

  function greedyRectangles(mask, nU, nV) {
    var used = new Uint8Array(nU * nV);
    var rects = [];
    for (var q0 = 0; q0 < nV; q0++) {
      for (var p0 = 0; p0 < nU; p0++) {
        if (!mask[p0 + nU * q0] || used[p0 + nU * q0]) continue;
        var w = 1;
        while (p0 + w < nU && mask[p0 + w + nU * q0] && !used[p0 + w + nU * q0]) w++;
        var h = 1;
        var blocked = false;
        while (q0 + h < nV && !blocked) {
          for (var k = 0; k < w; k++) {
            if (!mask[p0 + k + nU * (q0 + h)] || used[p0 + k + nU * (q0 + h)]) {
              blocked = true;
              break;
            }
          }
          if (!blocked) h++;
        }
        for (var yy = 0; yy < h; yy++) {
          for (var xx = 0; xx < w; xx++) used[p0 + xx + nU * (q0 + yy)] = 1;
        }
        rects.push([p0, q0, w, h]);
      }
    }
    return rects;
  }

  function makeQuad(a, s, i, p0, q0, w, h) {
    var u = (a + 1) % 3;
    var v = (a + 2) % 3;
    var c = s === -1 ? i : i + 1;
    var pt = function (p, q) {
      var out = [0, 0, 0];
      out[a] = c;
      out[u] = p;
      out[v] = q;
      return out;
    };
    var points = s === 1
      ? [pt(p0, q0), pt(p0 + w, q0), pt(p0 + w, q0 + h), pt(p0, q0 + h)]
      : [pt(p0, q0), pt(p0, q0 + h), pt(p0 + w, q0 + h), pt(p0 + w, q0)];
    var normal = [0, 0, 0];
    normal[a] = s;
    return { axis: a, sign: s, coord: c, points: points, normal: normal, w: w, h: h };
  }

  /*
   * One mask per (axis, sign, slice). A mask cell is set when a solid voxel
   * borders air in that direction. Maximal rectangles are grown first along
   * u, then along v. Every rectangle is emitted as a single quad.
   */
  function buildQuads(grid) {
    assertGrid(grid);
    var quads = [];
    for (var a = 0; a < 3; a++) {
      var u = (a + 1) % 3;
      var v = (a + 2) % 3;
      var nA = axisSize(grid, a);
      var nU = axisSize(grid, u);
      var nV = axisSize(grid, v);
      for (var s = -1; s <= 1; s += 2) {
        for (var i = 0; i < nA; i++) {
          var mask = new Uint8Array(nU * nV);
          var any = false;
          var cell = [0, 0, 0];
          var neighbour = [0, 0, 0];
          cell[a] = i;
          for (var q = 0; q < nV; q++) {
            for (var p = 0; p < nU; p++) {
              cell[u] = p; cell[v] = q;
              if (!getVoxel(grid, cell[0], cell[1], cell[2])) continue;
              neighbour[0] = cell[0]; neighbour[1] = cell[1]; neighbour[2] = cell[2];
              neighbour[a] = i + s;
              if (getVoxel(grid, neighbour[0], neighbour[1], neighbour[2])) continue;
              mask[p + nU * q] = 1;
              any = true;
            }
          }
          if (!any) continue;
          var rects = greedyRectangles(mask, nU, nV);
          for (var ri = 0; ri < rects.length; ri++) {
            var rect = rects[ri];
            quads.push(makeQuad(a, s, i, rect[0], rect[1], rect[2], rect[3]));
          }
        }
      }
    }
    return quads;
  }

  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function length3(a) { return Math.sqrt(dot3(a, a)); }

  function pointKey(p) { return p[0] + ',' + p[1] + ',' + p[2]; }

  function assertMesh(mesh) {
    if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles) ||
        !Array.isArray(mesh.normals) || mesh.normals.length !== mesh.triangles.length) {
      throw new TypeError('expected vertices, triangles and one normal per triangle');
    }
    mesh.vertices.forEach(function (v) {
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError('invalid mesh vertex');
    });
    mesh.triangles.forEach(function (tri, i) {
      if (!Array.isArray(tri) || tri.length !== 3 || !tri.every(function (id) {
        return Number.isInteger(id) && id >= 0 && id < mesh.vertices.length;
      }) || new Set(tri).size !== 3) throw new TypeError('invalid triangle indices');
      var a = mesh.vertices[tri[0]], b = mesh.vertices[tri[1]], c = mesh.vertices[tri[2]];
      var cross = cross3(sub3(b, a), sub3(c, a));
      var normal = mesh.normals[i];
      if (!Number.isFinite(length3(cross)) || length3(cross) <= 0) throw new TypeError('degenerate triangle');
      if (!Array.isArray(normal) || normal.length !== 3 || !normal.every(Number.isFinite) ||
          Math.abs(length3(normal) - 1) > 1e-5 || dot3(normal, cross) <= 0) {
        throw new TypeError('facet normal must be an outward unit vector');
      }
    });
  }

  /* A manifold requires two oriented incidences per edge and a single cycle
   * in every vertex link. Edge pairs alone miss both edge and point contacts. */
  function analyzeMesh(mesh) {
    assertMesh(mesh);
    var vertices = mesh.vertices, triangles = mesh.triangles;
    var edges = new Map(), links = new Map(), faceKeys = new Map(), duplicateTriangles = 0;
    var parent = triangles.map(function (_, i) { return i; });
    function find(i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    }
    function join(a, b) { parent[find(a)] = find(b); }
    var area = 0, volume = 0, correction = 0;
    var reference = triangles.length ? vertices[triangles[0][0]] : [0, 0, 0];
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    triangles.forEach(function (ids, t) {
      var a = vertices[ids[0]], b = vertices[ids[1]], c = vertices[ids[2]];
      /* Coincident faces: the same unordered vertex triple appearing twice
       * is a doubled sheet, not a thicker wall. */
      var faceKey = [pointKey(a), pointKey(b), pointKey(c)].sort().join('|');
      if (faceKeys.has(faceKey)) duplicateTriangles++;
      else faceKeys.set(faceKey, true);
      area += length3(cross3(sub3(b, a), sub3(c, a))) / 2;
      var term = dot3(sub3(a, reference), cross3(sub3(b, reference), sub3(c, reference))) / 6 - correction;
      var sum = volume + term;
      correction = (sum - volume) - term;
      volume = sum;
      for (var e = 0; e < 3; e++) {
        var u = ids[e], v = ids[(e + 1) % 3], w = ids[(e + 2) % 3];
        var key = Math.min(u, v) + ':' + Math.max(u, v);
        var edge = edges.get(key);
        if (!edge) { edge = { count: 0, balance: 0, triangle: t }; edges.set(key, edge); }
        else join(t, edge.triangle);
        edge.count++;
        edge.balance += u < v ? 1 : -1;
        if (!links.has(u)) links.set(u, []);
        links.get(u).push([v, w]);
        for (var d = 0; d < 3; d++) {
          lo[d] = Math.min(lo[d], vertices[u][d]);
          hi[d] = Math.max(hi[d], vertices[u][d]);
        }
      }
    });
    if (!triangles.length) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
    var boundary = 0, nonManifoldEdges = 0, windingErrors = 0, unmatched = 0;
    edges.forEach(function (edge) {
      if (edge.count === 1) boundary++;
      if (edge.count > 2) nonManifoldEdges++;
      if (edge.count === 2 && edge.balance !== 0) windingErrors++;
      if (edge.count !== 2 || edge.balance !== 0) unmatched += Math.max(1, Math.abs(edge.balance), edge.count - 2);
    });
    var nonManifoldVertices = 0;
    links.forEach(function (pairs) {
      var graph = new Map(), degree = new Map();
      pairs.forEach(function (pair) {
        for (var i = 0; i < 2; i++) {
          var u = pair[i], v = pair[1 - i];
          if (!graph.has(u)) graph.set(u, new Set());
          graph.get(u).add(v);
          degree.set(u, (degree.get(u) || 0) + 1);
        }
      });
      var start = graph.keys().next().value, seen = new Set([start]), stack = [start];
      while (stack.length) graph.get(stack.pop()).forEach(function (id) {
        if (!seen.has(id)) { seen.add(id); stack.push(id); }
      });
      if (seen.size !== graph.size || Array.from(degree.values()).some(function (n) { return n !== 2; })) nonManifoldVertices++;
    });
    var components = new Set(triangles.map(function (_, i) { return find(i); })).size;
    var chi = links.size - edges.size + triangles.length;
    var manifold = triangles.length > 0 && unmatched === 0 && nonManifoldVertices === 0 && duplicateTriangles === 0;
    return {
      triangleCount: triangles.length,
      uniqueVertices: links.size,
      uniqueEdges: edges.size,
      surfaceAreaMm2: area,
      volumeMm3: volume,
      volumeCm3: volume / 1000,
      boundingBoxMm: { min: lo, max: hi, size: hi.map(function (n, i) { return n - lo[i]; }) },
      eulerCharacteristic: chi,
      surfaceComponents: components,
      genusEstimate: manifold ? (2 * components - chi) / 2 : null,
      watertight: manifold,
      boundaryEdges: boundary,
      nonManifoldEdges: nonManifoldEdges,
      nonManifoldVertices: nonManifoldVertices,
      windingErrors: windingErrors,
      unmatchedEdges: unmatched,
      duplicateTriangles: duplicateTriangles
    };
  }

  /*
   * Coplanar greedy quads are overlaid on a shared integer lattice. A quad
   * covers a rectangle of unit face cells, and every covered unit cell emits
   * exactly two triangles. All surface vertices are lattice coordinates, so
   * two adjacent quads always describe identical boundaries. This yields a
   * consistent surface triangulation without T junctions. Occupancy point and
   * edge contacts still require the separate incidence and link verifier.
   */
  function quadUnitTriangles(quad) {
    var tris = [];
    var u = (quad.axis + 1) % 3;
    var v = (quad.axis + 2) % 3;
    var p = quad.points[0];
    var u0 = p[u], v0 = p[v];
    for (var du = 0; du < quad.w; du++) {
      for (var dv = 0; dv < quad.h; dv++) {
        var corner = function (iu, iv) {
          var out = [0, 0, 0];
          out[quad.axis] = quad.coord;
          out[u] = u0 + iu;
          out[v] = v0 + iv;
          return out;
        };
        var a = corner(du, dv);
        var b = corner(du + 1, dv);
        var c = corner(du + 1, dv + 1);
        var d = corner(du, dv + 1);
        if (quad.sign === 1) tris.push([a, b, c], [a, c, d]);
        else tris.push([a, d, c], [a, c, b]);
      }
    }
    return tris;
  }

  function buildMeshStats(mesh, grid, quadCount) {
    var topology = analyzeMesh(mesh);
    var triangles = mesh.triangles;
    var volumeCm3 = topology.volumeCm3;
    var infill = mesh.infillPercent;
    mesh.stats = Object.assign(topology, {
      voxelCount: countVoxels(grid),
      exposedFaceCount: countExposedFaces(grid),
      naiveTriangleCount: naiveTriangleCount(grid),
      quadCount: quadCount,
      triangleCount: triangles.length,
      mergeRatio: triangles.length ? naiveTriangleCount(grid) / triangles.length : 0,
      infillPercent: infill,
      plaMassG: volumeCm3 * (infill / 100) * DEFAULT_PLA_DENSITY,
      petgMassG: volumeCm3 * (infill / 100) * DEFAULT_PETG_DENSITY,
      voxelVolumeMm3: countVoxels(grid) * Math.pow(grid.pitchMm, 3),
      volumeErrorMm3: Math.abs(topology.volumeMm3 - countVoxels(grid) * Math.pow(grid.pitchMm, 3))
    });
    return mesh;
  }

  function extractManifoldMesh(grid, options) {
    assertGrid(grid);
    if (countExposedFaces(grid, MAX_MESH_TRIANGLES / 2) * 2 > MAX_MESH_TRIANGLES) throw new RangeError('Surface exceeds the ' + MAX_MESH_TRIANGLES + ' triangle budget. Simplify the occupancy or use a coarser lattice.');
    var opts = options || {};
    if (opts.infillPercent !== undefined) assertFinite(opts.infillPercent, 'infill');
    var pitch = grid.pitchMm;
    var quads = buildQuads(grid);
    var i, d;

    var mesh = {
      vertices: [],
      triangles: [],
      normals: [],
      vertexKeys: [],
      pitchMm: pitch,
      gridSize: [grid.nx, grid.ny, grid.nz],
      infillPercent: opts.infillPercent === undefined ? 100 : clamp(opts.infillPercent, 0, 100)
    };
    var vertexIndex = new Map();
    var lookup = function (p) {
      var key = pointKey(p);
      if (vertexIndex.has(key)) return vertexIndex.get(key);
      var id = mesh.vertices.length;
      vertexIndex.set(key, id);
      mesh.vertexKeys.push(key);
      mesh.vertices.push([p[0] * pitch, p[1] * pitch, p[2] * pitch]);
      return id;
    };

    for (i = 0; i < quads.length; i++) {
      var quad = quads[i];
      var tris = quadUnitTriangles(quad);
      for (var t = 0; t < tris.length; t++) {
        var ids = [lookup(tris[t][0]), lookup(tris[t][1]), lookup(tris[t][2])];
        if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
        mesh.triangles.push(ids);
        mesh.normals.push(quad.normal.slice());
      }
    }

    /* Defensive: a closed surface must have outward winding and positive volume. */
    var probe = 0;
    var reference = mesh.triangles.length ? mesh.vertices[mesh.triangles[0][0]] : [0, 0, 0];
    for (i = 0; i < mesh.triangles.length; i++) {
      var v0 = mesh.vertices[mesh.triangles[i][0]];
      var v1 = mesh.vertices[mesh.triangles[i][1]];
      var v2 = mesh.vertices[mesh.triangles[i][2]];
      probe += dot3(sub3(v0, reference), cross3(sub3(v1, reference), sub3(v2, reference))) / 6;
    }
    if (probe < 0) {
      for (i = 0; i < mesh.triangles.length; i++) {
        mesh.triangles[i].reverse();
        mesh.normals[i] = mesh.normals[i].map(function (n) { return -n; });
      }
    }
    return buildMeshStats(mesh, grid, quads.length);
  }

  /*
   * Occupancy-based printability report: downward faces that need support,
   * face-connected clusters that never reach the build plate, and cells
   * only one voxel thick along an axis. Returns indices of floating cells
   * so callers can highlight them.
   */
  function analyzePrintability(grid) {
    assertGrid(grid);
    var nx = grid.nx, ny = grid.ny, nz = grid.nz, p = grid.pitchMm;
    var layer = nx * ny, total = grid.data.length;

    var comp = new Int32Array(total).fill(-1);
    var queue = new Int32Array(total);
    var clusterCount = 0, floatingClusters = 0;
    var floatingCellIndices = [];
    var dirs = [1, -1, nx, -nx, layer, -layer];
    for (var start = 0; start < total; start++) {
      if (!grid.data[start] || comp[start] !== -1) continue;
      var members = [], touchesPlate = false, head = 0, tail = 0;
      queue[tail++] = start; comp[start] = clusterCount;
      while (head < tail) {
        var i = queue[head++];
        members.push(i);
        var x = i % nx, rest = (i - x) / nx, y = rest % ny, z = (rest - y) / ny;
        if (z === 0) touchesPlate = true;
        for (var d = 0; d < 6; d++) {
          var nb = i + dirs[d];
          if (nb < 0 || nb >= total || !grid.data[nb] || comp[nb] !== -1) continue;
          var nx2 = nb % nx, rest2 = (nb - nx2) / nx, ny2 = rest2 % ny;
          if (Math.abs(nx2 - x) + Math.abs(ny2 - y) + Math.abs((rest2 - ny2) / ny - z) !== 1) continue;
          comp[nb] = clusterCount; queue[tail++] = nb;
        }
      }
      clusterCount++;
      if (!touchesPlate) { floatingClusters++; floatingCellIndices.push.apply(floatingCellIndices, members); }
    }

    var overhangCells = 0, thinX = 0, thinY = 0, thinZ = 0, thinWallCells = 0;
    var overhangCellIndices = [], thinWallCellIndices = [];
    for (var z2 = 0; z2 < nz; z2++) {
      for (var y2 = 0; y2 < ny; y2++) {
        for (var x2 = 0; x2 < nx; x2++) {
          if (!getVoxel(grid, x2, y2, z2)) continue;
          var index2 = x2 + nx * (y2 + ny * z2);
          var below = getVoxel(grid, x2, y2, z2 - 1);
          if (z2 > 0 && !below) { overhangCells++; overhangCellIndices.push(index2); }
          var thinA = !getVoxel(grid, x2 - 1, y2, z2) && !getVoxel(grid, x2 + 1, y2, z2);
          var thinB = !getVoxel(grid, x2, y2 - 1, z2) && !getVoxel(grid, x2, y2 + 1, z2);
          var thinC = !below && !getVoxel(grid, x2, y2, z2 + 1);
          if (thinA) thinX++;
          if (thinB) thinY++;
          if (thinC) thinZ++;
          if (thinA || thinB || thinC) { thinWallCells++; thinWallCellIndices.push(index2); }
        }
      }
    }

    return {
      printable: floatingClusters === 0,
      solidComponents: clusterCount,
      overhangCells: overhangCells,
      overhangAreaMm2: overhangCells * p * p,
      overhangCellIndices: overhangCellIndices,
      floatingClusters: floatingClusters,
      floatingCells: floatingCellIndices.length,
      floatingCellIndices: floatingCellIndices,
      thinWallCells: thinWallCells,
      thinWallCellIndices: thinWallCellIndices,
      thinX: thinX,
      thinY: thinY,
      thinZ: thinZ,
      minFeatureMm: p
    };
  }

  function estimateMass(mesh, options) {
    if (!mesh || !mesh.stats || !Number.isFinite(mesh.stats.volumeCm3) || mesh.stats.volumeCm3 < 0) throw new TypeError('mass estimate requires a finite nonnegative mesh volume');
    var opts = options || {};
    var density = opts.density;
    if (density === undefined) {
      var material = String(opts.material || 'PLA').toLowerCase();
      density = material === 'petg' ? DEFAULT_PETG_DENSITY : DEFAULT_PLA_DENSITY;
    }
    assertPositive(density, 'material density');
    var materialName = String(opts.material || 'PLA').toLowerCase();
    if (opts.density === undefined && materialName !== 'pla' && materialName !== 'petg') throw new RangeError('unknown material');
    var infill = opts.infillPercent === undefined ? (mesh.infillPercent === undefined ? 100 : mesh.infillPercent) : opts.infillPercent;
    assertFinite(infill, 'infill');
    infill = clamp(infill, 0, 100);
    var volumeCm3 = mesh.stats ? mesh.stats.volumeCm3 : 0;
    var grams = volumeCm3 * (infill / 100) * density;
    assertFinite(grams, 'estimated mass');
    return {
      material: opts.material || 'PLA',
      infillPercent: infill,
      densityGPerCm3: density,
      grams: grams
    };
  }

  /* ------------------------------------------------------------------ */
  /* Exporters                                                           */
  /* ------------------------------------------------------------------ */

  function solidName(name) {
    var raw = String(name === undefined || name === '' ? 'voxelsynth' : name);
    var clean = raw.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return clean || 'voxelsynth';
  }

  function fmt(v) {
    assertFinite(v, 'export coordinate');
    if (v === 0) return '0.000000';
    var s = v.toString();
    return /^-?\d+$/.test(s) ? s + '.000000' : s;
  }

  function meshFacets(mesh) {
    assertMesh(mesh);
    var out = [];
    for (var i = 0; i < mesh.triangles.length; i++) {
      var ids = mesh.triangles[i];
      out.push({
        normal: mesh.normals[i],
        vertices: [mesh.vertices[ids[0]], mesh.vertices[ids[1]], mesh.vertices[ids[2]]]
      });
    }
    return out;
  }

  function exportAsciiSTL(mesh, name) {
    var label = solidName(name);
    var lines = ['solid ' + label];
    var facets = meshFacets(mesh);
    for (var i = 0; i < facets.length; i++) {
      var f = facets[i];
      lines.push('  facet normal ' + fmt(f.normal[0]) + ' ' + fmt(f.normal[1]) + ' ' + fmt(f.normal[2]));
      lines.push('    outer loop');
      for (var j = 0; j < 3; j++) {
        var v = f.vertices[j];
        lines.push('      vertex ' + fmt(v[0]) + ' ' + fmt(v[1]) + ' ' + fmt(v[2]));
      }
      lines.push('    endloop');
      lines.push('  endfacet');
    }
    lines.push('endsolid ' + label);
    return lines.join('\n') + '\n';
  }

  function exportBinarySTL(mesh, name) {
    var facets = meshFacets(mesh);
    var count = facets.length;
    var buffer = new ArrayBuffer(84 + 50 * count);
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var header = 'VoxelSynth binary STL: ' + solidName(name);
    for (var h = 0; h < 80; h++) {
      bytes[h] = h < header.length ? (header.charCodeAt(h) & 0xff) : 0;
    }
    view.setUint32(80, count, true);
    var off = 84;
    for (var i = 0; i < count; i++) {
      var f = facets[i];
      var rounded = f.vertices.map(function (point) { return point.map(Math.fround); });
      if (rounded.some(function (point) { return !point.every(Number.isFinite); }) ||
          dot3(f.normal, cross3(sub3(rounded[1], rounded[0]), sub3(rounded[2], rounded[0]))) <= 0) {
        throw new RangeError('binary STL float32 precision would collapse a facet; use ASCII STL or OBJ');
      }
      view.setFloat32(off, f.normal[0], true);
      view.setFloat32(off + 4, f.normal[1], true);
      view.setFloat32(off + 8, f.normal[2], true);
      for (var j = 0; j < 3; j++) {
        view.setFloat32(off + 12 + j * 12, f.vertices[j][0], true);
        view.setFloat32(off + 16 + j * 12, f.vertices[j][1], true);
        view.setFloat32(off + 20 + j * 12, f.vertices[j][2], true);
      }
      view.setUint16(off + 48, 0, true);
      off += 50;
    }
    return bytes;
  }

  function exportOBJ(mesh, name) {
    assertMesh(mesh);
    var label = solidName(name);
    var lines = [
      '# VoxelSynth wavefront OBJ',
      '# object: ' + label,
      '# triangles: ' + mesh.triangles.length,
      'o ' + label
    ];
    var i;
    for (i = 0; i < mesh.vertices.length; i++) {
      var v = mesh.vertices[i];
      lines.push('v ' + fmt(v[0]) + ' ' + fmt(v[1]) + ' ' + fmt(v[2]));
    }
    for (i = 0; i < mesh.normals.length; i++) {
      var n = mesh.normals[i];
      lines.push('vn ' + fmt(n[0]) + ' ' + fmt(n[1]) + ' ' + fmt(n[2]));
    }
    for (i = 0; i < mesh.triangles.length; i++) {
      var ids = mesh.triangles[i];
      var ni = i + 1;
      lines.push('f ' + (ids[0] + 1) + '//' + ni + ' ' + (ids[1] + 1) + '//' + ni + ' ' + (ids[2] + 1) + '//' + ni);
    }
    return lines.join('\n') + '\n';
  }

  /*
   * Binary little endian PLY 1.0: an ASCII header declares the vertex and
   * face elements, then float32 positions and uchar-listed int32 indices
   * follow. Same float32 collapse guard as the binary STL writer.
   */
  function exportPLY(mesh, name) {
    assertMesh(mesh);
    var label = solidName(name);
    var header = [
      'ply',
      'format binary_little_endian 1.0',
      'comment VoxelSynth export',
      'comment object: ' + label,
      'element vertex ' + mesh.vertices.length,
      'property float x',
      'property float y',
      'property float z',
      'element face ' + mesh.triangles.length,
      'property list uchar int vertex_indices',
      'end_header',
      ''
    ].join('\n');
    var headerBytes = new Uint8Array(header.length);
    for (var h = 0; h < header.length; h++) headerBytes[h] = header.charCodeAt(h) & 0x7f;
    var bytes = new Uint8Array(headerBytes.length + mesh.vertices.length * 12 + mesh.triangles.length * 13);
    bytes.set(headerBytes, 0);
    var view = new DataView(bytes.buffer);
    var off = headerBytes.length;
    for (var i = 0; i < mesh.vertices.length; i++) {
      var v = mesh.vertices[i];
      view.setFloat32(off, v[0], true);
      view.setFloat32(off + 4, v[1], true);
      view.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    for (var t = 0; t < mesh.triangles.length; t++) {
      var ids = mesh.triangles[t];
      var a = mesh.vertices[ids[0]], b = mesh.vertices[ids[1]], c = mesh.vertices[ids[2]];
      var rounded = [a, b, c].map(function (point) { return point.map(Math.fround); });
      if (rounded.some(function (point) { return !point.every(Number.isFinite); }) ||
          dot3(mesh.normals[t], cross3(sub3(rounded[1], rounded[0]), sub3(rounded[2], rounded[0]))) <= 0) {
        throw new RangeError('binary PLY float32 precision would collapse a facet; use ASCII STL or OBJ');
      }
      bytes[off] = 3;
      view.setInt32(off + 1, ids[0], true);
      view.setInt32(off + 5, ids[1], true);
      view.setInt32(off + 9, ids[2], true);
      off += 13;
    }
    return bytes;
  }

  function layerRectangles(grid, z) {
    var nx = grid.nx, ny = grid.ny;
    var mask = new Uint8Array(nx * ny);
    for (var y = 0; y < ny; y++) {
      for (var x = 0; x < nx; x++) {
        if (getVoxel(grid, x, y, z)) mask[x + nx * y] = 1;
      }
    }
    return greedyRectangles(mask, nx, ny);
  }

  function exportOpenSCAD(grid, pitchMm) {
    assertGrid(grid);
    var p = pitchMm === undefined ? grid.pitchMm : pitchMm;
    assertPositive(p, 'export pitch');
    if (p < 1e-6 || p > 1e6) throw new RangeError('export pitch must be between 0.000001 and 1000000');
    var boxes = [];
    var active = new Map();
    for (var z = 0; z <= grid.nz; z++) {
      var rects = z < grid.nz ? layerRectangles(grid, z) : [];
      var keys = new Set(rects.map(function (r) { return r.join(','); }));
      Array.from(active.entries()).forEach(function (entry) {
        if (keys.has(entry[0])) return;
        var parts = entry[0].split(',').map(Number);
        boxes.push({ x: parts[0], y: parts[1], w: parts[2], h: parts[3], z0: entry[1], z1: z });
        active.delete(entry[0]);
      });
      for (var r = 0; r < rects.length; r++) {
        var key = rects[r].join(',');
        if (!active.has(key)) active.set(key, z);
      }
    }
    var lines = [
      '// VoxelSynth OpenSCAD export',
      '// Grid: ' + grid.nx + ' x ' + grid.ny + ' x ' + grid.nz,
      '// Solid cells: ' + countVoxels(grid),
      '// Merged boxes: ' + boxes.length,
      '$fn = 24;',
      'pitch = ' + fmt(p) + ';',
      'module voxelsynth_body() {',
      '  union() {'
    ];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      lines.push('    translate([' + fmt(b.x * p) + ', ' + fmt(b.y * p) + ', ' + fmt(b.z0 * p) + ']) ' +
        'cube([' + fmt(b.w * p) + ', ' + fmt(b.h * p) + ', ' + fmt((b.z1 - b.z0) * p) + '], center = false);');
    }
    lines.push('  }');
    lines.push('}');
    lines.push('voxelsynth_body();');
    return lines.join('\n') + '\n';
  }

  /*
   * MagicaVoxel .vox: 'VOX ' magic + version 150, one MAIN chunk whose
   * children are SIZE (lattice dims), XYZI (solid cells, palette index 1)
   * and RGBA (256-colour palette). At most 256 cells per axis per the spec.
   */
  var VOX_MAX_AXIS = 256;
  var VOX_PALETTE_INDEX = 1;

  function voxChunk(id, content) {
    var out = new Uint8Array(12 + content.length);
    for (var i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
    var view = new DataView(out.buffer);
    view.setUint32(4, content.length, true);
    view.setUint32(8, 0, true);
    out.set(content, 12);
    return out;
  }

  function exportVOX(grid) {
    assertGrid(grid);
    if (grid.nx > VOX_MAX_AXIS || grid.ny > VOX_MAX_AXIS || grid.nz > VOX_MAX_AXIS) {
      throw new RangeError('vox export supports at most ' + VOX_MAX_AXIS + ' cells per axis');
    }
    var count = countVoxels(grid);
    var size = new Uint8Array(12);
    var sv = new DataView(size.buffer);
    sv.setUint32(0, grid.nx, true); sv.setUint32(4, grid.ny, true); sv.setUint32(8, grid.nz, true);
    var xyzi = new Uint8Array(4 + count * 4);
    var xv = new DataView(xyzi.buffer);
    xv.setUint32(0, count, true);
    var at = 4;
    for (var z = 0; z < grid.nz; z++) {
      for (var y = 0; y < grid.ny; y++) {
        for (var x = 0; x < grid.nx; x++) {
          if (!getVoxel(grid, x, y, z)) continue;
          xyzi[at] = x; xyzi[at + 1] = y; xyzi[at + 2] = z; xyzi[at + 3] = VOX_PALETTE_INDEX;
          at += 4;
        }
      }
    }
    var palette = new Uint8Array(1024);
    for (var c = 0; c < 256; c++) {
      var tone = c === 0 ? 0 : Math.round(80 + (c / 255) * 160);
      palette[c * 4] = c === VOX_PALETTE_INDEX ? 0x84 : tone;
      palette[c * 4 + 1] = c === VOX_PALETTE_INDEX ? 0x9c : tone;
      palette[c * 4 + 2] = c === VOX_PALETTE_INDEX ? 0xb0 : tone;
      palette[c * 4 + 3] = 255;
    }
    var children = [voxChunk('SIZE', size), voxChunk('XYZI', xyzi), voxChunk('RGBA', palette)];
    var childLen = children.reduce(function (sum, part) { return sum + part.length; }, 0);
    var total = 8 + 12 + childLen;
    var out = new Uint8Array(total);
    out[0] = 0x56; out[1] = 0x4f; out[2] = 0x58; out[3] = 0x20;
    var view = new DataView(out.buffer);
    view.setUint32(4, 150, true);
    var pos = 8;
    for (var j = 0; j < 4; j++) out[pos + j] = 'MAIN'.charCodeAt(j);
    view.setUint32(pos + 4, 0, true);
    view.setUint32(pos + 8, childLen, true);
    pos += 12;
    children.forEach(function (part) { out.set(part, pos); pos += part.length; });
    return out;
  }

  function numericVector(text) {
    var values = text.trim().split(/\s+/).map(function (part) {
      if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?$/.test(part)) throw new TypeError('invalid numeric token');
      return Number(part);
    });
    if (values.length !== 3 || !values.every(Number.isFinite)) throw new TypeError('expected three finite coordinates');
    return values;
  }

  function facetBuilder() {
    var mesh = { vertices: [], triangles: [], normals: [] }, lookup = new Map();
    return {
      mesh: mesh,
      add: function (normal, points) {
        var ids = points.map(function (point) {
          var key = pointKey(point);
          if (!lookup.has(key)) { lookup.set(key, mesh.vertices.length); mesh.vertices.push(point); }
          return lookup.get(key);
        });
        mesh.triangles.push(ids);
        mesh.normals.push(normal);
      }
    };
  }

  /* These readers validate the standards-compliant subset written above.
   * They are independent of the mesh writer and never execute imported text. */
  function parseAsciiSTL(text) {
    if (typeof text !== 'string') throw new TypeError('ASCII STL must be text');
    var lines = text.trim().split(/\r?\n/).map(function (line) { return line.trim(); });
    if (!/^solid [A-Za-z0-9_.-]+$/.test(lines[0]) || lines[lines.length - 1] !== 'end' + lines[0]) {
      throw new TypeError('STL solid names must match');
    }
    var builder = facetBuilder();
    for (var i = 1; i < lines.length - 1; i += 7) {
      if (!lines[i].startsWith('facet normal ') || lines[i + 1] !== 'outer loop' ||
          lines[i + 5] !== 'endloop' || lines[i + 6] !== 'endfacet') throw new TypeError('incomplete STL facet');
      var points = [2, 3, 4].map(function (offset) {
        if (!lines[i + offset] || !lines[i + offset].startsWith('vertex ')) throw new TypeError('incomplete STL vertex');
        return numericVector(lines[i + offset].slice(7));
      });
      builder.add(numericVector(lines[i].slice(13)), points);
    }
    assertMesh(builder.mesh);
    return builder.mesh;
  }

  function parseBinarySTL(input) {
    var bytes = Object.prototype.toString.call(input) === '[object ArrayBuffer]' ? new Uint8Array(input) : input;
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object Uint8Array]' || bytes.byteLength < 84) {
      throw new TypeError('binary STL requires an 84 byte header');
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(80, true);
    if (bytes.byteLength !== 84 + count * 50) throw new TypeError('binary STL facet count does not match file length');
    var builder = facetBuilder();
    for (var i = 0; i < count; i++) {
      var offset = 84 + i * 50;
      function vector(at) { return [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]; }
      if (view.getUint16(offset + 48, true) !== 0) throw new TypeError('unsupported STL attribute bytes');
      builder.add(vector(offset), [vector(offset + 12), vector(offset + 24), vector(offset + 36)]);
    }
    assertMesh(builder.mesh);
    return builder.mesh;
  }

  function parseOBJ(text) {
    if (typeof text !== 'string') throw new TypeError('OBJ must be text');
    var mesh = { vertices: [], normals: [], triangles: [] }, normals = [], objects = 0;
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line[0] === '#') return;
      if (/^o [A-Za-z0-9_.-]+$/.test(line)) { objects++; return; }
      if (line.startsWith('v ')) { mesh.vertices.push(numericVector(line.slice(2))); return; }
      if (line.startsWith('vn ')) { normals.push(numericVector(line.slice(3))); return; }
      if (!line.startsWith('f ')) throw new TypeError('unsupported OBJ record');
      var tokens = line.slice(2).split(/\s+/);
      if (tokens.length !== 3 || !tokens.every(function (token) { return /^\d+\/\/\d+$/.test(token); })) throw new TypeError('OBJ face must contain three indexed vertices and normals');
      var ids = tokens.map(function (token) { return token.split('//').map(Number); });
      if (ids.some(function (pair) { return pair[1] !== ids[0][1]; }) || ids[0][1] < 1 || ids[0][1] > normals.length) throw new TypeError('invalid OBJ normal index');
      mesh.triangles.push(ids.map(function (pair) { return pair[0] - 1; }));
      mesh.normals.push(normals[ids[0][1] - 1]);
    });
    if (objects !== 1) throw new TypeError('OBJ must declare one object');
    assertMesh(mesh);
    return mesh;
  }

  /* Validates the binary little endian PLY 1.0 subset written above:
   * vertex elements are float x/y/z triples, faces are uchar-listed int32
   * triangle indices. Normals are rebuilt from winding. */
  function parsePLY(input) {
    var bytes = Object.prototype.toString.call(input) === '[object ArrayBuffer]' ? new Uint8Array(input) : input;
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object Uint8Array]') {
      throw new TypeError('PLY requires binary content');
    }
    var headEnd = -1;
    var marker = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10];
    for (var i = 0; i + marker.length <= bytes.length; i++) {
      var found = true;
      for (var m = 0; m < marker.length; m++) if (bytes[i + m] !== marker[m]) { found = false; break; }
      if (found) { headEnd = i + marker.length; break; }
    }
    if (headEnd < 0) throw new TypeError('PLY end_header is missing');
    var headerText = '';
    for (var b = 0; b < headEnd; b++) headerText += String.fromCharCode(bytes[b]);
    var lines = headerText.trim().split(/\r?\n/).map(function (line) { return line.trim(); });
    if (lines[0] !== 'ply' || lines[1] !== 'format binary_little_endian 1.0') {
      throw new TypeError('PLY must be binary_little_endian 1.0');
    }
    var vertexCount = -1, faceCount = -1, section = null;
    var vertexProps = [], faceProp = null;
    for (var l = 2; l < lines.length; l++) {
      var line = lines[l];
      if (line === 'end_header') break;
      if (line.startsWith('comment ')) continue;
      var el = /^element (vertex|face) (\d+)$/.exec(line);
      if (el) {
        section = el[1];
        if (section === 'vertex') { if (vertexCount !== -1) throw new TypeError('duplicate vertex element'); vertexCount = Number(el[2]); }
        else { if (faceCount !== -1) throw new TypeError('duplicate face element'); faceCount = Number(el[2]); }
        continue;
      }
      var prop = /^property (.+)$/.exec(line);
      if (prop) {
        if (section === 'vertex') vertexProps.push(prop[1]);
        else if (section === 'face') faceProp = prop[1];
        continue;
      }
      throw new TypeError('unsupported PLY header line: ' + line);
    }
    if (vertexCount < 0 || faceCount < 0) throw new TypeError('PLY must declare vertex and face elements');
    if (vertexProps.length !== 3 || vertexProps[0] !== 'float x' || vertexProps[1] !== 'float y' || vertexProps[2] !== 'float z') {
      throw new TypeError('PLY vertices must be float x/y/z');
    }
    if (faceProp !== 'list uchar int vertex_indices') throw new TypeError('PLY faces must be uchar-listed int32 vertex_indices');
    var expected = headEnd + vertexCount * 12 + faceCount * 13;
    if (bytes.length !== expected) throw new TypeError('PLY byte length does not match declared elements');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var mesh = { vertices: [], triangles: [], normals: [] };
    var off = headEnd;
    for (var vi = 0; vi < vertexCount; vi++) {
      mesh.vertices.push([view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true)]);
      off += 12;
    }
    for (var f = 0; f < faceCount; f++) {
      if (bytes[off] !== 3) throw new TypeError('PLY face must contain three vertices');
      var tri = [view.getInt32(off + 1, true), view.getInt32(off + 5, true), view.getInt32(off + 9, true)];
      off += 13;
      if (tri.some(function (id) { return id < 0 || id >= vertexCount; })) throw new TypeError('PLY face index out of range');
      var a = mesh.vertices[tri[0]], b2 = mesh.vertices[tri[1]], c = mesh.vertices[tri[2]];
      var cross = cross3(sub3(b2, a), sub3(c, a));
      var len = length3(cross);
      if (!Number.isFinite(len) || len === 0) throw new TypeError('PLY contains a degenerate face');
      mesh.triangles.push(tri);
      mesh.normals.push(cross.map(function (n) { return n / len; }));
    }
    assertMesh(mesh);
    return mesh;
  }

  /* Validates the single-model .vox subset written above: 'VOX ' + 150,
   * one MAIN chunk, exactly one SIZE and one XYZI child, optional RGBA.
   * Returns a pitch 1 grid. */
  function parseVOX(input) {
    var bytes = Object.prototype.toString.call(input) === '[object ArrayBuffer]' ? new Uint8Array(input) : input;
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object Uint8Array]' || bytes.length < 20) {
      throw new TypeError('VOX requires the magic header and a MAIN chunk');
    }
    if (bytes[0] !== 0x56 || bytes[1] !== 0x4f || bytes[2] !== 0x58 || bytes[3] !== 0x20) {
      throw new TypeError('VOX magic is missing');
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) !== 150) throw new TypeError('unsupported VOX version');
    var id = function (at) { return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]); };
    if (id(8) !== 'MAIN' || view.getUint32(12, true) !== 0) throw new TypeError('VOX must start with an empty MAIN chunk');
    var childrenEnd = 20 + view.getUint32(16, true);
    if (childrenEnd !== bytes.length) throw new TypeError('VOX children do not fill the file');
    var dims = null, declared = -1, seen = { SIZE: 0, XYZI: 0 };
    var cells = null;
    var pos = 20;
    while (pos < childrenEnd) {
      var name = id(pos), content = view.getUint32(pos + 4, true), children = view.getUint32(pos + 8, true);
      if (children !== 0 || pos + 12 + content > childrenEnd) throw new TypeError('VOX chunk sizes are inconsistent');
      var body = pos + 12;
      if (name === 'SIZE') {
        if (content !== 12 || seen.SIZE++) throw new TypeError('VOX SIZE must appear once with 12 bytes');
        dims = [view.getUint32(body, true), view.getUint32(body + 4, true), view.getUint32(body + 8, true)];
        if (!dims.every(function (n) { return n >= 1 && n <= VOX_MAX_AXIS; })) throw new TypeError('VOX dimensions out of range');
      } else if (name === 'XYZI') {
        if (seen.XYZI++ || content < 4 || (content - 4) % 4 !== 0) throw new TypeError('VOX XYZI must appear once with voxel records');
        declared = view.getUint32(body, true);
        if (declared !== (content - 4) / 4) throw new TypeError('VOX voxel count does not match content length');
        cells = body + 4;
      } else if (name === 'RGBA') {
        if (content !== 1024) throw new TypeError('VOX RGBA must hold 256 colours');
      } else {
        throw new TypeError('unsupported VOX chunk: ' + name);
      }
      pos = body + content;
    }
    if (!dims || cells === null) throw new TypeError('VOX needs SIZE and XYZI chunks');
    var grid = createGrid(dims[0], dims[1], dims[2], 1);
    for (var n = 0; n < declared; n++) {
      var x = bytes[cells + n * 4], y = bytes[cells + n * 4 + 1], z = bytes[cells + n * 4 + 2];
      if (x >= dims[0] || y >= dims[1] || z >= dims[2]) throw new TypeError('VOX voxel outside the declared size');
      var idx = x + dims[0] * (y + dims[1] * z);
      if (grid.data[idx]) throw new TypeError('VOX contains a duplicate voxel');
      grid.data[idx] = 1;
    }
    return grid;
  }

  function parseOpenSCAD(text) {
    if (typeof text !== 'string') throw new TypeError('OpenSCAD must be text');
    var shape = /\/\/ Grid: (\d+) x (\d+) x (\d+)/.exec(text);
    var pitch = /^pitch = ([^;]+);$/m.exec(text);
    var count = /\/\/ Solid cells: (\d+)/.exec(text), expectedBoxes = /\/\/ Merged boxes: (\d+)/.exec(text);
    if (!shape || !pitch || !count || !expectedBoxes || !text.includes('module voxelsynth_body() {') ||
        !text.trim().endsWith('voxelsynth_body();')) throw new TypeError('incomplete OpenSCAD metadata');
    var grid = createGrid(Number(shape[1]), Number(shape[2]), Number(shape[3]), Number(pitch[1]));
    var boxes = 0;
    var records = text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(function (line) { return line && !line.startsWith('//'); });
    if (records[0] !== '$fn = 24;' || records[1] !== pitch[0] || records[2] !== 'module voxelsynth_body() {' || records[3] !== 'union() {' ||
        records[records.length - 3] !== '}' || records[records.length - 2] !== '}' || records[records.length - 1] !== 'voxelsynth_body();') {
      throw new TypeError('OpenSCAD module and union must have balanced structure');
    }
    records.slice(4, -3).forEach(function (line) {
      var match = /^translate\(\[([^\]]+)\]\) cube\(\[([^\]]+)\], center = false\);$/.exec(line);
      if (!match) throw new TypeError('unsupported OpenSCAD statement');
      var origin = numericVector(match[1].replace(/,/g, ' '));
      var size = numericVector(match[2].replace(/,/g, ' '));
      var limits = [grid.nx, grid.ny, grid.nz];
      var from = [], to = [];
      for (var d = 0; d < 3; d++) {
        from[d] = Math.round(origin[d] / grid.pitchMm);
        var cells = Math.round(size[d] / grid.pitchMm);
        to[d] = from[d] + cells;
        if (Math.abs(origin[d] / grid.pitchMm - from[d]) > 1e-8 || Math.abs(size[d] / grid.pitchMm - cells) > 1e-8 ||
            cells <= 0 || from[d] < 0 || to[d] > limits[d]) throw new TypeError('OpenSCAD cube is outside the declared lattice');
      }
      for (var z = from[2]; z < to[2]; z++) for (var y = from[1]; y < to[1]; y++) for (var x = from[0]; x < to[0]; x++) {
        if (getVoxel(grid, x, y, z)) throw new TypeError('OpenSCAD cubes overlap');
        setVoxel(grid, x, y, z, 1);
      }
      boxes++;
    });
    if (countVoxels(grid) !== Number(count[1]) || boxes !== Number(expectedBoxes[1])) throw new TypeError('OpenSCAD occupancy or cube count mismatch');
    return grid;
  }

  function verifyExports(grid) {
    assertGrid(grid);
    var source = extractManifoldMesh(grid), s = source.stats;
    if (!s.watertight) throw new RangeError('export verification requires a nonempty manifold with no edge or point contacts');
    var formats = [
      { name: 'ASCII STL', payload: exportAsciiSTL(source), read: parseAsciiSTL },
      { name: 'Binary STL', payload: exportBinarySTL(source), read: parseBinarySTL },
      { name: 'OBJ', payload: exportOBJ(source), read: parseOBJ },
      { name: 'Binary PLY', payload: exportPLY(source), read: parsePLY }
    ];
    var maximum = 0;
    var results = formats.map(function (format) {
      var restored = format.read(format.payload), topology = analyzeMesh(restored);
      var error = Math.abs(topology.volumeMm3 - s.volumeMm3) / Math.max(Number.MIN_VALUE, s.volumeMm3);
      if (!topology.watertight || topology.eulerCharacteristic !== s.eulerCharacteristic ||
          topology.surfaceComponents !== s.surfaceComponents || restored.triangles.length !== source.triangles.length ||
          restored.vertices.length !== source.vertices.length || error > 1e-5 ||
          Math.abs(topology.surfaceAreaMm2 - s.surfaceAreaMm2) / s.surfaceAreaMm2 > 1e-5) throw new Error(format.name + ' round trip changed geometry or topology');
      restored.vertices.forEach(function (point, i) {
        point.forEach(function (value, d) {
          if (Math.abs(value - source.vertices[i][d]) > Math.max(1e-12, Math.abs(source.vertices[i][d]) * 1e-6)) throw new Error(format.name + ' vertex mismatch');
        });
      });
      maximum = Math.max(maximum, error);
      return { name: format.name, pass: true, triangles: topology.triangleCount, volumeMm3: topology.volumeMm3,
        relativeVolumeError: error, bytes: format.payload.length };
    });
    var scad = exportOpenSCAD(grid), restoredGrid = parseOpenSCAD(scad);
    if (restoredGrid.data.some(function (value, i) { return value !== (grid.data[i] ? 1 : 0); })) throw new Error('OpenSCAD changed occupancy');
    results.push({ name: 'OpenSCAD', pass: true, cells: countVoxels(restoredGrid), bytes: scad.length });
    /* .vox is a per-model format capped at 256 cells per axis; larger
     * lattices skip it rather than block the other checks. */
    if (grid.nx <= VOX_MAX_AXIS && grid.ny <= VOX_MAX_AXIS && grid.nz <= VOX_MAX_AXIS) {
      var voxBytes = exportVOX(grid), voxGrid = parseVOX(voxBytes);
      if (voxGrid.nx !== grid.nx || voxGrid.ny !== grid.ny || voxGrid.nz !== grid.nz ||
          voxGrid.data.some(function (value, i) { return value !== (grid.data[i] ? 1 : 0); })) {
        throw new Error('VOX changed occupancy');
      }
      results.push({ name: 'VOX', pass: true, cells: countVoxels(voxGrid), bytes: voxBytes.length });
    }
    var snapshot = deserializeGrid(serializeGrid(grid));
    if (snapshot.data.some(function (value, i) { return value !== (grid.data[i] ? 1 : 0); })) throw new Error('project snapshot changed occupancy');
    return { pass: true, formats: results, snapshotCells: grid.data.length, maxRelativeVolumeError: maximum };
  }

  /* ------------------------------------------------------------------ */
  /* Binary glTF 2.0 (.glb) writer and reader                            */
  /* ------------------------------------------------------------------ */

  /* A GLB is a 12 byte header, a JSON chunk padded with spaces and a BIN
   * chunk padded with zeros, each chunk length aligned to four bytes. The
   * BIN block stores float32 positions, float32 per-vertex normals and
   * uint32 triangle indices; per-vertex normals accumulate the unit facet
   * normals at every corner. glTF 2.0 measures distances in meters, so the
   * engine's millimeter vertices are divided by 1000 on export and the
   * POSITION accessor bounds record the same meter values. */
  function exportGLB(mesh, name) {
    assertMesh(mesh);
    if (!mesh.triangles.length) throw new RangeError('binary glTF export needs a nonempty manifold');
    var label = solidName(name);
    var i, j, k;
    var vertexCount = mesh.vertices.length, triangleCount = mesh.triangles.length;
    var positions = new Float32Array(vertexCount * 3);
    var normals = new Float32Array(vertexCount * 3);
    var indices = new Uint32Array(triangleCount * 3);
    var firstNormal = new Array(vertexCount);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    var toMeters = function (mm) { return mm / 1000; };
    for (i = 0; i < vertexCount; i++) {
      var v = mesh.vertices[i];
      for (j = 0; j < 3; j++) {
        var rounded = Math.fround(toMeters(v[j]));
        if (!Number.isFinite(rounded)) throw new RangeError('binary glTF float32 precision lost a vertex; use ASCII STL or OBJ');
        positions[i * 3 + j] = rounded;
        if (rounded < min[j]) min[j] = rounded;
        if (rounded > max[j]) max[j] = rounded;
      }
    }
    var facets = meshFacets(mesh);
    for (i = 0; i < facets.length; i++) {
      var f = facets[i];
      var roundedFacet = f.vertices.map(function (point) { return point.map(function (value) { return Math.fround(toMeters(value)); }); });
      if (dot3(f.normal, cross3(sub3(roundedFacet[1], roundedFacet[0]), sub3(roundedFacet[2], roundedFacet[0]))) <= 0) {
        throw new RangeError('binary glTF float32 precision would collapse a facet; use ASCII STL or OBJ');
      }
      for (j = 0; j < 3; j++) {
        var id = mesh.triangles[i][j];
        if (!firstNormal[id]) firstNormal[id] = f.normal;
        for (k = 0; k < 3; k++) normals[id * 3 + k] += f.normal[k];
      }
      for (j = 0; j < 3; j++) indices[i * 3 + j] = mesh.triangles[i][j];
    }
    for (i = 0; i < vertexCount; i++) {
      var nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      var unit = len > 0 ? [nx / len, ny / len, nz / len] : (firstNormal[i] || [0, 0, 1]);
      for (j = 0; j < 3; j++) {
        var rn = Math.fround(unit[j]);
        if (!Number.isFinite(rn) || rn === 0 && unit[j] !== 0) throw new RangeError('binary glTF float32 precision lost a normal; use ASCII STL or OBJ');
        normals[i * 3 + j] = rn;
      }
    }
    var binBytes = new Uint8Array(positions.byteLength + normals.byteLength + indices.byteLength);
    binBytes.set(new Uint8Array(positions.buffer), 0);
    binBytes.set(new Uint8Array(normals.buffer), positions.byteLength);
    binBytes.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);
    var gltf = {
      asset: { version: '2.0', generator: 'VoxelSynth' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: label }],
      meshes: [{ name: label, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
      materials: [{ name: 'voxelsynth', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.55, 0.66, 0.74, 1], metallicFactor: 0, roughnessFactor: 0.82 } }],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: min, max: max },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: vertexCount, type: 'VEC3' },
        { bufferView: 2, byteOffset: 0, componentType: 5125, count: triangleCount * 3, type: 'SCALAR' }
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
        { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
        { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: indices.byteLength, target: 34963 }
      ],
      buffers: [{ byteLength: binBytes.length }]
    };
    var jsonText = JSON.stringify(gltf);
    var jsonPad = (4 - jsonText.length % 4) % 4, binPad = (4 - binBytes.length % 4) % 4;
    var total = 12 + 8 + jsonText.length + jsonPad + 8 + binBytes.length + binPad;
    var out = new Uint8Array(total), view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true);          /* 'glTF' */
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonText.length + jsonPad, true);
    view.setUint32(16, 0x4e4f534a, true);         /* 'JSON' */
    for (i = 0; i < jsonText.length; i++) out[20 + i] = jsonText.charCodeAt(i) & 0x7f;
    for (i = 0; i < jsonPad; i++) out[20 + jsonText.length + i] = 0x20;
    var binStart = 20 + jsonText.length + jsonPad;
    view.setUint32(binStart, binBytes.length + binPad, true);
    view.setUint32(binStart + 4, 0x004e4942, true); /* 'BIN\0' */
    out.set(binBytes, binStart + 8);
    return out;
  }

  /* Validates the indexed-triangle glTF 2.0 subset written above, extended
   * to scene-graph instancing: the active scene's nodes are traversed and
   * each node's world transform (a 4x4 matrix or T * R * S) is composed, so
   * every referenced mesh is instanced into world space with its true
   * triangle count, bounds, normals and signed volume. glTF distances are
   * meters; world positions are converted to millimeters for the internal
   * audit, equal world positions weld into shared vertices, and a negative
   * determinant transform flips winding back to outward. Meshes the scene
   * never references are not part of the audited geometry. */
  function parseGLB(input) {
    var bytes = Object.prototype.toString.call(input) === '[object ArrayBuffer]' ? new Uint8Array(input) : input;
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object Uint8Array]' || bytes.byteLength < 20) {
      throw new TypeError('binary glTF requires a 20 byte header');
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67) throw new TypeError('glTF magic is missing');
    if (view.getUint32(4, true) !== 2) throw new TypeError('unsupported glTF container version');
    if (view.getUint32(8, true) !== bytes.byteLength) throw new TypeError('glTF length does not match file size');
    var jsonLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a) throw new TypeError('glTF must open with a JSON chunk');
    if (20 + jsonLength + 8 > bytes.length) throw new TypeError('glTF JSON chunk overruns the file');
    var binStart = 20 + jsonLength;
    var binLength = view.getUint32(binStart, true);
    if (view.getUint32(binStart + 4, true) !== 0x004e4942) throw new TypeError('glTF requires a BIN chunk');
    if (binStart + 8 + binLength > bytes.length) throw new TypeError('glTF BIN chunk overruns the file');
    var jsonText = '';
    for (var c = 0; c < jsonLength; c++) jsonText += String.fromCharCode(bytes[20 + c]);
    var gltf;
    try { gltf = JSON.parse(jsonText); } catch (error) { throw new TypeError('glTF JSON chunk is malformed'); }
    if (!gltf || !gltf.asset || gltf.asset.version !== '2.0') throw new TypeError('glTF asset version must be 2.0');
    if (!Array.isArray(gltf.meshes) || !gltf.meshes.length || !Array.isArray(gltf.accessors) ||
        !Array.isArray(gltf.bufferViews) || !Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 ||
        gltf.buffers[0].byteLength !== binLength) throw new TypeError('unsupported glTF structure');
    var accessorBytes = { 5126: 4, 5125: 4, 5123: 2 };
    var accessorItems = { SCALAR: 1, VEC3: 3 };
    function readAccessor(index, label, componentTypes, items) {
      var accessor = gltf.accessors[index];
      if (!accessor || componentTypes.indexOf(accessor.componentType) < 0 || accessorItems[accessor.type] !== items) {
        throw new TypeError('glTF ' + label + ' accessor has an unsupported component type');
      }
      var bufferView = gltf.bufferViews[accessor.bufferView];
      if (!bufferView || bufferView.buffer !== 0) throw new TypeError('glTF ' + label + ' references a missing buffer view');
      var offset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      var elementBytes = accessorBytes[accessor.componentType] * accessorItems[accessor.type];
      var stride = bufferView.byteStride || elementBytes;
      var localEnd = (accessor.byteOffset || 0) + stride * (accessor.count - 1) + elementBytes;
      if (stride < elementBytes || localEnd > bufferView.byteLength || offset + bufferView.byteLength > binLength) {
        throw new TypeError('glTF ' + label + ' accessor overruns its buffer');
      }
      var base = binStart + 8 + offset, items = accessorItems[accessor.type];
      var out = new Array(accessor.count * items);
      for (var i = 0; i < accessor.count; i++) {
        for (var d = 0; d < items; d++) {
          var at = base + i * stride + d * accessorBytes[accessor.componentType];
          out[i * items + d] = accessor.componentType === 5126 ? view.getFloat32(at, true) :
            accessor.componentType === 5125 ? view.getUint32(at, true) : view.getUint16(at, true);
        }
      }
      return { data: out, count: accessor.count, items: items };
    }
    /* Column-major 4x4 helpers for node world transforms. */
    function matIdentity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    function matMultiply(a, b) {
      var out = new Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    }
    function matPoint(m, p) {
      return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
      ];
    }
    function matDet3(m) {
      return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    }
    function nodeVec(node, prop, fallback, index) {
      var value = node[prop];
      if (value === undefined) return fallback;
      if (!Array.isArray(value) || !value.every(Number.isFinite)) {
        throw new TypeError('glTF node ' + index + ' ' + prop + ' must hold finite numbers');
      }
      return value;
    }
    function nodeLocalMatrix(node, index) {
      if (node.matrix !== undefined) {
        if (!Array.isArray(node.matrix) || node.matrix.length !== 16 || !node.matrix.every(Number.isFinite)) {
          throw new TypeError('glTF node ' + index + ' matrix must hold sixteen finite numbers');
        }
        return node.matrix;
      }
      var t = nodeVec(node, 'translation', [0, 0, 0], index);
      var s = nodeVec(node, 'scale', [1, 1, 1], index);
      var q = nodeVec(node, 'rotation', [0, 0, 0, 1], index);
      if (t.length !== 3 || s.length !== 3 || q.length !== 4) throw new TypeError('glTF node ' + index + ' transform has a wrong component count');
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var n = Math.sqrt(x * x + y * y + z * z + w * w);
      if (!(n > 0)) throw new TypeError('glTF node ' + index + ' rotation quaternion is zero');
      x /= n; y /= n; z /= n; w /= n;
      var m = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        t[0], t[1], t[2], 1
      ];
      for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
      return m;
    }
    var lookup = new Map();
    var mesh = { vertices: [], triangles: [], normals: [], nonUnitNormalCount: 0 };
    function emitPrimitive(primitive, world) {
      if (primitive.mode !== undefined && primitive.mode !== 4) throw new TypeError('glTF only supports triangle primitives');
      if (primitive.attributes === undefined || !Number.isInteger(primitive.attributes.POSITION) || !Number.isInteger(primitive.indices)) {
        throw new TypeError('glTF primitives need POSITION and indices accessors');
      }
      var positions = readAccessor(primitive.attributes.POSITION, 'POSITION', [5126], 3);
      if (positions.count === 0) throw new TypeError('glTF POSITION must hold VEC3 vertices');
      var ids = readAccessor(primitive.indices, 'indices', [5123, 5125], 1);
      if (ids.count % 3 !== 0 || ids.count === 0) throw new TypeError('glTF indices must count whole triangles');
      if (Number.isInteger(primitive.attributes.NORMAL)) {
        var declared = readAccessor(primitive.attributes.NORMAL, 'NORMAL', [5126], 3);
        if (declared.count !== positions.count) throw new TypeError('glTF NORMAL must match POSITION');
        for (var n = 0; n < declared.data.length; n += 3) {
          var nl = Math.sqrt(declared.data[n] * declared.data[n] + declared.data[n + 1] * declared.data[n + 1] + declared.data[n + 2] * declared.data[n + 2]);
          if (!Number.isFinite(nl) || Math.abs(nl - 1) > 1e-3) mesh.nonUnitNormalCount++;
        }
      }
      var flip = matDet3(world) < 0;
      var remap = new Map();
      for (var t = 0; t < ids.count; t++) {
        var source = ids.data[t];
        if (!Number.isInteger(source) || source < 0 || source >= positions.count) throw new TypeError('glTF index out of range');
        var target = remap.get(source);
        if (target === undefined) {
          var point = matPoint(world, [positions.data[source * 3], positions.data[source * 3 + 1], positions.data[source * 3 + 2]]);
          point = [point[0] * 1000, point[1] * 1000, point[2] * 1000];
          if (!point.every(Number.isFinite)) throw new TypeError('glTF node transform produces a nonfinite vertex');
          var key = pointKey(point);
          if (lookup.has(key)) target = lookup.get(key);
          else { target = mesh.vertices.length; lookup.set(key, target); mesh.vertices.push(point); }
          remap.set(source, target);
        }
        if (t % 3 === 2) {
          var tri = [remap.get(ids.data[t - 2]), remap.get(ids.data[t - 1]), target];
          if (flip) { var hold = tri[1]; tri[1] = tri[2]; tri[2] = hold; }
          var a = mesh.vertices[tri[0]], b = mesh.vertices[tri[1]], c2 = mesh.vertices[tri[2]];
          var cross = cross3(sub3(b, a), sub3(c2, a));
          var len = length3(cross);
          if (!Number.isFinite(len) || len === 0) throw new TypeError('glTF contains a degenerate face');
          mesh.triangles.push(tri);
          mesh.normals.push(cross.map(function (n) { return n / len; }));
        }
      }
    }
    function emitMesh(meshIndex, world) {
      if (!Number.isInteger(meshIndex) || meshIndex < 0 || meshIndex >= gltf.meshes.length) {
        throw new TypeError('glTF node references a missing mesh');
      }
      var gltfMesh = gltf.meshes[meshIndex];
      if (!Array.isArray(gltfMesh.primitives) || !gltfMesh.primitives.length) throw new TypeError('glTF mesh has no primitives');
      gltfMesh.primitives.forEach(function (primitive) { emitPrimitive(primitive, world); });
    }
    function visitNode(index, parentWorld, stack) {
      var node = Array.isArray(gltf.nodes) ? gltf.nodes[index] : undefined;
      if (!node || typeof node !== 'object') throw new TypeError('glTF scene references a missing node');
      if (stack.has(index)) throw new TypeError('glTF node graph contains a cycle');
      var world = matMultiply(parentWorld, nodeLocalMatrix(node, index));
      if (node.mesh !== undefined) emitMesh(node.mesh, world);
      var children = nodeVec(node, 'children', [], index);
      if (!children.every(Number.isInteger)) throw new TypeError('glTF node ' + index + ' children must be node indices');
      stack.add(index);
      children.forEach(function (child) { visitNode(child, world, stack); });
      stack.delete(index);
    }
    var roots = [];
    if (Array.isArray(gltf.scenes) && gltf.scenes.length) {
      var sceneIndex = gltf.scene === undefined ? 0 : gltf.scene;
      if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= gltf.scenes.length) {
        throw new TypeError('glTF scene index is out of range');
      }
      var scene = gltf.scenes[sceneIndex];
      roots = scene && Array.isArray(scene.nodes) ? scene.nodes : [];
      if (!roots.every(Number.isInteger)) throw new TypeError('glTF scene nodes must be node indices');
    } else if (Array.isArray(gltf.nodes)) {
      var hasParent = {};
      gltf.nodes.forEach(function (node, index) {
        nodeVec(node || {}, 'children', [], index).forEach(function (child) { hasParent[child] = true; });
      });
      gltf.nodes.forEach(function (node, index) { if (!hasParent[index]) roots.push(index); });
    }
    if (!roots.length && !Array.isArray(gltf.nodes)) {
      gltf.meshes.forEach(function (_, index) { emitMesh(index, matIdentity()); });
    } else {
      roots.forEach(function (index) { visitNode(index, matIdentity(), new Set()); });
    }
    assertMesh(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------------ */
  /* SHA-256 and the export integrity auditor                            */
  /* ------------------------------------------------------------------ */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) | 0; }

  /* Pure JavaScript SHA-256 so a proof report can bind its verdict to the
   * exact audited bytes without any runtime dependency. */
  function sha256Hex(bytes) {
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object Uint8Array]') throw new TypeError('SHA-256 requires a Uint8Array');
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bitLength = bytes.length * 8;
    var totalLength = bytes.length + 1 + ((56 - (bytes.length + 1) % 64 + 64) % 64) + 8;
    var msg = new Uint8Array(totalLength);
    msg.set(bytes);
    msg[bytes.length] = 0x80;
    var msgView = new DataView(msg.buffer);
    msgView.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false);
    msgView.setUint32(totalLength - 4, bitLength % 0x100000000, false);
    var w = new Array(64);
    for (var off = 0; off < totalLength; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = msgView.getUint32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
        var S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map(function (value) { return ('0000000' + (value >>> 0).toString(16)).slice(-8); }).join('');
  }

  function auditInputBytes(input) {
    if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input);
    if (Object.prototype.toString.call(input) === '[object Uint8Array]') return input;
    if (typeof input === 'string') {
      var bytes = new Uint8Array(input.length);
      for (var i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
      return bytes;
    }
    throw new TypeError('audit input must be bytes or text');
  }

  /* Format detection prefers byte magics; text signatures only run after the
   * binary candidates are exhausted. A binary STL that happens to start with
   * 'solid' is still caught by the exact 84 + 50 * count length contract. */
  function detectExportFormat(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return { id: 'glb', name: 'Binary glTF' };
    if (bytes.length >= 4 && bytes[0] === 0x56 && bytes[1] === 0x4f && bytes[2] === 0x58 && bytes[3] === 0x20) return { id: 'vox', name: 'MagicaVoxel VOX' };
    if (bytes.length >= 4 && bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79 && (bytes[3] === 0x0a || bytes[3] === 0x0d)) return { id: 'ply', name: 'Binary PLY' };
    if (bytes.length >= 84) {
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.length === 84 + view.getUint32(80, true) * 50) return { id: 'binary-stl', name: 'Binary STL' };
    }
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    var trimmed = text.trim();
    if (trimmed[0] === '{') {
      var parsed = null;
      try { parsed = JSON.parse(trimmed); } catch (error) { /* JSON.parse retried below for the error message. */ }
      if (parsed && parsed.asset && String(parsed.asset.version) === '2.0') return { id: 'gltf-json', name: 'JSON glTF' };
      return { id: 'json', name: 'Project JSON' };
    }
    if (/^solid\s/.test(trimmed)) return { id: 'ascii-stl', name: 'ASCII STL' };
    if (/voxelsynth_body|\/\/ Grid:/.test(text)) return { id: 'scad', name: 'OpenSCAD' };
    if (/^(?:v|vn|vt|f|o|g|#)\s/m.test(text) || /^(?:v|vn|f|o)\s/.test(trimmed)) return { id: 'obj', name: 'OBJ' };
    if (/^ply\s/.test(trimmed)) return { id: 'ply', name: 'PLY' };
    return { id: 'unrecognized', name: 'Unrecognized' };
  }

  /* Counted audit of one parsed mesh: Euler characteristic, genus from
   * chi = 2 * (components - g), degenerate facets and non-unit declared
   * normals, area, divergence volume and the bounding box proof. */
  function auditMeshIntegrity(mesh) {
    var a = analyzeMesh(mesh);
    var degenerate = 0;
    mesh.triangles.forEach(function (ids) {
      var cross = cross3(sub3(mesh.vertices[ids[1]], mesh.vertices[ids[0]]), sub3(mesh.vertices[ids[2]], mesh.vertices[ids[0]]));
      var len = length3(cross);
      if (!Number.isFinite(len) || len <= 0) degenerate++;
    });
    return {
      vertices: a.uniqueVertices,
      edges: a.uniqueEdges,
      triangles: a.triangleCount,
      eulerCharacteristic: a.eulerCharacteristic,
      eulerFormula: 'V - E + F = ' + a.eulerCharacteristic,
      surfaceComponents: a.surfaceComponents,
      genusEstimate: a.genusEstimate,
      genusFormula: a.genusEstimate === null ? null : '(2 * ' + a.surfaceComponents + ' - ' + a.eulerCharacteristic + ') / 2 = ' + a.genusEstimate,
      watertight: a.watertight,
      boundaryEdges: a.boundaryEdges,
      nonManifoldEdges: a.nonManifoldEdges,
      nonManifoldVertices: a.nonManifoldVertices,
      windingErrors: a.windingErrors,
      duplicateTriangles: a.duplicateTriangles,
      degenerateTriangles: degenerate,
      nonUnitNormals: mesh.nonUnitNormalCount || 0,
      surfaceAreaMm2: a.surfaceAreaMm2,
      volumeMm3: a.volumeMm3,
      volumeCm3: a.volumeCm3,
      boundingBoxMm: a.boundingBoxMm
    };
  }

  /* Audits an exported file without trusting it: detects the format, parses
   * it with the same strict readers used for round trips, recounts topology
   * and binds the verdict to the file SHA-256. Malformed content yields a
   * REJECTED report instead of throwing, so callers never inherit state. */
  function auditExportFile(input, name) {
    var bytes = auditInputBytes(input);
    var detected = detectExportFormat(bytes);
    var report = {
      report: 'voxelsynth-export-integrity',
      reportVersion: 1,
      generator: 'VoxelSynth ' + api.version,
      file: {
        name: typeof name === 'string' && name ? name : 'export',
        bytes: bytes.length,
        sha256: sha256Hex(bytes),
        format: detected.id,
        formatName: detected.name
      },
      verdict: 'REJECTED',
      failures: [],
      mesh: null,
      occupancy: null
    };
    if (detected.id === 'unrecognized') {
      report.failures.push('Unrecognized export format. Expected binary STL, ASCII STL, OBJ, binary PLY, binary glTF, VOX, OpenSCAD or project JSON.');
      return report;
    }
    if (detected.id === 'gltf-json') {
      report.failures.push('JSON glTF references external buffers; audit a single-file binary .glb instead.');
      return report;
    }
    try {
      if (detected.id === 'json' || detected.id === 'scad' || detected.id === 'vox') {
        var text = '';
        if (detected.id !== 'vox') for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
        var grid = detected.id === 'json' ? deserializeGrid(JSON.parse(text)) :
          detected.id === 'scad' ? parseOpenSCAD(text) : parseVOX(bytes);
        report.occupancy = {
          nx: grid.nx, ny: grid.ny, nz: grid.nz, pitchMm: grid.pitchMm,
          solidCells: countVoxels(grid), totalCells: grid.data.length
        };
        report.mesh = auditMeshIntegrity(extractManifoldMesh(grid));
      } else {
        var mesh;
        if (detected.id === 'binary-stl') mesh = parseBinarySTL(bytes);
        else if (detected.id === 'glb') mesh = parseGLB(bytes);
        else if (detected.id === 'ply') mesh = parsePLY(bytes);
        else {
          var text = '';
          for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
          mesh = detected.id === 'obj' ? parseOBJ(text) : parseAsciiSTL(text);
        }
        report.mesh = auditMeshIntegrity(mesh);
      }
    } catch (error) {
      report.failures.push('Rejected while reading ' + detected.name + ': ' + error.message);
      return report;
    }
    var m = report.mesh;
    /* A file that parses but carries no solid geometry is not a geometry
     * pass: an empty part has no closed surface to certify. */
    if (!m.triangles) {
      report.verdict = 'EMPTY';
      report.failures.push('The file parses but contains no solid geometry, so there is no closed surface to certify.');
      return report;
    }
    if (m.duplicateTriangles) report.failures.push(m.duplicateTriangles + ' coincident triangle(s) reuse the same three vertices as another facet');
    /* A closed surface whose signed volume is not positive faces inward or
     * encloses nothing. Nested cavity shells stay valid because their
     * inward area only subtracts from a larger outward volume. */
    if (!(m.volumeMm3 > 0)) report.failures.push('Net signed volume is ' + m.volumeMm3 + ' mm3, not positive; a valid solid encloses positive volume with outward faces');
    if (m.boundaryEdges) report.failures.push(m.boundaryEdges + ' boundary edge(s) break the closed surface');
    if (m.nonManifoldEdges) report.failures.push(m.nonManifoldEdges + ' edge(s) carry more than two facets');
    if (m.nonManifoldVertices) report.failures.push(m.nonManifoldVertices + ' vertex link(s) fail to close into one ring');
    if (m.windingErrors) report.failures.push(m.windingErrors + ' paired edge(s) run the same direction');
    if (m.degenerateTriangles) report.failures.push(m.degenerateTriangles + ' degenerate triangle(s) have zero area');
    if (m.nonUnitNormals) report.failures.push(m.nonUnitNormals + ' declared normal(s) are not unit length');
    report.verdict = report.failures.length ? 'FAIL' : 'PASS';
    return report;
  }

  /* ------------------------------------------------------------------ */
  /* Signed distance field helpers                                       */
  /* ------------------------------------------------------------------ */

  function sdfBox(px, py, pz, min, size) {
    if (!Array.isArray(min) || min.length !== 3 || !Array.isArray(size) || size.length !== 3) throw new TypeError('SDF box needs three origin and size coordinates');
    assertGeometry([px, py, pz].concat(min, size));
    if (size.some(function (v) { return v < 0; })) throw new RangeError('SDF box sizes must be nonnegative');
    var half = [size[0] / 2, size[1] / 2, size[2] / 2];
    var c = [min[0] + half[0], min[1] + half[1], min[2] + half[2]];
    var qx = Math.abs(px - c[0]) - half[0];
    var qy = Math.abs(py - c[1]) - half[1];
    var qz = Math.abs(pz - c[2]) - half[2];
    var outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    var distance = outside + Math.min(Math.max(qx, qy, qz), 0);
    assertFinite(distance, 'SDF box distance');
    return distance;
  }

  function sdfSphere(px, py, pz, cx, cy, cz, radius) {
    assertGeometry([px, py, pz, cx, cy, cz]); assertPositive(radius, 'SDF sphere radius');
    var distance = Math.hypot(px - cx, py - cy, pz - cz) - radius;
    assertFinite(distance, 'SDF sphere distance'); return distance;
  }

  function sdfCylinder(px, py, pz, cx, cy, cz, radius, height, axis) {
    assertGeometry([px, py, pz, cx, cy, cz]); assertPositive(radius, 'SDF cylinder radius'); assertPositive(height, 'SDF cylinder height');
    var a = normalizeAxis(axis);
    var u = (a + 1) % 3;
    var v = (a + 2) % 3;
    var point = [px, py, pz];
    var center = [cx, cy, cz];
    var radial = Math.hypot(point[u] - center[u], point[v] - center[v]) - radius;
    var axial = Math.abs(point[a] - (center[a] + height / 2)) - height / 2;
    var dx = Math.max(radial, 0);
    var dy = Math.max(axial, 0);
    var distance = Math.min(Math.max(radial, axial), 0) + Math.hypot(dx, dy);
    assertFinite(distance, 'SDF cylinder distance'); return distance;
  }

  function sdfUnion(a, b) { return Math.min(a, b); }
  function sdfSubtract(a, b) { return Math.max(a, -b); }
  function sdfIntersect(a, b) { return Math.max(a, b); }
  function sdfSmoothUnion(a, b, k) {
    assertGeometry([a, b, k]);
    if (k < 0) throw new RangeError('blend radius must be nonnegative');
    if (k === 0) return Math.min(a, b);
    var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return b * (1 - h) + a * h - k * h * (1 - h);
  }

  function rasterizeSDF(grid, sdf, operation) {
    assertGrid(grid);
    if (typeof sdf !== 'function') throw new TypeError('sdf must be a function');
    if (operation !== undefined && operation !== 'add' && operation !== 'subtract' && operation !== 'replace') {
      throw new RangeError('SDF operation must be add, subtract, or replace');
    }
    var op = operation === 'subtract' ? 0 : 1;
    var next = operation === 'replace' ? new Uint8Array(grid.data.length) : new Uint8Array(grid.data);
    var pitch = grid.pitchMm;
    for (var z = 0; z < grid.nz; z++) {
      for (var y = 0; y < grid.ny; y++) {
        for (var x = 0; x < grid.nx; x++) {
          var d = sdf((x + 0.5) * pitch, (y + 0.5) * pitch, (z + 0.5) * pitch);
          assertFinite(d, 'sampled SDF');
          if (d <= 0) next[indexOf(grid, x, y, z)] = op;
        }
      }
    }
    grid.data.set(next);
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /* Serialization                                                       */
  /* ------------------------------------------------------------------ */

  function serializeGrid(grid) {
    assertGrid(grid);
    var bytes = '';
    for (var i = 0; i < grid.data.length; i++) bytes += String.fromCharCode(grid.data[i] ? 49 : 48);
    return {
      format: 'voxelsynth-grid-v1',
      nx: grid.nx, ny: grid.ny, nz: grid.nz,
      pitchMm: grid.pitchMm,
      cells: typeof btoa === 'function' ? btoa(bytes) : Buffer.from(bytes, 'binary').toString('base64')
    };
  }

  function deserializeGrid(snapshot) {
    if (!snapshot || snapshot.format !== 'voxelsynth-grid-v1') {
      throw new TypeError('unsupported grid snapshot');
    }
    var grid = createGrid(snapshot.nx, snapshot.ny, snapshot.nz, snapshot.pitchMm);
    var padding = (3 - grid.data.length % 3) % 3;
    if (typeof snapshot.cells !== 'string' || snapshot.cells.length !== 4 * Math.ceil(grid.data.length / 3) ||
        !snapshot.cells.endsWith('='.repeat(padding)) || /[^A-Za-z0-9+/]/.test(snapshot.cells.slice(0, snapshot.cells.length - padding))) {
      throw new TypeError('snapshot cells must be complete canonical base64');
    }
    var raw = typeof atob === 'function' ? atob(snapshot.cells) : Buffer.from(snapshot.cells, 'base64').toString('binary');
    if (raw.length !== grid.data.length || !/^[01]+$/.test(raw)) throw new TypeError('snapshot must contain exactly one binary occupancy character per cell');
    var canonical = typeof btoa === 'function' ? btoa(raw) : Buffer.from(raw, 'binary').toString('base64');
    if (canonical !== snapshot.cells) throw new TypeError('snapshot base64 is not canonical');
    for (var i = 0; i < grid.data.length; i++) grid.data[i] = raw.charCodeAt(i) === 49 ? 1 : 0;
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /* Parametric presets                                                  */
  /* ------------------------------------------------------------------ */

  function resolvePresetOptions(options) {
    var o = options || {};
    return {
      pitchMm: o.pitchMm === undefined ? 2 : o.pitchMm,
      nx: o.nx === undefined ? 32 : o.nx,
      ny: o.ny === undefined ? 22 : o.ny,
      nz: o.nz === undefined ? 12 : o.nz,
      wallMm: o.wallMm === undefined ? 4 : o.wallMm,
      compartments: o.compartments === undefined ? 3 : o.compartments
    };
  }

  function assertPresetGrid(grid) {
    if (grid.nx < 4 || grid.ny < 4 || grid.nz < 4) throw new RangeError('part presets need at least 4 cells on each axis');
  }

  function deskOrganizerPreset(options) {
    var o = resolvePresetOptions(options);
    var p = o.pitchMm;
    var grid = createGrid(o.nx, o.ny, o.nz, p);
    assertPresetGrid(grid);
    var width = o.nx * p, depth = o.ny * p, height = o.nz * p;
    addBox(grid, 0, 0, 0, width, depth, height);
    assertPositive(o.wallMm, 'preset wall');
    assertPositiveInteger(o.compartments, 'compartments');
    var wall = Math.max(1, Math.min(Math.ceil(o.wallMm / p), Math.floor(o.nx / 4), Math.floor(o.ny / 4), Math.floor(o.nz / 2))) * p;
    o.compartments = Math.max(1, Math.min(o.compartments, Math.floor((width - wall) / (2 * wall))));
    var floor = wall;
    var top = height + p;
    var usable = width - wall * (o.compartments + 1);
    var bay = Math.floor(usable / (o.compartments * p)) * p;
    for (var i = 0; i < o.compartments; i++) {
      var x0 = wall + i * (bay + wall);
      var w = i === o.compartments - 1 ? (width - wall - x0) : bay;
      subtractBox(grid, x0, wall, floor, w, depth - 2 * wall, top - floor);
    }
    var penR = Math.max(p, wall * 0.6);
    for (var j = 0; j < o.compartments; j++) {
      subtractCylinder(grid, wall + bay * 0.5 + j * (bay + wall), depth * 0.5, floor,
        penR, height - floor + p, 'z');
    }
    return grid;
  }

  function sdCardVaultPreset(options) {
    var o = options || {};
    var p = o.pitchMm === undefined ? 1.5 : o.pitchMm;
    var nx = o.nx === undefined ? 24 : o.nx, ny = o.ny === undefined ? 18 : o.ny, nz = o.nz === undefined ? 10 : o.nz;
    var grid = createGrid(nx, ny, nz, p);
    assertPresetGrid(grid);
    var width = nx * p, depth = ny * p, height = nz * p;
    addBox(grid, 0, 0, 0, width, depth, height);
    shellGrid(grid, o.wallMm === undefined ? 3 : o.wallMm);
    var slotW = o.slotWidthMm === undefined ? width * 0.55 : o.slotWidthMm;
    assertPositive(slotW, 'slot width');
    subtractBox(grid, (width - slotW) / 2, depth * 0.25, height - 2 * p,
      slotW, depth * 0.5, 4 * p);
    addBox(grid, p, p, 0, width - 2 * p, depth - 2 * p, p * 1.5);
    subtractCylinder(grid, width * 0.5, depth * 0.5, 0, p * 1.2, height, 'z');
    return grid;
  }

  function cableCombPreset(options) {
    var o = options || {};
    var p = o.pitchMm === undefined ? 1.5 : o.pitchMm;
    var nx = o.nx === undefined ? 30 : o.nx, ny = o.ny === undefined ? 10 : o.ny, nz = o.nz === undefined ? 12 : o.nz;
    var grid = createGrid(nx, ny, nz, p);
    assertPresetGrid(grid);
    var width = nx * p, depth = ny * p, height = nz * p;
    var channels = o.channels === undefined ? 6 : o.channels;
    assertPositiveInteger(channels, 'channels');
    channels = Math.min(channels, Math.max(1, Math.floor(nx / 3)));
    addBox(grid, 0, 0, 0, width, depth, height);
    var pitch = width / (channels + 0.5);
    var slotW = Math.max(p * 2, pitch * 0.55);
    for (var i = 0; i < channels; i++) {
      var cx = pitch * (i + 0.75);
      subtractBox(grid, cx - slotW / 2, p, height * 0.35, slotW, depth - 2 * p, height);
      if (depth > 2 * p) subtractCylinder(grid, cx, p, height * 0.35, slotW * 0.52, depth - 2 * p, 'y');
    }
    subtractCylinder(grid, p * 2, depth * 0.5, 0, p, height, 'z');
    subtractCylinder(grid, width - p * 2, depth * 0.5, 0, p, height, 'z');
    return grid;
  }

  function rpiPicoMountPreset(options) {
    var o = options || {};
    var p = o.pitchMm === undefined ? 1.5 : o.pitchMm;
    var nx = o.nx === undefined ? 36 : o.nx, ny = o.ny === undefined ? 16 : o.ny, nz = o.nz === undefined ? 8 : o.nz;
    var grid = createGrid(nx, ny, nz, p);
    assertPresetGrid(grid);
    var width = nx * p, depth = ny * p, height = nz * p;
    var rail = Math.min(p * 2, width / 4);
    addBox(grid, 0, 0, 0, width, depth, p * 2);
    addBox(grid, 0, 0, 0, rail, depth, height * 0.6);
    addBox(grid, width - rail, 0, 0, rail, depth, height * 0.6);
    var holeR = p * 1.1;
    var insetX = Math.min(p * 4, width / 3), insetY = Math.min(p * 3, depth / 3);
    subtractBox(grid, rail, p, p * 2, Math.max(0, width - 2 * rail), Math.max(0, depth - 2 * p), height);
    [[insetX, insetY], [width - insetX, insetY],
     [insetX, depth - insetY], [width - insetX, depth - insetY]].forEach(function (pair) {
      addCylinder(grid, pair[0], pair[1], 0, holeR * 2.1, height * 0.55, 'z');
      subtractCylinder(grid, pair[0], pair[1], 0, holeR, height, 'z');
    });
    return grid;
  }

  function sdfDockPreset(options) {
    var o = resolvePresetOptions(options), p = o.pitchMm;
    var grid = createGrid(o.nx, o.ny, o.nz, p);
    assertPresetGrid(grid);
    var width = grid.nx * p, depth = grid.ny * p, height = grid.nz * p;
    var radius = Math.min(width, depth, height) * 0.38;
    rasterizeSDF(grid, function (x, y, z) {
      var base = sdfBox(x, y, z, [p, p, 0], [Math.max(p, width - 2 * p), Math.max(p, depth - 2 * p), 2 * p]);
      var collar = sdfSphere(x, y, z, width / 2, depth / 2, height * 0.42, radius);
      var body = sdfSmoothUnion(base, collar, 2 * p);
      var bore = sdfCylinder(x, y, z, width / 2, depth / 2, 2 * p, radius * 0.6, height, 'z');
      return sdfSubtract(sdfIntersect(body, z - height * 0.58), bore);
    }, 'replace');
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /* Algorithmic sculpture                                              */
  /* ------------------------------------------------------------------ */

  var SCULPTURE_PRESETS = [
    { id: 'gyroidPavilion', label: 'Minimalist Gyroid Pavilion', note: 'Triply periodic minimal surface', nx: 30, ny: 30, nz: 18, pitchMm: 1.5 },
    { id: 'mengerLantern', label: 'Menger Sponge Lantern', note: 'Recursive fractal voxel lattice', nx: 27, ny: 27, nz: 27, pitchMm: 1.5 },
    { id: 'helicalRibbon', label: 'Helical Kinetic Ribbon', note: 'Parametric triple helix', nx: 30, ny: 30, nz: 23, pitchMm: 1.5 },
    { id: 'voronoiAmphitheater', label: 'Voronoi Terraced Amphitheater', note: 'Organic stepped cell landscape', nx: 36, ny: 36, nz: 16, pitchMm: 1.5 }
  ];

  function sculpturePresetDimensions(name, options) {
    var definition = SCULPTURE_PRESETS.find(function (item) { return item.id === name; });
    if (!definition) throw new RangeError('unknown sculpture preset: ' + name);
    var o = options || {};
    var dimensions = {
      nx: o.nx === undefined ? definition.nx : o.nx,
      ny: o.ny === undefined ? definition.ny : o.ny,
      nz: o.nz === undefined ? definition.nz : o.nz,
      pitchMm: o.pitchMm === undefined ? definition.pitchMm : o.pitchMm
    };
    ['nx', 'ny', 'nz'].forEach(function (key) { assertPositiveInteger(dimensions[key], key); });
    assertPositive(dimensions.pitchMm, 'pitchMm');
    if (dimensions.nx < 4 || dimensions.ny < 4 || dimensions.nz < 4) throw new RangeError('sculpture presets need at least 4 cells on each axis');
    return dimensions;
  }

  /* The pavilion is a gyroid tunnel network carved through a solid block on a
   * two-cell plinth. Cutting the signed field band out of the whole volume
   * keeps the remaining walls thick enough to stay a closed manifold, and the
   * fenestrated faces show the minimal surface instead of a solid brick. */
  function gyroidPavilionPreset(options) {
    var d = sculpturePresetDimensions('gyroidPavilion', options), p = d.pitchMm;
    var grid = createGrid(d.nx, d.ny, d.nz, p);
    assertPresetGrid(grid);
    var period = Math.min(d.nx * p, d.ny * p) * 1.2;
    var threshold = 1.0;
    for (var z = 0; z < d.nz; z++) {
      for (var y = 0; y < d.ny; y++) {
        for (var x = 0; x < d.nx; x++) {
          if (z < 2) { setVoxel(grid, x, y, z, 1); continue; }
          var a = (x + 0.5) * p / period * 2 * Math.PI;
          var b = (y + 0.5) * p / period * 2 * Math.PI;
          var c = (z + 0.5) * p / period * 2 * Math.PI;
          var field = Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(c) + Math.sin(c) * Math.cos(a);
          setVoxel(grid, x, y, z, Math.abs(field) > threshold ? 1 : 0);
        }
      }
    }
    return grid;
  }

  /* Menger sponge: a cell is solid when at most one of its three base-3
   * digits equals 1. The lantern sits on a two-cell plinth. */
  function mengerLanternPreset(options) {
    var d = sculpturePresetDimensions('mengerLantern', options), p = d.pitchMm;
    var grid = createGrid(d.nx, d.ny, d.nz, p);
    assertPresetGrid(grid);
    var digits = [0, 0, 0];
    for (var z = 0; z < d.nz; z++) {
      for (var y = 0; y < d.ny; y++) {
        for (var x = 0; x < d.nx; x++) {
          digits[0] = x; digits[1] = y; digits[2] = z;
          if (z < 2) { setVoxel(grid, x, y, z, 1); continue; }
          var ones = 0;
          for (var axis = 0; axis < 3; axis++) {
            if (Math.floor(digits[axis] / 9) === 1) ones++;
            if (Math.floor((digits[axis] % 9) / 3) === 1) ones++;
            if (digits[axis] % 3 === 1) ones++;
          }
          setVoxel(grid, x, y, z, ones <= 1 ? 1 : 0);
        }
      }
    }
    return grid;
  }

  /* Three ribbons twist around a central mast between two solid rings. */
  function helicalRibbonPreset(options) {
    var d = sculpturePresetDimensions('helicalRibbon', options), p = d.pitchMm;
    var grid = createGrid(d.nx, d.ny, d.nz, p);
    assertPresetGrid(grid);
    var width = d.nx * p, depth = d.ny * p;
    var cx = width / 2, cy = depth / 2;
    var core = 2.6 * p, inner = 6 * p, outer = Math.min(width, depth) * 0.4;
    var halfWidth = 0.55;
    var arms = 3, turns = 2, ringLayers = 2;
    for (var z = 0; z < d.nz; z++) {
      for (var y = 0; y < d.ny; y++) {
        for (var x = 0; x < d.nx; x++) {
          var dx = (x + 0.5) * p - cx, dy = (y + 0.5) * p - cy;
          var radius = Math.hypot(dx, dy);
          if (radius <= core) { setVoxel(grid, x, y, z, 1); continue; }
          var theta = Math.atan2(dy, dx);
          if (theta < 0) theta += 2 * Math.PI;
          var phase = theta - 2 * Math.PI * turns * z / d.nz;
          var onRibbon = false;
          for (var arm = 0; arm < arms; arm++) {
            var wrapped = (phase - arm * 2 * Math.PI / arms + Math.PI) % (2 * Math.PI);
            if (wrapped < 0) wrapped += 2 * Math.PI;
            var delta = Math.abs(wrapped - Math.PI);
            if (delta <= halfWidth) onRibbon = true;
          }
          var ring = z < ringLayers || z >= d.nz - ringLayers;
          var solid = (ring && radius >= core && radius <= outer) ||
            (!ring && radius >= inner && radius <= outer && onRibbon);
          setVoxel(grid, x, y, z, solid ? 1 : 0);
        }
      }
    }
    return grid;
  }

  /* Nearest and second-nearest site distances yield a stepped terrace whose
   * height grows toward the rim and follows each Voronoi boundary. */
  function voronoiAmphitheaterPreset(options) {
    var d = sculpturePresetDimensions('voronoiAmphitheater', options), p = d.pitchMm;
    var grid = createGrid(d.nx, d.ny, d.nz, p);
    assertPresetGrid(grid);
    var cx = d.nx / 2, cy = d.ny / 2;
    var layout = [[0.5, 0.5], [0.18, 0.22], [0.82, 0.24], [0.2, 0.8], [0.8, 0.8], [0.5, 0.1], [0.1, 0.5], [0.9, 0.55]];
    var sites = layout.map(function (site, index) { return [site[0] * d.nx + 0.7 * index, site[1] * d.ny + 0.5 * index]; });
    var radius = Math.min(cx, cy);
    for (var y = 0; y < d.ny; y++) {
      for (var x = 0; x < d.nx; x++) {
        var nearest = Infinity, second = Infinity;
        sites.forEach(function (site) {
          var distance = Math.hypot(x + 0.5 - site[0], y + 0.5 - site[1]);
          if (distance < nearest) { second = nearest; nearest = distance; }
          else if (distance < second) second = distance;
        });
        var radial = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        var edge = Math.min(2, second - nearest);
        var height = Math.max(1, Math.min(d.nz - 1, Math.floor(1 + radial * (d.nz - 4) + edge * 0.35)));
        for (var z = 0; z <= height; z++) setVoxel(grid, x, y, z, 1);
      }
    }
    return grid;
  }

  var PRESETS = {
    deskOrganizer: deskOrganizerPreset,
    sdCardVault: sdCardVaultPreset,
    cableComb: cableCombPreset,
    rpiPicoMount: rpiPicoMountPreset,
    sdfDock: sdfDockPreset,
    gyroidPavilion: gyroidPavilionPreset,
    mengerLantern: mengerLanternPreset,
    helicalRibbon: helicalRibbonPreset,
    voronoiAmphitheater: voronoiAmphitheaterPreset
  };

  function listSculpturePresets() { return SCULPTURE_PRESETS.map(function (item) { return Object.assign({}, item); }); }

  function listPresets() { return Object.keys(PRESETS); }
  function loadPreset(name, options) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) throw new RangeError('unknown preset: ' + name);
    return PRESETS[name](options);
  }

  var api = {
    version: '2.0.0',
    MAX_GRID_CELLS: MAX_GRID_CELLS,
    MAX_MESH_TRIANGLES: MAX_MESH_TRIANGLES,
    DEFAULT_PLA_DENSITY: DEFAULT_PLA_DENSITY,
    DEFAULT_PETG_DENSITY: DEFAULT_PETG_DENSITY,
    AXIS_NAMES: AXIS_NAMES,
    createGrid: createGrid,
    cloneGrid: cloneGrid,
    getVoxel: getVoxel,
    setVoxel: setVoxel,
    inBounds: inBounds,
    countVoxels: countVoxels,
    countExposedFaces: countExposedFaces,
    naiveTriangleCount: naiveTriangleCount,
    addBox: addBox,
    subtractBox: subtractBox,
    addCylinder: addCylinder,
    subtractCylinder: subtractCylinder,
    addSphere: addSphere,
    subtractSphere: subtractSphere,
    mirrorGrid: mirrorGrid,
    shellGrid: shellGrid,
    unionGrid: unionGrid,
    subtractGrid: subtractGrid,
    sdfBox: sdfBox,
    sdfSphere: sdfSphere,
    sdfCylinder: sdfCylinder,
    sdfUnion: sdfUnion,
    sdfSubtract: sdfSubtract,
    sdfIntersect: sdfIntersect,
    sdfSmoothUnion: sdfSmoothUnion,
    rasterizeSDF: rasterizeSDF,
    extractManifoldMesh: extractManifoldMesh,
    analyzeMesh: analyzeMesh,
    estimateMass: estimateMass,
    buildQuads: buildQuads,
    exportAsciiSTL: exportAsciiSTL,
    exportBinarySTL: exportBinarySTL,
    exportOBJ: exportOBJ,
    exportPLY: exportPLY,
    exportOpenSCAD: exportOpenSCAD,
    exportVOX: exportVOX,
    exportGLB: exportGLB,
    parseGLB: parseGLB,
    sha256Hex: sha256Hex,
    auditExportFile: auditExportFile,
    parseAsciiSTL: parseAsciiSTL,
    parseBinarySTL: parseBinarySTL,
    parseOBJ: parseOBJ,
    parsePLY: parsePLY,
    parseOpenSCAD: parseOpenSCAD,
    parseVOX: parseVOX,
    analyzePrintability: analyzePrintability,
    applySymmetricEdit: applySymmetricEdit,
    VOX_MAX_AXIS: VOX_MAX_AXIS,
    verifyExports: verifyExports,
    serializeGrid: serializeGrid,
    deserializeGrid: deserializeGrid,
    deskOrganizerPreset: deskOrganizerPreset,
    sdCardVaultPreset: sdCardVaultPreset,
    cableCombPreset: cableCombPreset,
    rpiPicoMountPreset: rpiPicoMountPreset,
    sdfDockPreset: sdfDockPreset,
    gyroidPavilionPreset: gyroidPavilionPreset,
    mengerLanternPreset: mengerLanternPreset,
    helicalRibbonPreset: helicalRibbonPreset,
    voronoiAmphitheaterPreset: voronoiAmphitheaterPreset,
    listSculpturePresets: listSculpturePresets,
    listPresets: listPresets,
    loadPreset: loadPreset,
    presets: PRESETS
  };

  return api;
});
