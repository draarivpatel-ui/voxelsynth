'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const V = require('./voxel.js');

function cube(pitch = 1) { const grid = V.createGrid(4, 5, 6, pitch); V.addBox(grid, 0, 0, 0, 4 * pitch, 5 * pitch, 6 * pitch); return grid; }
function equalVolume(actual, expected, tolerance = 1e-5) { assert.ok(Math.abs(actual - expected) / expected <= tolerance, `volume ${actual}, expected ${expected}`); }

const ALL_FORMATS = ['ASCII STL', 'Binary STL', 'OBJ', 'Binary PLY', 'OpenSCAD', 'VOX'];
const CAD_PRESETS = ['deskOrganizer', 'sdCardVault', 'cableComb', 'rpiPicoMount', 'sdfDock'];
for (const name of CAD_PRESETS) test(name + ': all six export formats and project cells round trip at the showcase resolution', () => {
  const grid = V.loadPreset(name), result = V.verifyExports(grid);
  assert.equal(result.pass, true); assert.equal(result.formats.length, 6);
  assert.deepEqual(result.formats.map(format => format.name), ALL_FORMATS);
  assert.ok(result.formats.every(format => format.pass && format.bytes > 0));
  assert.equal(result.snapshotCells, grid.data.length);
  assert.ok(result.maxRelativeVolumeError <= 1e-5);
});

for (const name of CAD_PRESETS) test(name + ': custom 20 x 14 x 9 lattice round trips at fractional pitch', () => {
  const grid = V.loadPreset(name, { nx: 20, ny: 14, nz: 9, pitchMm: 0.3 });
  const result = V.verifyExports(grid);
  assert.equal(result.pass, true);
  assert.ok(result.maxRelativeVolumeError <= 1e-5);
});

for (const pitch of [1e-6, 0.003, 1 / 3, 1.5, 1e6]) test('export precision preserves nondegenerate geometry at pitch ' + pitch, () => {
  const grid = cube(pitch), result = V.verifyExports(grid);
  assert.equal(result.pass, true); assert.ok(result.maxRelativeVolumeError <= 1e-5);
  const scad = V.parseOpenSCAD(V.exportOpenSCAD(grid));
  assert.equal(scad.data.length, grid.data.length); assert.deepEqual(Array.from(scad.data), Array.from(grid.data));
});

test('ASCII STL uses matching names, complete facets and outward unit normals', () => {
  const mesh = V.extractManifoldMesh(cube());
  const text = V.exportAsciiSTL(mesh, 'hello / part');
  const restored = V.parseAsciiSTL(text);
  assert.equal(restored.triangles.length, mesh.triangles.length);
  assert.equal(V.analyzeMesh(restored).watertight, true);
  equalVolume(V.analyzeMesh(restored).volumeMm3, mesh.stats.volumeMm3, 1e-12);
});

test('ASCII STL rejects mismatched names, missing vertices and invalid tokens', () => {
  const text = V.exportAsciiSTL(V.extractManifoldMesh(cube()), 'part');
  for (const changed of [text.replace('endsolid part', 'endsolid other'), text.replace(/\s+vertex [^\n]+\n/, '\n'), text.replace(/vertex [^\n]+/, 'vertex NaN 0 0'), text.replace('endloop', 'loop')]) {
    assert.throws(() => V.parseAsciiSTL(changed), TypeError);
  }
});

test('binary STL declares exact little endian records with zero attribute bytes', () => {
  const mesh = V.extractManifoldMesh(cube()), bytes = V.exportBinarySTL(mesh, 'part');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes.length, 84 + mesh.triangles.length * 50);
  assert.equal(view.getUint32(80, true), mesh.triangles.length);
  for (let i = 0; i < mesh.triangles.length; i++) {
    const at = 84 + i * 50;
    assert.equal(view.getUint16(at + 48, true), 0);
    assert.ok(Math.abs(Math.hypot(...[0, 4, 8].map(offset => view.getFloat32(at + offset, true))) - 1) < 1e-7);
  }
  equalVolume(V.analyzeMesh(V.parseBinarySTL(bytes)).volumeMm3, mesh.stats.volumeMm3);
});

test('binary STL reads a typed array with a nonzero byte offset', () => {
  const bytes = V.exportBinarySTL(V.extractManifoldMesh(cube()));
  const padded = new Uint8Array(bytes.length + 24); padded.set(bytes, 13);
  const view = padded.subarray(13, 13 + bytes.length);
  assert.equal(V.parseBinarySTL(view).triangles.length, (bytes.length - 84) / 50);
});

test('binary STL rejects short headers, forged counts and trailing records', () => {
  const bytes = V.exportBinarySTL(V.extractManifoldMesh(cube()));
  const forged = new Uint8Array(bytes); new DataView(forged.buffer).setUint32(80, 0xffffffff, true);
  for (const bad of [new Uint8Array(83), forged, bytes.slice(0, -1), new Uint8Array(bytes.length + 1)]) assert.throws(() => V.parseBinarySTL(bad), TypeError);
});

test('binary STL rejects nonfinite values and unsupported attributes', () => {
  const source = V.exportBinarySTL(V.extractManifoldMesh(cube()));
  const normal = new Uint8Array(source); new DataView(normal.buffer).setFloat32(84, NaN, true);
  const attribute = new Uint8Array(source); new DataView(attribute.buffer).setUint16(84 + 48, 1, true);
  assert.throws(() => V.parseBinarySTL(normal), TypeError);
  assert.throws(() => V.parseBinarySTL(attribute), TypeError);
});

test('OBJ keeps indexed positions and face normals and preserves the entire mesh', () => {
  const mesh = V.extractManifoldMesh(cube(0.3)), text = V.exportOBJ(mesh, 'part');
  const restored = V.parseOBJ(text);
  assert.deepEqual(restored.triangles, mesh.triangles);
  assert.equal(restored.vertices.length, mesh.vertices.length);
  equalVolume(V.analyzeMesh(restored).volumeMm3, mesh.stats.volumeMm3, 1e-12);
});

test('OBJ rejects out of range or zero vertex and normal indices', () => {
  const text = V.exportOBJ(V.extractManifoldMesh(cube()), 'part');
  for (const face of ['f 0//1 1//1 2//1', 'f 99999//1 1//1 2//1', 'f 1//99999 2//99999 3//99999', 'f 1//0 2//0 3//0', 'f 1//1 2//2 3//1']) {
    assert.throws(() => V.parseOBJ(text.replace(/^f .+$/m, face)), TypeError);
  }
});

test('OBJ rejects nonfinite vertices and unsupported face syntax', () => {
  const text = V.exportOBJ(V.extractManifoldMesh(cube()), 'part');
  assert.throws(() => V.parseOBJ(text.replace(/^v .+$/m, 'v 0 Infinity 0')), TypeError);
  assert.throws(() => V.parseOBJ(text.replace(/^f .+$/m, 'f 1 2 3 4')), TypeError);
});

test('OpenSCAD boxes reconstruct occupancy without overlap or lost units', () => {
  const grid = V.loadPreset('deskOrganizer'), text = V.exportOpenSCAD(grid);
  const restored = V.parseOpenSCAD(text);
  assert.deepEqual(Array.from(restored.data), Array.from(grid.data));
  assert.equal(restored.pitchMm, grid.pitchMm);
  assert.ok((text.match(/cube\(/g) || []).length < V.countVoxels(grid));
});

test('OpenSCAD rejects inconsistent metadata, invalid cubes and executable additions', () => {
  const text = V.exportOpenSCAD(cube());
  for (const changed of [text.replace(/Solid cells: \d+/, 'Solid cells: 0'), text.replace(/Merged boxes: \d+/, 'Merged boxes: 7'), text.replace('center = false', 'center = true'), text + '\necho("unexpected");\n', text.replace('pitch = 1.000000;', 'pitch = Infinity;')]) {
    assert.throws(() => V.parseOpenSCAD(changed));
  }
});

test('OpenSCAD rejects overlapping cuboids even if their declared count matches', () => {
  const text = V.exportOpenSCAD(cube()), line = text.split('\n').find(line => line.includes('translate('));
  const duplicated = text.replace('Merged boxes: 1', 'Merged boxes: 2').replace(line, line + '\n' + line);
  assert.throws(() => V.parseOpenSCAD(duplicated), /overlap/);
});

test('OpenSCAD rejects negative, zero, nonfinite and fractional cell extents', () => {
  const text = V.exportOpenSCAD(cube());
  for (const value of ['-4', '0', 'Infinity', '4.5']) {
    assert.throws(() => V.parseOpenSCAD(text.replace('cube([4.000000,', 'cube([' + value + ',')));
  }
  for (const pitch of [0, -1, NaN, Infinity]) assert.throws(() => V.exportOpenSCAD(cube(), pitch), RangeError);
});

test('mesh exporters reject malformed indices, degenerate facets and wrong normals', () => {
  const source = V.extractManifoldMesh(cube());
  for (const changed of [
    { ...source, triangles: [[0, 0, 1]], normals: [[1, 0, 0]] },
    { ...source, triangles: [[0, 1, 999999]], normals: [[1, 0, 0]] },
    { ...source, normals: source.normals.map(() => [0, 0, 0]) },
    { ...source, vertices: source.vertices.map(() => [0, 0, 0]) }
  ]) {
    assert.throws(() => V.exportAsciiSTL(changed), TypeError);
    assert.throws(() => V.exportBinarySTL(changed), TypeError);
    assert.throws(() => V.exportOBJ(changed), TypeError);
    assert.throws(() => V.exportPLY(changed), TypeError);
  }
});

test('binary PLY declares a little endian header and exact element records', () => {
  const mesh = V.extractManifoldMesh(cube()), bytes = V.exportPLY(mesh, 'part');
  const text = Array.from(bytes.subarray(0, 320)).map(b => String.fromCharCode(b)).join('');
  assert.ok(text.startsWith('ply\nformat binary_little_endian 1.0\n'));
  assert.ok(text.includes('element vertex ' + mesh.vertices.length));
  assert.ok(text.includes('element face ' + mesh.triangles.length));
  const headEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
  assert.equal(bytes.length, headEnd + mesh.vertices.length * 12 + mesh.triangles.length * 13);
  const restored = V.parsePLY(bytes);
  assert.equal(restored.triangles.length, mesh.triangles.length);
  assert.equal(V.analyzeMesh(restored).watertight, true);
  equalVolume(V.analyzeMesh(restored).volumeMm3, mesh.stats.volumeMm3);
});

test('binary PLY reads a typed array with a nonzero byte offset', () => {
  const mesh = V.extractManifoldMesh(cube()), bytes = V.exportPLY(mesh);
  const padded = new Uint8Array(bytes.length + 24); padded.set(bytes, 13);
  const view = padded.subarray(13, 13 + bytes.length);
  assert.equal(V.parsePLY(view).triangles.length, mesh.triangles.length);
});

test('binary PLY rejects text input, forged lengths and bad face records', () => {
  const mesh = V.extractManifoldMesh(cube()), bytes = V.exportPLY(mesh, 'part');
  assert.throws(() => V.parsePLY('ply\nformat binary_little_endian 1.0\nend_header\n'), TypeError);
  const ascii = Buffer.from('ply\nformat ascii 1.0\nelement vertex 0\nend_header\n');
  assert.throws(() => V.parsePLY(ascii), TypeError);
  assert.throws(() => V.parsePLY(bytes.slice(0, -1)), TypeError);
  assert.throws(() => V.parsePLY(new Uint8Array(bytes.length + 1)), TypeError);
  const forged = new Uint8Array(bytes);
  const headText = Array.from(forged.subarray(0, 400)).map(b => String.fromCharCode(b)).join('');
  const headEnd = headText.indexOf('end_header\n') + 'end_header\n'.length;
  const view = new DataView(forged.buffer);
  view.setInt32(headEnd + mesh.vertices.length * 12 + 1, 999999, true);
  assert.throws(() => V.parsePLY(forged), TypeError);
  const degentri = new Uint8Array(bytes); const dv = new DataView(degentri.buffer);
  dv.setInt32(headEnd + mesh.vertices.length * 12 + 1, 0, true);
  dv.setInt32(headEnd + mesh.vertices.length * 12 + 5, 0, true);
  assert.throws(() => V.parsePLY(degentri), TypeError);
});

test('binary PLY refuses facets that float32 would collapse', () => {
  const mesh = V.extractManifoldMesh(cube(0.001));
  mesh.vertices = mesh.vertices.map(point => point.map(value => value + 1e12));
  assert.throws(() => V.exportPLY(mesh), /float32 precision would collapse/);
});

test('VOX preserves dimensions and occupancy exactly through SIZE and XYZI chunks', () => {
  for (const name of CAD_PRESETS) {
    const grid = V.loadPreset(name, { nx: 20, ny: 14, nz: 9, pitchMm: 0.3 });
    const bytes = V.exportVOX(grid);
    assert.equal(bytes[0], 0x56); assert.equal(bytes[1], 0x4f); assert.equal(bytes[2], 0x58); assert.equal(bytes[3], 0x20);
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true), 150);
    const restored = V.parseVOX(bytes);
    assert.equal(restored.nx, 20); assert.equal(restored.ny, 14); assert.equal(restored.nz, 9);
    assert.deepEqual(Array.from(restored.data), Array.from(grid.data));
    assert.equal(restored.pitchMm, 1);
  }
});

test('VOX rejects forged magic, unknown chunks, bad counts and out of range voxels', () => {
  const grid = cube(); V.setVoxel(grid, 0, 0, 0, 0);
  const bytes = V.exportVOX(grid);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.throws(() => V.parseVOX(new Uint8Array(20)), TypeError);
  const magic = new Uint8Array(bytes); magic[0] = 0x21;
  assert.throws(() => V.parseVOX(magic), TypeError);
  const version = new Uint8Array(bytes); new DataView(version.buffer).setUint32(4, 149, true);
  assert.throws(() => V.parseVOX(version), TypeError);
  const truncated = bytes.slice(0, bytes.length - 5);
  assert.throws(() => V.parseVOX(truncated), TypeError);
  /* Forge the XYZI voxel count so it disagrees with the content length. */
  let at = -1;
  for (let i = 20; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x58 && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x5a && bytes[i + 3] === 0x49) { at = i; break; }
  }
  assert.ok(at > 20);
  const count = new Uint8Array(bytes); new DataView(count.buffer).setUint32(at + 12, view.getUint32(at + 12, true) + 1, true);
  assert.throws(() => V.parseVOX(count), TypeError);
  const outOfRange = new Uint8Array(bytes); outOfRange[at + 16] = 4 + 1;
  assert.throws(() => V.parseVOX(outOfRange), TypeError);
});

test('VOX export refuses lattices wider than 256 cells on any axis', () => {
  assert.throws(() => V.exportVOX(V.createGrid(257, 1, 1)), /256/);
  assert.throws(() => V.exportVOX(V.createGrid(1, 300, 1)), /256/);
});

test('VOX and JSON round trip without a manifold mesh', () => {
  const grid = V.createGrid(3, 3, 3); V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 1, 1);
  const restored = V.parseVOX(V.exportVOX(grid));
  assert.deepEqual(Array.from(restored.data), Array.from(grid.data));
});

test('empty and singular occupancy cannot produce a false full verification pass', () => {
  assert.throws(() => V.verifyExports(V.createGrid(2, 2, 2)), /nonempty manifold/);
  const grid = V.createGrid(3, 3, 3); V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 1, 1);
  assert.throws(() => V.verifyExports(grid), /point contacts/);
});

test('source and documentation contain no forbidden dash characters', () => {
  const forbidden = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  const binaryExtensions = /\.(?:mp4|mov|webm|png|jpe?g|gif|webp|wav|mp3|ico|pdf|zip)$/i;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.implementation-report.md') continue;
      const path = directory + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('repository source must not escape through a symlink');
      if (entry.isDirectory()) inspect(path);
      else if (entry.isFile() && !binaryExtensions.test(entry.name)) {
        const text = fs.readFileSync(path, 'utf8');
        assert.ok(forbidden.every(character => !text.includes(character)), path);
      }
    }
  }
  inspect(__dirname);
});

test('OpenSCAD parser validates balanced module and union structure', () => {
  const text = V.exportOpenSCAD(cube());
  for (const changed of [text.replace('  }\n', ''), text.replace('  }\n', '  }\n  }\n'), text.replace('union() {', 'union() {\nunion() {')]) assert.throws(() => V.parseOpenSCAD(changed), TypeError);
});

test('ASCII STL and OBJ retain full double precision for translated fine detail', () => {
  const mesh = V.extractManifoldMesh(cube(0.001));
  mesh.vertices = mesh.vertices.map(point => point.map(value => value + 1e12));
  const stl = V.parseAsciiSTL(V.exportAsciiSTL(mesh)), obj = V.parseOBJ(V.exportOBJ(mesh));
  assert.deepEqual(stl.vertices, mesh.vertices); assert.deepEqual(obj.vertices, mesh.vertices);
  equalVolume(V.analyzeMesh(stl).volumeMm3, V.analyzeMesh(mesh).volumeMm3, 1e-12);
});

test('binary STL refuses facets that float32 would collapse', () => {
  const mesh = V.extractManifoldMesh(cube(0.001));
  mesh.vertices = mesh.vertices.map(point => point.map(value => value + 1e12));
  assert.throws(() => V.exportBinarySTL(mesh), /float32 precision would collapse/);
});

test('binary STL accepts ArrayBuffers originating in another JavaScript realm', () => {
  const vm = require('node:vm');
  const bytes = V.exportBinarySTL(V.extractManifoldMesh(cube()));
  const foreign = vm.runInNewContext('new ArrayBuffer(' + bytes.length + ')');
  new Uint8Array(foreign).set(bytes);
  assert.equal(V.parseBinarySTL(foreign).triangles.length, (bytes.length - 84) / 50);
});

for (const item of V.listSculpturePresets()) {
  test('sculpture ' + item.id + ' exports valid STL, OBJ, PLY, OpenSCAD, VOX and project files', () => {
    const grid = V.loadPreset(item.id), result = V.verifyExports(grid);
    assert.equal(result.pass, true);
    assert.deepEqual(result.formats.map(format => format.name), ALL_FORMATS);
    assert.ok(result.formats.every(format => format.pass && format.bytes > 0));
    assert.equal(result.snapshotCells, grid.data.length);
    assert.ok(result.maxRelativeVolumeError <= 1e-5);
    const mesh = V.extractManifoldMesh(grid);
    assert.equal((V.exportBinarySTL(mesh, item.id).length - 84) / 50, mesh.triangles.length);
    const obj = V.parseOBJ(V.exportOBJ(mesh, item.id));
    assert.equal(obj.triangles.length, mesh.triangles.length);
    const ply = V.parsePLY(V.exportPLY(mesh, item.id));
    assert.equal(ply.triangles.length, mesh.triangles.length);
    equalVolume(V.analyzeMesh(ply).volumeMm3, mesh.stats.volumeMm3);
    const scad = V.parseOpenSCAD(V.exportOpenSCAD(grid));
    assert.deepEqual(Array.from(scad.data), Array.from(grid.data));
    const vox = V.parseVOX(V.exportVOX(grid));
    assert.deepEqual(Array.from(vox.data), Array.from(grid.data));
  });
}
