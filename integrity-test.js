'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createWorkspace } = require('./dom-harness.js');
const V = require('./voxel.js');

function box(nx, ny, nz, pitch) {
  const g = V.createGrid(nx, ny, nz, pitch === undefined ? 1 : pitch);
  V.addBox(g, 0, 0, 0, nx * g.pitchMm, ny * g.pitchMm, nz * g.pitchMm);
  return g;
}

function occupancy(workspace) { return Array.from(V.deserializeGrid(workspace.studio.snapshot()).data); }
function clean(workspace) { assert.deepEqual(workspace.errors, []); }
function nodeSha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function textBytes(text) { const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff; return out; }

/* Rebuild a GLB container from a JSON object and BIN payload so malformed
 * variants can be constructed without touching the writer. */
function buildContainer(gltf, bin) {
  const json = JSON.stringify(gltf), jsonPad = (4 - json.length % 4) % 4, binPad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + json.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, json.length + jsonPad, true); view.setUint32(16, 0x4e4f534a, true);
  for (let i = 0; i < json.length; i++) out[20 + i] = json.charCodeAt(i) & 0x7f;
  for (let i = 0; i < jsonPad; i++) out[20 + json.length + i] = 0x20;
  const start = 20 + json.length + jsonPad;
  view.setUint32(start, bin.length + binPad, true); view.setUint32(start + 4, 0x004e4942, true);
  out.set(bin, start + 8);
  return out;
}

function glbParts(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true), start = 20 + jsonLength, binLength = view.getUint32(start, true);
  let text = '';
  for (let i = 0; i < jsonLength; i++) text += String.fromCharCode(glb[20 + i]);
  return { gltf: JSON.parse(text), bin: glb.slice(start + 8, start + 8 + binLength) };
}

/* ----------------------------- SHA-256 ------------------------------- */

test('SHA-256 matches published vectors for empty and short inputs', () => {
  assert.equal(V.sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(V.sha256Hex(textBytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(V.sha256Hex(textBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 1000, 4097]) {
  test('SHA-256 matches node:crypto at ' + length + ' bytes across block boundaries', () => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length) & 0xff;
    assert.equal(V.sha256Hex(bytes), nodeSha(bytes));
  });
}

test('SHA-256 rejects non-byte input and is deterministic', () => {
  assert.throws(() => V.sha256Hex('abc'), TypeError);
  assert.throws(() => V.sha256Hex([1, 2, 3]), TypeError);
  const bytes = V.exportBinarySTL(V.extractManifoldMesh(box(4, 4, 4)), 'part');
  assert.equal(V.sha256Hex(bytes), V.sha256Hex(bytes));
  const original = V.sha256Hex(bytes);
  bytes[100] ^= 1;
  assert.notEqual(V.sha256Hex(bytes), original);
  assert.equal(V.sha256Hex(bytes), nodeSha(bytes));
});

/* --------------------------- GLB container --------------------------- */

test('binary glTF writes the magic, version and exact length contract', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const glb = V.exportGLB(mesh, 'cube');
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), glb.byteLength);
  assert.equal(glb.byteLength % 4, 0);
});

test('binary glTF JSON declares one triangle primitive with indexed attributes', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const { gltf } = glbParts(V.exportGLB(mesh, 'cube'));
  assert.equal(gltf.asset.version, '2.0');
  assert.match(gltf.asset.generator, /VoxelSynth/);
  assert.equal(gltf.scenes[0].nodes[0], 0);
  assert.equal(gltf.nodes[0].mesh, 0);
  assert.equal(gltf.nodes[0].name, 'cube');
  const primitive = gltf.meshes[0].primitives[0];
  assert.equal(primitive.mode, 4);
  assert.equal(primitive.attributes.POSITION, 0);
  assert.equal(primitive.attributes.NORMAL, 1);
  assert.equal(primitive.indices, 2);
  assert.equal(gltf.materials[0].pbrMetallicRoughness.metallicFactor, 0);
});

test('binary glTF accessors count vertices and indices with a required POSITION box', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube'));
  const [pos, nrm, idx] = gltf.accessors;
  assert.equal(pos.count, mesh.vertices.length);
  assert.equal(nrm.count, mesh.vertices.length);
  assert.equal(idx.count, mesh.triangles.length * 3);
  assert.equal(pos.type, 'VEC3'); assert.equal(nrm.type, 'VEC3'); assert.equal(idx.type, 'SCALAR');
  assert.equal(pos.componentType, 5126); assert.equal(idx.componentType, 5125);
  const s = mesh.stats.boundingBoxMm;
  assert.deepEqual(pos.min, s.min.map(v => Math.fround(v / 1000)));
  assert.deepEqual(pos.max, s.max.map(v => Math.fround(v / 1000)));
  assert.equal(gltf.buffers[0].byteLength, bin.length);
  assert.equal(bin.length, mesh.vertices.length * 24 + mesh.triangles.length * 12);
});

test('binary glTF buffer views partition the BIN chunk exactly', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube'));
  const [bv0, bv1, bv2] = gltf.bufferViews;
  assert.equal(bv0.byteOffset, 0);
  assert.equal(bv0.byteLength, mesh.vertices.length * 12);
  assert.equal(bv1.byteOffset, bv0.byteLength);
  assert.equal(bv1.byteLength, mesh.vertices.length * 12);
  assert.equal(bv2.byteOffset, bv0.byteLength + bv1.byteLength);
  assert.equal(bv2.byteLength, mesh.triangles.length * 12);
  assert.equal(bv2.byteOffset + bv2.byteLength, bin.length);
  assert.deepEqual(gltf.bufferViews.map(view => view.target), [34962, 34962, 34963]);
});

test('binary glTF writes unit per-vertex normals into the BIN chunk', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube'));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const base = gltf.bufferViews[1].byteOffset;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const len = Math.hypot(view.getFloat32(base + i * 12, true), view.getFloat32(base + i * 12 + 4, true), view.getFloat32(base + i * 12 + 8, true));
    assert.ok(Math.abs(len - 1) < 1e-6, 'normal ' + i + ' is not unit length');
  }
});

test('binary glTF export refuses empty or malformed meshes', () => {
  assert.throws(() => V.exportGLB({ vertices: [], triangles: [], normals: [] }), RangeError);
  assert.throws(() => V.exportGLB({ vertices: [[0, 0, 0]], triangles: [[0, 0, 0]], normals: [[0, 0, 1]] }), TypeError);
});

/* -------------------------- GLB round trips -------------------------- */

for (const [label, grid] of [['unit cube', box(4, 5, 6)], ['board fixture', V.loadPreset('rpiPicoMount')], ['gyroid pavilion', V.loadPreset('gyroidPavilion')]]) {
  test(label + ': glTF bytes round trip counts, Euler characteristic and volume', () => {
    const mesh = V.extractManifoldMesh(grid);
    const restored = V.parseGLB(V.exportGLB(mesh, label));
    assert.equal(restored.vertices.length, mesh.vertices.length);
    assert.equal(restored.triangles.length, mesh.triangles.length);
    const a = V.analyzeMesh(restored), s = mesh.stats;
    assert.equal(a.eulerCharacteristic, s.eulerCharacteristic);
    assert.equal(a.surfaceComponents, s.surfaceComponents);
    assert.equal(a.watertight, true);
    assert.ok(Math.abs(a.volumeMm3 - s.volumeMm3) / s.volumeMm3 <= 1e-5);
    assert.ok(Math.abs(a.surfaceAreaMm2 - s.surfaceAreaMm2) / s.surfaceAreaMm2 <= 1e-5);
  });
}

test('parsed glTF vertices equal the float32 export positions read back in millimeters', () => {
  const mesh = V.extractManifoldMesh(box(4, 5, 6));
  const restored = V.parseGLB(V.exportGLB(mesh, 'cube'));
  mesh.vertices.forEach(function (point, i) {
    point.forEach(function (value, d) {
      assert.equal(restored.vertices[i][d], Math.fround(value / 1000) * 1000);
    });
  });
});

test('glTF export accepts an ArrayBuffer on parse', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3));
  const bytes = V.exportGLB(mesh, 'cube');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const restored = V.parseGLB(buffer);
  assert.equal(restored.triangles.length, mesh.triangles.length);
});

/* -------------------------- GLB malformed ---------------------------- */

test('parseGLB rejects a wrong magic, container version and length field', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  const magic = glb.slice(); magic[0] = 0x21;
  assert.throws(() => V.parseGLB(magic), /glTF magic/);
  const version = glb.slice(); new DataView(version.buffer).setUint32(4, 1, true);
  assert.throws(() => V.parseGLB(version), /container version/);
  const length = glb.slice(); new DataView(length.buffer).setUint32(8, 4, true);
  assert.throws(() => V.parseGLB(length), /length/);
});

test('parseGLB rejects truncated containers and missing chunks', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  assert.throws(() => V.parseGLB(glb.slice(0, 10)), /20 byte header/);
  assert.throws(() => V.parseGLB(glb.slice(0, glb.length - 4)), /length/);
  const { gltf, bin } = glbParts(glb);
  const noBin = glb.slice(0, 12 + 8 + new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true));
  new DataView(noBin.buffer).setUint32(8, noBin.length, true);
  assert.throws(() => V.parseGLB(noBin), /overruns|BIN chunk/);
  assert.throws(() => V.parseGLB(buildContainer(gltf, new Uint8Array(0))), /byteLength|structure/);
});

test('parseGLB rejects malformed JSON and unsupported asset versions', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  const { gltf, bin } = glbParts(glb);
  const badJson = buildContainer({ asset: { version: '2.0' }, meshes: gltf.meshes, accessors: gltf.accessors, bufferViews: gltf.bufferViews, buffers: gltf.buffers }, bin);
  const view = new DataView(badJson.buffer, badJson.byteOffset, badJson.byteLength);
  badJson[30] = 0x7b ^ 0xff;
  assert.throws(() => V.parseGLB(badJson), /malformed|JSON/);
  const v1 = JSON.parse(JSON.stringify(gltf)); v1.asset.version = '1.0';
  assert.throws(() => V.parseGLB(buildContainer(v1, bin)), /version must be 2.0/);
  const twoBuffers = JSON.parse(JSON.stringify(gltf)); twoBuffers.buffers.push({ byteLength: 4 });
  assert.throws(() => V.parseGLB(buildContainer(twoBuffers, bin)), /structure/);
});

test('parseGLB rejects non-triangle primitives and missing accessors', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  const { gltf, bin } = glbParts(glb);
  const strip = JSON.parse(JSON.stringify(gltf)); strip.meshes[0].primitives[0].mode = 5;
  assert.throws(() => V.parseGLB(buildContainer(strip, bin)), /triangle primitives/);
  const noIndices = JSON.parse(JSON.stringify(gltf)); delete noIndices.meshes[0].primitives[0].indices;
  assert.throws(() => V.parseGLB(buildContainer(noIndices, bin)), /POSITION and indices/);
  const float = JSON.parse(JSON.stringify(gltf)); float.accessors[2].componentType = 5126;
  assert.throws(() => V.parseGLB(buildContainer(float, bin)), /component type/);
});

test('parseGLB rejects out of range indices and partial triangles', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  const { gltf, bin } = glbParts(glb);
  const broken = bin.slice();
  const view = new DataView(broken.buffer, broken.byteOffset, broken.byteLength);
  view.setUint32(gltf.bufferViews[2].byteOffset, mesh.vertices.length + 7, true);
  assert.throws(() => V.parseGLB(buildContainer(gltf, broken)), /index out of range/);
  const partial = JSON.parse(JSON.stringify(gltf)); partial.accessors[2].count = mesh.triangles.length * 3 - 1;
  assert.throws(() => V.parseGLB(buildContainer(partial, bin)), /whole triangles/);
  const shrunk = JSON.parse(JSON.stringify(gltf)); shrunk.bufferViews[2].byteLength = 8;
  assert.throws(() => V.parseGLB(buildContainer(shrunk, bin)), /overruns/);
});

test('parseGLB counts declared normals that are not unit length', () => {
  const mesh = V.extractManifoldMesh(box(3, 3, 3)), glb = V.exportGLB(mesh, 'cube');
  const { gltf, bin } = glbParts(glb);
  const scaled = bin.slice();
  const view = new DataView(scaled.buffer, scaled.byteOffset, scaled.byteLength);
  view.setFloat32(gltf.bufferViews[1].byteOffset, 2.0, true);
  const restored = V.parseGLB(buildContainer(gltf, scaled));
  assert.equal(restored.nonUnitNormalCount, 1);
  const report = V.auditExportFile(buildContainer(gltf, scaled), 'scaled.glb');
  assert.equal(report.mesh.nonUnitNormals, 1);
  assert.equal(report.verdict, 'FAIL');
  assert.match(report.failures.join(' '), /not unit length/);
});

/* ------------------------ glTF units and scenes ---------------------- */

test('binary glTF writes POSITION in meters per the glTF 2.0 spec and reads it back in millimeters', () => {
  const mesh = V.extractManifoldMesh(box(10, 10, 10));
  const glb = V.exportGLB(mesh, 'cube10');
  const { gltf, bin } = glbParts(glb);
  const pos = gltf.accessors[0];
  assert.deepEqual(pos.min, [0, 0, 0]);
  assert.ok(pos.max.every(v => Math.abs(v - 0.01) < 1e-6), 'a 10 mm cube writes max 0.01 m, got ' + JSON.stringify(pos.max));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < pos.count * 3; i++) {
    const value = view.getFloat32(gltf.bufferViews[0].byteOffset + i * 4, true);
    assert.ok(value >= 0 && value <= 0.011, 'POSITION component ' + i + ' reads ' + value + ' m instead of millimeters');
  }
  const report = V.auditExportFile(glb, 'cube10.glb');
  assert.equal(report.verdict, 'PASS');
  assert.ok(Math.abs(report.mesh.volumeMm3 - 1000) < 0.01, 'a 10 mm cube must audit near 1000 mm3, got ' + report.mesh.volumeMm3);
  report.mesh.boundingBoxMm.size.forEach((n, i) => assert.ok(Math.abs(n - 10) < 0.001, 'bounding axis ' + i));
});

test('the glTF audit instances every scene node through composed world transforms', () => {
  const mesh = V.extractManifoldMesh(box(1, 1, 1));
  assert.equal(mesh.triangles.length, 12);
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube'));
  gltf.nodes[0].scale = [2, 2, 2];
  gltf.nodes[0].translation = [20, 0, 0];
  gltf.nodes[0].children = [1];
  gltf.nodes.push({ mesh: 0, translation: [0, 0, 20] });
  const report = V.auditExportFile(buildContainer(gltf, bin), 'instanced.glb');
  assert.equal(report.verdict, 'PASS', report.failures.join(' | '));
  assert.equal(report.mesh.triangles, 24);
  assert.equal(report.mesh.surfaceComponents, 2);
  assert.equal(report.mesh.watertight, true);
  assert.ok(Math.abs(report.mesh.volumeMm3 - 16) < 0.01, 'two scaled 2 mm cubes enclose 16 mm3, got ' + report.mesh.volumeMm3);
  const close = (a, b) => Math.abs(a - b) < 0.01;
  assert.ok(report.mesh.boundingBoxMm.min.every((n, i) => close(n, [20000, 0, 0][i])), JSON.stringify(report.mesh.boundingBoxMm.min));
  assert.ok(report.mesh.boundingBoxMm.max.every((n, i) => close(n, [20002, 2, 40002][i])), 'child translation composes inside the parent scale: ' + JSON.stringify(report.mesh.boundingBoxMm.max));
});

test('glTF node matrices, quaternions and mirrored scales compose truthfully', () => {
  const mesh = V.extractManifoldMesh(box(10, 10, 10));
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube10'));
  const rotated = JSON.parse(JSON.stringify(gltf));
  rotated.nodes[0].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const quarter = V.parseGLB(buildContainer(rotated, bin));
  const bounds = V.analyzeMesh(quarter).boundingBoxMm;
  assert.ok(Math.abs(bounds.min[0] + 10) < 0.01 && Math.abs(bounds.max[0]) < 0.01 &&
    Math.abs(bounds.min[1]) < 0.01 && Math.abs(bounds.max[1] - 10) < 0.01, '90 deg Z rotation maps the cube into -X/+Y');
  const matrixed = JSON.parse(JSON.stringify(gltf));
  matrixed.nodes[0].matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0.02, 0, 0, 1];
  const scaled = V.analyzeMesh(V.parseGLB(buildContainer(matrixed, bin)));
  assert.ok(Math.abs(scaled.volumeMm3 - 8000) < 0.5);
  assert.deepEqual(scaled.boundingBoxMm.size.map(n => Math.round(n)), [20, 20, 20]);
  const mirrored = JSON.parse(JSON.stringify(gltf));
  mirrored.nodes[0].scale = [-1, 1, 1];
  const flipped = V.analyzeMesh(V.parseGLB(buildContainer(mirrored, bin)));
  assert.ok(flipped.watertight);
  assert.ok(flipped.volumeMm3 > 0, 'a mirror transform must flip winding back to outward, got ' + flipped.volumeMm3);
});

test('the glTF audit ignores meshes the active scene never references and rejects cycles', () => {
  const mesh = V.extractManifoldMesh(box(1, 1, 1));
  const { gltf, bin } = glbParts(V.exportGLB(mesh, 'cube'));
  const extra = JSON.parse(JSON.stringify(gltf));
  extra.meshes.push(JSON.parse(JSON.stringify(extra.meshes[0])));
  const report = V.auditExportFile(buildContainer(extra, bin), 'orphan.glb');
  assert.equal(report.mesh.triangles, 12);
  assert.equal(report.verdict, 'PASS');
  const cyclic = JSON.parse(JSON.stringify(gltf));
  cyclic.nodes[0].children = [0];
  assert.throws(() => V.parseGLB(buildContainer(cyclic, bin)), /cycle/);
});

/* --------------------------- Audit verdicts -------------------------- */

const AUDIT_CASES = [
  ['ascii-stl', 'model.stl', grid => V.exportAsciiSTL(V.extractManifoldMesh(grid), 'model')],
  ['binary-stl', 'model.stl', grid => V.exportBinarySTL(V.extractManifoldMesh(grid), 'model')],
  ['obj', 'model.obj', grid => V.exportOBJ(V.extractManifoldMesh(grid), 'model')],
  ['ply', 'model.ply', grid => V.exportPLY(V.extractManifoldMesh(grid), 'model')],
  ['glb', 'model.glb', grid => V.exportGLB(V.extractManifoldMesh(grid), 'model')],
  ['vox', 'model.vox', grid => V.exportVOX(grid)],
  ['scad', 'model.scad', grid => V.exportOpenSCAD(grid)],
  ['json', 'model.json', grid => JSON.stringify(V.serializeGrid(grid))]
];
for (const [format, name, build] of AUDIT_CASES) {
  test('audit of a studio ' + format + ' export returns a bound PASS report', () => {
    const grid = box(6, 5, 4, 1.5);
    const payload = build(grid);
    const bytes = typeof payload === 'string' ? textBytes(payload) : payload;
    const report = V.auditExportFile(payload, name);
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.file.format, format);
    assert.equal(report.file.bytes, bytes.length);
    assert.equal(report.file.sha256, nodeSha(bytes));
    assert.equal(report.failures.length, 0);
    assert.ok(report.mesh.watertight);
    assert.equal(report.mesh.eulerCharacteristic, 2);
    assert.equal(report.mesh.degenerateTriangles, 0);
    assert.equal(report.mesh.nonUnitNormals, 0);
    const expectedSize = format === 'vox' ? [6, 5, 4] : [9, 7.5, 6];
    report.mesh.boundingBoxMm.size.forEach((n, i) => assert.ok(Math.abs(n - expectedSize[i]) < 1e-5, 'bounding box axis ' + i));
    if (format === 'vox' || format === 'scad' || format === 'json') assert.equal(report.occupancy.solidCells, 120);
  });
}

test('audit rejects garbage, truncated and wrong-type content cleanly', () => {
  assert.equal(V.auditExportFile(new Uint8Array([1, 2, 3, 4]), 'junk.bin').verdict, 'REJECTED');
  const stl = V.exportBinarySTL(V.extractManifoldMesh(box(4, 4, 4)), 'part');
  assert.equal(V.auditExportFile(stl.slice(0, 60), 'part.stl').verdict, 'REJECTED');
  assert.match(V.auditExportFile('{broken json', 'part.json').failures[0], /Rejected while reading Project JSON/);
  assert.match(V.auditExportFile('{"asset":{"version":"2.0"}}', 'part.gltf').failures[0], /binary \.glb/);
});

test('audit fails open surfaces and winding mismatches rather than passing them', () => {
  const openObj = 'o open\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n';
  const report = V.auditExportFile(openObj, 'open.obj');
  assert.equal(report.verdict, 'FAIL');
  assert.match(report.failures.join(' '), /boundary edge/);
  assert.equal(report.mesh.boundaryEdges, 3);
  const wound = 'o wound\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\n' +
    'vn 0 0 1\nvn 0 -1 0\nf 1//1 2//1 3//1\nf 1//2 2//2 4//2\n';
  const woundReport = V.auditExportFile(wound, 'wound.obj');
  assert.equal(woundReport.verdict, 'FAIL');
  assert.match(woundReport.failures.join(' '), /same direction/);
  assert.equal(woundReport.mesh.windingErrors, 1);
});

test('audit fails point-contact occupancy carried by VOX', () => {
  const grid = V.createGrid(4, 4, 4, 1);
  V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 1, 1);
  const report = V.auditExportFile(V.exportVOX(grid), 'contact.vox');
  assert.equal(report.verdict, 'FAIL');
  assert.match(report.failures.join(' '), /vertex link|edge/);
  assert.equal(report.mesh.watertight, false);
});

test('audit report shape is deterministic and self describing', () => {
  const grid = V.loadPreset('rpiPicoMount');
  const payload = V.exportBinarySTL(V.extractManifoldMesh(grid), 'fixture');
  const first = V.auditExportFile(payload, 'fixture.stl');
  const second = V.auditExportFile(payload, 'fixture.stl');
  assert.deepEqual(first, second);
  assert.equal(first.report, 'voxelsynth-export-integrity');
  assert.equal(first.reportVersion, 1);
  assert.match(first.generator, /VoxelSynth/);
  assert.match(first.file.sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.mesh.eulerFormula, 'V - E + F = ' + first.mesh.eulerCharacteristic);
  assert.equal(first.mesh.vertices - first.mesh.edges + first.mesh.triangles, first.mesh.eulerCharacteristic);
  assert.equal(first.mesh.genusEstimate, (2 * first.mesh.surfaceComponents - first.mesh.eulerCharacteristic) / 2);
});

test('audit preserves the parser contract on typed input', () => {
  assert.throws(() => V.auditExportFile(null, 'x'), TypeError);
  assert.throws(() => V.auditExportFile(42, 'x'), TypeError);
  const grid = box(4, 4, 4);
  const glb = V.exportGLB(V.extractManifoldMesh(grid), 'x');
  const report = V.auditExportFile(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), 'x.glb');
  assert.equal(report.verdict, 'PASS');
});

/* ------------------------- Euler invariants -------------------------- */

for (const dims of [[2, 2, 2], [3, 4, 5], [6, 6, 6], [8, 3, 5]]) {
  test('solid ' + dims.join(' x ') + ' box keeps chi 2 and genus 0 at any size', () => {
    const s = V.extractManifoldMesh(box(dims[0], dims[1], dims[2])).stats;
    assert.equal(s.eulerCharacteristic, 2);
    assert.equal(s.surfaceComponents, 1);
    assert.equal(s.genusEstimate, 0);
    assert.ok(s.watertight);
  });
}

for (const count of [2, 3, 4]) {
  test(count + ' disjoint solids keep chi ' + 2 * count + ' across ' + count + ' components', () => {
    const g = V.createGrid(24, 6, 6, 1);
    for (let i = 0; i < count; i++) V.addBox(g, i * 7, 0, 0, 3, 3, 3);
    const s = V.extractManifoldMesh(g).stats;
    assert.equal(s.eulerCharacteristic, 2 * count);
    assert.equal(s.surfaceComponents, count);
    assert.equal(s.genusEstimate, 0);
  });
}

test('a drilled through-hole raises genus to 1 and drops chi to 0', () => {
  const g = box(10, 10, 10, 1);
  V.subtractBox(g, 4, 4, -1, 2, 2, 12);
  const s = V.extractManifoldMesh(g).stats;
  assert.equal(s.genusEstimate, 1);
  assert.equal(s.eulerCharacteristic, 0);
  assert.equal(s.surfaceComponents, 1);
});

test('two parallel through-holes give genus 2 and chi -2', () => {
  const g = box(12, 10, 10, 1);
  V.subtractBox(g, 3, 4, -1, 2, 2, 12);
  V.subtractBox(g, 8, 4, -1, 2, 2, 12);
  const s = V.extractManifoldMesh(g).stats;
  assert.equal(s.genusEstimate, 2);
  assert.equal(s.eulerCharacteristic, -2);
});

test('a sealed interior cavity adds a surface component and chi 4', () => {
  const g = box(12, 12, 12, 1);
  V.subtractSphere(g, 6, 6, 6, 3);
  const s = V.extractManifoldMesh(g).stats;
  assert.equal(s.surfaceComponents, 2);
  assert.equal(s.eulerCharacteristic, 4);
  assert.equal(s.genusEstimate, 0);
});

test('mirroring preserves Euler characteristic, volume and watertightness', () => {
  const g = box(12, 8, 6, 1);
  V.subtractBox(g, 2, 3, -1, 2, 2, 8);
  const before = V.extractManifoldMesh(g).stats;
  const after = V.extractManifoldMesh(V.mirrorGrid(g, 'x')).stats;
  assert.equal(after.eulerCharacteristic, before.eulerCharacteristic);
  assert.equal(after.genusEstimate, before.genusEstimate);
  assert.ok(after.watertight && Math.abs(after.volumeMm3 - before.volumeMm3) < 1e-9);
});

test('a minimum wall shell on a solid creates a counted inner surface', () => {
  const g = V.shellGrid(box(12, 12, 12, 1), 2);
  const s = V.extractManifoldMesh(g).stats;
  assert.equal(s.surfaceComponents, 2);
  assert.equal(s.eulerCharacteristic, 4);
  assert.ok(s.watertight);
});

const EULER_PRESETS = [
  ['deskOrganizer', 0], ['sdCardVault', 1], ['cableComb', 2], ['rpiPicoMount', 4], ['sdfDock', 0],
  ['gyroidPavilion', 1], ['mengerLantern', 240], ['helicalRibbon', 3], ['voronoiAmphitheater', 0]
];
for (const [name, genus] of EULER_PRESETS) {
  test(name + ' keeps V - E + F = 2(components - genus) with genus ' + genus, () => {
    const s = V.extractManifoldMesh(V.loadPreset(name)).stats;
    assert.equal(s.genusEstimate, genus);
    assert.equal(s.eulerCharacteristic, 2 * (s.surfaceComponents - genus));
    assert.equal(s.uniqueVertices - s.uniqueEdges + s.triangleCount, s.eulerCharacteristic);
  });
}

test('binary STL audits reproduce every preset Euler characteristic', () => {
  for (const [name] of EULER_PRESETS) {
    const grid = V.loadPreset(name);
    const report = V.auditExportFile(V.exportBinarySTL(V.extractManifoldMesh(grid), 'p'), 'p.stl');
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.mesh.eulerCharacteristic, V.extractManifoldMesh(grid).stats.eulerCharacteristic);
  }
});

test('a degenerate or misindexed OBJ fails instead of silently passing', () => {
  const dup = 'o bad\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 1//1 2//1\n';
  assert.equal(V.auditExportFile(dup, 'bad.obj').verdict, 'REJECTED');
  const outOfRange = 'o bad\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 9//1\n';
  assert.equal(V.auditExportFile(outOfRange, 'bad.obj').verdict, 'REJECTED');
});

/* --------------------- Honest geometry verdicts ---------------------- */

test('a coincident double-sided sheet fails as doubled faces, not a watertight pass', () => {
  const sheet = 'o double\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nvn 0 0 -1\nf 1//1 2//1 3//1\nf 3//2 2//2 1//2\n';
  const report = V.auditExportFile(sheet, 'double.obj');
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.mesh.watertight, false);
  assert.equal(report.mesh.duplicateTriangles, 1);
  assert.equal(report.mesh.volumeMm3, 0);
  assert.match(report.failures.join(' '), /coincident|same three vertices/);
});

test('an inward-facing closed shell fails on nonpositive signed volume', () => {
  const obj = V.exportOBJ(V.extractManifoldMesh(box(10, 10, 10)), 'inward');
  const inward = obj.split('\n').map(line => {
    if (line.startsWith('vn ')) return 'vn ' + line.slice(3).trim().split(/\s+/).map(n => String(-Number(n))).join(' ');
    if (line.startsWith('f ')) { const p = line.slice(2).trim().split(/\s+/); return 'f ' + [p[2], p[1], p[0]].join(' '); }
    return line;
  }).join('\n');
  const report = V.auditExportFile(inward, 'inward.obj');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.mesh.volumeMm3 < -990, 'inverted 10 mm cube signs near -1000 mm3, got ' + report.mesh.volumeMm3);
  assert.match(report.failures.join(' '), /signed volume|not positive/);
});

test('a legitimate nested cavity shell keeps a positive net volume and still passes', () => {
  const g = V.shellGrid(box(12, 12, 12, 1), 2);
  const report = V.auditExportFile(V.exportBinarySTL(V.extractManifoldMesh(g), 'shell'), 'shell.stl');
  assert.equal(report.verdict, 'PASS', report.failures.join(' | '));
  assert.equal(report.mesh.surfaceComponents, 2);
  assert.ok(report.mesh.volumeMm3 > 0);
  const cavity = box(12, 12, 12, 1);
  V.subtractSphere(cavity, 6, 6, 6, 3);
  const cavityReport = V.auditExportFile(V.exportAsciiSTL(V.extractManifoldMesh(cavity), 'cavity'), 'cavity.stl');
  assert.equal(cavityReport.verdict, 'PASS');
  assert.equal(cavityReport.mesh.surfaceComponents, 2);
});

test('empty project JSON, empty OBJ and empty VOX report EMPTY rather than a geometry pass', () => {
  const emptyGrid = V.createGrid(4, 4, 4, 1);
  const json = V.auditExportFile(JSON.stringify(V.serializeGrid(emptyGrid)), 'empty.json');
  assert.equal(json.verdict, 'EMPTY');
  assert.equal(json.mesh.watertight, false);
  assert.equal(json.occupancy.solidCells, 0);
  assert.match(json.failures.join(' '), /no solid geometry/);
  const obj = V.auditExportFile('o empty\n', 'empty.obj');
  assert.equal(obj.verdict, 'EMPTY');
  const vox = V.auditExportFile(V.exportVOX(emptyGrid), 'empty.vox');
  assert.equal(vox.verdict, 'EMPTY');
});

test('CI and the README both run the unified npm test command covering all four suites', () => {
  const ci = fs.readFileSync(__dirname + '/.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /npm test/);
  assert.doesNotMatch(ci, /node --test/);
  const pkg = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8'));
  for (const file of ['test.js', 'export-test.js', 'integrity-test.js', 'ui-test.js']) {
    assert.ok(pkg.scripts.test.includes(file), 'npm test misses ' + file);
  }
  const readme = fs.readFileSync(__dirname + '/README.md', 'utf8');
  assert.match(readme, /npm test/);
});

/* ----------------------------- Studio UI ----------------------------- */

test('the page exposes a polite live announcer for silent actions', () => {
  const w = createWorkspace();
  const announcer = w.get('live-announcer');
  assert.equal(announcer.getAttribute('role'), 'status');
  assert.equal(announcer.getAttribute('aria-live'), 'polite');
  assert.ok(announcer.classList.contains('sr-only'));
  clean(w);
});

test('arrow keys orbit and announce the view; repeated announcements stay distinct', () => {
  const w = createWorkspace();
  w.key('ArrowRight', { target: w.document.body });
  assert.match(w.get('live-announcer').textContent, /Yaw 40 deg, pitch 28 deg/);
  w.key('o', { target: w.document.body });
  assert.equal(w.get('live-announcer').textContent, 'Top view.');
  w.key('o', { target: w.document.body });
  assert.equal(w.get('live-announcer').textContent, 'Top view. ');
  clean(w);
});

test('W, P, V and N keys drive wireframe, printability, verification and lattice', () => {
  const w = createWorkspace();
  w.key('w', { target: w.document.body });
  assert.equal(w.get('toggle-wire').getAttribute('aria-pressed'), 'true');
  assert.match(w.get('live-announcer').textContent, /Wireframe on/);
  w.key('p', { target: w.document.body });
  assert.equal(w.get('toggle-print').getAttribute('aria-pressed'), 'true');
  assert.equal(w.get('print-legend').hidden, false);
  w.key('v', { target: w.document.body });
  assert.match(w.get('verification-result').textContent, /6 formats passed/);
  w.get('grid-nx').value = '9'; w.get('grid-ny').value = '7'; w.get('grid-nz').value = '5';
  w.key('n', { target: w.document.body });
  assert.equal(w.studio.snapshot().nx, 9);
  clean(w);
});

test('I, O, F and brackets choose views and cycle the slice plane', () => {
  const w = createWorkspace();
  w.key('i', { target: w.document.body });
  assert.equal(w.studio.inspect().yawDeg, 35); assert.equal(w.studio.inspect().pitchDeg, 28);
  w.key('o', { target: w.document.body });
  assert.equal(w.studio.inspect().pitchDeg, 90);
  w.key('f', { target: w.document.body });
  assert.equal(w.studio.inspect().pitchDeg, 0);
  assert.match(w.get('live-announcer').textContent, /Front view/);
  const order = [];
  for (const key of [']', ']', ']']) { w.key(key, { target: w.document.body }); order.push(w.studio.inspect().sliceAxis); }
  assert.deepEqual(order, ['x', 'y', 'z']);
  assert.match(w.get('live-announcer').textContent, /Slice plane set to Z/);
  clean(w);
});

test('sculpture keys announce a hint outside art mode and act inside it', () => {
  const w = createWorkspace();
  w.key('u', { target: w.document.body });
  assert.match(w.get('live-announcer').textContent, /needs Sculpture mode/);
  assert.equal(w.studio.inspect().turntable, false);
  w.get('art-mode-toggle').click();
  w.key('u', { target: w.document.body });
  assert.equal(w.studio.inspect().turntable, true);
  w.key('l', { target: w.document.body });
  assert.equal(w.studio.inspect().lighting, true);
  w.key('g', { target: w.document.body });
  assert.equal(w.studio.inspect().gallery, true);
  assert.match(w.get('live-announcer').textContent, /Gallery tour playing/);
  clean(w);
});

test('keyboard shortcuts keep ignoring form fields', () => {
  const w = createWorkspace();
  w.key('w', { target: w.get('prim-x') });
  assert.equal(w.get('toggle-wire').getAttribute('aria-pressed'), 'false');
  w.key('v', { target: w.get('export-name') });
  assert.doesNotMatch(w.get('verification-result').textContent, /formats passed/);
  clean(w);
});

test('the binary glTF button downloads a verified container with the magic header', async () => {
  const w = createWorkspace();
  w.group('data-export', 'glb').click();
  assert.equal(w.downloads.length, 1);
  assert.equal(w.downloads[0].filename, 'voxelsynth_model.glb');
  const bytes = new Uint8Array(await w.downloads[0].blob.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'glTF');
  assert.equal(V.auditExportFile(bytes, 'voxelsynth_model.glb').verdict, 'PASS');
  clean(w);
});

test('auditing the studio binary STL inside the page renders a bound PASS block', () => {
  const w = createWorkspace();
  const mesh = V.extractManifoldMesh(V.deserializeGrid(w.studio.snapshot()));
  const report = w.studio.auditBytes(V.exportBinarySTL(mesh, 'organizer'), 'organizer.stl');
  assert.equal(report.verdict, 'PASS');
  assert.match(w.get('audit-result').textContent, /PASS: organizer\.stl/);
  assert.match(w.get('audit-result').textContent, /V - E \+ F = 2/);
  assert.match(w.get('audit-result').textContent, /SHA-256/);
  assert.equal(w.get('audit-report').disabled, false);
  assert.match(w.get('live-announcer').textContent, /Audit pass/);
  clean(w);
});

test('a rejected audit keeps geometry, disables nothing and reports the reason', () => {
  const w = createWorkspace(), before = occupancy(w);
  const report = w.studio.auditBytes(new Uint8Array([9, 9, 9]), 'mystery.bin');
  assert.equal(report.verdict, 'REJECTED');
  assert.match(w.get('audit-result').textContent, /REJECTED: mystery\.bin/);
  assert.match(w.get('audit-result').textContent, /Unrecognized/);
  assert.deepEqual(occupancy(w), before);
  assert.equal(w.studio.inspect().stats.watertight, true);
  clean(w);
});

test('the proof report downloads as deterministic parseable JSON', async () => {
  const w = createWorkspace();
  const mesh = V.extractManifoldMesh(V.deserializeGrid(w.studio.snapshot()));
  w.studio.auditBytes(V.exportGLB(mesh, 'proof'), 'proof.glb');
  w.get('audit-report').click();
  const entry = w.downloads.find(d => d.filename.endsWith('.integrity.json'));
  assert.ok(entry, 'integrity report download is missing');
  const report = JSON.parse(await entry.blob.text());
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.file.format, 'glb');
  assert.match(report.file.sha256, /^[0-9a-f]{64}$/);
  clean(w);
});

test('drop and file pick paths feed the same audit with clean resets', async () => {
  const w = createWorkspace();
  const mesh = V.extractManifoldMesh(V.deserializeGrid(w.studio.snapshot()));
  const stl = V.exportBinarySTL(mesh, 'dropped');
  const file = { name: 'dropped.stl', size: stl.length, arrayBuffer: () => Promise.resolve(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)) };
  w.get('audit-drop').dispatch('dragover');
  assert.ok(w.get('audit-drop').classList.contains('over'));
  await w.get('audit-drop').dispatch('drop', { dataTransfer: { files: [file] } });
  assert.equal(w.get('audit-drop').classList.contains('over'), false);
  assert.match(w.get('audit-result').textContent, /PASS: dropped\.stl/);
  const input = w.get('audit-file');
  input.files = [file];
  await input.dispatch('change');
  assert.match(w.get('audit-result').textContent, /PASS: dropped\.stl/);
  assert.equal(input.value, '');
  clean(w);
});

test('an audited project JSON reports occupancy alongside the surface proof', () => {
  const w = createWorkspace();
  const report = w.studio.auditBytes(JSON.stringify(w.studio.snapshot()), 'project.json');
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.occupancy.solidCells, V.countVoxels(V.deserializeGrid(w.studio.snapshot())));
  assert.match(w.get('audit-result').textContent, /cells solid at/);
  clean(w);
});
