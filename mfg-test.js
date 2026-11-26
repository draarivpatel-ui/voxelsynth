'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspace } = require('./dom-harness.js');
const V = require('./voxel.js');
const M = require('./mfg-lab.js');

const CAD_PRESETS = ['deskOrganizer', 'sdCardVault', 'cableComb', 'rpiPicoMount', 'sdfDock'];
const SCULPTURES = ['gyroidPavilion', 'mengerLantern', 'helicalRibbon', 'voronoiAmphitheater'];
const ALL_PRESETS = CAD_PRESETS.concat(SCULPTURES);
const ORIENTS = M.ORIENTATION_IDS;

function occupancy(workspace) { return Array.from(V.deserializeGrid(workspace.studio.snapshot()).data); }
function clean(workspace) { assert.deepEqual(workspace.errors, []); }
function solidPrism(nx, ny, nz, pitch) {
  const grid = V.createGrid(nx, ny, nz, pitch);
  grid.data.fill(1);
  return grid;
}
/* A wide top slab on a narrow center post: the optimal build face is -Z. */
function mushroom() {
  const grid = V.createGrid(6, 6, 6, 1);
  V.addBox(grid, 0, 0, 4, 6, 6, 2);
  V.addBox(grid, 2, 2, 0, 2, 2, 4);
  return grid;
}
/* addBox takes millimeters; pitch 1 keeps the cell arithmetic exact. */
function cantilever() {
  const grid = V.createGrid(10, 6, 8, 1);
  V.addBox(grid, 0, 0, 0, 4, 6, 3);
  V.addBox(grid, 4, 2, 5, 6, 1, 1);
  return grid;
}
function loneVoxel(z) {
  const grid = V.createGrid(4, 4, 6, 2);
  V.setVoxel(grid, 1, 2, z, 1);
  return grid;
}
function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hashOf(obj) { return '#vs=' + b64url(JSON.stringify(obj)); }
function validPayloadObject() {
  const grid = V.createGrid(4, 3, 5, 1.5);
  return { v: 1, c: M.packOccupancy(grid.data), x: 4, y: 3, z: 5, p: 1.5, o: '+z', m: 'PLA', l: 0.2, i: 100 };
}
const OPTS = { material: 'PLA', layerMm: 0.2, infillPercent: 100 };

/* --------------------------- Orientation transforms --------------------------- */

for (const preset of ALL_PRESETS) {
  for (const orientation of ORIENTS) {
    test(preset + ' in ' + orientation + ' preserves cell count, pitch, volume and V - E + F', () => {
      const grid = V.loadPreset(preset);
      const oriented = M.orientGrid(grid, orientation);
      assert.equal(V.countVoxels(oriented), V.countVoxels(grid));
      assert.equal(oriented.pitchMm, grid.pitchMm);
      const chiSource = V.analyzeMesh(V.extractManifoldMesh(grid)).eulerCharacteristic;
      const chiOriented = V.analyzeMesh(V.extractManifoldMesh(oriented)).eulerCharacteristic;
      assert.equal(chiOriented, chiSource);
    });
  }
}

const INVERSES = { '+z': '+z', '-z': '-z', '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y' };
for (const orientation of ORIENTS) {
  test('orientation ' + orientation + ' reverts through ' + INVERSES[orientation] + ' to an identical lattice', () => {
    const grid = V.loadPreset('rpiPicoMount');
    const restored = M.orientGrid(M.orientGrid(grid, orientation), INVERSES[orientation]);
    assert.equal(restored.nx, grid.nx); assert.equal(restored.ny, grid.ny); assert.equal(restored.nz, grid.nz);
    assert.deepEqual(Array.from(restored.data), Array.from(grid.data));
  });
}

for (const orientation of ORIENTS) {
  test('orientation ' + orientation + ' is deterministic across repeated runs', () => {
    const grid = V.loadPreset('cableComb');
    const first = M.orientGrid(grid, orientation);
    const second = M.orientGrid(grid, orientation);
    assert.deepEqual(Array.from(second.data), Array.from(first.data));
    assert.notEqual(second.data, first.data);
  });
}

test('+Z keeps a bottom corner voxel on the build plate', () => {
  const out = M.orientGrid(loneVoxel(0), '+z');
  assert.equal(V.getVoxel(out, 1, 2, 0), 1);
  assert.equal(out.nx, 4); assert.equal(out.ny, 4); assert.equal(out.nz, 6);
});

test('-Z rotates a bottom voxel to the mirrored top corner about X', () => {
  const out = M.orientGrid(loneVoxel(0), '-z');
  assert.equal(V.countVoxels(out), 1);
  assert.equal(V.getVoxel(out, 1, 1, 5), 1);
});

test('+X rolls a bottom voxel onto its side while preserving bounds', () => {
  const out = M.orientGrid(loneVoxel(0), '+x');
  assert.deepEqual([out.nx, out.ny, out.nz], [6, 4, 4]);
  assert.equal(V.getVoxel(out, 5, 2, 1), 1);
});

test('-X lifts a bottom voxel to the top of the rolled lattice', () => {
  const out = M.orientGrid(loneVoxel(0), '-x');
  assert.deepEqual([out.nx, out.ny, out.nz], [6, 4, 4]);
  assert.equal(V.getVoxel(out, 0, 2, 2), 1);
});

test('+Y ends a bottom voxel on the plate of the tumbled lattice', () => {
  const out = M.orientGrid(loneVoxel(0), '+y');
  assert.deepEqual([out.nx, out.ny, out.nz], [4, 6, 4]);
  assert.equal(V.getVoxel(out, 1, 5, 2), 1);
});

test('-Y hangs a bottom voxel from the far end of the tumbled lattice', () => {
  const out = M.orientGrid(loneVoxel(0), '-y');
  assert.deepEqual([out.nx, out.ny, out.nz], [4, 6, 4]);
  assert.equal(V.getVoxel(out, 1, 0, 1), 1);
});

for (const bad of ['++z', 'z', '0', '__proto__', 'constructor', '', null, undefined, 5, {}, []]) {
  test('orientGrid rejects hostile orientation ' + JSON.stringify(bad), () => {
    assert.throws(() => M.orientGrid(V.createGrid(2, 2, 2), bad), RangeError);
  });
}

test('orientGrid rejects malformed grids instead of reading through them', () => {
  assert.throws(() => M.orientGrid(null, '+z'), TypeError);
  assert.throws(() => M.orientGrid({}, '+z'), TypeError);
  assert.throws(() => M.orientGrid({ nx: 2, ny: 2, nz: 2, pitchMm: 1, data: new Uint8Array(7) }, '+z'), TypeError);
  assert.throws(() => M.orientGrid({ nx: 2, ny: 2, nz: 2, pitchMm: 1, data: [0, 0, 0, 0, 0, 0, 0, 0] }, '+z'), TypeError);
  assert.throws(() => M.orientGrid({ nx: 2, ny: 2, nz: 2, pitchMm: NaN, data: new Uint8Array(8) }, '+z'), TypeError);
});

/* --------------------------- Orientation analysis --------------------------- */

test('a solid prism reports exact bed footprint and zero support in all six orientations', () => {
  const grid = solidPrism(6, 5, 4, 2);
  const expected = { '+z': 120, '-z': 120, '+x': 80, '-x': 80, '+y': 96, '-y': 96 };
  for (const orientation of ORIENTS) {
    const row = M.analyzeOrientation(grid, orientation, OPTS);
    assert.equal(row.bedCells * 4, row.footprintMm2);
    assert.equal(row.footprintMm2, expected[orientation], orientation);
    assert.equal(row.overhangCells, 0);
    assert.equal(row.floatingClusters, 0);
    assert.equal(row.supportCells, 0);
    assert.equal(row.printable, true);
  }
});

test('a solid prism computes exact heights, layers, mass and print time', () => {
  const grid = solidPrism(6, 5, 4, 2);
  const row = M.analyzeOrientation(grid, '+z', OPTS);
  assert.equal(row.buildHeightMm, 8);
  assert.equal(row.layers, 40);
  assert.equal(row.solidMm3, 960);
  assert.ok(Math.abs(row.massG - 0.96 * 1.24) < 1e-9);
  assert.ok(Math.abs(row.printSeconds - (960 / 12 + 40 * 6)) < 1e-9);
  const rolled = M.analyzeOrientation(grid, '+x', OPTS);
  assert.equal(rolled.buildHeightMm, 12);
  assert.equal(rolled.layers, 60);
});

test('a lone top voxel floats with exact support columns and overhang in -Z', () => {
  const row = M.analyzeOrientation(loneVoxel(0), '-z', OPTS);
  assert.equal(row.bedCells, 0);
  assert.equal(row.floatingClusters, 1);
  assert.equal(row.overhangCells, 1);
  assert.equal(row.supportCells, 5);
  assert.equal(row.printable, false);
  assert.equal(row.buildHeightMm, 12);
});

test('a lone bottom voxel needs no support in +Z', () => {
  const row = M.analyzeOrientation(loneVoxel(0), '+z', OPTS);
  assert.equal(row.bedCells, 1);
  assert.equal(row.floatingClusters, 0);
  assert.equal(row.overhangCells, 0);
  assert.equal(row.supportCells, 0);
  assert.equal(row.footprintMm2, 4);
});

test('a mushroom counts exact overhang cells and support columns upright', () => {
  const row = M.analyzeOrientation(mushroom(), '+z', OPTS);
  assert.equal(row.solidCells, 88);
  assert.equal(row.overhangCells, 32);
  assert.equal(row.supportCells, 128);
  assert.equal(row.floatingClusters, 0);
  assert.equal(row.bedCells, 4);
});

test('the same mushroom needs no support upside down', () => {
  const row = M.analyzeOrientation(mushroom(), '-z', OPTS);
  assert.equal(row.overhangCells, 0);
  assert.equal(row.supportCells, 0);
  assert.equal(row.floatingClusters, 0);
});

test('a cantilever arm counts floating clusters and columnar support', () => {
  const row = M.analyzeOrientation(cantilever(), '+z', OPTS);
  assert.equal(row.solidCells, 78);
  assert.equal(row.floatingClusters, 1);
  assert.equal(row.solidComponents, 2);
  assert.equal(row.supportCells, 30);
  assert.equal(row.overhangCells, 6);
  assert.equal(row.printable, false);
  assert.equal(row.supportMm3, 30);
});

test('an empty lattice reports zeros and stays printable', () => {
  const row = M.analyzeOrientation(V.createGrid(4, 4, 4, 1), '+z', OPTS);
  assert.equal(row.solidCells, 0);
  assert.equal(row.bedCells, 0);
  assert.equal(row.layers, 0);
  assert.equal(row.buildHeightMm, 0);
  assert.equal(row.massG, 0);
  assert.equal(row.printable, true);
});

test('mass scales linearly with infill and follows each material density', () => {
  const grid = solidPrism(4, 4, 4, 1);
  for (const infill of [0, 25, 50, 100]) {
    const row = M.analyzeOrientation(grid, '+z', { material: 'PETG', layerMm: 0.2, infillPercent: infill });
    assert.ok(Math.abs(row.massG - 0.064 * (infill / 100) * 1.27) < 1e-9, 'infill ' + infill);
  }
  const densities = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };
  for (const material of Object.keys(densities)) {
    const row = M.analyzeOrientation(grid, '+z', { material: material, layerMm: 0.2, infillPercent: 100 });
    assert.ok(Math.abs(row.massG - 0.064 * densities[material]) < 1e-9, material);
  }
});

test('layer counts never grow as the layer height increases', () => {
  const grid = V.loadPreset('deskOrganizer');
  const counts = M.LAYER_HEIGHTS_MM.map(h => M.analyzeOrientation(grid, '+z', { material: 'PLA', layerMm: h, infillPercent: 100 }).layers);
  assert.ok(counts[0] >= counts[1] && counts[1] >= counts[2]);
  assert.ok(counts[0] > counts[2]);
});

test('print time grows with infill and with layer overhead', () => {
  const grid = solidPrism(4, 4, 4, 1);
  const dense = M.analyzeOrientation(grid, '+z', { material: 'PLA', layerMm: 0.2, infillPercent: 100 });
  const hollow = M.analyzeOrientation(grid, '+z', { material: 'PLA', layerMm: 0.2, infillPercent: 20 });
  assert.ok(dense.printSeconds > hollow.printSeconds);
  const tall = M.analyzeOrientation(grid, '+x', { material: 'PLA', layerMm: 0.12, infillPercent: 100 });
  assert.equal(tall.layers, Math.ceil(4 / 0.12));
});

for (const material of ['WOOD', 'nylon', '__proto__', 'constructor', 'PLAA', '', null, 5]) {
  test('hostile material ' + JSON.stringify(material) + ' is rejected', () => {
    assert.throws(() => M.analyzeOrientation(solidPrism(2, 2, 2, 1), '+z', { material: material }), RangeError);
  });
}

for (const layerMm of [NaN, Infinity, -Infinity, 0, -0.2, 5.01, 'x']) {
  test('hostile layer height ' + String(layerMm) + ' is rejected', () => {
    assert.throws(() => M.analyzeOrientation(solidPrism(2, 2, 2, 1), '+z', { layerMm: layerMm }), RangeError);
  });
}

test('infill clamps into range instead of corrupting the estimate', () => {
  const grid = solidPrism(2, 2, 2, 1);
  assert.equal(M.analyzeOrientation(grid, '+z', { infillPercent: -50 }).massG, 0);
  const full = M.analyzeOrientation(grid, '+z', { infillPercent: 200 }).massG;
  const hundred = M.analyzeOrientation(grid, '+z', { infillPercent: 100 }).massG;
  assert.equal(full, hundred);
  assert.throws(() => M.analyzeOrientation(grid, '+z', { infillPercent: NaN }), RangeError);
  assert.throws(() => M.analyzeOrientation(grid, '+z', { infillPercent: 'lots' }), RangeError);
});

test('lower-case material names normalize but unknown ones still throw', () => {
  const row = M.analyzeOrientation(solidPrism(2, 2, 2, 1), '+z', { material: 'pla' });
  assert.ok(Math.abs(row.massG - 0.008 * 1.24) < 1e-9);
});

test('analysis defaults missing options and rejects a hostile orientation', () => {
  const row = M.analyzeOrientation(solidPrism(2, 2, 2, 1), '+z');
  assert.equal(row.layers, 10);
  assert.throws(() => M.analyzeOrientation(solidPrism(2, 2, 2, 1), '++z', OPTS), RangeError);
  assert.throws(() => M.analyzeOrientation(solidPrism(2, 2, 2, 1), null, OPTS), RangeError);
});

/* --------------------------- Comparator --------------------------- */

test('the comparator returns six ranked rows and picks the low-support face', () => {
  const report = M.compareOrientations(mushroom(), OPTS);
  assert.equal(report.rows.length, 6);
  assert.deepEqual(report.rows.map(r => r.orientation), ORIENTS);
  assert.equal(report.best.orientation, '-z');
  assert.equal(report.best.supportMm3, 0);
  for (const row of report.rows) assert.equal(row.solidCells, 88);
});

test('the comparator prefers the stock face on a grounded flat part', () => {
  const report = M.compareOrientations(V.loadPreset('rpiPicoMount'), OPTS);
  assert.equal(report.best.orientation, '+z');
  assert.equal(report.best.floatingClusters, 0);
  assert.equal(report.best.supportCells, 0);
});

test('comparator rows stay deterministic across repeated calls', () => {
  const a = M.compareOrientations(cantilever(), OPTS);
  const b = M.compareOrientations(cantilever(), OPTS);
  assert.deepEqual(a.rows.map(r => [r.supportCells, r.overhangCells, r.layers, r.massG]),
    b.rows.map(r => [r.supportCells, r.overhangCells, r.layers, r.massG]));
  assert.equal(a.best.orientation, b.best.orientation);
});

test('comparator echoes the normalized manufacturing options', () => {
  const report = M.compareOrientations(solidPrism(2, 2, 2, 1), { material: 'tpu', layerMm: 0.28, infillPercent: 250 });
  assert.equal(report.material, 'TPU');
  assert.equal(report.layerMm, 0.28);
  assert.equal(report.infillPercent, 100);
  assert.equal(report.densityGPerCm3, 1.21);
});

test('the comparator survives an empty lattice and a single floating voxel', () => {
  const empty = M.compareOrientations(V.createGrid(4, 4, 4, 1), OPTS);
  assert.equal(empty.best.orientation, '+z');
  assert.ok(empty.rows.every(row => row.solidCells === 0 && row.printable));
  const lone = M.compareOrientations(loneVoxel(0), OPTS);
  const groundedRows = lone.rows.filter(row => row.floatingClusters === 0);
  assert.equal(lone.best.floatingClusters, 0);
  assert.ok(groundedRows.length > 0);
});

/* --------------------------- Layer profile --------------------------- */

test('layer profile of a solid prism is exact and sums to the voxel count', () => {
  const profile = M.layerProfile(solidPrism(6, 5, 4, 2), '+z');
  assert.equal(profile.layers.length, 4);
  let sum = 0;
  for (const layer of profile.layers) {
    assert.equal(layer.cells, 30);
    assert.equal(layer.areaMm2, 120);
    assert.equal(layer.overhangCells, 0);
    assert.equal(layer.supportCells, 0);
    sum += layer.cells;
  }
  assert.equal(sum, 120);
});

test('layer profile exposes the floating layer of a -Z lone voxel', () => {
  const profile = M.layerProfile(loneVoxel(0), '-z');
  for (let z = 0; z < 5; z++) {
    assert.equal(profile.layers[z].cells, 0);
    assert.equal(profile.layers[z].supportCells, 1);
  }
  assert.equal(profile.layers[5].cells, 1);
  assert.equal(profile.layers[5].overhangCells, 1);
});

test('layer profile of a -Z mushroom splits slab and post layers', () => {
  const profile = M.layerProfile(mushroom(), '-z');
  assert.equal(profile.layers[0].cells, 36);
  assert.equal(profile.layers[1].cells, 36);
  for (let z = 2; z < 6; z++) assert.equal(profile.layers[z].cells, 4);
  assert.ok(profile.layers.every(layer => layer.overhangCells === 0));
});

test('layer profile support cells count the empty column below the lowest solid', () => {
  const grid = V.createGrid(3, 3, 6, 1);
  V.setVoxel(grid, 1, 1, 4, 1);
  V.setVoxel(grid, 1, 1, 5, 1);
  const profile = M.layerProfile(grid, '+z');
  assert.equal(profile.layers[0].supportCells, 1);
  assert.equal(profile.layers[3].supportCells, 1);
  assert.equal(profile.layers[4].supportCells, 0);
  assert.equal(profile.layers[4].cells, 1);
  assert.equal(profile.layers[4].overhangCells, 1);
});

for (const preset of ALL_PRESETS) {
  for (const orientation of ['+z', '-x', '+y']) {
    test('layer profile sums for ' + preset + ' in ' + orientation, () => {
      const grid = V.loadPreset(preset);
      const profile = M.layerProfile(grid, orientation);
      const sum = profile.layers.reduce((total, layer) => total + layer.cells, 0);
      assert.equal(sum, V.countVoxels(grid));
      const row = M.analyzeOrientation(grid, orientation, OPTS);
      const overhang = profile.layers.reduce((total, layer) => total + layer.overhangCells, 0);
      assert.equal(overhang, row.overhangCells);
    });
  }
}

test('layer profile rejects hostile orientations and grids', () => {
  assert.throws(() => M.layerProfile(V.createGrid(2, 2, 2), '++z'), RangeError);
  assert.throws(() => M.layerProfile(null, '+z'), TypeError);
  assert.throws(() => M.layerProfile({ nx: 1, ny: 1, nz: 1, pitchMm: 1, data: new Uint8Array(2) }, '+z'), TypeError);
});

/* --------------------------- Audit brief --------------------------- */

test('the audit digest is a deterministic 64-hex fingerprint per state key', () => {
  const grid = cantilever();
  const a = M.auditBundle(grid, OPTS);
  const b = M.auditBundle(grid, OPTS);
  assert.equal(a, b);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
  const c = M.auditBundle(grid, { material: 'ABS', layerMm: 0.28, infillPercent: 40 });
  assert.notEqual(c.digest, a.digest);
});

test('JSON, CSV and Markdown exports carry the one identical digest', () => {
  const bundle = M.auditBundle(cantilever(), OPTS);
  assert.ok(bundle.json.includes('"sha256": "' + bundle.digest + '"'));
  assert.ok(bundle.csv.includes('# sha256=' + bundle.digest));
  assert.ok(bundle.markdown.includes('Audit digest SHA-256: `' + bundle.digest + '`'));
  const parsed = JSON.parse(bundle.json);
  assert.equal(parsed.sha256, bundle.digest);
  assert.equal(parsed.model.solidCells, V.countVoxels(cantilever()));
  assert.equal(parsed.orientations.length, 6);
});

test('the stamped payload verifies and a single mutated field fails', () => {
  const bundle = M.auditBundle(cantilever(), OPTS);
  assert.equal(M.verifyBundle(bundle).ok, true);
  assert.equal(M.verifyBundle(bundle.payload).ok, true);
  const mutated = JSON.parse(JSON.stringify(bundle.payload));
  mutated.orientations[0].supportMm3 += 1;
  const check = M.verifyBundle(mutated);
  assert.equal(check.ok, false);
  assert.equal(check.expected, bundle.digest);
  assert.notEqual(check.actual, bundle.digest);
});

test('the tamper demo mutates a copy and always gets flagged', () => {
  const bundle = M.auditBundle(solidPrism(4, 4, 4, 1), OPTS);
  const demo = M.tamperDemo(bundle);
  assert.equal(demo.detected, true);
  assert.equal(demo.ok, false);
  assert.equal(demo.changedField, 'model.solidCells');
  assert.equal(demo.expected, bundle.digest);
  assert.equal(M.verifyBundle(bundle).ok, true);
  assert.throws(() => M.tamperDemo({}), TypeError);
  assert.throws(() => M.verifyBundle({}), TypeError);
  assert.throws(() => M.verifyBundle({ payload: 'text' }), TypeError);
});

test('the occupancy fingerprint binds the exact lattice bytes', () => {
  const grid = V.loadPreset('sdCardVault');
  const bundle = M.auditBundle(grid, OPTS);
  assert.equal(bundle.payload.model.occupancySha256, V.sha256Hex(grid.data));
  assert.equal(bundle.payload.engine, V.version);
  assert.equal(bundle.payload.settings.material, 'PLA');
  assert.equal(bundle.payload.settings.selectedOrientation, '+z');
  assert.ok(Object.keys(M.ORIENT_MAP || {}).length === 0 || bundle.payload.orientations.length === 6);
});

test('CSV provenance comments and escaped orientation cells keep one table', () => {
  const bundle = M.auditBundle(solidPrism(4, 4, 4, 2), OPTS);
  const lines = bundle.csv.trim().split('\n');
  assert.equal(lines[0], '# VoxelSynth manufacturing brief');
  assert.equal(lines[1], '# sha256=' + bundle.digest);
  assert.match(lines[6], /^orientation,label,bed_cells/);
  assert.equal(lines.length, 7 + 6);
  for (const line of lines.slice(7)) assert.match(line, /^'[+-][xyz],/);
  assert.ok(lines.some(line => line.endsWith('optimal')));
});

test('CSV escaping blocks every spreadsheet formula prefix', () => {
  assert.equal(M.csvEscape('=CMD()'), "'=CMD()");
  assert.equal(M.csvEscape('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(M.csvEscape('-10'), "'-10");
  assert.equal(M.csvEscape('@info'), "'@info");
  assert.equal(M.csvEscape(' =1+1'), "' =1+1");
  assert.equal(M.csvEscape('has,comma'), '"has,comma"');
  assert.equal(M.csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(M.csvEscape('line\nbreak'), '"line\nbreak"');
  assert.equal(M.csvEscape(42), '42');
  assert.equal(M.csvEscape('plain'), 'plain');
});

test('markdown carries the comparison, the layer table and honest disclosure', () => {
  const bundle = M.auditBundle(V.loadPreset('rpiPicoMount'), OPTS);
  assert.match(bundle.markdown, /Six orientation comparison/);
  assert.match(bundle.markdown, /deterministic voxel-geometry estimates, not physical slicer G-code runs/);
  assert.match(bundle.markdown, /optimal/);
  const footer = bundle.markdown.trim().split('\n').slice(-1)[0];
  assert.equal(footer, 'Audit digest SHA-256: `' + bundle.digest + '`');
});

test('stableStringify sorts keys recursively for a canonical byte stream', () => {
  assert.equal(M.stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(M.stableStringify([{ z: 1, a: 2 }]), '[{"a":2,"z":1}]');
  assert.equal(M.stableStringify('x'), '"x"');
  assert.equal(M.stableStringify(null), 'null');
});

test('utf8Bytes encodes ASCII, two-byte and surrogate-pair text', () => {
  assert.deepEqual(Array.from(M.utf8Bytes('abc')), [97, 98, 99]);
  assert.deepEqual(Array.from(M.utf8Bytes('é')), [0xc3, 0xa9]);
  assert.equal(M.utf8Bytes('𐀀').length, 4);
  assert.equal(M.utf8Bytes('').length, 0);
});

test('the audit bundle survives an empty lattice with honest zeros', () => {
  const bundle = M.auditBundle(V.createGrid(4, 4, 4, 1), OPTS);
  assert.equal(bundle.payload.model.solidCells, 0);
  assert.equal(bundle.payload.best.orientation, '+z');
  assert.equal(M.verifyBundle(bundle).ok, true);
});

/* --------------------------- Share-hash codec --------------------------- */

test('a preset share hash restores the preset by name and kind', () => {
  const hash = M.encodeShareState({
    grid: V.loadPreset('sdfDock'), presetName: 'sdfDock',
    orientation: '+x', material: 'PETG', layerMm: 0.28, infillPercent: 35
  });
  assert.ok(hash.startsWith('#vs='));
  const decoded = M.decodeShareHash(hash);
  assert.equal(decoded.n, 'sdfDock');
  assert.equal(decoded.k, 'part');
  assert.equal(decoded.cells, null);
  const grid = M.shareGrid(decoded);
  assert.deepEqual(Array.from(grid.data), Array.from(V.loadPreset('sdfDock').data));
});

for (const name of SCULPTURES) {
  test('a sculpture share hash restores ' + name + ' with its sculpture kind', () => {
    const hash = M.encodeShareState({
      grid: V.loadPreset(name), presetName: name,
      orientation: '-y', material: 'TPU', layerMm: 0.12, infillPercent: 60
    });
    const decoded = M.decodeShareHash(hash);
    assert.equal(decoded.n, name);
    assert.equal(decoded.k, 'sculpture');
    assert.equal(decoded.o, '-y');
    assert.equal(decoded.m, 'TPU');
    assert.equal(decoded.l, 0.12);
    assert.equal(decoded.i, 60);
    const grid = M.shareGrid(decoded);
    assert.deepEqual(Array.from(grid.data), Array.from(V.loadPreset(name).data));
  });
}

test('an edited lattice round-trips through packed occupancy bits', () => {
  const grid = V.loadPreset('deskOrganizer');
  grid.data[0] ^= 1;
  grid.data[grid.data.length - 1] ^= 1;
  const hash = M.encodeShareState({
    grid: grid, presetName: 'deskOrganizer',
    orientation: '-x', material: 'ABS', layerMm: 0.12, infillPercent: 77
  });
  const decoded = M.decodeShareHash(hash);
  assert.equal(decoded.n, null);
  const rebuilt = M.shareGrid(decoded);
  assert.deepEqual(Array.from(rebuilt.data), Array.from(grid.data));
  assert.equal(rebuilt.pitchMm, grid.pitchMm);
});

test('a custom lattice without a preset name round-trips occupancy bits', () => {
  const grid = V.createGrid(7, 5, 9, 0.4);
  V.addBox(grid, 1, 1, 2, 3, 2, 4);
  const hash = M.encodeShareState({ grid: grid, presetName: null, orientation: '+z', material: 'PLA', layerMm: 0.2, infillPercent: 90 });
  const decoded = M.decodeShareHash(hash);
  assert.equal(decoded.n, null);
  const rebuilt = M.shareGrid(decoded);
  assert.equal(rebuilt.nx, 7); assert.equal(rebuilt.ny, 5); assert.equal(rebuilt.nz, 9);
  assert.deepEqual(Array.from(rebuilt.data), Array.from(grid.data));
});

test('encoding is deterministic and decoding validates every field', () => {
  const grid = cantilever();
  const input = { grid: grid, presetName: null, orientation: '+y', material: 'PETG', layerMm: 0.28, infillPercent: 55 };
  const first = M.encodeShareState(input);
  assert.equal(M.encodeShareState(input), first);
  const decoded = M.decodeShareHash(first);
  assert.equal(decoded.o, '+y');
  assert.equal(decoded.m, 'PETG');
  assert.equal(decoded.l, 0.28);
  assert.equal(decoded.i, 55);
});

function payloadTextWith(extraPair) {
  const base = validPayloadObject();
  const pairs = Object.keys(base).map(k => '"' + k + '":' + JSON.stringify(base[k]));
  pairs.push(extraPair);
  return '{' + pairs.join(',') + '}';
}
for (const [label, mutate] of [
  ['a prototype pollution key', () => payloadTextWith('"__proto__":{}')],
  ['a constructor key', () => payloadTextWith('"constructor":{}')],
  ['a prototype key', () => payloadTextWith('"prototype":{}')],
  ['an unknown extra key', obj => { obj.extra = 1; return obj; }],
  ['a non object payload', () => [1, 2, 3]],
  ['a wrong version', obj => { obj.v = 2; return obj; }],
  ['a string version', obj => { obj.v = '1'; return obj; }],
  ['a fractional dimension', obj => { obj.x = 4.5; return obj; }],
  ['a zero dimension', obj => { obj.y = 0; return obj; }],
  ['an oversized lattice', obj => { obj.x = 200; obj.y = 200; obj.z = 60; return obj; }],
  ['an out of range pitch', obj => { obj.p = 2000000; return obj; }],
  ['a null pitch', obj => { obj.p = null; return obj; }],
  ['a hostile orientation', obj => { obj.o = '__proto__'; return obj; }],
  ['a hostile material', obj => { obj.m = 'WOOD'; return obj; }],
  ['a lower-case material', obj => { obj.m = 'pla'; return obj; }],
  ['a non canonical layer height', obj => { obj.l = 0.15; return obj; }],
  ['a string layer height', obj => { obj.l = '0.2'; return obj; }],
  ['a negative infill', obj => { obj.i = -1; return obj; }],
  ['an infill above 100', obj => { obj.i = 101; return obj; }],
  ['preset and cells together', obj => { obj.n = 'deskOrganizer'; return obj; }],
  ['neither preset nor cells', obj => { delete obj.c; return obj; }],
  ['an unknown preset', obj => { delete obj.c; obj.n = 'notARealPreset'; return obj; }],
  ['a prototype preset name', obj => { delete obj.c; obj.n = '__proto__'; return obj; }],
  ['a numeric preset name', obj => { delete obj.c; obj.n = 5; return obj; }],
  ['a kind that disagrees', obj => { delete obj.c; obj.n = 'deskOrganizer'; obj.k = 'sculpture'; return obj; }],
  ['an unknown kind', obj => { delete obj.c; obj.n = 'deskOrganizer'; obj.k = 'weird'; return obj; }],
  ['truncated occupancy bits', obj => { obj.c = obj.c.slice(0, -2); return obj; }],
  ['non base64url occupancy', obj => { obj.c = '!!!'; return obj; }]
]) {
  test('the codec fails closed on ' + label, () => {
    const obj = mutate(validPayloadObject());
    const hash = typeof obj === 'string' ? '#vs=' + b64url(obj) : hashOf(obj);
    assert.throws(() => M.decodeShareHash(hash), TypeError);
  });
}

test('the codec fails closed on prototype keys nested in hostile spots', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const hash = '#vs=' + b64url(payloadTextWith('"' + key + '":[1,2,3]'));
    assert.throws(() => M.decodeShareHash(hash), TypeError);
  }
});

test('the codec rejects malformed, truncated and hostile outer hashes', () => {
  const good = M.encodeShareState({ grid: cantilever(), presetName: null, orientation: '+z', material: 'PLA', layerMm: 0.2, infillPercent: 100 });
  for (const bad of [
    good.slice(0, -2), good + '!', '#vx=' + good.slice(4), '#vs=' + good.slice(4) + ' ',
    '#VS=' + good.slice(4), 'vs=' + good.slice(4), '#vs=', '#vs=AAA A', 5, null, {}, []
  ]) {
    assert.throws(() => M.decodeShareHash(bad), TypeError, JSON.stringify(bad));
  }
});

test('non canonical occupancy tail bits are refused', () => {
  // 9 cells: two bytes, seven unused tail bits in the last byte.
  const bytes = new Uint8Array([0xff, 0xff]);
  const text = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(() => M.unpackOccupancy(text, 9), TypeError);
  const clean = new Uint8Array([0xff, 0x01]);
  const ok = Buffer.from(clean).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const cells = M.unpackOccupancy(ok, 9);
  assert.deepEqual(Array.from(cells), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test('occupancy packing round-trips edge lengths including empty and full', () => {
  for (const total of [1, 7, 8, 9, 64, 73728]) {
    const data = new Uint8Array(total);
    for (let i = 0; i < total; i++) data[i] = i % 3 === 0 ? 1 : 0;
    const cells = M.unpackOccupancy(M.packOccupancy(data), total);
    assert.deepEqual(Array.from(cells), Array.from(data));
  }
});

test('shareGrid rebuilds preset and cell states and refuses a broken state', () => {
  const preset = M.shareGrid(M.decodeShareHash(M.encodeShareState({
    grid: V.loadPreset('cableComb'), presetName: 'cableComb', orientation: '+z', material: 'PLA', layerMm: 0.2, infillPercent: 100
  })));
  assert.deepEqual(Array.from(preset.data), Array.from(V.loadPreset('cableComb').data));
  assert.throws(() => M.shareGrid({}), TypeError);
  assert.throws(() => M.shareGrid({ n: null, cells: new Uint8Array(3), x: 2, y: 2, z: 2, p: 1 }), TypeError);
  assert.throws(() => M.shareGrid(null), TypeError);
});

test('the encoder refuses non canonical lab options', () => {
  const grid = V.createGrid(3, 3, 3, 1);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.3 }), RangeError);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.12, infillPercent: -5 }), RangeError);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.2, infillPercent: 150 }), RangeError);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.2, orientation: 'up' }), RangeError);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.2, material: 'WOOD' }), RangeError);
  assert.throws(() => M.encodeShareState({ grid: grid, layerMm: 0.2, presetName: 'bogus' }), RangeError);
  assert.throws(() => M.encodeShareState({}), TypeError);
  assert.throws(() => M.encodeShareState(null), TypeError);
});

/* --------------------------- Self-test runner --------------------------- */

test('the in-page self-test runner reports at least 14 passing checks', () => {
  const run = M.runSelfTests(V.loadPreset('deskOrganizer'));
  assert.ok(run.total >= 14, 'expected at least 14 checks');
  assert.equal(run.passed, run.total);
  for (const result of run.results) {
    assert.ok(result.id && result.name && typeof result.pass === 'boolean');
  }
});

test('self-test ids are unique and cover digest, orientation and codec checks', () => {
  const run = M.runSelfTests(cantilever());
  const ids = run.results.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const needed of ['sha256-empty', 'sha256-abc', 'orient-cells', 'orient-euler',
    'prism-clean', 'support-monotone', 'layer-sum', 'csv-escape', 'digest-parity',
    'tamper', 'share-roundtrip', 'share-proto', 'share-hostile', 'floating']) {
    assert.ok(ids.includes(needed), 'missing ' + needed);
  }
});

test('the self-test runner works on an empty lattice and a floating one', () => {
  assert.equal(M.runSelfTests(V.createGrid(4, 4, 4, 1)).total, M.runSelfTests(V.createGrid(4, 4, 4, 1)).passed);
  const floating = V.createGrid(4, 4, 6, 1);
  V.setVoxel(floating, 1, 1, 4, 1);
  const run = M.runSelfTests(floating);
  assert.equal(run.passed, run.total);
});

test('the module exposes defensive copies of its constants', () => {
  assert.equal(M.ORIENTATIONS.length, 6);
  assert.deepEqual(M.LAYER_HEIGHTS_MM, [0.12, 0.2, 0.28]);
  assert.equal(M.MATERIALS.PLA, 1.24);
  M.MATERIALS.PLA = 99;
  M.LAYER_HEIGHTS_MM.push(9);
  assert.equal(M.normalizeLabOptions({ material: 'PLA' }).densityGPerCm3, 1.24);
  assert.equal(M.normalizeLabOptions({ layerMm: 0.2 }).layerMm, 0.2);
  assert.equal(M.LAYER_HEIGHTS_MM.length, 4);
});

/* --------------------------- Studio integration --------------------------- */

test('the lab boots with six rows, a live digest and zero harness errors', () => {
  const w = createWorkspace();
  const lab = w.studio.lab();
  assert.equal(lab.active, true);
  assert.equal(lab.rows.length, 6);
  assert.equal(lab.best, '+z');
  assert.match(lab.digest, /^[0-9a-f]{64}$/);
  assert.equal(w.get('lab-orient-body').children.length, 6);
  assert.match(w.get('lab-digest').textContent, new RegExp(lab.digest));
  assert.match(w.get('lab-verdict').textContent, /Optimal build orientation/);
  clean(w);
});

test('orientation rows are keyboard-focusable and select on click and Enter', () => {
  const w = createWorkspace();
  const rows = w.get('lab-orient-body').children;
  const target = rows[2];
  assert.equal(target.getAttribute('data-orient'), '+x');
  assert.equal(target.getAttribute('tabindex'), '0');
  target.focus();
  assert.equal(w.document.activeElement, target);
  target.dispatch('click');
  assert.equal(w.studio.lab().orientation, '+x');
  const rebuilt = w.get('lab-orient-body').children;
  assert.equal(rebuilt[2].getAttribute('aria-pressed'), 'true');
  assert.equal(rebuilt[2].className.includes('selected'), true);
  rebuilt[3].dispatch('keydown', { key: 'Enter' });
  assert.equal(w.studio.lab().orientation, '-x');
  assert.equal(w.get('lab-orient-body').children[3].getAttribute('aria-pressed'), 'true');
  clean(w);
});

test('material, layer-height and lab-infill controls recompute the comparison', () => {
  const w = createWorkspace();
  const before = w.studio.lab().rows[0].massG;
  w.get('lab-material').value = 'ABS'; w.get('lab-material').dispatch('change');
  assert.equal(w.studio.lab().material, 'ABS');
  const abs = w.studio.lab().rows[0].massG;
  assert.ok(Math.abs(abs - before * 1.04 / 1.24) < 0.02, before + ' vs ' + abs);
  const layersAt20 = w.studio.lab().rows[0].layers;
  w.get('lab-layer').value = '0.12'; w.get('lab-layer').dispatch('change');
  assert.equal(w.studio.lab().layerMm, 0.12);
  assert.ok(w.studio.lab().rows[0].layers >= layersAt20);
  w.get('lab-infill').value = '50'; w.get('lab-infill').dispatch('input');
  assert.equal(w.get('infill').value, '50');
  assert.equal(w.studio.inspect().stats.infillPercent, 50);
  assert.ok(w.studio.lab().rows[0].massG < abs);
  clean(w);
});

test('applying the optimal orientation rotates a top-heavy lattice onto its face', () => {
  const w = createWorkspace();
  w.studio.importText(JSON.stringify(V.serializeGrid(mushroom())));
  assert.equal(w.studio.lab().best, '-z');
  const cells = w.studio.inspect().stats.voxelCount;
  w.get('lab-apply-optimal').click();
  assert.equal(w.studio.inspect().stats.voxelCount, cells);
  assert.equal(w.studio.lab().best, '+z');
  const restored = V.deserializeGrid(w.studio.snapshot());
  assert.deepEqual(Array.from(restored.data), Array.from(M.orientGrid(mushroom(), '-z').data));
  clean(w);
});

test('applying the optimal orientation on an optimal part reports no rotation needed', () => {
  const w = createWorkspace();
  const before = occupancy(w);
  w.get('lab-apply-optimal').click();
  assert.match(w.get('toast').textContent, /Already in the optimal/);
  assert.deepEqual(occupancy(w), before);
  clean(w);
});

test('the audited brief downloads one identical digest across JSON, CSV and Markdown', async () => {
  const w = createWorkspace();
  w.get('lab-export-json').click();
  w.get('lab-export-csv').click();
  w.get('lab-export-md').click();
  assert.equal(w.downloads.length, 3);
  const digest = w.studio.lab().digest;
  const [json, csv, md] = await Promise.all(w.downloads.map(d => d.blob.text()));
  assert.ok(json.includes('"sha256": "' + digest + '"'));
  assert.ok(csv.includes('# sha256=' + digest));
  assert.ok(md.includes('Audit digest SHA-256: `' + digest + '`'));
  assert.match(w.downloads[0].filename, /\.manufacturing\.json$/);
  assert.match(w.downloads[1].filename, /\.manufacturing\.csv$/);
  assert.match(w.downloads[2].filename, /\.manufacturing\.md$/);
  clean(w);
});

test('the share link copies a #vs= url that restores every field on reload', () => {
  const w = createWorkspace();
  w.get('lab-material').value = 'ABS'; w.get('lab-material').dispatch('change');
  w.get('lab-layer').value = '0.28'; w.get('lab-layer').dispatch('change');
  w.get('lab-infill').value = '40'; w.get('lab-infill').dispatch('input');
  w.get('lab-orient-body').children[4].dispatch('click');
  w.get('lab-copy-link').click();
  assert.equal(w.copies.length, 1);
  const url = w.copies[0];
  assert.match(url, /#vs=/);
  const hash = url.slice(url.indexOf('#vs='));
  const restored = createWorkspace({ location: { href: 'https://aariv.me/voxelsynth/', hash: hash } });
  const lab = restored.studio.lab();
  assert.equal(lab.material, 'ABS');
  assert.equal(lab.layerMm, 0.28);
  assert.equal(lab.orientation, '+y');
  assert.equal(restored.studio.inspect().stats.infillPercent, 40);
  assert.equal(restored.get('lab-material').value, 'ABS');
  assert.equal(restored.get('infill').value, '40');
  assert.deepEqual(occupancy(restored), occupancy(w));
  clean(w);
  clean(restored);
});

test('a sculpture share hash restores sculpture mode and the exact lattice', () => {
  const hash = M.encodeShareState({
    grid: V.loadPreset('gyroidPavilion'), presetName: 'gyroidPavilion',
    orientation: '-x', material: 'PETG', layerMm: 0.28, infillPercent: 65
  });
  const w = createWorkspace({ location: { href: 'https://aariv.me/voxelsynth/', hash: hash } });
  const inspect = w.studio.inspect();
  assert.equal(inspect.artMode, true);
  assert.equal(inspect.sculpture, 'gyroidPavilion');
  assert.equal(w.studio.lab().orientation, '-x');
  assert.equal(w.studio.lab().material, 'PETG');
  assert.deepEqual(occupancy(w), Array.from(V.loadPreset('gyroidPavilion').data));
  clean(w);
});

test('a malformed share hash keeps the default workspace without errors', () => {
  for (const hash of ['#vs=AAAA', '#vs=' + '!'.repeat(8), '#vs=notjson']) {
    const w = createWorkspace({ location: { href: 'https://aariv.me/voxelsynth/', hash: hash } });
    assert.equal(w.studio.snapshot().nx, V.loadPreset('deskOrganizer').nx);
    clean(w);
  }
});

test('verify and tamper buttons report intact then detected in the page', () => {
  const w = createWorkspace();
  w.get('lab-verify').click();
  assert.match(w.get('lab-status').textContent, /Verified intact/);
  assert.match(w.get('lab-status').className, /good/);
  w.get('lab-tamper').click();
  assert.match(w.get('lab-status').textContent, /Tamper detected/);
  assert.match(w.get('lab-status').textContent, /model\.solidCells/);
  clean(w);
});

test('the self-test runner reports all passing with a visible list', () => {
  const w = createWorkspace();
  w.get('lab-selftest').click();
  const lab = w.studio.lab();
  assert.ok(lab.selfTests.total >= 14);
  assert.equal(lab.selfTests.passed, lab.selfTests.total);
  assert.match(w.get('lab-selftest-result').textContent, new RegExp(lab.selfTests.total + ' / ' + lab.selfTests.total));
  assert.equal(w.get('lab-selftest-list').children.length, lab.selfTests.total);
  clean(w);
});

test('orientation chart groups are focusable and drive the layer profile', () => {
  const w = createWorkspace();
  const svg = w.get('lab-chart-orient').children[0];
  assert.equal(svg.tagName, 'SVG');
  const group = svg.children.find(node => node.getAttribute('data-chart-orient') === '-y');
  assert.ok(group);
  assert.equal(group.getAttribute('tabindex'), '0');
  const hit = group.children.find(node => node.getAttribute('class') === 'chart-hit');
  assert.ok(hit);
  assert.ok(Number(hit.getAttribute('height')) >= 44);
  group.dispatch('click');
  assert.equal(w.studio.lab().orientation, '-y');
  const layerSvg = w.get('lab-chart-layer').children[0];
  assert.ok(Number(layerSvg.getAttribute('width')) >= 560);
  const layerPoint = layerSvg.children.find(node => node.getAttribute('data-layer') === '3');
  assert.ok(layerPoint);
  layerPoint.dispatch('click');
  assert.match(w.get('lab-layer-readout').textContent, /Layer 4 \//);
  assert.match(w.get('lab-layer-readout').textContent, /-y/);
  clean(w);
});

test('the layer readout updates on geometry edits with a clamped selection', () => {
  const w = createWorkspace();
  w.get('lab-layer-readout').textContent;
  w.studio.importText(JSON.stringify(V.serializeGrid(mushroom())));
  assert.match(w.get('lab-layer-readout').textContent, /Layer 1 \/ 6/);
  const layerSvg = w.get('lab-chart-layer').children[0];
  const last = layerSvg.children.filter(node => node.getAttribute('data-layer') !== null);
  assert.ok(last.length >= 6);
  last[5].dispatch('keydown', { key: ' ' });
  assert.match(w.get('lab-layer-readout').textContent, /Layer 6 \/ 6/);
  clean(w);
});

test('the lab hides itself cleanly when mfg-lab.js is absent', () => {
  const w = createWorkspace({ scripts: ['voxel.js', 'app.js'] });
  assert.equal(w.get('mfg-panel').hidden, true);
  assert.equal(w.studio.lab().active, false);
  assert.equal(w.studio.shareHash(), null);
  assert.equal(w.studio.inspect().stats.watertight, true);
  clean(w);
});

test('edits keep the digest synchronized across the page and all three exports', async () => {
  const w = createWorkspace();
  const first = w.studio.lab().digest;
  w.get('toggle-voxel').click();
  const second = w.studio.lab().digest;
  assert.notEqual(second, first);
  assert.ok(w.get('lab-digest').textContent.includes(second));
  w.get('lab-export-json').click();
  const json = await w.downloads[0].blob.text();
  assert.ok(json.includes('"sha256": "' + second + '"'));
  clean(w);
});

test('hostile lab inputs fail through the toast without corrupting the lab', () => {
  const w = createWorkspace();
  const digest = w.studio.lab().digest;
  w.get('lab-infill').value = ''; w.get('lab-infill').dispatch('input');
  assert.match(w.get('toast').textContent, /finite number/);
  assert.equal(w.studio.lab().digest, digest);
  w.get('toast').textContent = '';
  w.get('lab-layer').value = '0.15'; w.get('lab-layer').dispatch('change');
  assert.match(w.get('toast').textContent, /0\.12, 0\.20 or 0\.28/);
  assert.equal(w.studio.lab().layerMm, 0.2);
  assert.equal(w.get('lab-layer').value, '0.2');
  w.get('toast').textContent = '';
  w.get('lab-material').value = 'WOOD'; w.get('lab-material').dispatch('change');
  assert.match(w.get('toast').textContent, /Unknown material/);
  assert.equal(w.studio.lab().material, 'PLA');
  assert.equal(w.get('lab-material').value, 'PLA');
  clean(w);
});
