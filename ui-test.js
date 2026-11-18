'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createWorkspace } = require('./dom-harness.js');
const V = require('./voxel.js');

function occupancy(workspace) { return Array.from(V.deserializeGrid(workspace.studio.snapshot()).data); }
function clean(workspace) { assert.deepEqual(workspace.errors, []); }

test('every JavaScript file and inline index script compiles without a syntax error', () => {
  const scripts = fs.readdirSync(__dirname).filter(name => name.endsWith('.js'));
  for (const filename of scripts) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(__dirname + '/' + filename, 'utf8'), { filename }));
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /src="([^"]+)"/.exec(match[1]);
    if (src) assert.ok(fs.existsSync(__dirname + '/' + src[1]));
    else assert.doesNotThrow(() => new vm.Script(match[2]));
  }
});

test('startup populates real diagnostics and reports zero runtime or reference errors', () => {
  const w = createWorkspace();
  assert.match(w.get('diag-body').textContent, /WatertightYes/);
  assert.match(w.get('health-badge').textContent, /MANIFOLD PASS/);
  assert.equal(w.studio.inspect().stats.watertight, true);
  assert.match(w.get('metric-volume').textContent, /33.02/);
  clean(w);
});

test('all page action buttons and canvas pointer events have persistent handlers', () => {
  const w = createWorkspace();
  for (const node of w.nodes.filter(node => node.tagName === 'BUTTON')) assert.ok(node.listeners.has('click'), node.id || node.className);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'wheel']) assert.ok(w.get('viewport').listeners.has(type), type);
  clean(w);
});

const CAD_PRESETS = ['deskOrganizer', 'sdCardVault', 'cableComb', 'rpiPicoMount', 'sdfDock'];
for (const name of CAD_PRESETS) test('showcase ' + name + ' loads a complete editable manifold in one action', () => {
  const w = createWorkspace();
  w.group('data-showcase', name).click();
  assert.equal(w.studio.inspect().stats.watertight, true);
  assert.equal(w.get('preset-select').value, name);
  assert.equal(w.group('data-showcase', name).getAttribute('aria-pressed'), 'true');
  assert.equal(w.get('slice').value, String(w.studio.inspect().slice));
  clean(w);
});

test('new lattice honors valid inputs and clear preserves current physical dimensions', () => {
  const w = createWorkspace();
  w.get('grid-nx').value = '12'; w.get('grid-ny').value = '10'; w.get('grid-nz').value = '8'; w.get('grid-pitch').value = '0.5';
  w.get('apply-grid').click();
  assert.equal(w.studio.snapshot().nx, 12); assert.equal(w.studio.snapshot().pitchMm, 0.5);
  w.get('grid-nx').value = '40'; w.get('reset-grid').click();
  assert.equal(w.studio.snapshot().nx, 12);
  w.get('apply-primitive').click(); assert.equal(w.studio.inspect().stats.voxelCount, 96);
  w.group('data-op', 'subtract').click(); w.group('data-prim', 'sphere').click();
  w.get('apply-primitive').click(); assert.equal(w.studio.inspect().stats.voxelCount, 0);
  w.group('data-op', 'add').click(); w.group('data-prim', 'cylinder').click();
  w.get('apply-primitive').click(); assert.equal(w.studio.inspect().stats.voxelCount, 480);
  clean(w);
});

test('invalid lattice dimensions and primitive parameters fail without stale or partial geometry', () => {
  const w = createWorkspace(), before = occupancy(w);
  w.get('grid-nx').value = '-2'; w.get('apply-grid').click();
  assert.match(w.get('toast').textContent, /positive integer/); assert.deepEqual(occupancy(w), before);
  w.get('prim-w').value = '-2'; w.get('apply-primitive').click();
  assert.match(w.get('toast').textContent, /nonnegative/); assert.deepEqual(occupancy(w), before);
  assert.equal(w.studio.inspect().history.undo, 0);
  clean(w);
});

test('blank material estimate fields do not corrupt later geometry edits', () => {
  const w = createWorkspace();
  w.get('infill').value = ''; w.get('infill').dispatch('input');
  w.get('reset-grid').click();
  assert.equal(w.studio.inspect().stats.voxelCount, 0);
  assert.match(w.get('health-badge').textContent, /EMPTY LATTICE/);
  clean(w);
});

test('boolean and primitive segments reflect their exact active state', () => {
  const w = createWorkspace();
  w.group('data-op', 'subtract').click(); w.group('data-prim', 'sphere').click();
  assert.equal(w.group('data-op', 'subtract').getAttribute('aria-pressed'), 'true');
  assert.equal(w.group('data-op', 'add').getAttribute('aria-pressed'), 'false');
  assert.equal(w.group('data-prim', 'sphere').getAttribute('aria-pressed'), 'true');
  assert.match(w.get('primitive-hint').textContent, /sphere center/);
  assert.equal(w.get('mode-chip').textContent, 'sphere / subtract');
  clean(w);
});

test('undo and redo restore exact occupancy and clear redo after a new edit', () => {
  const w = createWorkspace(), original = occupancy(w);
  w.get('reset-grid').click(); assert.equal(w.studio.inspect().stats.voxelCount, 0);
  w.get('undo').click(); assert.deepEqual(occupancy(w), original);
  w.get('redo').click(); assert.equal(w.studio.inspect().stats.voxelCount, 0);
  w.get('undo').click(); w.get('toggle-voxel').click();
  assert.equal(w.get('redo').disabled, true);
  clean(w);
});

test('history is bounded to 32 recoverable geometry revisions', () => {
  const w = createWorkspace();
  w.studio.importText(JSON.stringify(V.serializeGrid(V.createGrid(2, 2, 2))));
  for (let i = 0; i < 40; i++) w.get('toggle-voxel').click();
  assert.equal(w.studio.inspect().history.undo, 32);
  clean(w);
});

test('cell inspector clamps out of bounds coordinates and rejects fractional coordinates', () => {
  const w = createWorkspace();
  w.get('inspect-x').value = '999'; w.get('inspect-x').dispatch('change');
  assert.equal(w.studio.inspect().selected[0], w.studio.snapshot().nx - 1);
  w.get('inspect-y').value = '1.5'; w.get('inspect-y').dispatch('change');
  assert.match(w.get('toast').textContent, /whole cells/);
  assert.equal(w.studio.inspect().selected[1], 0);
  clean(w);
});

test('canvas keyboard edits use integer cell coordinates and retain undo', () => {
  const w = createWorkspace(); w.get('viewport').focus();
  w.key('ArrowRight'); w.key('ArrowUp');
  const cell = Array.from(w.studio.inspect().selected), before = occupancy(w);
  w.key(' '); const after = occupancy(w);
  assert.deepEqual(cell.slice(0, 2), [1, 1]);
  assert.equal(after.filter((value, i) => value !== before[i]).length, 1);
  w.key('z', { ctrlKey: true }); assert.deepEqual(occupancy(w), before);
  w.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(occupancy(w), after);
  clean(w);
});

test('shortcuts respect form fields, contenteditable regions and browser modifiers', () => {
  const w = createWorkspace(), before = w.studio.snapshot();
  w.key('r', { target: w.get('prim-x') });
  w.key('r', { target: { tagName: 'DIV', isContentEditable: true } });
  w.key('r', { target: w.document.body, ctrlKey: true });
  assert.equal(w.studio.snapshot().cells, before.cells);
  w.key('ArrowLeft', { target: w.document.body }); assert.equal(w.studio.inspect().yawDeg, 30);
  clean(w);
});

test('top view uses the full 90 degree range and slice controls stay synchronized', () => {
  const w = createWorkspace(); w.get('view-top').click();
  assert.equal(w.studio.inspect().pitchDeg, 90); assert.equal(w.get('pitch').value, '90');
  w.key('PageUp', { target: w.document.body });
  assert.equal(w.get('slice').value, String(w.studio.inspect().slice));
  assert.equal(w.get('inspect-z').value, String(w.studio.inspect().slice));
  clean(w);
});

test('slice clipping exposes cut faces even when the layer plane is hidden', () => {
  const w = createWorkspace();
  const grid = V.createGrid(4, 4, 4); V.addBox(grid, 0, 0, 0, 4, 4, 4);
  w.studio.importText(JSON.stringify(V.serializeGrid(grid)));
  w.get('inspect-z').value = '1'; w.get('inspect-z').dispatch('change');
  w.get('cycle-slice-mode').click(); const faces = w.studio.inspect().faceCount;
  w.get('toggle-slice').click();
  assert.equal(w.studio.inspect().sliceOnly, true);
  assert.equal(w.studio.inspect().showSlice, false);
  assert.equal(w.studio.inspect().faceCount, faces);
  assert.equal(faces, 32);
  clean(w);
});

test('DPI backing store and resize use CSS coordinates without changing physical geometry', () => {
  const w = createWorkspace({ width: 600, height: 450, dpr: 2 }), before = w.studio.snapshot();
  assert.equal(w.get('viewport').width, 1200); assert.equal(w.get('viewport').height, 900);
  w.resize(320, 440, 3);
  assert.equal(w.get('viewport').width, 960); assert.equal(w.get('viewport').height, 1320);
  assert.equal(w.studio.inspect().width, 320); assert.equal(w.studio.snapshot().cells, before.cells);
  assert.ok(w.drawCalls.some(call => call.method === 'setTransform' && call.values[0] === 3));
  clean(w);
});

test('layer inset hover and click map to the correct cell at high DPI', () => {
  const w = createWorkspace({ width: 420, height: 440, dpr: 2 });
  const state = w.studio.inspect(), inset = state.inset;
  const x = 3, y = 2;
  const point = { clientX: inset.gx + (x + 0.5) * inset.cell, clientY: inset.gy + (w.studio.snapshot().ny - y - 0.5) * inset.cell, pointerId: 7, button: 0 };
  w.get('viewport').dispatch('pointermove', point);
  assert.match(w.get('hover-readout').textContent, /Cell 3, 2,/);
  const before = occupancy(w);
  w.get('viewport').dispatch('pointerdown', point); w.get('viewport').dispatch('pointerup', point);
  assert.deepEqual(Array.from(w.studio.inspect().selected), [x, y, state.slice]);
  assert.equal(occupancy(w).filter((value, i) => value !== before[i]).length, 1);
  assert.match(w.get('hover-readout').textContent, /^Hover over/);
  clean(w);
});

test('pointer cancel and lost capture prevent a phantom voxel edit', () => {
  const w = createWorkspace(), before = occupancy(w);
  const point = { clientX: 350, clientY: 280, pointerId: 1, button: 0 };
  w.get('viewport').dispatch('pointerdown', point); w.get('viewport').dispatch('pointercancel', point); w.get('viewport').dispatch('pointerup', point);
  assert.deepEqual(occupancy(w), before);
  w.get('viewport').dispatch('pointerdown', point); w.get('viewport').dispatch('lostpointercapture', point); w.get('viewport').dispatch('pointerup', point);
  assert.deepEqual(occupancy(w), before);
  clean(w);
});

test('drag orbits without editing and zero wheel delta preserves scale', () => {
  const w = createWorkspace(), before = occupancy(w), viewport = w.get('viewport');
  viewport.dispatch('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  viewport.dispatch('pointermove', { clientX: 130, clientY: 120, pointerId: 1 });
  viewport.dispatch('pointerup', { clientX: 130, clientY: 120, pointerId: 1 });
  assert.equal(w.studio.inspect().yawDeg, 47); assert.deepEqual(occupancy(w), before);
  viewport.dispatch('wheel', { deltaY: 0 }); assert.equal(w.studio.inspect().zoom, 1);
  assert.equal(viewport.listeners.get('wheel')[0].options.passive, false);
  clean(w);
});

test('full export self-check returns four format passes and is invalidated by editing', () => {
  const w = createWorkspace(); w.get('verify-exports').click();
  assert.match(w.get('verification-result').textContent, /4 formats passed \+ project occupancy/);
  w.get('toggle-voxel').click(); assert.match(w.get('verification-result').textContent, /Geometry changed/);
  clean(w);
});

test('empty and contact meshes block manufacturing exports but allow editable project save', () => {
  const w = createWorkspace(); w.get('reset-grid').click();
  assert.equal(w.group('data-export', 'binary-stl').disabled, true);
  assert.equal(w.group('data-export', 'json').disabled, false);
  const grid = V.createGrid(3, 3, 3); V.setVoxel(grid, 0, 0, 0, 1); V.setVoxel(grid, 1, 1, 1, 1);
  w.studio.importText(JSON.stringify(V.serializeGrid(grid)));
  assert.match(w.get('health-badge').textContent, /CONTACT DETECTED/);
  assert.equal(w.group('data-export', 'obj').disabled, true);
  w.group('data-export', 'json').click(); assert.equal(w.downloads.length, 1);
  clean(w);
});

test('each download validates its payload and releases the Blob URL', async () => {
  const w = createWorkspace(); w.get('export-name').value = '../part <test>';
  for (const kind of ['ascii-stl', 'binary-stl', 'obj', 'scad', 'json']) w.group('data-export', kind).click();
  assert.equal(w.downloads.length, 5);
  assert.ok(w.downloads.every(download => /^part_test\.(stl|obj|scad|json)$/.test(download.filename)));
  assert.match(await w.downloads[0].blob.text(), /^solid /);
  assert.equal(V.parseBinarySTL(new Uint8Array(await w.downloads[1].blob.arrayBuffer())).triangles.length, w.studio.inspect().stats.triangleCount);
  w.runTimers(); assert.equal(w.urls.size, 0);
  clean(w);
});

test('valid project file import restores exact occupancy and resets the input for reuse', async () => {
  const w = createWorkspace(), grid = V.createGrid(4, 5, 6, 0.2); V.addSphere(grid, 0.4, 0.5, 0.6, 0.3);
  const text = JSON.stringify(V.serializeGrid(grid));
  w.get('import-project').files = [{ size: text.length, text: async () => text }];
  await w.get('import-project').dispatch('change');
  assert.deepEqual(occupancy(w), Array.from(grid.data)); assert.equal(w.studio.snapshot().pitchMm, 0.2);
  assert.equal(w.get('import-project').value, '');
  w.get('open-project').click(); assert.equal(w.get('import-project').clickCount, 1);
  clean(w);
});

test('malformed or oversized project files leave geometry and undo history intact', async () => {
  const w = createWorkspace(), before = w.studio.snapshot();
  w.get('import-project').files = [{ size: 3, text: async () => '{' }];
  await w.get('import-project').dispatch('change');
  assert.equal(w.studio.snapshot().cells, before.cells); assert.equal(w.studio.inspect().history.undo, 0);
  w.get('import-project').files = [{ size: 1000001, text: async () => { throw new Error('must not read'); } }];
  await w.get('import-project').dispatch('change'); assert.match(w.get('toast').textContent, /smaller than 1 MB/);
  clean(w);
});

test('clipboard uses the current geometry and reports a real fallback failure', async () => {
  const w = createWorkspace(); await w.group('data-copy', 'json').click();
  assert.equal(JSON.parse(w.copies[0]).cells, w.studio.snapshot().cells);
  assert.match(w.get('toast').textContent, /copied to clipboard/);
  const fallback = createWorkspace({ clipboardRejects: true, legacyCopy: false });
  await fallback.group('data-copy', 'json').click();
  assert.match(fallback.get('toast').textContent, /Clipboard unavailable/);
  assert.doesNotMatch(fallback.get('toast').textContent, /copied/);
  clean(w); clean(fallback);
});

test('themes and help remain accessible when browser storage is blocked', () => {
  const w = createWorkspace({ blockStorage: true });
  w.get('theme-toggle').click(); assert.equal(w.document.documentElement.getAttribute('data-theme'), 'dark');
  w.get('help-toggle').click(); assert.equal(w.get('help-panel').hidden, false); assert.equal(w.get('help-toggle').getAttribute('aria-expanded'), 'true');
  w.get('help-toggle').click(); assert.equal(w.get('help-panel').hidden, true);
  clean(w);
});

test('page has accessible labels and local assets with responsive and motion preferences', () => {
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  assert.match(html, /lang="en"/); assert.match(html, /class="skip-link"/); assert.match(html, /id="viewport"[^>]+tabindex="0"/);
  assert.match(html, /aria-live="polite"/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /pointer: coarse/);
  assert.match(css, /@media \(max-width: 540px\)/); assert.doesNotMatch(html, /(?:src|href)="https?:\/\/[^\"]+\.(?:js|css)/);
});

test('shell and mirror controls change geometry and retain exact undo history', () => {
  const w = createWorkspace(), grid = V.createGrid(4, 4, 4);
  V.addBox(grid, 0, 0, 0, 4, 4, 4); w.studio.importText(JSON.stringify(V.serializeGrid(grid)));
  w.get('shell-wall').value = '1'; w.get('apply-shell').click();
  assert.equal(w.studio.inspect().stats.voxelCount, 56);
  assert.equal(w.studio.inspect().stats.surfaceComponents, 2);
  const asymmetric = V.createGrid(4, 4, 4); V.setVoxel(asymmetric, 0, 1, 0, 1);
  w.studio.importText(JSON.stringify(V.serializeGrid(asymmetric)));
  w.get('mirror-x').click(); w.get('mirror-y').click();
  assert.equal(V.getVoxel(V.deserializeGrid(w.studio.snapshot()), 3, 2, 0), 1);
  w.get('undo').click(); assert.equal(V.getVoxel(V.deserializeGrid(w.studio.snapshot()), 3, 1, 0), 1);
  clean(w);
});

test('a second pointer cannot replace or cancel the active orbit gesture', () => {
  const w = createWorkspace(), viewport = w.get('viewport'), before = occupancy(w);
  viewport.dispatch('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  viewport.dispatch('pointerdown', { clientX: 400, clientY: 300, pointerId: 2, button: 0 });
  viewport.dispatch('pointercancel', { pointerId: 2 });
  viewport.dispatch('pointermove', { clientX: 110, clientY: 100, pointerId: 1 });
  viewport.dispatch('pointerup', { clientX: 110, clientY: 100, pointerId: 1 });
  assert.equal(w.studio.inspect().yawDeg, 39); assert.deepEqual(occupancy(w), before);
  clean(w);
});

test('a rejected complex import preserves the current model and undo state', () => {
  const w=createWorkspace(), before=w.studio.snapshot(), history=w.studio.inspect().history;
  const grid=V.createGrid(48,48,32,1);
  for(let z=0;z<32;z++) for(let y=0;y<48;y++) for(let x=0;x<48;x++) if((x+y+z)%2===0) V.setVoxel(grid,x,y,z,1);
  assert.throws(()=>w.studio.importText(JSON.stringify(V.serializeGrid(grid))),/triangle budget/);
  assert.deepEqual(w.studio.snapshot(),before); assert.deepEqual(w.studio.inspect().history,history);
});
test('extremely narrow canvas rendering keeps the projection scale positive', () => {
  const w=createWorkspace(); w.resize(50,70,2);
  const polygons=w.drawCalls.filter(call=>call.method==='moveTo'||call.method==='lineTo');
  assert.ok(polygons.length>0); assert.ok(polygons.every(call=>call.values.every(Number.isFinite))); assert.deepEqual(w.errors,[]);
});

for (const item of V.listSculpturePresets()) {
  test('sculpture mode loads ' + item.id + ' with verified plate metrics and editable geometry', () => {
    const w = createWorkspace();
    assert.equal(w.get('art-section').hidden, true);
    w.get('art-mode-toggle').click();
    assert.equal(w.get('art-section').hidden, false);
    assert.equal(w.studio.inspect().artMode, true);
    w.group('data-sculpture', item.id).click();
    assert.equal(w.studio.inspect().sculpture, item.id);
    assert.equal(w.studio.inspect().stats.watertight, true);
    assert.equal(w.get('art-plate-title').textContent, item.label);
    assert.equal(w.get('art-plate-badge').textContent, 'MANIFOLD');
    assert.equal(w.get('art-metric-voxels').textContent, w.studio.inspect().stats.voxelCount.toLocaleString('en-US'));
    assert.equal(w.group('data-sculpture', item.id).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(w.studio.snapshot().cells, V.serializeGrid(V.loadPreset(item.id)).cells);
    w.get('undo').click();
    assert.notDeepEqual(w.studio.snapshot().cells, V.serializeGrid(V.loadPreset(item.id)).cells);
    clean(w);
  });
}

test('exhibition lighting and turntable toggle without changing geometry', async () => {
  const w = createWorkspace();
  w.get('art-mode-toggle').click();
  const before = w.studio.snapshot();
  w.get('lighting-toggle').click();
  assert.equal(w.studio.inspect().lighting, true);
  assert.equal(w.get('lighting-toggle').getAttribute('aria-pressed'), 'true');
  assert.ok(w.get('art-section')._class.has('exhibition'));
  w.get('turntable-toggle').click();
  assert.equal(w.studio.inspect().turntable, true);
  assert.equal(w.get('turntable-toggle').getAttribute('aria-pressed'), 'true');
  w.runTimers();
  assert.equal(w.studio.inspect().yawDeg, 35);
  w.get('turntable-toggle').click();
  assert.equal(w.studio.inspect().turntable, false);
  w.get('art-mode-toggle').click();
  assert.equal(w.studio.inspect().turntable, false);
  assert.equal(w.studio.inspect().artMode, false);
  assert.deepEqual(w.studio.snapshot(), before);
  clean(w);
});

test('exhibition plate export writes a complete PNG with a valid trailer', async () => {
  const w = createWorkspace();
  w.get('art-mode-toggle').click();
  w.group('data-sculpture', 'mengerLantern').click();
  w.get('art-export-plate').click();
  assert.equal(w.downloads.length, 1);
  assert.match(w.downloads[0].filename, /-plate\.png$/);
  const bytes = new Uint8Array(await w.downloads[0].blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.length > 100000, true);
  assert.equal(String.fromCharCode(...bytes.slice(-8, -4)), 'IEND');
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 12), 0);
  assert.match(w.get('toast').textContent, /1400 x 1000 PNG/);
  clean(w);
});

test('exhibition plate PNG contains a decodable zlib stream whose adler32 matches the raw pixels', async () => {
  const zlib = require('node:zlib');
  const w = createWorkspace();
  w.get('art-mode-toggle').click();
  w.group('data-sculpture', 'mengerLantern').click();
  w.get('art-export-plate').click();
  const bytes = new Uint8Array(await w.downloads[0].blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 8, idat = null;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IDAT') idat = bytes.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  assert.ok(idat && idat.length > 0);
  const raw = zlib.inflateSync(Buffer.from(idat));
  assert.equal(raw.length, (1400 * 3 + 1) * 1000);
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const trailer = (idat[idat.length - 4] << 24) | (idat[idat.length - 3] << 16) | (idat[idat.length - 2] << 8) | idat[idat.length - 1];
  assert.equal(trailer >>> 0, (b * 65536 + a) >>> 0);
  clean(w);
});

test('plate title follows the lattice on screen, not a remembered sculpture', () => {
  const w = createWorkspace();
  w.get('art-mode-toggle').click();
  w.group('data-sculpture', 'mengerLantern').click();
  assert.equal(w.get('art-plate-title').textContent, 'Menger Sponge Lantern');
  w.group('data-showcase', 'deskOrganizer').click();
  assert.equal(w.get('art-plate-title').textContent, 'Editable lattice');
  assert.equal(w.studio.inspect().sculpture, null);
  assert.equal(w.get('art-plate-badge').textContent, 'MANIFOLD');
  w.group('data-sculpture', 'gyroidPavilion').click();
  assert.equal(w.get('art-plate-title').textContent, 'Minimalist Gyroid Pavilion');
  assert.equal(w.studio.inspect().sculpture, 'gyroidPavilion');
  clean(w);
});

test('leaving art mode stops exhibition lighting and restores CAD colors', () => {
  const w = createWorkspace();
  w.get('art-mode-toggle').click();
  w.get('lighting-toggle').click();
  assert.equal(w.studio.inspect().lighting, true);
  w.get('art-mode-toggle').click();
  assert.equal(w.studio.inspect().lighting, false);
  assert.equal(w.get('lighting-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(w.get('lighting-toggle').textContent, 'Exhibition lighting');
  assert.equal(w.get('art-section')._class.has('exhibition'), false);
  clean(w);
});

test('artist statement explains implicit surfaces and fabrication formats', () => {
  const html = require('node:fs').readFileSync(__dirname + '/index.html', 'utf8');
  assert.match(html, /id="art-statement"/);
  assert.match(html, /Artist statement and fabrication spec/);
  assert.match(html, /minimal surface/);
  assert.match(html, /OpenSCAD/);
});
