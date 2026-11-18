# VoxelSynth

**Shape. Inspect. Manufacture.** A local CAD studio that turns an editable voxel lattice into useful parts and mathematical sculptures, then checks the geometry before it leaves your browser.

[Open the studio](https://aariv.me/voxelsynth/) | [Submission story](DEVPOST_UPGRADE.md)

Pick a desk organizer, card vault, cable comb, board fixture or blended SDF sensor dock. Edit it with constructive solid geometry, inspect a layer, test the surface topology and export STL, OBJ or OpenSCAD. Sculpture mode adds four algorithmic artworks sampled onto the same lattice, with exhibition lighting, a turntable and a museum-style exhibition plate export. Every operation runs in plain browser JavaScript. There are no accounts, uploads, runtime packages, remote fonts or build steps.

## A quick judging path

1. Click **Board fixture**. Four raised standoffs and four open bores are real geometry. The live readout reports total genus 4.
2. Click **SDF sensor dock** to compare a smooth-union distance field sampled onto the same inspectable lattice.
3. Hover the XY layer inset to read integer cell coordinates and physical cell centers. Click a cell, then **Undo**.
4. Press **Verify all 4 export formats**. Independent readers reparse three mesh formats, reconstruct OpenSCAD occupancy and restore project JSON.
5. Download **Binary STL** or **Save project**. Open the JSON later to recover every cell and its pitch.
6. Toggle **Sculpture mode**. Click each of the four sculpture cards, watch the live plate report MANIFOLD for every one, play the turntable and switch on exhibition lighting. Export the exhibition plate PNG and open it in any image viewer.

The showcase buttons load complete designs directly. The part recipe selector can regenerate a design at a custom resolution, and every sculpture card stays editable: erase cells, shell it, mirror it, undo.

## What the studio contains

| Workflow | Implemented behavior |
| --- | --- |
| Build | Box, cylinder and sphere unions or differences in cell units; mirror X/Y; minimum wall shell erosion |
| Inspect | Orthographic orbit, top/front/isometric views, wireframe, layer plane, clipping above a layer, editable XY inset, physical coordinate readouts |
| Recover | 32 geometry revisions with undo/redo; project JSON save/open; failed edits and imports preserve the current geometry |
| Verify | Counted edge incidences, directed winding, connected vertex link cycles, surface components, Euler characteristic, total genus, area and volume |
| Export | ASCII STL, binary STL, indexed OBJ and cuboid-merged OpenSCAD; every download is reparsed before delivery |
| Sculpt | Four algorithmic sculpture presets (gyroid pavilion, Menger lantern, helical ribbon, Voronoi amphitheater) on the editable lattice; exhibition lighting, turntable orbit and a locally encoded 1400 x 1000 exhibition plate PNG |
| Access | Focusable canvas, direct X/Y/Z cell editor, keyboard edits, visible focus, live status, large touch targets and reduced motion preferences |
| Display | Responsive layouts with the viewport first on narrow screens; light and dark themes; CSS-pixel drawing with a DPI-scaled backing store |

Empty lattices and point or edge contacts keep project save available and disable manufacturing exports. The diagnostics identify why the surface needs an edit.

## Verified showcase geometry

These numbers were computed from the engine's default presets on 2026-11-15. All five pass counted edge and vertex link verification. The four manufacturing formats and project occupancy round trip for every row.

| Scenario | Grid / pitch mm | Solid cells | Export triangles | Volume mm3 | Total genus | OpenSCAD cuboids |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Desk organizer | 32 x 22 x 12 / 2 | 4,128 | 8,528 | 33,024 | 0 | 9 |
| Card vault | 24 x 18 x 10 / 1.5 | 2,380 | 5,040 | 8,032.5 | 1 | 12 |
| Cable comb | 30 x 10 x 12 / 1.5 | 2,404 | 5,552 | 8,113.5 | 2 | 26 |
| Board fixture | 36 x 16 x 8 / 1.5 | 1,408 | 3,472 | 4,752 | 4 | 26 |
| SDF sensor dock | 32 x 22 x 12 / 2 | 1,396 | 3,424 | 11,168 | 0 | 31 |

The desk organizer's binary STL is exactly 426,484 bytes: an 84-byte header plus 8,528 records of 50 bytes. OpenSCAD represents its 4,128 occupied cells with nine disjoint cuboids. The measured relative volume difference after default preset mesh round trips is zero at the stored precision.

### Sculpture mode geometry

Sculpture mode samples four algorithmic artworks onto the same integer lattice. Each preset is deterministic, passes the same counted edge and vertex link verification as the CAD parts, and round trips through all four manufacturing formats and project JSON. Numbers were computed from the engine defaults on 2026-11-18.

| Sculpture | Grid / pitch mm | Solid cells | Export triangles | Volume cm3 | Total genus | OpenSCAD cuboids |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Minimalist Gyroid Pavilion | 30 x 30 x 18 / 1.5 | 15,144 | 8,464 | 51.11 | 0 | 9 |
| Menger Sponge Lantern | 27 x 27 x 27 / 1.5 | 3,954 | 22,932 | 13.34 | 240 | 1,671 |
| Helical Kinetic Ribbon | 30 x 30 x 23 / 1.5 | 5,602 | 15,212 | 18.91 | 3 | 485 |
| Voronoi Terraced Amphitheater | 36 x 36 x 16 / 1.5 | 14,555 | 11,580 | 49.12 | 0 | 340 |

The gyroid is a dilated `sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x)` shell that stays connected and manifold at this resolution. The lantern keeps base-3 cells with at most one middle digit on a two-cell plinth. The ribbon twists three arms around a central mast between solid rings. The amphitheater steps each column's height from the nearest and second nearest Voronoi seed distances.

Exhibition lighting warms the palette and canvas tint in both themes. The turntable orbits 2 degrees per tick and wraps instead of stalling at the yaw limit. The exhibition plate is a 1400 x 1000 PNG written by a local encoder (stored deflate plus adler32 and CRC32 checksums, no `canvas.toBlob` and no network); its zlib stream decodes and the plate title follows the geometry actually on screen, including when a CAD part is loaded in sculpture mode. Sculpture presets render with their own resolution independent of the lattice inputs; loading one replaces the current geometry and can be undone.

## Run it

Open [index.html](index.html) directly in a modern browser, or host these files with GitHub Pages. The entry point uses relative local asset paths and works at `https://aariv.me/voxelsynth/`.

Node.js is needed only for tests and programmatic use. The browser needs no installation.

```sh
node --test test.js export-test.js ui-test.js
```

Current verified result: **201 tests, 201 passed, 0 failed, 0 skipped**. Tests use Node builtins only.

| Suite | Command | Verified result |
| --- | --- | --- |
| Engine | `node --test test.js` | 117 passed, 0 failed |
| File schemas and precision | `node --test export-test.js` | 39 passed, 0 failed |
| DOM and interaction | `node --test ui-test.js` | 45 passed, 0 failed |
| Full suite | `node --test test.js export-test.js ui-test.js` | 201 passed, 0 failed |

The engine suite checks all 256 occupancy masks of a 2 x 2 x 2 block, exact center-sampling boundaries, singular contacts, cavities, translations, malformed input and a 2,000,000-cell project snapshot. Format tests check complete STL facets, binary length and little endian records, OBJ index bounds, balanced OpenSCAD structure, disjoint cuboid coverage and pitches from 0.000001 to 1,000,000 mm, plus full schema round trips for every sculpture preset.

The DOM suite executes the actual page scripts in a strict `node:vm` browser contract built from `index.html`. It exercises every action button, five CAD showcase presets, all four sculpture presets, undo/redo, imports, clipboard failure, high DPI picking, resize, keyboard focus and multiple pointers, with zero recorded console or reference errors. The plate tests decode the exported PNG's zlib stream and check its adler32 trailer, verify the plate title tracks the loaded geometry, and confirm exhibition lighting resets when sculpture mode closes. Every repository JavaScript file and any inline page script is compiled as part of the suite. These are automated DOM and geometry checks; no physical print or external slicer run is claimed.

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

ASCII STL and OBJ retain the JavaScript double's round-trip numeric representation. Binary STL writes little endian float32 records and refuses a facet if conversion would collapse it. OBJ uses positive `v//vn` indices and one unit face normal per triangle. OpenSCAD merges disjoint rectangles across consecutive Z slices into cuboids and writes a balanced module and union.

Independent readers validate the subset the studio writes. `verifyExports(grid)` checks every mesh vertex, facet count, topology, area and volume, then reconstructs all OpenSCAD cells and project occupancy. Its maximum accepted relative mesh volume difference is `1e-5`; the fractional-pitch and extreme-pitch tests use that bound.

## Programmatic use

```js
const V = require('./voxel.js');

const grid = V.loadPreset('rpiPicoMount');
const mesh = V.extractManifoldMesh(grid, { infillPercent: 25 });
const check = V.verifyExports(grid);

console.log(mesh.stats.watertight);       // true
console.log(mesh.stats.genusEstimate);    // 4
console.log(V.estimateMass(mesh).grams);   // inherits 25% infill
console.log(check.formats.length);        // 4

const stlBytes = V.exportBinarySTL(mesh, 'board_fixture');
const project = V.serializeGrid(grid);
const recovered = V.deserializeGrid(project);
```

The UMD engine exposes `window.VoxelSynth` in classic browser scripts. `window.VoxelSynthStudio.snapshot()`, `.inspect()` and `.importText()` provide a small workspace integration API.

## Practical limits

The editor supports up to 48 x 48 x 32 cells. The engine caps allocation at 2,000,000 cells and accepts pitch from 0.000001 to 1,000,000 mm. Surface extraction is capped at 250,000 triangles before mesh allocation. An overly complex edit or import preserves the current part and history. Part and sculpture recipes require at least four cells per axis. Sculpture presets carry their own default resolutions that can be overridden down to the editor limit; the plate PNG is a flat stylistic projection, not a shaded or perspective render. Imported project files are limited to 1 MB and the editor dimensions; their declared occupancy length, base64 representation and binary characters are checked exactly.

Voxel resolution controls dimensional accuracy. Curves are stepped surfaces, six-neighbor shells are a discrete morphology, and fixture recipes are design starting points rather than certified hardware fits. Measure a specific board and choose an appropriate pitch before fabrication. The material estimate is volume x infill x density; slicer walls, supports, toolpaths and print time are not simulated.

## Files

| File | Responsibility |
| --- | --- |
| [voxel.js](voxel.js) | Validated lattice, CSG, SDFs, algorithmic sculpture presets, surface extraction, topology, format writers/readers and project serialization |
| [app.js](app.js) | Renderer, DPI resizing, inspection, recoverable edits, keyboard navigation, sculpture mode and checked export delivery |
| [index.html](index.html), [style.css](style.css) | Local studio, responsive hierarchy, accessible controls, themes and the sculpture section |
| [test.js](test.js) | 117 engine tests |
| [export-test.js](export-test.js) | 39 format and precision tests |
| [ui-test.js](ui-test.js), [dom-harness.js](dom-harness.js) | 45 UI tests and the strict page contract |

MIT. See [LICENSE](LICENSE).
