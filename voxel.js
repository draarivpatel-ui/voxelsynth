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

  function assertPositiveInteger(value, label) {
    if (!Number.isFinite(value) || Math.floor(value) !== value || value <= 0) {
      throw new RangeError(label + ' must be a positive integer');
    }
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
    if (!Number.isFinite(pitchMm) || pitchMm <= 0) {
      throw new RangeError('pitchMm must be a positive finite number');
    }
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
    if (!grid || !grid.data || !Number.isFinite(grid.nx) || !Number.isFinite(grid.ny) || !Number.isFinite(grid.nz)) {
      throw new TypeError('expected a VoxelSynth grid');
    }
  }

  function indexOf(grid, x, y, z) {
    return x + grid.nx * (y + grid.ny * z);
  }

  function inBounds(grid, x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < grid.nx && y < grid.ny && z < grid.nz;
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

  function countExposedFaces(grid) {
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

  function cellsForRange(grid, minMm, maxMm, axisIndex) {
    var limit = axisIndex === 0 ? grid.nx : (axisIndex === 1 ? grid.ny : grid.nz);
    var lo = clamp(Math.round(minMm / grid.pitchMm), 0, limit);
    var hi = clamp(Math.round(maxMm / grid.pitchMm), 0, limit);
    if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
    return [lo, hi];
  }

  function forEachBoxCell(grid, min, size, callback) {
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
    var pitch = grid.pitchMm;
    var r2 = radius * radius;
    var xr = cellsForRange(grid, cx - radius, cx + radius, 0);
    var yr = cellsForRange(grid, cy - radius, cy + radius, 1);
    var zr = cellsForRange(grid, cz - radius, cz + radius, 2);
    for (var z = zr[0]; z < zr[1]; z++) {
      var dz = (z + 0.5) * pitch - cz;
      for (var y = yr[0]; y < yr[1]; y++) {
        var dy = (y + 0.5) * pitch - cy;
        for (var x = xr[0]; x < xr[1]; x++) {
          var dx = (x + 0.5) * pitch - cx;
          if (dx * dx + dy * dy + dz * dz <= r2) setVoxel(grid, x, y, z, value);
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
    var a = normalizeAxis(axis);
    var pitch = grid.pitchMm;
    var r2 = radius * radius;
    var center = [cx, cy, cz];
    var base = center[a];
    var u = (a + 1) % 3;
    var v = (a + 2) % 3;
    var ar = cellsForRange(grid, base, base + height, a);
    var ur = cellsForRange(grid, center[u] - radius, center[u] + radius, u);
    var vr = cellsForRange(grid, center[v] - radius, center[v] + radius, v);
    var cell = [0, 0, 0];
    for (var ai = ar[0]; ai < ar[1]; ai++) {
      var ac = (ai + 0.5) * pitch;
      if (ac < base || ac >= base + height) continue;
      for (var ui = ur[0]; ui < ur[1]; ui++) {
        var du = (ui + 0.5) * pitch - center[u];
        for (var vi = vr[0]; vi < vr[1]; vi++) {
          var dv = (vi + 0.5) * pitch - center[v];
          if (du * du + dv * dv <= r2) {
            cell[a] = ai; cell[u] = ui; cell[v] = vi;
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
    return 'x';
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
    var k = Math.max(1, Math.round(wallThicknessMm / grid.pitchMm));
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

  /*
   * Coplanar greedy quads are overlaid on a shared integer lattice. A quad
   * covers a rectangle of unit face cells, and every covered unit cell emits
   * exactly two triangles. All surface vertices are lattice coordinates, so
   * two adjacent quads always describe identical boundaries. This yields a
   * globally consistent triangle manifold without T junctions.
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
    var vertices = mesh.vertices;
    var triangles = mesh.triangles;
    var surfaceArea = 0;
    var signedVolume = 0;
    var lo = [Infinity, Infinity, Infinity];
    var hi = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < vertices.length; i++) {
      for (var d = 0; d < 3; d++) {
        if (vertices[i][d] < lo[d]) lo[d] = vertices[i][d];
        if (vertices[i][d] > hi[d]) hi[d] = vertices[i][d];
      }
    }
    if (!vertices.length) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
    var directed = new Set();
    var undirected = new Set();
    for (var t = 0; t < triangles.length; t++) {
      var a = vertices[triangles[t][0]];
      var b = vertices[triangles[t][1]];
      var c = vertices[triangles[t][2]];
      surfaceArea += 0.5 * length3(cross3(sub3(b, a), sub3(c, a)));
      signedVolume += dot3(a, cross3(b, c)) / 6;
      var ids = triangles[t];
      for (var e = 0; e < 3; e++) {
        var u = ids[e];
        var v = ids[(e + 1) % 3];
        directed.add(u + '>' + v);
        undirected.add(Math.min(u, v) + ':' + Math.max(u, v));
      }
    }
    var unmatched = 0;
    directed.forEach(function (key) {
      var parts = key.split('>');
      if (!directed.has(parts[1] + '>' + parts[0])) unmatched++;
    });
    var chi = vertices.length - undirected.size + triangles.length;
    var volumeCm3 = signedVolume / 1000;
    var infill = mesh.infillPercent;
    mesh.stats = {
      voxelCount: countVoxels(grid),
      exposedFaceCount: countExposedFaces(grid),
      naiveTriangleCount: naiveTriangleCount(grid),
      quadCount: quadCount,
      triangleCount: triangles.length,
      mergeRatio: triangles.length ? naiveTriangleCount(grid) / triangles.length : 0,
      surfaceAreaMm2: surfaceArea,
      volumeMm3: signedVolume,
      volumeCm3: volumeCm3,
      boundingBoxMm: {
        min: lo.slice(), max: hi.slice(),
        size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
      },
      eulerCharacteristic: chi,
      genusEstimate: (2 - chi) / 2,
      uniqueVertices: vertices.length,
      uniqueEdges: undirected.size,
      watertight: unmatched === 0 && triangles.length > 0,
      unmatchedEdges: unmatched,
      infillPercent: infill,
      plaMassG: volumeCm3 * (infill / 100) * DEFAULT_PLA_DENSITY,
      petgMassG: volumeCm3 * (infill / 100) * DEFAULT_PETG_DENSITY
    };
    return mesh;
  }

  function extractManifoldMesh(grid, options) {
    assertGrid(grid);
    var opts = options || {};
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
    for (i = 0; i < mesh.triangles.length; i++) {
      var v0 = mesh.vertices[mesh.triangles[i][0]];
      var v1 = mesh.vertices[mesh.triangles[i][1]];
      var v2 = mesh.vertices[mesh.triangles[i][2]];
      probe += dot3(v0, cross3(v1, v2)) / 6;
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
    var opts = options || {};
    var density = opts.density;
    if (density === undefined) {
      var material = String(opts.material || 'PLA').toLowerCase();
      density = material === 'petg' ? DEFAULT_PETG_DENSITY : DEFAULT_PLA_DENSITY;
    }
    var infill = opts.infillPercent === undefined ? 100 : clamp(opts.infillPercent, 0, 100);
    var volumeCm3 = mesh.stats ? mesh.stats.volumeCm3 : 0;
    return {
      material: opts.material || 'PLA',
      infillPercent: infill,
      densityGPerCm3: density,
      grams: volumeCm3 * (infill / 100) * density
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
    var s = v.toFixed(6);
    return s === '-0.000000' ? '0.000000' : s;
  }

  function meshFacets(mesh) {
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
    var p = (typeof pitchMm === 'number' && pitchMm > 0) ? pitchMm : grid.pitchMm;
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

  /* ------------------------------------------------------------------ */
  /* Signed distance field helpers                                       */
  /* ------------------------------------------------------------------ */

  function sdfBox(px, py, pz, min, size) {
    var half = [size[0] / 2, size[1] / 2, size[2] / 2];
    var c = [min[0] + half[0], min[1] + half[1], min[2] + half[2]];
    var qx = Math.abs(px - c[0]) - half[0];
    var qy = Math.abs(py - c[1]) - half[1];
    var qz = Math.abs(pz - c[2]) - half[2];
    var outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0);
  }

  function sdfSphere(px, py, pz, cx, cy, cz, radius) {
    return Math.hypot(px - cx, py - cy, pz - cz) - radius;
  }

  function sdfCylinder(px, py, pz, cx, cy, cz, radius, height, axis) {
    var a = normalizeAxis(axis);
    var u = (a + 1) % 3;
    var v = (a + 2) % 3;
    var point = [px, py, pz];
    var center = [cx, cy, cz];
    var radial = Math.hypot(point[u] - center[u], point[v] - center[v]) - radius;
    var axial = Math.abs(point[a] - (center[a] + height / 2)) - height / 2;
    var dx = Math.max(radial, 0);
    var dy = Math.max(axial, 0);
    return Math.min(Math.max(radial, axial), 0) + Math.hypot(dx, dy);
  }

  function sdfUnion(a, b) { return Math.min(a, b); }
  function sdfSubtract(a, b) { return Math.max(a, -b); }
  function sdfIntersect(a, b) { return Math.max(a, b); }
  function sdfSmoothUnion(a, b, k) {
    var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return b * (1 - h) + a * h - k * h * (1 - h);
  }

  function rasterizeSDF(grid, sdf, operation) {
    assertGrid(grid);
    if (typeof sdf !== 'function') throw new TypeError('sdf must be a function');
    var op = operation === 'subtract' ? 0 : 1;
    var pitch = grid.pitchMm;
    for (var z = 0; z < grid.nz; z++) {
      for (var y = 0; y < grid.ny; y++) {
        for (var x = 0; x < grid.nx; x++) {
          var d = sdf((x + 0.5) * pitch, (y + 0.5) * pitch, (z + 0.5) * pitch);
          if (d <= 0) setVoxel(grid, x, y, z, op);
        }
      }
    }
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
    var raw = typeof atob === 'function'
      ? atob(snapshot.cells)
      : Buffer.from(snapshot.cells, 'base64').toString('binary');
    var grid = createGrid(snapshot.nx, snapshot.ny, snapshot.nz, snapshot.pitchMm);
    for (var i = 0; i < grid.data.length && i < raw.length; i++) grid.data[i] = raw.charCodeAt(i) === 49 ? 1 : 0;
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /* Parametric presets                                                  */
  /* ------------------------------------------------------------------ */

  function resolvePresetOptions(options) {
    var o = options || {};
    return {
      pitchMm: o.pitchMm || 2,
      nx: o.nx || 32,
      ny: o.ny || 22,
      nz: o.nz || 12,
      wallMm: o.wallMm || 4,
      compartments: o.compartments || 3
    };
  }

  function deskOrganizerPreset(options) {
    var o = resolvePresetOptions(options);
    var p = o.pitchMm;
    var grid = createGrid(o.nx, o.ny, o.nz, p);
    var width = o.nx * p, depth = o.ny * p, height = o.nz * p;
    addBox(grid, 0, 0, 0, width, depth, height);
    var wall = o.wallMm;
    var floor = wall;
    var top = height + p;
    var usable = width - wall * (o.compartments + 1);
    var bay = Math.floor(usable / o.compartments);
    for (var i = 0; i < o.compartments; i++) {
      var x0 = wall + i * (bay + wall);
      var w = i === o.compartments - 1 ? (width - wall - x0) : bay;
      subtractBox(grid, x0, wall, floor, w, depth - 2 * wall, top - floor);
    }
    var penR = Math.max(p, wall * 0.6);
    for (var j = 0; j < 3; j++) {
      subtractCylinder(grid, wall + bay * 0.5 + j * (bay + wall), depth * 0.5, floor,
        penR, height - floor + p, 'z');
    }
    return grid;
  }

  function sdCardVaultPreset(options) {
    var o = options || {};
    var p = o.pitchMm || 1.5;
    var nx = o.nx || 24, ny = o.ny || 18, nz = o.nz || 10;
    var grid = createGrid(nx, ny, nz, p);
    var width = nx * p, depth = ny * p, height = nz * p;
    addBox(grid, 0, 0, 0, width, depth, height);
    shellGrid(grid, o.wallMm || 3);
    var slotW = o.slotWidthMm || width * 0.55;
    subtractBox(grid, (width - slotW) / 2, depth * 0.25, height - 2 * p,
      slotW, depth * 0.5, 4 * p);
    addBox(grid, p, p, 0, width - 2 * p, depth - 2 * p, p * 1.5);
    subtractCylinder(grid, width * 0.5, depth * 0.5, 0, p * 1.2, height, 'z');
    return grid;
  }

  function cableCombPreset(options) {
    var o = options || {};
    var p = o.pitchMm || 1.5;
    var nx = o.nx || 30, ny = o.ny || 10, nz = o.nz || 12;
    var grid = createGrid(nx, ny, nz, p);
    var width = nx * p, depth = ny * p, height = nz * p;
    var channels = o.channels || 6;
    addBox(grid, 0, 0, 0, width, depth, height);
    var pitch = width / (channels + 0.5);
    var slotW = Math.max(p * 2, pitch * 0.55);
    for (var i = 0; i < channels; i++) {
      var cx = pitch * (i + 0.75);
      subtractBox(grid, cx - slotW / 2, p, height * 0.35, slotW, depth - 2 * p, height);
      subtractCylinder(grid, cx, depth * 0.5, height * 0.35, slotW * 0.52, depth - 2 * p, 'y');
    }
    subtractCylinder(grid, p * 2, depth * 0.5, 0, p, height, 'z');
    subtractCylinder(grid, width - p * 2, depth * 0.5, 0, p, height, 'z');
    return grid;
  }

  function rpiPicoMountPreset(options) {
    var o = options || {};
    var p = o.pitchMm || 1.5;
    var nx = o.nx || 36, ny = o.ny || 16, nz = o.nz || 8;
    var grid = createGrid(nx, ny, nz, p);
    var width = nx * p, depth = ny * p, height = nz * p;
    var rail = p * 2;
    addBox(grid, 0, 0, 0, width, depth, p * 2);
    addBox(grid, 0, 0, 0, rail, depth, height * 0.6);
    addBox(grid, width - rail, 0, 0, rail, depth, height * 0.6);
    var holeR = p * 1.1;
    var insetX = p * 4, insetY = p * 3;
    [[insetX, insetY], [width - insetX, insetY],
     [insetX, depth - insetY], [width - insetX, depth - insetY]].forEach(function (pair) {
      addCylinder(grid, pair[0], pair[1], 0, holeR * 2.1, height * 0.55, 'z');
      subtractCylinder(grid, pair[0], pair[1], 0, holeR, height, 'z');
    });
    subtractBox(grid, rail, p, p * 2, width - 2 * rail, depth - 2 * p, height);
    return grid;
  }

  var PRESETS = {
    deskOrganizer: deskOrganizerPreset,
    sdCardVault: sdCardVaultPreset,
    cableComb: cableCombPreset,
    rpiPicoMount: rpiPicoMountPreset
  };

  function listPresets() { return Object.keys(PRESETS); }
  function loadPreset(name, options) {
    if (!PRESETS[name]) throw new RangeError('unknown preset: ' + name);
    return PRESETS[name](options);
  }

  var api = {
    version: '1.0.0',
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
    estimateMass: estimateMass,
    buildQuads: buildQuads,
    exportAsciiSTL: exportAsciiSTL,
    exportBinarySTL: exportBinarySTL,
    exportOBJ: exportOBJ,
    exportOpenSCAD: exportOpenSCAD,
    serializeGrid: serializeGrid,
    deserializeGrid: deserializeGrid,
    deskOrganizerPreset: deskOrganizerPreset,
    sdCardVaultPreset: sdCardVaultPreset,
    cableCombPreset: cableCombPreset,
    rpiPicoMountPreset: rpiPicoMountPreset,
    listPresets: listPresets,
    loadPreset: loadPreset,
    presets: PRESETS
  };

  return api;
});
