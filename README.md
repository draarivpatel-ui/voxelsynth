# VoxelSynth

**Shape. Inspect. Manufacture.** A local CAD studio that turns an editable voxel lattice into useful parts and mathematical sculptures, then checks the geometry before it leaves your browser.

[Open the studio](https://aariv.me/voxelsynth/) | [Submission story](DEVPOST_UPGRADE.md)

Pick a desk organizer, card vault, cable comb, board fixture or blended SDF sensor dock. Edit it with constructive solid geometry, slice it along any axis, audit its printability, test the surface topology and export STL, OBJ, PLY, OpenSCAD or MagicaVoxel VOX. The manufacturing lab compares all six build orientations, profiles every layer and stamps a SHA-256 brief you can verify, tamper-test and share as a `#vs=` link. Sculpture mode adds four algorithmic artworks sampled onto the same lattice, with a timed gallery cycle, exhibition lighting, a turntable and a museum-style exhibition plate export. Every operation runs in plain browser JavaScript. There are no accounts, uploads, runtime packages, remote fonts or build steps.

## A quick judging path

1. Click **Board fixture**. Four raised standoffs and four open bores are real geometry. The live readout reports total genus 4.
2. Click **SDF sensor dock** to compare a smooth-union distance field sampled onto the same inspectable lattice.
3. Hover the XY layer inset to read integer cell coordinates and physical cell centers. Click a cell, then **Undo**.
4. Press **Verify all 6 export formats**. Independent readers reparse four mesh formats, reconstruct OpenSCAD, VOX and project occupancy.
5. Toggle **Printability**. Amber undersides are overhangs and red regions are floating clusters that need supports; the diagnostics table lists exact counts.
6. Switch the slice axis to Y or X and clip above a layer to cut the model open on that plane. Enable **X** live symmetry in Shell and symmetry, apply a box and watch it mirror across the lattice midpoint.
7. Download **Binary PLY** or **MagicaVoxel VOX** alongside STL, OBJ, OpenSCAD and project JSON.
8. Scroll to the **Manufacturing and 6-orientation lab**. The comparator ranks all six rigid orientations by support volume; click a table row or a chart point to select an orientation, then watch the layer-by-layer profile update. Apply the optimal orientation to rotate the lattice onto its low-support face.
9. Download the **Brief JSON**, **Brief CSV** and **Brief Markdown**. All three carry the same SHA-256 digest shown on the page; **Verify** recomputes it, **Tamper demo** mutates a copy and gets flagged. **Copy share link** writes a `#vs=` URL that restores the part and every lab setting on reload. **Run self-tests** executes 17 deterministic checks inside the page.
10. Toggle **Sculpture mode**. Click **Play gallery** to cycle all four curated sculptures with captions on the turntable; pause, resume or exit the tour at any time, then click a card to inspect one up close. Export the exhibition plate PNG and open it in any image viewer.

The showcase buttons load complete designs directly. The part recipe selector can regenerate a design at a custom resolution, and every sculpture card stays editable: erase cells, shell it, mirror it, undo.

## What the studio contains

| Workflow | Implemented behavior |
| --- | --- |
| Build | Box, cylinder and sphere unions or differences in cell units; live X/Y/Z symmetry mirrors every edit delta; mirror X/Y; minimum wall shell erosion |
| Inspect | Orthographic orbit, top/front/isometric views, wireframe, X/Y/Z slice plane, clipping above a layer on any axis, editable layer inset, ground shadow, physical coordinate readouts |
| Audit | Printability overlay: floating-cluster detection over 6-neighbor connectivity, per-axis thin cell counts, overhang cell and area totals, printable verdict |
| Recover | 32 geometry revisions with undo/redo; project JSON save/open; failed edits and imports preserve the current geometry |
| Verify | Counted edge incidences, directed winding, connected vertex link cycles, surface components, Euler characteristic, total genus, live V - E + F proof, area and volume |
| Export | ASCII STL, binary STL, indexed OBJ, binary little endian PLY, binary glTF, cuboid-merged OpenSCAD and MagicaVoxel VOX; every download is reparsed before delivery |
| Manufacture | Six-orientation build comparator (bed footprint, overhang cells and area, floating clusters, support-column volume, layer count at 0.12 / 0.20 / 0.28 mm, mass and time estimates for PLA, PETG, ABS and TPU), layer-by-layer cross-section profile, keyboard-accessible SVG charts, one-click optimal orientation, SHA-256 audit briefs as JSON, CSV and Markdown, verify and tamper checks, `#vs=` share links and a 17-check in-page self-test runner |
| Sculpt | Four algorithmic sculpture presets (gyroid pavilion, Menger lantern, helical ribbon, Voronoi amphitheater) on the editable lattice; timed curated gallery cycle with captions and pause/resume/exit, exhibition lighting, turntable orbit and a locally encoded 1400 x 1000 exhibition plate PNG |
| Access | Focusable canvas, direct X/Y/Z cell editor, keyboard edits with a persistent single-key shortcuts switch, visible focus, live status, large touch targets and reduced motion preferences |
| Display | Responsive layouts with the viewport first on narrow screens; light and dark themes; CSS-pixel drawing with a DPI-scaled backing store |

Empty lattices and point or edge contacts keep project save available and disable manufacturing exports. The diagnostics identify why the surface needs an edit.

## Verified showcase geometry

These numbers were computed from the engine's default presets on 2026-11-15. All five pass counted edge and vertex link verification. All six export formats and project occupancy round trip for every row.

| Scenario | Grid / pitch mm | Solid cells | Export triangles | Volume mm3 | Total genus | OpenSCAD cuboids |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Desk organizer | 32 x 22 x 12 / 2 | 4,128 | 8,528 | 33,024 | 0 | 9 |
| Card vault | 24 x 18 x 10 / 1.5 | 2,380 | 5,040 | 8,032.5 | 1 | 12 |
| Cable comb | 30 x 10 x 12 / 1.5 | 2,404 | 5,552 | 8,113.5 | 2 | 26 |
| Board fixture | 36 x 16 x 8 / 1.5 | 1,408 | 3,472 | 4,752 | 4 | 26 |
| SDF sensor dock | 32 x 22 x 12 / 2 | 1,396 | 3,424 | 11,168 | 0 | 31 |

The desk organizer's binary STL is exactly 426,484 bytes: an 84-byte header plus 8,528 records of 50 bytes. OpenSCAD represents its 4,128 occupied cells with nine disjoint cuboids. The measured relative volume difference after default preset mesh round trips is zero at the stored precision.

### Sculpture mode geometry

Sculpture mode samples four algorithmic artworks onto the same integer lattice. Each preset is deterministic, passes the same counted edge and vertex link verification as the CAD parts, and round trips through all six export formats and project JSON. Numbers were computed from the engine defaults on 2026-11-18.

| Sculpture | Grid / pitch mm | Solid cells | Export triangles | Volume cm3 | Total genus | OpenSCAD cuboids |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Minimalist Gyroid Pavilion | 30 x 30 x 18 / 1.5 | 6,495 | 11,140 | 21.92 | 1 | 465 |
| Menger Sponge Lantern | 27 x 27 x 27 / 1.5 | 3,954 | 22,932 | 13.34 | 240 | 1,671 |
| Helical Kinetic Ribbon | 30 x 30 x 23 / 1.5 | 5,602 | 15,212 | 18.91 | 3 | 485 |
| Voronoi Terraced Amphitheater | 36 x 36 x 16 / 1.5 | 14,555 | 11,580 | 49.12 | 0 | 340 |

The pavilion carves the signed `sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x)` band out of a solid block on a two-cell plinth, leaving a fenestrated monolith of genus 1 whose tunnel network opens on every face. The lantern keeps base-3 cells with at most one middle digit on a two-cell plinth. The ribbon twists three arms around a central mast between solid rings. The amphitheater steps each column's height from the nearest and second nearest Voronoi seed distances.

Exhibition lighting warms the palette and canvas tint in both themes. The turntable orbits 2 degrees per tick and wraps instead of stalling at the yaw limit. The exhibition plate is a 1400 x 1000 PNG written by a local encoder (fixed Huffman LZ77 deflate plus adler32 and CRC32 checksums, no `canvas.toBlob` and no network); its zlib stream decodes and the plate title follows the geometry actually on screen, including when a CAD part is loaded in sculpture mode. Sculpture presets render with their own resolution independent of the lattice inputs; loading one replaces the current geometry and can be undone.

## Run it

Open [index.html](index.html) directly in a modern browser, or host these files with GitHub Pages. The entry point uses relative local asset paths and works at `https://aariv.me/voxelsynth/`.

Node.js is needed only for tests and programmatic use. The browser needs no installation.

```sh
npm test
```

Current verified result: **567 tests, 567 passed, 0 failed, 0 skipped**. Tests use Node builtins only, and CI runs the same single command.

| Suite | Command | Verified result |
| --- | --- | --- |
| Engine | `node --test test.js` | 134 passed, 0 failed |
| File schemas and precision | `node --test export-test.js` | 47 passed, 0 failed |
| Export integrity and audit | `node --test integrity-test.js` | 98 passed, 0 failed |
| DOM and interaction | `node --test ui-test.js` | 64 passed, 0 failed |
| Manufacturing lab | `node --test mfg-test.js` | 223 passed, 0 failed |
| Full suite | `npm test` | 566 passed, 0 failed |

The engine suite checks all 256 occupancy masks of a 2 x 2 x 2 block, exact center-sampling boundaries, singular contacts, cavities, translations, malformed input, live mirrored edits, printability component and wraparound analysis, and a 2,000,000-cell project snapshot. Format tests check complete STL facets, binary length and little endian records, OBJ index bounds, binary PLY element records and float32 collapse guards, VOX chunk structure and occupancy fidelity, balanced OpenSCAD structure, disjoint cuboid coverage and pitches from 0.000001 to 1,000,000 mm, plus full schema round trips for every sculpture preset.

The DOM suite executes the actual page scripts in a strict `node:vm` browser contract built from `index.html`. It exercises every action button, five CAD showcase presets, all four sculpture presets, the timed gallery cycle, X/Y/Z slice axes with a labeled plane group, clipping, the printability overlay with overhang/floating/thin-wall legend, live symmetry edits, undo/redo, imports, clipboard failure, high DPI picking, resize, keyboard focus and multiple pointers, with zero recorded console or reference errors. The plate tests decode the exported PNG's zlib stream and check its adler32 trailer, verify the plate title tracks the loaded geometry, confirm the plate carries topology, lattice and exhibition metadata in a compressed stream, and confirm exhibition lighting resets when sculpture mode closes. Every repository JavaScript file and any inline page script is compiled as part of the suite. These are automated DOM and geometry checks; no physical print or external slicer run is claimed.

The manufacturing suite checks cell-count and `V - E + F` invariance across all six rigid orientations on every CAD part and sculpture, exact footprints and support columns on hand-computed fixtures, material and infill mass math, layer profiles, one-digest parity across the page, JSON, CSV and Markdown, verify and tamper detection, and the `#vs=` codec. Codec probes include truncated and hostile hashes, `__proto__`, `constructor` and `prototype` keys, non-canonical base64url occupancy, string-typed layer heights, out-of-range infill and CSV formula prefixes (`=CMD()`, `+`, `-`, `@`). UI probes click orientation rows, SVG chart groups and layer points, run the in-page self-tests, and reload a workspace from a real share hash asserting every restored field.

## Geometry and verification

### Integer occupancy and center sampling

A `Uint8Array` stores `nx * ny * nz` occupancy values at `x + nx * (y + ny * z)`. Physical cell centers are `((x + 0.5) * pitchMm, (y + 0.5) * pitchMm, (z + 0.5) * pitchMm)`.

Box ranges include a center at the minimum and exclude a center at the maximum. Sphere and cylinder radial boundaries are closed; cylinder height is half open. Invalid coordinates and negative dimensions fail before changing cells. Grid booleans require equal physical pitch. Shelling uses `ceil(wallMm / pitchMm)` rounds of six-neighbor erosion and stops at the available solid depth.

### SDF construction

Analytic box, sphere and cylinder fields compose with union, subtraction, intersection or polynomial smooth union. A zero blend radius becomes an ordinary union. The SDF dock uses a blended base and spherical collar, a cylindrical bore and a planar rim. `rasterizeSDF` samples the field transactionally: a failed or nonfinite sample leaves the old grid intact.

### Greedy masks and shared surface vertices

Six face directions cull internal faces and merge coplanar masks into greedy quads. Export triangles subdivide these quads on the shared unit lattice. This prevents long greedy edges from introducing T junctions. The quad count measures coplanar compression; the triangle culling ratio compares output triangles to 12 triangles per occupied cell. Export triangles are not claimed to be two triangles per merged quad.

### A stronger manifold certificate

Each undirected edge must have exactly two incidences with opposite direction. Every vertex link must be one connected cycle. The second condition detects point contacts that can pass ordinary edge pairing; counted incidences detect edge contacts hidden by a Set.

For closed surface components, `chi = V - E + F` and total genus is `(2 * componentCount - chi) / 2`. Inner cavity surfaces count as separate surface components. Area comes from triangle cross products. Volume uses the divergence theorem with a nearby reference and compensated summation to reduce cancellation. It is compared against `solidCellCount * pitchMm^3`.

### Export contracts

ASCII STL and OBJ retain the JavaScript double's round-trip numeric representation. Binary STL and binary little endian PLY write float32 records and refuse a facet if conversion would collapse it. OBJ uses positive `v//vn` indices and one unit face normal per triangle. PLY declares float x/y/z vertices and uchar-listed int32 faces. Binary glTF writes meter units per the glTF 2.0 specification (millimeter geometry divided by 1000), and the reader converts back to millimeters. OpenSCAD merges disjoint rectangles across consecutive Z slices into cuboids and writes a balanced module and union. MagicaVoxel VOX writes SIZE, XYZI and RGBA chunks at up to 256 cells per axis and verifies without a manifold mesh, since it carries raw occupancy rather than surface facets.

Independent readers validate the subset the studio writes. `verifyExports(grid)` checks every mesh vertex, facet count, topology, area and volume, then reconstructs all OpenSCAD cells, VOX occupancy and project occupancy. Its maximum accepted relative mesh volume difference is `1e-5`; the fractional-pitch and extreme-pitch tests use that bound. The export auditor walks a glTF scene graph the same way a viewer does: every node in the active scene contributes its mesh primitives through the composed world transform, whether the transform is a matrix or a translation, rotation and scale triple, so instanced, scaled, translated or mirrored content is counted in world coordinates.

### Manufacturing lab

The lab module (`mfg-lab.js`, exposed as `window.VoxelSynthMfg` and as a CommonJS export) analyzes the lattice without changing it. Six exact 90-degree coordinate remaps produce `+z`, `-z`, `+x`, `-x`, `+y` and `-y` views; each preserves the solid cell count and the Euler characteristic because no cells are added or removed, only permuted.

For each orientation the comparator counts bed-contact cells (footprint area), cells with empty space below (overhang count and underside area), floating clusters on six-neighbor connectivity that never touch the plate, and the empty cells between the plate and the lowest solid cell of each column (columnar support volume). Layer count is `ceil(buildHeight / layerMm)` at the selected height. Filament mass is `solidMm3 * infill% * density` for PLA 1.24, PETG 1.27, ABS 1.04 and TPU 1.21 g/cm3. The print-time estimate is `extrudeMm3 / 12 mm3 per second + layers * 6 seconds`, a deterministic volumetric figure.

These are deterministic voxel-geometry estimates, not physical slicer G-code runs. No slicer walls, toolpaths, cooling, acceleration or raft behavior is simulated; the numbers rank orientations against each other, which is the decision the lab supports. The winning orientation minimizes floating clusters, then support volume, then overhang cells, then estimated time.

The audit brief serializes one canonical payload (model identity, lattice occupancy SHA-256, all six orientation rows, settings and the layer profile) and stamps it with a pure-JavaScript FIPS 180-4 SHA-256 digest. The same digest-stamped object feeds the on-page fingerprint, the JSON download, the CSV provenance comment and the Markdown footer, so all four representations always agree. CSV cells are escaped against spreadsheet formula injection. The `#vs=` share hash base64url-encodes a strict JSON state (preset name or packed occupancy bits, dimensions, pitch, orientation, material, layer height and infill); decoding validates every field with `hasOwnProperty` checks, refuses unknown and prototype-pollution keys, fails closed on any malformed input, and restores the whole workspace, including sculpture mode.

## Programmatic use

```js
const V = require('./voxel.js');

const grid = V.loadPreset('rpiPicoMount');
const mesh = V.extractManifoldMesh(grid, { infillPercent: 25 });
const check = V.verifyExports(grid);

console.log(mesh.stats.watertight);       // true
console.log(mesh.stats.genusEstimate);    // 4
console.log(V.estimateMass(mesh).grams);   // inherits 25% infill
console.log(check.formats.length);        // 6

const stlBytes = V.exportBinarySTL(mesh, 'board_fixture');
const project = V.serializeGrid(grid);
const recovered = V.deserializeGrid(project);

const M = require('./mfg-lab.js');
const report = M.compareOrientations(grid, { material: 'PETG', layerMm: 0.2, infillPercent: 60 });
console.log(report.best.orientation);        // '+z' for the fixture
const bundle = M.auditBundle(grid);
console.log(bundle.digest);                   // one digest for page, JSON, CSV and Markdown
const hash = M.encodeShareState({ grid: grid, orientation: '+x', material: 'ABS', layerMm: 0.28, infillPercent: 40 });
const state = M.decodeShareHash(hash);        // fails closed on malformed input
```

The UMD engine exposes `window.VoxelSynth` in classic browser scripts, and `mfg-lab.js` exposes `window.VoxelSynthMfg`. `window.VoxelSynthStudio.snapshot()`, `.inspect()`, `.importText()`, `.shareHash()` and `.lab()` provide a small workspace integration API.

## Practical limits

The editor supports up to 48 x 48 x 32 cells. The engine caps allocation at 2,000,000 cells and accepts pitch from 0.000001 to 1,000,000 mm. Surface extraction is capped at 250,000 triangles before mesh allocation. An overly complex edit or import preserves the current part and history. Part and sculpture recipes require at least four cells per axis. Sculpture presets carry their own default resolutions that can be overridden down to the editor limit; the plate PNG is a flat stylistic projection, not a shaded or perspective render. Imported project files are limited to 1 MB and the editor dimensions; their declared occupancy length, base64 representation and binary characters are checked exactly.

Voxel resolution controls dimensional accuracy. Curves are stepped surfaces, six-neighbor shells are a discrete morphology, and fixture recipes are design starting points rather than certified hardware fits. Measure a specific board and choose an appropriate pitch before fabrication. The material estimate is volume x infill x density; slicer walls, supports, toolpaths and print time are not simulated. The manufacturing lab's support, mass and print-time figures are deterministic voxel-geometry estimates used to compare orientations, not outputs of a physical slicer or G-code run.

## Files

| File | Responsibility |
| --- | --- |
| [voxel.js](voxel.js) | Validated lattice, CSG, SDFs, algorithmic sculpture presets, surface extraction, topology, printability analysis, live symmetry edits, format writers/readers and project serialization |
| [app.js](app.js) | Renderer, DPI resizing, X/Y/Z slice inspection, printability overlay, recoverable edits, keyboard navigation, sculpture gallery, manufacturing lab wiring and checked export delivery |
| [mfg-lab.js](mfg-lab.js) | Six-orientation comparator, layer profiles, material and infill estimates, SHA-256 audit briefs (JSON, CSV, Markdown), `#vs=` share codec and in-page self-tests |
| [index.html](index.html), [style.css](style.css) | Local studio, responsive hierarchy, accessible controls, themes and the sculpture section |
| [test.js](test.js) | 135 engine tests |
| [export-test.js](export-test.js) | 47 format and precision tests |
| [integrity-test.js](integrity-test.js) | 98 export integrity, audit and glTF scene tests |
| [ui-test.js](ui-test.js), [dom-harness.js](dom-harness.js) | 64 UI tests and the strict page contract |
| [mfg-test.js](mfg-test.js) | 223 manufacturing lab, codec, audit and lab UI tests |

MIT. See [LICENSE](LICENSE).
