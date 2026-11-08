# VoxelSynth

A parametric voxel and signed distance field CSG CAD studio for rapid 3D printable enclosures, desktop organizers, and mechanical fixtures. VoxelSynth builds watertight manifold surfaces on an integer lattice and exports ASCII STL, Binary STL, Wavefront OBJ, and OpenSCAD source.

Everything runs locally. There are no runtime dependencies, no build step, no network calls, and no telemetry. Open `index.html` from disk, host the folder on any static server, or use the GitHub Pages deployment.

Live workspace: https://draarivpatel-ui.github.io/voxelsynth/

## Contents

| File | Purpose |
| --- | --- |
| `voxel.js` | UMD core engine. Grid, CSG, SDF helpers, mesher, diagnostics, exporters, presets. |
| `index.html` | Engineering workspace markup. |
| `style.css` | Responsive light and dark theme plus print stylesheet. |
| `app.js` | Canvas projection, interaction, diagnostics table, download and copy actions. |
| `test.js` | 64 `node:test` assertions covering geometry, topology, exporters, and presets. |
| `ui-test.js` | Headless DOM smoke test for the browser workspace. |
| `LICENSE` | MIT license. |

## Quick start

Browser:

```sh
open index.html
```

Or serve the directory locally:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

Node.js:

```js
const V = require('./voxel.js');

const grid = V.deskOrganizerPreset({
  pitchMm: 2, nx: 32, ny: 22, nz: 12, wallMm: 4, compartments: 3
});

const mesh = V.extractManifoldMesh(grid, { infillPercent: 20 });
console.log(mesh.stats.watertight);        // true
console.log(mesh.stats.volumeCm3);         // enclosed volume in cubic centimetres
console.log(mesh.stats.plaMassG);          // PLA estimate in grams

const fs = require('node:fs');
fs.writeFileSync('organizer.stl', V.exportAsciiSTL(mesh, 'organizer'));
fs.writeFileSync('organizer.obj', V.exportOBJ(mesh, 'organizer'));
fs.writeFileSync('organizer.scad', V.exportOpenSCAD(grid));
```

Browser global:

```html
<script src="voxel.js"></script>
<script>
  const g = window.VoxelSynth.rpiPicoMountPreset();
</script>
```

The UMD wrapper also supports AMD loaders.

Run the test suite:

```sh
node --test test.js
```

## Using the workspace

1. Pick a preset from the loader, or rebuild an empty grid with your own X, Y, Z counts and pitch in millimetres.
2. Select an operation (add or subtract) and a primitive (box, cylinder, or sphere). Parameters are entered in voxel cells for center and footprint, and in millimetres for height or radius, then applied at the current pitch.
3. Drag on the canvas to rotate yaw and pitch. Scroll to zoom. Use the sliders for exact angles and for the Z layer scrubber.
4. Click a visible voxel to remove it, or click an empty cell on the highlighted slice plane to add one. The slice overlay shows the active layer. Toggle "Slice only" to hide every layer above the scrubber and inspect the interior.
5. Mirror or hollow the model with the transform buttons. Adjust infill and material to see live filament mass estimates.
6. Download or copy ASCII STL, Binary STL, OBJ, OpenSCAD, or the serialized grid JSON.

Keyboard shortcuts: `1` to `4` load presets, `B`/`C`/`S` pick primitives, `A`/`D` pick operations, `M` mirrors X, `H` hollows, arrow keys rotate, `PageUp` and `PageDown` change the slice, `T` toggles theme, `R` resets, and `?` opens the shortcut panel.

The print stylesheet hides the controls and prints the viewport together with the diagnostics table as an engineering report.

## Geometry model

### Integer lattice

A grid of `nx * ny * nz` cells is stored in a flat `Uint8Array` with `x` as the fastest changing index:

```
index = x + nx * (y + ny * z)
```

Each cell is a cube of side `pitchMm`. CSG primitives rasterize against cell centers at `(x + 0.5) * pitchMm`, so a box from `a` to `b` millimetres covers cell indices `round(a / pitchMm)` through `round(b / pitchMm) - 1`. Coordinates outside the grid are treated as air, which means a filled block touching the boundary is still a closed solid.

`addBox`, `subtractBox`, `addCylinder`, `subtractCylinder`, `addSphere`, `subtractSphere`, `mirrorGrid`, `shellGrid`, `unionGrid`, and `subtractGrid` all mutate and return the grid. `shellGrid` performs `round(wallThickness / pitchMm)` passes of six neighbour erosion on the solid set, then subtracts the surviving core from the original. That leaves a closed wall of the requested thickness.

### Signed distance fields

For workflows that start from analytic geometry, `sdfBox`, `sdfSphere`, and `sdfCylinder` return the signed distance from a point. `sdfUnion` is `min(a, b)`, `sdfSubtract` is `max(a, -b)`, `sdfIntersect` is `max(a, b)`, and `sdfSmoothUnion` blends with a polynomial smoothing kernel of radius `k`. `rasterizeSDF(grid, fn, operation)` samples the field at every cell center and sets or clears cells where the distance is nonpositive.

Example of a rounded subtraction:

```js
const g = V.createGrid(30, 30, 16, 1);
V.rasterizeSDF(g, (x, y, z) =>
  V.sdfSubtract(
    V.sdfBox(x, y, z, [2, 2, 2], [26, 26, 12]),
    V.sdfSphere(x, y, z, 15, 15, 14, 9)
  )
);
```

### Greedy face culling

For each of the six axis directions, the mesher builds a 2D mask of solid cells whose neighbour in that direction is air. Internal faces never enter the mask. A greedy sweep grows each mask region into a maximal rectangle, first along `u` and then along `v`, and emits one quad per rectangle. This is the standard face culling plus greedy merging pass used by voxel renderers.

Each quad is then overlaid on a shared integer lattice. For every unit face cell it covers, the mesher emits two triangles whose vertices are lattice coordinates. Because all adjacent quads use the same lattice, shared boundaries are described by identical vertex pairs. This avoids T junctions that would otherwise appear where a long quad edge meets several short ones. A convex polygon fan on a merged quad would be faster to draw, but it cannot guarantee edge pairing, so watertightness takes priority over triangle count.

Triangles are wound so the cross product of two edges agrees with the outward axis normal. A defensive pass computes the signed volume of the whole triangle set, and if it is negative the winding and normals are flipped.

### Diagnostics

For triangles with vertices `a`, `b`, `c`:

```
area    = 0.5 * |(b - a) x (c - a)|
volume  = sum( a . (b x c) / 6 )
```

The divergence theorem turns the second sum into the enclosed volume in cubic millimetres. It matches `voxelCount * pitchMm^3` for every closed grid and is reported in cubic centimetres.

Surface area is the sum of triangle areas. The bounding box is taken over all mesh vertices in millimetres. Filament mass is `volumeCm3 * (infill / 100) * density`, with PLA at `1.24 g/cm3` and PETG at `1.27 g/cm3`. A custom density can be passed to `estimateMass`.

The topology check builds the set of directed triangle edges. A closed orientable manifold requires every `(u, v)` to have an opposite `(v, u)` with no extras. The Euler characteristic is `V - E + F`, computed from unique vertices, unique undirected edges, and triangle count. For a connected closed orientable surface, the genus is `(2 - chi) / 2`, so a sphere gives `chi = 2` and genus `0`, while one through hole gives `chi = 0` and genus `1`. Disconnected components shift `chi`, so the genus value is reported as an estimate.

The naive triangle baseline is twelve triangles per solid voxel with no culling. `mergeRatio` compares that baseline with the emitted triangle count.

### Exporters

`exportAsciiSTL(mesh, name)` writes a named solid with one `facet normal` and three `vertex` records per triangle. `exportBinarySTL(mesh, name)` writes the 80 byte header, little endian facet count, and fifty bytes per facet. `exportOBJ(mesh, name)` emits indexed vertices, per face normals, and `f v//vn` faces. `exportOpenSCAD(grid, pitchMm)` greedily merges each Z layer into rectangles, then extrudes runs of identical rectangles into `cube()` calls inside a `union()`. It produces the same solid cell set with far fewer boxes than one cube per voxel.

Names are sanitized to alphanumerics, dots, underscores, and hyphens so exported files are safe to use as identifiers.

## API reference

Grid: `createGrid`, `cloneGrid`, `getVoxel`, `setVoxel`, `inBounds`, `countVoxels`, `countExposedFaces`, `naiveTriangleCount`, `serializeGrid`, `deserializeGrid`.

CSG: `addBox`, `subtractBox`, `addCylinder`, `subtractCylinder`, `addSphere`, `subtractSphere`, `mirrorGrid`, `shellGrid`, `unionGrid`, `subtractGrid`.

SDF: `sdfBox`, `sdfSphere`, `sdfCylinder`, `sdfUnion`, `sdfSubtract`, `sdfIntersect`, `sdfSmoothUnion`, `rasterizeSDF`.

Mesh: `extractManifoldMesh(grid, { infillPercent })`, `estimateMass(mesh, { material, infillPercent, density })`, `buildQuads(grid)`.

Exports: `exportAsciiSTL`, `exportBinarySTL`, `exportOBJ`, `exportOpenSCAD`.

Presets: `deskOrganizerPreset`, `sdCardVaultPreset`, `cableCombPreset`, `rpiPicoMountPreset`, `listPresets`, `loadPreset`.

`extractManifoldMesh` returns `{ vertices, triangles, normals, vertexKeys, pitchMm, gridSize, infillPercent, stats }`. Vertices are `[x, y, z]` in millimetres. Triangles are triples of vertex indices. Normals are outward unit vectors. The `stats` object contains all values shown in the diagnostics table.

## Built in presets

| Preset | Description |
| --- | --- |
| `deskOrganizerPreset` | Partitioned tray with three pencil bores. Configurable compartment count and wall thickness. |
| `sdCardVaultPreset` | Hollow walled case with a top slot, a rear stop, and a central screw clearance hole. |
| `cableCombPreset` | Six rounded channels cut into a bar with two mounting holes. |
| `rpiPicoMountPreset` | Rail plate with four raised standoffs and through holes for a Raspberry Pi Pico board. |

All presets accept `{ pitchMm, nx, ny, nz, wallMm }` overrides.

## Testing

`test.js` uses the built in `node:test` runner and covers grid construction and validation, all CSG primitives on every axis, mirroring, shell erosion, face culling counts, greedy quad merging, exact volume checks, outward normals, surface area, bounding boxes, Euler characteristics, drilled hole genus, directed edge pairing for every preset, PLA and PETG mass estimates, infill clamping, ASCII and Binary STL structure, OBJ index validity, OpenSCAD box coverage, grid serialization, SDF combinators, and preset parameters.

```sh
node --test test.js
# tests 64
# pass 64
# fail 0

node ui-test.js
# UI smoke test passed.
```

`ui-test.js` runs `voxel.js` and `app.js` inside a minimal headless DOM, then exercises every bound control, all keyboard shortcuts, preset loading, diagnostics rendering, and the export and copy actions.

## Design notes

The project is deliberately plain HTML, CSS, and JavaScript. The viewport is a 2D canvas with an orthographic projection:

```
X_screen = x * cos(yaw) + y * sin(yaw)
Y_world  = -x * sin(yaw) + y * cos(yaw)
Y_screen = -(Y_world * sin(pitch) + z * cos(pitch))
depth    = -Y_world * cos(pitch) + z * sin(pitch)
```

Visible faces are selected by the sign of the dot product between their outward normal and the camera vector, then painted back to front. Picking reuses the same projected polygons, so clicking maps directly back to the voxel that produced the polygon. Clicking the slice plane maps the screen point back to the world XY plane at the active Z height.

Theme, clipboard, and local storage fallbacks are all optional. If a browser blocks any of them, the geometry engine and downloads still work.

## License

MIT. See `LICENSE`.
