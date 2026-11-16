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
    var edges = new Map(), links = new Map();
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
    var manifold = triangles.length > 0 && unmatched === 0 && nonManifoldVertices === 0;
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
      unmatchedEdges: unmatched
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
      { name: 'OBJ', payload: exportOBJ(source), read: parseOBJ }
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
    var snapshot = deserializeGrid(serializeGrid(grid));
    if (snapshot.data.some(function (value, i) { return value !== (grid.data[i] ? 1 : 0); })) throw new Error('project snapshot changed occupancy');
    return { pass: true, formats: results, snapshotCells: grid.data.length, maxRelativeVolumeError: maximum };
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

  var PRESETS = {
    deskOrganizer: deskOrganizerPreset,
    sdCardVault: sdCardVaultPreset,
    cableComb: cableCombPreset,
    rpiPicoMount: rpiPicoMountPreset,
    sdfDock: sdfDockPreset
  };

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
    exportOpenSCAD: exportOpenSCAD,
    parseAsciiSTL: parseAsciiSTL,
    parseBinarySTL: parseBinarySTL,
    parseOBJ: parseOBJ,
    parseOpenSCAD: parseOpenSCAD,
    verifyExports: verifyExports,
    serializeGrid: serializeGrid,
    deserializeGrid: deserializeGrid,
    deskOrganizerPreset: deskOrganizerPreset,
    sdCardVaultPreset: sdCardVaultPreset,
    cableCombPreset: cableCombPreset,
    rpiPicoMountPreset: rpiPicoMountPreset,
    sdfDockPreset: sdfDockPreset,
    listPresets: listPresets,
    loadPreset: loadPreset,
    presets: PRESETS
  };

  return api;
});
