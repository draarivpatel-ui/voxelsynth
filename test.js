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
  const directed = new Set();
  for (const tri of mesh.triangles) {
    for (let e = 0; e < 3; e++) directed.add(tri[e] + '>' + tri[(e + 1) % 3]);
  }
  for (const key of directed) {
    const [u, v] = key.split('>');
    assert.ok(directed.has(v + '>' + u), `${label}: directed edge ${key} has no opposite`);
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

test('listPresets exposes exactly the four built in designs', () => {
  assert.deepEqual(V.listPresets().sort(),
    ['cableComb', 'deskOrganizer', 'rpiPicoMount', 'sdCardVault']);
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
  assert.equal(V.version, '1.0.0');
});
