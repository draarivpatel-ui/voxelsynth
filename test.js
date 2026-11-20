'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./voxel.js');

function solidBox(nx, ny, nz, pitch) {
  const g = V.createGrid(nx, ny, nz, pitch === undefined ? 1 : pitch);
  V.addBox(g, 0, 0, 0, nx * g.pitchMm, ny * g.pitchMm, nz * g.pitchMm);
  return g;
}

function verifyDirectedEdges(mesh, label) {
  const directed = new Map();
  for (const tri of mesh.triangles) {
    for (let e = 0; e < 3; e++) {
      const key = tri[e] + '>' + tri[(e + 1) % 3];
      directed.set(key, (directed.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of directed) {
    const [u, v] = key.split('>');
    assert.equal(count, 1, `${label}: directed edge ${key} has multiple incidences`);
    assert.equal(directed.get(v + '>' + u), 1, `${label}: directed edge ${key} needs exactly one opposite`);
  }
  return directed;
}

function presetGridSizes() {
  return { pitchMm: 2, nx: 20, ny: 14, nz: 9 };
}

/* ------------------------------- Grid -------------------------------- */

test('createGrid builds a zeroed array of the expected shape', () => {
  const g = V.createGrid(4, 5, 6, 2);
  assert.equal(g.nx, 4);
  assert.equal(g.ny, 5);
  assert.equal(g.nz, 6);
  assert.equal(g.pitchMm, 2);
  assert.equal(g.data.length, 120);
  assert.ok(g.data.every((v) => v === 0));
});

test('createGrid defaults pitchMm to 1 mm', () => {
  assert.equal(V.createGrid(2, 2, 2).pitchMm, 1);
});

test('createGrid rejects nonpositive or fractional dimensions', () => {
  assert.throws(() => V.createGrid(0, 2, 2), RangeError);
  assert.throws(() => V.createGrid(2.5, 2, 2), RangeError);
  assert.throws(() => V.createGrid(2, -1, 2), RangeError);
});

test('createGrid rejects invalid pitch', () => {
  assert.throws(() => V.createGrid(2, 2, 2, 0), RangeError);
  assert.throws(() => V.createGrid(2, 2, 2, -3), RangeError);
  assert.throws(() => V.createGrid(2, 2, 2, NaN), RangeError);
});

test('getVoxel and setVoxel roundtrip using x fastest ordering', () => {
  const g = V.createGrid(3, 3, 3);
  assert.equal(V.getVoxel(g, 1, 2, 0), 0);
  V.setVoxel(g, 1, 2, 0, 1);
  assert.equal(V.getVoxel(g, 1, 2, 0), 1);
  assert.equal(g.data[1 + 3 * 2], 1);
  V.setVoxel(g, 1, 2, 0, 0);
  assert.equal(V.getVoxel(g, 1, 2, 0), 0);
});

test('out of bounds reads return air and writes are rejected', () => {
  const g = V.createGrid(2, 2, 2);
  assert.equal(V.getVoxel(g, -1, 0, 0), 0);
  assert.equal(V.getVoxel(g, 2, 0, 0), 0);
  assert.equal(V.setVoxel(g, 2, 0, 0, 1), false);
  assert.equal(V.inBounds(g, 1, 1, 1), true);
  assert.equal(V.inBounds(g, 2, 1, 1), false);
});

test('countVoxels reports the number of solid cells', () => {
  const g = V.createGrid(4, 4, 4);
  V.addBox(g, 1, 1, 1, 2, 2, 2);
  assert.equal(V.countVoxels(g), 8);
});

/* ------------------------------- CSG --------------------------------- */

test('addBox fills an exact half open millimetre range', () => {
  const g = V.createGrid(5, 5, 5, 2);
  V.addBox(g, 2, 2, 2, 4, 4, 2);
  assert.equal(V.countVoxels(g), 4);
  assert.equal(V.getVoxel(g, 1, 1, 1), 1);
  assert.equal(V.getVoxel(g, 2, 2, 1), 1);
  assert.equal(V.getVoxel(g, 3, 0, 1), 0);
});

test('addBox clamps geometry that extends past the grid', () => {
  const g = V.createGrid(3, 3, 3, 1);
  V.addBox(g, -5, -5, -5, 99, 99, 99);
  assert.equal(V.countVoxels(g), 27);
});

test('subtractBox removes only the specified region', () => {
  const g = solidBox(5, 5, 5);
  V.subtractBox(g, 1, 1, 0, 3, 3, 5);
  assert.equal(V.countVoxels(g), 125 - 45);
  assert.equal(V.getVoxel(g, 1, 1, 2), 0);
  assert.equal(V.getVoxel(g, 0, 0, 2), 1);
});

test('addSphere produces a roughly spherical cell count', () => {
  const g = V.createGrid(10, 10, 10, 1);
  V.addSphere(g, 5, 5, 5, 3);
  const n = V.countVoxels(g);
  assert.ok(n > 90 && n < 140, `sphere cell count was ${n}`);
  assert.equal(V.getVoxel(g, 5, 5, 5), 1);
  assert.equal(V.getVoxel(g, 0, 0, 0), 0);
});

test('subtractSphere carves a spherical cavity', () => {
  const g = solidBox(8, 8, 8);
  const before = V.countVoxels(g);
  V.subtractSphere(g, 4, 4, 4, 2.5);
  assert.ok(V.countVoxels(g) < before);
  assert.equal(V.getVoxel(g, 4, 4, 4), 0);
  assert.equal(V.getVoxel(g, 0, 0, 0), 1);
});

test('addCylinder along z fills a circular column', () => {
  const g = V.createGrid(10, 10, 6, 1);
  V.addCylinder(g, 5, 5, 0, 3, 6, 'z');
  const perLayer = V.countVoxels(g) / 6;
  assert.equal(perLayer, 32);
  assert.ok(perLayer > 24 && perLayer < 34);
});

test('addCylinder supports the x and y axes', () => {
  const gx = V.createGrid(6, 10, 10, 1);
  V.addCylinder(gx, 0, 5, 5, 3, 6, 'x');
  const gy = V.createGrid(10, 6, 10, 1);
  V.addCylinder(gy, 5, 0, 5, 3, 6, 'y');
  assert.ok(V.countVoxels(gx) > 100);
  assert.equal(V.countVoxels(gx), V.countVoxels(gy));
});

test('subtractCylinder drills a through hole', () => {
  const g = solidBox(10, 10, 6);
  V.subtractCylinder(g, 5, 5, 0, 2, 6, 'z');
  assert.equal(V.getVoxel(g, 5, 5, 3), 0);
  assert.equal(V.getVoxel(g, 0, 0, 3), 1);
});

test('cylinder rejects an unknown axis', () => {
  const g = V.createGrid(3, 3, 3);
  assert.throws(() => V.addCylinder(g, 1, 1, 0, 1, 3, 'w'), RangeError);
});

test('mirrorGrid x flips a voxel across the center plane', () => {
  const g = V.createGrid(4, 3, 3);
  V.setVoxel(g, 0, 1, 1, 1);
  V.mirrorGrid(g, 'x');
  assert.equal(V.getVoxel(g, 3, 1, 1), 1);
  assert.equal(V.countVoxels(g), 1);
});

test('mirrorGrid supports y, z, and numeric axis codes', () => {
  const g = V.createGrid(3, 4, 5);
  V.setVoxel(g, 1, 0, 0, 1);
  V.mirrorGrid(g, 'y');
  assert.equal(V.getVoxel(g, 1, 3, 0), 1);
  V.mirrorGrid(g, 2);
  assert.equal(V.getVoxel(g, 1, 3, 4), 1);
});

test('shellGrid hollows a solid block into a closed wall', () => {
  const g = solidBox(8, 8, 8);
  V.shellGrid(g, 1);
  assert.equal(V.countVoxels(g), 8 * 8 * 8 - 6 * 6 * 6);
  assert.equal(V.getVoxel(g, 0, 0, 0), 1);
  assert.equal(V.getVoxel(g, 4, 4, 4), 0);
});

test('shellGrid with a thicker wall removes more interior cells', () => {
  const g = solidBox(10, 10, 10);
  V.shellGrid(g, 2);
  assert.equal(V.countVoxels(g), 1000 - 6 * 6 * 6);
});

test('unionGrid ORs two occupancy fields', () => {
  const a = V.createGrid(4, 4, 4);
  const b = V.createGrid(4, 4, 4);
  V.addBox(a, 0, 0, 0, 1, 4, 4);
  V.addBox(b, 3, 0, 0, 1, 4, 4);
  V.unionGrid(a, b);
  assert.equal(V.countVoxels(a), 32);
});

test('subtractGrid applies a boolean difference', () => {
  const a = solidBox(4, 4, 4);
  const b = V.createGrid(4, 4, 4);
  V.addBox(b, 1, 1, 1, 2, 2, 2);
  V.subtractGrid(a, b);
  assert.equal(V.countVoxels(a), 64 - 8);
});

test('cloneGrid produces an independent copy', () => {
  const a = V.createGrid(3, 3, 3, 2);
  V.setVoxel(a, 1, 1, 1, 1);
  const b = V.cloneGrid(a);
  assert.equal(V.getVoxel(b, 1, 1, 1), 1);
  V.setVoxel(b, 1, 1, 1, 0);
  assert.equal(V.getVoxel(a, 1, 1, 1), 1);
  assert.equal(b.pitchMm, 2);
});

/* --------------------------- Face culling ---------------------------- */

test('a single voxel has six exposed faces', () => {
  const g = V.createGrid(3, 3, 3);
  V.setVoxel(g, 1, 1, 1, 1);
  assert.equal(V.countExposedFaces(g), 6);
  assert.equal(V.naiveTriangleCount(g), 12);
});

test('internal faces of a solid block are culled', () => {
  const g = solidBox(4, 4, 4);
  assert.equal(V.countExposedFaces(g), 6 * 16);
  assert.equal(V.naiveTriangleCount(g), 64 * 12);
  assert.ok(V.naiveTriangleCount(g) > V.countExposedFaces(g) * 2);
});

test('greedy mesher merges a solid block into six quads', () => {
  const g = solidBox(5, 6, 7);
  assert.equal(V.buildQuads(g).length, 6);
});

test('greedy quads are fewer than naive exposed faces', () => {
  const g = solidBox(6, 6, 6);
  assert.ok(V.buildQuads(g).length < V.countExposedFaces(g) / 4);
});

test('merged triangles are fewer than naive triangles for large flat regions', () => {
  const g = V.createGrid(12, 12, 12, 1);
  V.addBox(g, 2, 2, 2, 8, 8, 2);
  const mesh = V.extractManifoldMesh(g);
  const naive = V.naiveTriangleCount(g);
  assert.ok(naive > mesh.stats.triangleCount, 'culled interior faces should beat naive per voxel triangles');
  assert.ok(mesh.stats.quadCount < V.countExposedFaces(g) / 4, 'greedy quads should merge exposed faces');
  assert.equal(mesh.triangles.length, V.countExposedFaces(g) * 2);
  assert.ok(mesh.stats.mergeRatio > 1);
});

/* ----------------------------- Manifold ------------------------------ */

test('a single voxel mesh is a watertight genus zero surface', () => {
  const g = V.createGrid(3, 3, 3);
  V.setVoxel(g, 1, 1, 1, 1);
  const mesh = V.extractManifoldMesh(g);
  assert.equal(mesh.stats.watertight, true);
  assert.equal(mesh.stats.unmatchedEdges, 0);
  assert.equal(mesh.stats.eulerCharacteristic, 2);
  assert.equal(mesh.stats.genusEstimate, 0);
  verifyDirectedEdges(mesh, 'single voxel');
});

test('solid block volume matches voxel count times pitch cubed', () => {
  const g = solidBox(5, 6, 7, 2);
  const mesh = V.extractManifoldMesh(g);
  const expected = V.countVoxels(g) * Math.pow(2, 3) / 1000;
  assert.ok(Math.abs(mesh.stats.volumeCm3 - expected) < 1e-9);
  assert.ok(Math.abs(mesh.stats.volumeMm3 - expected * 1000) < 1e-9);
});

test('signed volume is positive so triangle winding is outward', () => {
  const g = solidBox(4, 4, 4, 1.5);
  const mesh = V.extractManifoldMesh(g);
  assert.ok(mesh.stats.volumeMm3 > 0);
  for (const tri of mesh.triangles) {
    const n = mesh.normals[mesh.triangles.indexOf(tri)];
    assert.equal(Math.hypot(n[0], n[1], n[2]), 1);
  }
});

test('normals are outward unit vectors on a box', () => {
  const g = solidBox(3, 3, 3);
  const mesh = V.extractManifoldMesh(g);
  for (let i = 0; i < mesh.triangles.length; i++) {
    const [a, b, c] = mesh.triangles[i].map((id) => mesh.vertices[id]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = mesh.normals[i];
    assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0);
  }
});

test('surface area and bounding box use millimetre units', () => {
  const g = solidBox(4, 5, 6, 2);
  const mesh = V.extractManifoldMesh(g);
  const area = 2 * (8 * 10 + 8 * 12 + 10 * 12);
  assert.ok(Math.abs(mesh.stats.surfaceAreaMm2 - area) < 1e-6);
  assert.deepEqual(mesh.stats.boundingBoxMm.min, [0, 0, 0]);
  assert.deepEqual(mesh.stats.boundingBoxMm.max, [8, 10, 12]);
  assert.deepEqual(mesh.stats.boundingBoxMm.size, [8, 10, 12]);
});

test('Euler characteristic equals V minus E plus F', () => {
  const g = solidBox(3, 4, 5);
  const mesh = V.extractManifoldMesh(g);
  assert.equal(mesh.stats.eulerCharacteristic,
    mesh.stats.uniqueVertices - mesh.stats.uniqueEdges + mesh.stats.triangleCount);
  assert.equal(mesh.stats.eulerCharacteristic, 2);
});

test('a drilled through hole raises the genus to one', () => {
  const g = solidBox(8, 8, 4);
  V.subtractCylinder(g, 4, 4, 0, 2, 4, 'z');
  const mesh = V.extractManifoldMesh(g);
  assert.equal(mesh.stats.watertight, true);
  assert.equal(mesh.stats.eulerCharacteristic, 0);
  assert.equal(mesh.stats.genusEstimate, 1);
  verifyDirectedEdges(mesh, 'drilled plate');
});

test('every preset produces a closed manifold with matched directed edges', () => {
  const o = presetGridSizes();
  for (const name of V.listPresets()) {
    const grid = V.loadPreset(name, o);
    const mesh = V.extractManifoldMesh(grid);
    assert.ok(mesh.triangles.length > 0, `${name} produced no triangles`);
    assert.equal(mesh.stats.watertight, true, `${name} was not watertight`);
    assert.equal(mesh.stats.unmatchedEdges, 0, `${name} had unmatched edges`);
    verifyDirectedEdges(mesh, name);
    const expected = V.countVoxels(grid) * Math.pow(grid.pitchMm, 3) / 1000;
    assert.ok(Math.abs(mesh.stats.volumeCm3 - expected) < 1e-8, `${name} volume mismatch`);
  }
});

/* ------------------------------- Mass -------------------------------- */

test('PLA mass uses 1.24 g per cubic centimetre at full infill', () => {
  const g = solidBox(10, 10, 10);
  const mesh = V.extractManifoldMesh(g);
  assert.ok(Math.abs(mesh.stats.volumeCm3 - 1) < 1e-9);
  assert.ok(Math.abs(mesh.stats.plaMassG - 1.24) < 1e-9);
  assert.ok(Math.abs(mesh.stats.petgMassG - 1.27) < 1e-9);
});

test('infill percentage scales mass linearly', () => {
  const g = solidBox(10, 10, 10);
  const full = V.extractManifoldMesh(g);
  const light = V.extractManifoldMesh(g, { infillPercent: 20 });
  assert.equal(light.stats.infillPercent, 20);
  assert.ok(Math.abs(light.stats.plaMassG - full.stats.plaMassG * 0.2) < 1e-9);
});

test('estimateMass supports material names and custom density', () => {
  const mesh = V.extractManifoldMesh(solidBox(10, 10, 10));
  const petg = V.estimateMass(mesh, { material: 'PETG', infillPercent: 50 });
  const custom = V.estimateMass(mesh, { density: 2, infillPercent: 50 });
  assert.ok(Math.abs(petg.grams - 1.27 * 0.5) < 1e-9);
  assert.ok(Math.abs(custom.grams - 1) < 1e-9);
});

test('infill is clamped to the zero to one hundred range', () => {
  const g = solidBox(2, 2, 2);
  assert.equal(V.extractManifoldMesh(g, { infillPercent: 900 }).stats.infillPercent, 100);
  assert.equal(V.extractManifoldMesh(g, { infillPercent: -4 }).stats.infillPercent, 0);
});

test('an empty grid has zero volume and is not watertight', () => {
  const mesh = V.extractManifoldMesh(V.createGrid(3, 3, 3));
  assert.equal(mesh.triangles.length, 0);
  assert.equal(mesh.stats.volumeCm3, 0);
  assert.equal(mesh.stats.watertight, false);
  assert.equal(mesh.stats.plaMassG, 0);
});

/* ----------------------------- Exporters ----------------------------- */

test('exportAsciiSTL emits a valid named solid', () => {
  const text = V.exportAsciiSTL(V.extractManifoldMesh(solidBox(2, 2, 2)), 'My Box');
  assert.ok(text.startsWith('solid My_Box\n'));
  assert.ok(text.trimEnd().endsWith('endsolid My_Box'));
  assert.equal((text.match(/facet normal/g) || []).length, (text.match(/outer loop/g) || []).length);
  assert.equal((text.match(/endfacet/g) || []).length, (text.match(/outer loop/g) || []).length);
});

test('exportAsciiSTL facet count matches the mesh triangle count', () => {
  const mesh = V.extractManifoldMesh(solidBox(3, 3, 3));
  const text = V.exportAsciiSTL(mesh, 'cube');
  assert.equal((text.match(/vertex /g) || []).length, mesh.triangles.length * 3);
  assert.ok(/facet normal 0\.000000 0\.000000 1\.000000/.test(text));
});

test('exportBinarySTL has an 84 byte header and correct facet count', () => {
  const mesh = V.extractManifoldMesh(solidBox(2, 3, 4));
  const bytes = V.exportBinarySTL(mesh, 'bin');
  assert.equal(bytes.length, 84 + 50 * mesh.triangles.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(80, true), mesh.triangles.length);
  const header = String.fromCharCode.apply(null, bytes.slice(0, 23));
  assert.ok(header.startsWith('VoxelSynth binary STL:'));
});

test('exportOBJ declares vertices, normals, and faces with valid indices', () => {
  const mesh = V.extractManifoldMesh(solidBox(3, 3, 3));
  const lines = V.exportOBJ(mesh, 'widget').trim().split('\n');
  const vCount = lines.filter((l) => l.startsWith('v ')).length;
  const nCount = lines.filter((l) => l.startsWith('vn ')).length;
  const faces = lines.filter((l) => l.startsWith('f '));
  assert.equal(vCount, mesh.vertices.length);
  assert.equal(nCount, mesh.triangles.length);
  assert.equal(faces.length, mesh.triangles.length);
  for (const f of faces) {
    for (const token of f.slice(2).split(' ')) {
      const [vi, , ni] = token.split('/').map(Number);
      assert.ok(vi >= 1 && vi <= vCount);
      assert.ok(ni >= 1 && ni <= nCount);
    }
  }
});

test('exportOpenSCAD emits a union module with merged cubes', () => {
  const g = solidBox(4, 4, 4, 2);
  const text = V.exportOpenSCAD(g);
  assert.ok(text.includes('module voxelsynth_body()'));
  assert.ok(text.includes('union()'));
  assert.ok(text.includes('voxelsynth_body();'));
  assert.ok(text.includes('pitch = 2.000000;'));
  assert.equal((text.match(/cube\(/g) || []).length, 1);
});

test('exportOpenSCAD merged boxes cover exactly the solid voxel cells', () => {
  const g = V.deskOrganizerPreset(presetGridSizes());
  const text = V.exportOpenSCAD(g);
  const re = /translate\(\[([-\d.]+), ([-\d.]+), ([-\d.]+)\]\) cube\(\[([-\d.]+), ([-\d.]+), ([-\d.]+)\]/g;
  let covered = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const nums = match.slice(1).map(Number);
    covered += (nums[3] / g.pitchMm) * (nums[4] / g.pitchMm) * (nums[5] / g.pitchMm);
  }
  assert.equal(covered, V.countVoxels(g));
  assert.ok((text.match(/cube\(/g) || []).length < V.countVoxels(g));
});

test('exporters sanitize solid and object names', () => {
  const mesh = V.extractManifoldMesh(solidBox(2, 2, 2));
  assert.ok(V.exportAsciiSTL(mesh, 'a/b c!!').includes('solid a_b_c'));
  assert.ok(V.exportOBJ(mesh, '').includes('o voxelsynth'));
});

/* ---------------------------- Serialization -------------------------- */

test('serializeGrid and deserializeGrid roundtrip all cells', () => {
  const g = V.loadPreset('cableComb', presetGridSizes());
  const snapshot = V.serializeGrid(g);
  assert.equal(snapshot.format, 'voxelsynth-grid-v1');
  assert.equal(typeof snapshot.cells, 'string');
  const restored = V.deserializeGrid(snapshot);
  assert.equal(restored.nx, g.nx);
  assert.equal(restored.pitchMm, g.pitchMm);
  assert.deepEqual(Array.from(restored.data), Array.from(g.data));
});

test('deserializeGrid rejects unknown formats', () => {
  assert.throws(() => V.deserializeGrid({ format: 'nope' }), TypeError);
});

/* -------------------------------- SDF -------------------------------- */

test('sdfBox is negative inside and positive outside', () => {
  assert.ok(V.sdfBox(5, 5, 5, [0, 0, 0], [10, 10, 10]) < 0);
  assert.ok(V.sdfBox(20, 5, 5, [0, 0, 0], [10, 10, 10]) > 0);
});

test('sdfSphere is the distance to the surface', () => {
  assert.equal(V.sdfSphere(3, 0, 0, 0, 0, 0, 2), 1);
  assert.equal(V.sdfSphere(2, 0, 0, 0, 0, 0, 2), 0);
});

test('sdfCylinder respects its axis', () => {
  assert.ok(V.sdfCylinder(1, 1, 5, 0, 0, 0, 3, 10, 'z') < 0);
  assert.ok(V.sdfCylinder(5, 1, 1, 0, 0, 0, 3, 10, 'x') < 0);
  assert.ok(V.sdfCylinder(9, 9, 5, 0, 0, 0, 3, 10, 'z') > 0);
});

test('SDF boolean combinators match min and max semantics', () => {
  assert.equal(V.sdfUnion(2, 5), 2);
  assert.equal(V.sdfSubtract(2, 5), 2);
  assert.equal(V.sdfSubtract(2, -5), 5);
  assert.equal(V.sdfIntersect(2, 5), 5);
  assert.ok(V.sdfSmoothUnion(-1, -1, 0.5) <= -1);
});

test('rasterizeSDF fills grid cells where the field is nonpositive', () => {
  const g = V.createGrid(10, 10, 10, 1);
  V.rasterizeSDF(g, (x, y, z) => V.sdfSphere(x, y, z, 5, 5, 5, 3));
  assert.equal(V.countVoxels(g), V.addSphere(V.createGrid(10, 10, 10, 1), 5, 5, 5, 3).data.reduce((a, b) => a + b, 0));
});

test('rasterizeSDF can subtract from an existing solid', () => {
  const g = solidBox(8, 8, 8);
  const before = V.countVoxels(g);
  V.rasterizeSDF(g, (x, y, z) => V.sdfSphere(x, y, z, 4, 4, 4, 2), 'subtract');
  assert.ok(V.countVoxels(g) < before);
});

/* ------------------------------ Presets ------------------------------ */

test('listPresets exposes the five CAD designs and four sculpture designs', () => {
  assert.deepEqual(V.listPresets().sort(),
    ['cableComb', 'deskOrganizer', 'gyroidPavilion', 'helicalRibbon', 'mengerLantern', 'rpiPicoMount', 'sdCardVault', 'sdfDock', 'voronoiAmphitheater']);
  assert.deepEqual(V.listSculpturePresets().map(item => item.id).sort(),
    ['gyroidPavilion', 'helicalRibbon', 'mengerLantern', 'voronoiAmphitheater']);
});

test('loadPreset rejects an unknown name', () => {
  assert.throws(() => V.loadPreset('notAPreset'), RangeError);
});

test('deskOrganizerPreset creates multiple compartments', () => {
  const g = V.deskOrganizerPreset({ pitchMm: 2, nx: 24, ny: 16, nz: 10, compartments: 3 });
  assert.ok(V.countVoxels(g) > 0);
  assert.equal(V.getVoxel(g, 0, 0, 0), 1);
  assert.equal(V.getVoxel(g, 12, 8, 6), 0);
  assert.equal(g.data.length, 24 * 16 * 10);
});

test('sdCardVaultPreset has hollow interior walls', () => {
  const g = V.sdCardVaultPreset(presetGridSizes());
  assert.ok(V.countVoxels(g) > 0);
  assert.equal(V.getVoxel(g, 0, 0, 0), 1);
  assert.equal(V.getVoxel(g, 10, 7, 4), 0);
});

test('cableCombPreset contains several channels', () => {
  const g = V.cableCombPreset(presetGridSizes());
  const mesh = V.extractManifoldMesh(g);
  assert.ok(mesh.stats.eulerCharacteristic < 2, 'channels should add topological handles');
  assert.ok(mesh.stats.surfaceAreaMm2 > 0);
});

test('rpiPicoMountPreset keeps four mounting holes open', () => {
  const g = V.rpiPicoMountPreset(presetGridSizes());
  assert.ok(V.countVoxels(g) > 0);
  const mesh = V.extractManifoldMesh(g);
  assert.equal(mesh.stats.watertight, true);
  assert.ok(mesh.stats.eulerCharacteristic < 2);
});

test('preset options change grid resolution and pitch', () => {
  const g = V.deskOrganizerPreset({ pitchMm: 1, nx: 12, ny: 9, nz: 6, wallMm: 1 });
  assert.equal(g.pitchMm, 1);
  assert.equal(g.nx, 12);
  assert.equal(g.data.length, 12 * 9 * 6);
});

test('the library reports its semantic version', () => {
  assert.equal(V.version, '2.0.0');
});

/* Regression audit: validation, lattice boundaries and topology. */
test('grid allocation rejects oversized and unsafe shapes before allocating', () => {
  assert.throws(() => V.createGrid(2000001, 1, 1), /cell limit/);
  assert.throws(() => V.createGrid(Number.MAX_SAFE_INTEGER, 2, 2), /cell limit/);
  assert.equal(V.createGrid(2000000, 1, 1).data.length, V.MAX_GRID_CELLS);
});

test('grid validation rejects malformed buffers and pitches', () => {
  const original = V.createGrid(2, 2, 2);
  for (const changed of [{ data: new Uint8Array(7) }, { data: new Float32Array(8) }, { data: [] }, { nx: 2.5 }, { nx: -2 }, { pitchMm: NaN }]) {
    assert.throws(() => V.countVoxels({ ...original, ...changed }), TypeError);
  }
});

test('fractional and nonfinite coordinates cannot alias another voxel', () => {
  const grid = solidBox(4, 4, 4);
  for (const cell of [[0, 0.5, 0], [0.5, 0, 0], [0, 0, 0.5], [NaN, 0, 0], [Infinity, 0, 0]]) {
    assert.equal(V.getVoxel(grid, ...cell), 0);
    assert.equal(V.setVoxel(grid, ...cell, 0), false);
    assert.equal(V.inBounds(grid, ...cell), false);
  }
  assert.equal(V.countVoxels(grid), 64);
});

test('box sampling includes a center at its minimum and excludes its maximum', () => {
  const grid = V.createGrid(4, 1, 1);
  V.addBox(grid, 0.5, 0, 0, 1, 1, 1);
  assert.deepEqual(Array.from(grid.data), [1, 0, 0, 0]);
});

test('zero size boxes do not add cells', () => {
  const grid = V.createGrid(4, 4, 4);
  V.addBox(grid, 0, 0, 0, 0, 2, 2);
  assert.equal(V.countVoxels(grid), 0);
});

test('sphere sampling includes both ends of a closed radial boundary', () => {
  const grid = V.createGrid(3, 3, 3);
  V.addSphere(grid, 1.5, 1.5, 1.5, 1);
  assert.equal(V.countVoxels(grid), 7);
});

test('cylinder axial sampling is half open and radial sampling is closed', () => {
  const grid = V.createGrid(3, 3, 3);
  V.addCylinder(grid, 1.5, 1.5, 0.5, 1, 1, 'z');
  assert.equal(V.countVoxels(grid), 5);
  assert.equal(V.getVoxel(grid, 1, 1, 0), 1);
  assert.equal(V.getVoxel(grid, 1, 1, 1), 0);
});

test('invalid primitive dimensions and coordinates fail without mutation', () => {
  const grid = solidBox(4, 4, 4), before = Array.from(grid.data);
  for (const action of [
    () => V.addBox(grid, 0, 0, 0, -2, 2, 2),
    () => V.subtractBox(grid, NaN, 0, 0, 2, 2, 2),
    () => V.addSphere(grid, 2, 2, 2, -1),
    () => V.subtractSphere(grid, 2, 2, 2, Infinity),
    () => V.addCylinder(grid, 2, 2, 0, 1, -2),
    () => V.subtractCylinder(grid, 2, 2, 0, 0, 2)
  ]) {
    assert.throws(action, RangeError);
    assert.deepEqual(Array.from(grid.data), before);
  }
});

test('shell wall rounds upward to preserve the requested minimum thickness', () => {
  const grid = solidBox(10, 10, 10, 2);
  V.shellGrid(grid, 2.1);
  assert.equal(V.countVoxels(grid), 1000 - 6 * 6 * 6);
});

test('invalid shell widths do not change geometry', () => {
  const grid = solidBox(4, 4, 4);
  for (const wall of [0, -1, NaN, Infinity]) assert.throws(() => V.shellGrid(grid, wall), RangeError);
  assert.equal(V.countVoxels(grid), 64);
});

test('huge shell walls terminate at the available solid depth', () => {
  const grid = solidBox(6, 6, 6);
  V.shellGrid(grid, 1e12);
  assert.equal(V.countVoxels(grid), 216);
});

test('booleans reject grids with incompatible physical pitch', () => {
  const a = solidBox(4, 4, 4), b = solidBox(4, 4, 4, 2);
  assert.throws(() => V.unionGrid(a, b), /matching pitch/);
  assert.throws(() => V.subtractGrid(a, b), /matching pitch/);
  assert.equal(V.countVoxels(a), 64);
});

test('mirror rejects unknown axes instead of silently using X', () => {
  assert.throws(() => V.mirrorGrid(solidBox(4, 4, 4), 'xx'), RangeError);
});

test('edge contacts are detected even with opposite directed edges', () => {
  const grid = V.createGrid(3, 3, 2);
  V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 0, 1);
  const stats = V.extractManifoldMesh(grid).stats;
  assert.equal(stats.watertight, false);
  assert.equal(stats.nonManifoldEdges, 1);
  assert.equal(stats.nonManifoldVertices, 2);
  assert.equal(stats.genusEstimate, null);
});

test('corner contacts fail the connected vertex link condition', () => {
  const grid = V.createGrid(3, 3, 3);
  V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 1, 1);
  const stats = V.extractManifoldMesh(grid).stats;
  assert.equal(stats.boundaryEdges, 0);
  assert.equal(stats.nonManifoldEdges, 0);
  assert.equal(stats.nonManifoldVertices, 1);
  assert.equal(stats.surfaceComponents, 2);
  assert.equal(stats.watertight, false);
});

test('separated closed components have total genus zero', () => {
  const grid = V.createGrid(4, 4, 4);
  V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 2, 2, 2, 1);
  const stats = V.extractManifoldMesh(grid).stats;
  assert.equal(stats.watertight, true);
  assert.equal(stats.surfaceComponents, 2);
  assert.equal(stats.eulerCharacteristic, 4);
  assert.equal(stats.genusEstimate, 0);
});

test('a hollow shell accounts for outer and inner surface components', () => {
  const grid = solidBox(8, 8, 8); V.shellGrid(grid, 1);
  const stats = V.extractManifoldMesh(grid).stats;
  assert.equal(stats.watertight, true);
  assert.equal(stats.surfaceComponents, 2);
  assert.equal(stats.eulerCharacteristic, 4);
  assert.equal(stats.genusEstimate, 0);
  assert.ok(Math.abs(stats.volumeMm3 - V.countVoxels(grid)) < 1e-9);
});

test('duplicated facets cannot pass counted edge verification', () => {
  const mesh = V.extractManifoldMesh(solidBox(2, 2, 2));
  mesh.triangles.push(mesh.triangles[0].slice()); mesh.normals.push(mesh.normals[0].slice());
  const stats = V.analyzeMesh(mesh);
  assert.equal(stats.watertight, false);
  assert.equal(stats.nonManifoldEdges, 3);
});

test('missing facets produce explicit boundary edge diagnostics', () => {
  const mesh = V.extractManifoldMesh(solidBox(2, 2, 2));
  mesh.triangles.pop(); mesh.normals.pop();
  const stats = V.analyzeMesh(mesh);
  assert.equal(stats.watertight, false);
  assert.equal(stats.boundaryEdges, 3);
});

test('unused OBJ vertices do not corrupt the surface Euler characteristic', () => {
  const mesh = V.extractManifoldMesh(solidBox(2, 2, 2));
  mesh.vertices.push([100, 100, 100]);
  assert.equal(V.analyzeMesh(mesh).eulerCharacteristic, 2);
});

test('all 256 occupancy configurations of a 2 x 2 x 2 block preserve volume and face counts', () => {
  for (let bits = 0; bits < 256; bits++) {
    const grid = V.createGrid(2, 2, 2);
    for (let i = 0; i < 8; i++) grid.data[i] = (bits >> i) & 1;
    const mesh = V.extractManifoldMesh(grid);
    assert.equal(mesh.triangles.length, V.countExposedFaces(grid) * 2, `mask ${bits}`);
    assert.ok(Math.abs(mesh.stats.volumeMm3 - V.countVoxels(grid)) < 1e-9, `mask ${bits}`);
  }
});

test('nonfinite infill and invalid material density are rejected', () => {
  const grid = solidBox(4, 4, 4), mesh = V.extractManifoldMesh(grid);
  for (const value of [NaN, Infinity]) {
    assert.throws(() => V.extractManifoldMesh(grid, { infillPercent: value }), RangeError);
    assert.throws(() => V.estimateMass(mesh, { infillPercent: value }), RangeError);
  }
  for (const density of [0, -2, NaN, Infinity]) assert.throws(() => V.estimateMass(mesh, { density }), RangeError);
  assert.throws(() => V.estimateMass(mesh, { material: 'unknown' }), /unknown material/);
});

test('mass estimation inherits the mesh infill percentage', () => {
  const mesh = V.extractManifoldMesh(solidBox(10, 10, 10), { infillPercent: 25 });
  assert.equal(V.estimateMass(mesh).infillPercent, 25);
  assert.ok(Math.abs(V.estimateMass(mesh).grams - 0.31) < 1e-9);
});

test('smooth union with zero blending radius is an ordinary finite union', () => {
  assert.equal(V.sdfSmoothUnion(-2, 3, 0), -2);
  assert.equal(V.sdfSmoothUnion(1, 1, 0), 1);
  for (const width of [-1, NaN, Infinity]) assert.throws(() => V.sdfSmoothUnion(1, 2, width), RangeError);
});

test('SDF replace removes occupancy outside the new field', () => {
  const grid = solidBox(6, 6, 6);
  V.rasterizeSDF(grid, (x, y, z) => V.sdfSphere(x, y, z, 3, 3, 3, 1), 'replace');
  assert.equal(V.countVoxels(grid), 8);
});

test('SDF errors and nonfinite samples fail transactionally', () => {
  const grid = solidBox(4, 4, 4), before = Array.from(grid.data);
  assert.throws(() => V.rasterizeSDF(grid, () => -1, 'unknown'), RangeError);
  let samples = 0;
  assert.throws(() => V.rasterizeSDF(grid, () => ++samples < 5 ? -1 : NaN, 'subtract'), RangeError);
  assert.deepEqual(Array.from(grid.data), before);
  assert.throws(() => V.rasterizeSDF(grid, () => { throw new Error('field failed'); }, 'replace'), /field failed/);
  assert.deepEqual(Array.from(grid.data), before);
});

test('snapshot rejects truncated, overlong and nonbinary occupancy', () => {
  const original = V.serializeGrid(solidBox(2, 2, 2));
  for (const raw of ['1111111', '111111111', '1111x111']) {
    const cells = Buffer.from(raw).toString('base64');
    assert.throws(() => V.deserializeGrid({ ...original, cells }), TypeError);
  }
});

test('snapshot rejects invalid or noncanonical base64', () => {
  const original = V.serializeGrid(V.createGrid(1, 1, 1));
  for (const cells of ['!!!!', 'MA= ', 'MB==', 'MA', 12, null]) {
    assert.throws(() => V.deserializeGrid({ ...original, cells }), TypeError);
  }
});

test('preset dispatch rejects inherited object property names', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) assert.throws(() => V.loadPreset(name), RangeError);
});

test('preset zero and invalid options are not silently defaulted', () => {
  for (const name of V.listPresets()) {
    for (const options of [{ nx: 0 }, { pitchMm: 0 }, { ny: NaN }, { nz: 3 }]) assert.throws(() => V.loadPreset(name, options), RangeError);
  }
  assert.throws(() => V.deskOrganizerPreset({ compartments: 0 }), RangeError);
  assert.throws(() => V.cableCombPreset({ channels: 0 }), RangeError);
});

test('board fixture retains raised standoffs after clearing the interior', () => {
  const grid = V.rpiPicoMountPreset();
  assert.equal(V.getVoxel(grid, 5, 2, 3), 1);
  assert.equal(V.getVoxel(grid, 4, 3, 3), 0);
});

test('SDF dock is generated by a finite blended field and has a flat manifold rim', () => {
  const grid = V.sdfDockPreset();
  const stats = V.extractManifoldMesh(grid).stats;
  assert.equal(stats.watertight, true);
  assert.ok(stats.voxelCount > 0);
  assert.ok(stats.boundingBoxMm.max[2] <= grid.nz * grid.pitchMm * 0.58 + grid.pitchMm / 2);
});

test('SDF primitives reject malformed dimensions, nonfinite inputs and arithmetic overflow', () => {
  assert.throws(() => V.sdfBox(0, 0, 0, [0, 0], [1, 1, 1]), TypeError);
  assert.throws(() => V.sdfBox(0, 0, 0, [0, 0, 0], [-1, 1, 1]), RangeError);
  assert.throws(() => V.sdfSphere(0, 0, 0, 0, 0, 0, -1), RangeError);
  assert.throws(() => V.sdfSphere(-1e308, 0, 0, 1e308, 0, 0, 1), RangeError);
  assert.throws(() => V.sdfCylinder(0, 0, 0, 0, 0, 0, 1, 0), RangeError);
  assert.throws(() => V.sdfCylinder(NaN, 0, 0, 0, 0, 0, 1, 1), RangeError);
});

test('mass estimates reject corrupt volumes and overflowing products', () => {
  for (const volumeCm3 of [NaN, Infinity, -1]) assert.throws(() => V.estimateMass({ stats: { volumeCm3 } }), TypeError);
  assert.throws(() => V.estimateMass({ stats: { volumeCm3: 10 } }, { density: 1e308 }), RangeError);
});

test('mesh volume uses a nearby reference to remain stable under large translations', () => {
  const mesh = V.extractManifoldMesh(solidBox(4, 5, 6, 0.001));
  mesh.vertices = mesh.vertices.map(point => point.map(value => value + 1e12));
  const stats = V.analyzeMesh(mesh);
  const expected = stats.boundingBoxMm.size.reduce((a, b) => a * b, 1);
  assert.equal(stats.watertight, true);
  assert.ok(Math.abs(stats.volumeMm3 - expected) / expected < 1e-12);
});

test('a full capacity snapshot validates canonically without recursive regular expression limits', () => {
  const grid = V.createGrid(V.MAX_GRID_CELLS, 1, 1);
  grid.data[0] = 1; grid.data[grid.data.length - 1] = 1;
  const restored = V.deserializeGrid(V.serializeGrid(grid));
  assert.equal(restored.data.length, V.MAX_GRID_CELLS);
  assert.equal(V.countVoxels(restored), 2);
});

test('sphere center sampling stays finite when squared distances would overflow', () => {
  const grid = V.createGrid(1, 1, 1, 1);
  V.addSphere(grid, 1e200, 1e200, 1e200, 1e200);
  assert.equal(V.countVoxels(grid), 0);
});
test('cylinder center sampling avoids Infinity comparison for far radial coordinates', () => {
  const grid = V.createGrid(1, 1, 1, 1);
  V.addCylinder(grid, 1e200, 1e200, 0, 1e200, 1, 'z');
  assert.equal(V.countVoxels(grid), 0);
});
test('complex occupancy is rejected before allocating an oversized surface', () => {
  const grid = V.createGrid(48, 48, 32, 1);
  for (let z=0;z<32;z++) for(let y=0;y<48;y++) for(let x=0;x<48;x++) if((x+y+z)%2===0) V.setVoxel(grid,x,y,z,1);
  assert.throws(() => V.extractManifoldMesh(grid), /triangle budget/);
  assert.equal(V.MAX_MESH_TRIANGLES,250000);
});

/* ------------------------ Sculpture presets ------------------------ */

for (const item of V.listSculpturePresets()) {
  test('sculpture ' + item.id + ' generates deterministic non-empty geometry', () => {
    const first = V.loadPreset(item.id), second = V.loadPreset(item.id);
    assert.ok(V.countVoxels(first) > 0, item.label + ' produced an empty lattice');
    assert.deepEqual(Array.from(first.data), Array.from(second.data));
    assert.equal(first.nx, item.nx); assert.equal(first.ny, item.ny); assert.equal(first.nz, item.nz);
    assert.equal(first.pitchMm, item.pitchMm);
  });

  test('sculpture ' + item.id + ' produces a closed manifold with matched directed edges', () => {
    const grid = V.loadPreset(item.id), mesh = V.extractManifoldMesh(grid);
    assert.ok(mesh.triangles.length > 0);
    assert.equal(mesh.stats.watertight, true, item.label + ' was not watertight');
    assert.equal(mesh.stats.boundaryEdges, 0);
    assert.equal(mesh.stats.unmatchedEdges, 0);
    assert.equal(mesh.stats.nonManifoldVertices, 0);
    verifyDirectedEdges(mesh, item.label);
    const expected = V.countVoxels(grid) * Math.pow(grid.pitchMm, 3) / 1000;
    assert.ok(Math.abs(mesh.stats.volumeCm3 - expected) < 1e-8);
  });

  test('sculpture ' + item.id + ' rejects invalid resolution options', () => {
    for (const options of [{ nx: 0 }, { ny: 3 }, { nz: NaN }, { pitchMm: 0 }]) {
      assert.throws(() => V.loadPreset(item.id, options), RangeError);
    }
  });
}

test('listSculpturePresets returns copies that cannot mutate the registry', () => {
  const listed = V.listSculpturePresets();
  listed[0].id = 'changed';
  assert.notEqual(V.listSculpturePresets()[0].id, 'changed');
  assert.throws(() => V.loadPreset('changed'), RangeError);
});

test('Menger lantern removes the center of every third division', () => {
  const grid = V.mengerLanternPreset();
  assert.equal(V.countVoxels(grid), 3954);
  assert.equal(V.getVoxel(grid, 13, 13, 13), 0);
  assert.equal(V.getVoxel(grid, 0, 0, 2), 1);
  assert.equal(V.getVoxel(grid, 0, 0, 26), 1);
});

test('symmetric edit mirrors an added box across the X midpoint', () => {
  const grid = V.createGrid(8, 6, 5);
  V.applySymmetricEdit(grid, 'x', (g) => V.addBox(g, 0, 0, 0, 2, 2, 2));
  assert.equal(V.countVoxels(grid), 16);
  assert.equal(V.getVoxel(grid, 0, 0, 0), 1);
  assert.equal(V.getVoxel(grid, 7, 0, 0), 1);
  assert.equal(V.getVoxel(grid, 6, 1, 1), 1);
});

test('symmetric edit mirrors a subtractive delta instead of the whole lattice', () => {
  const grid = V.createGrid(9, 4, 4);
  V.addBox(grid, 0, 0, 0, 9, 4, 4);
  V.applySymmetricEdit(grid, 'x', (g) => V.subtractBox(g, 0, 0, 0, 2, 2, 2));
  assert.equal(V.getVoxel(grid, 0, 0, 0), 0);
  assert.equal(V.getVoxel(grid, 7, 0, 0), 0);
  assert.equal(V.getVoxel(grid, 4, 0, 0), 1);
  assert.equal(V.countVoxels(grid), 9 * 4 * 4 - 16);
});

test('symmetric edit on an odd axis maps the center column onto itself', () => {
  const grid = V.createGrid(7, 7, 7);
  V.applySymmetricEdit(grid, 'y', (g) => V.addBox(g, 0, 3, 3, 1, 1, 1));
  assert.equal(V.countVoxels(grid), 1);
  assert.equal(V.getVoxel(grid, 0, 3, 3), 1);
});

test('symmetric edit supports Z and rejects bad axes and non functions', () => {
  const grid = V.createGrid(4, 4, 8);
  V.applySymmetricEdit(grid, 'z', (g) => V.addBox(g, 0, 0, 0, 2, 2, 2));
  assert.equal(V.getVoxel(grid, 0, 0, 7), 1);
  assert.throws(() => V.applySymmetricEdit(grid, 'w', () => grid), RangeError);
  assert.throws(() => V.applySymmetricEdit(grid, 'x', null), TypeError);
});

test('symmetric edit leaves the grid unchanged when the callback does nothing', () => {
  const grid = V.createGrid(4, 4, 4);
  V.addBox(grid, 0, 0, 0, 4, 4, 4);
  V.applySymmetricEdit(grid, 'x', () => grid);
  assert.equal(V.countVoxels(grid), 64);
});

test('printability reports a grounded solid as printable with zero floating cells', () => {
  const grid = V.createGrid(6, 6, 6);
  V.addBox(grid, 0, 0, 0, 6, 6, 6);
  const report = V.analyzePrintability(grid);
  assert.equal(report.printable, true);
  assert.equal(report.solidComponents, 1);
  assert.equal(report.floatingClusters, 0);
  assert.equal(report.overhangCells, 0);
  assert.equal(report.floatingCells, 0);
});

test('printability detects a floating cluster and counts its cells', () => {
  const grid = V.createGrid(8, 8, 8);
  V.addBox(grid, 0, 0, 0, 4, 4, 1);
  V.addBox(grid, 6, 6, 5, 2, 2, 2);
  const report = V.analyzePrintability(grid);
  assert.equal(report.printable, false);
  assert.equal(report.solidComponents, 2);
  assert.equal(report.floatingClusters, 1);
  assert.equal(report.floatingCells, 8);
  assert.equal(report.floatingCellIndices.length, 8);
});

test('printability counts overhang cells above empty air', () => {
  const grid = V.createGrid(8, 8, 8);
  V.addBox(grid, 3, 3, 4, 2, 2, 2);
  const report = V.analyzePrintability(grid);
  assert.equal(report.overhangCells, 4);
  assert.equal(report.overhangAreaMm2, 4 * grid.pitchMm * grid.pitchMm);
});

test('printability counts thin cells per axis', () => {
  const grid = V.createGrid(9, 9, 9);
  V.addBox(grid, 4, 0, 0, 1, 9, 9);
  const report = V.analyzePrintability(grid);
  assert.equal(report.thinX, 81);
  assert.equal(report.thinY, 0);
  assert.equal(report.thinZ, 0);
});

test('printability does not treat X row wraparound as a neighbor', () => {
  const grid = V.createGrid(4, 4, 4);
  V.setVoxel(grid, 3, 0, 2, 1);
  V.setVoxel(grid, 0, 1, 2, 1);
  const report = V.analyzePrintability(grid);
  assert.equal(report.solidComponents, 2);
  assert.equal(report.floatingClusters, 2);
});

test('printability reports an empty lattice as printable with no components', () => {
  const report = V.analyzePrintability(V.createGrid(4, 4, 4));
  assert.equal(report.printable, true);
  assert.equal(report.solidComponents, 0);
  assert.equal(report.minFeatureMm, 1);
});

test('a hollow shell keeps its cavity and stays watertight', () => {
  const grid = V.createGrid(8, 8, 8);
  V.addBox(grid, 0, 0, 0, 8, 8, 8);
  const hollow = V.shellGrid(grid, 1);
  const mesh = V.extractManifoldMesh(hollow);
  assert.equal(mesh.stats.watertight, true);
  assert.equal(mesh.stats.surfaceComponents, 2);
  assert.equal(mesh.stats.eulerCharacteristic, 4);
});
