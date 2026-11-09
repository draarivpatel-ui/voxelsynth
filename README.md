# VoxelSynth

VoxelSynth is an offline integer-lattice constructive solid geometry (CSG) and signed distance field (SDF) CAD workstation built for 3D printable enclosures, cable combs, and PCB mounting fixtures. It constructs watertight manifold triangle meshes on a shared discrete lattice, verifies directed half-edge pairing and Euler characteristic in real time, and exports ASCII STL, Binary STL, Wavefront OBJ, and greedy cuboid-merged OpenSCAD scripts.

All computation runs locally in plain HTML, CSS, and JavaScript with zero runtime dependencies, zero build steps, and zero network requests.

Live workstation: https://aariv.me/voxelsynth/

## Repository Structure

| File | Responsibility |
| --- | --- |
| `voxel.js` | UMD geometry engine: integer lattice, CSG boolean ops, SDF evaluators, 6-direction greedy quad mesher, half-edge verifier, and exporters |
| `index.html` | Three-column engineering CAD & slicer workstation markup |
| `style.css` | Architectural warm-gray vellum sheet and dark charcoal CAD theme plus print stylesheet |
| `app.js` | Orthographic isometric canvas renderer, build-plate cage, 2D Z-slice cross-section inspector HUD, picking, and export handlers |
| `test.js` | 64 `node:test` assertions covering CSG, SDFs, greedy meshing, topology invariants, and file exporters |
| `ui-test.js` | Headless DOM smoke test verifying every control, keybind, preset, and export action |
| `LICENSE` | MIT License |

## Running Locally

Open `index.html` directly from disk or serve the directory over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Run the automated test suite and headless UI smoke check with Node.js:

```sh
node --test test.js
# tests 64 | pass 64 | fail 0

node ui-test.js
# UI smoke test passed.
```

## Programmatic Usage (Node.js & Browser)

```js
const V = require('./voxel.js');
const fs = require('node:fs');

const grid = V.deskOrganizerPreset({
  pitchMm: 2, nx: 32, ny: 22, nz: 12, wallMm: 4, compartments: 3
});

const mesh = V.extractManifoldMesh(grid, { infillPercent: 20 });
console.log(mesh.stats.watertight);      // true (0 unmatched directed half-edges)
console.log(mesh.stats.volumeCm3);       // enclosed volume via divergence theorem (cm3)
console.log(mesh.stats.plaMassG);        // estimated PLA filament mass (g)

fs.writeFileSync('organizer.stl', V.exportAsciiSTL(mesh, 'organizer'));
fs.writeFileSync('organizer.obj', V.exportOBJ(mesh, 'organizer'));
fs.writeFileSync('organizer.scad', V.exportOpenSCAD(grid));
```

## Geometric & Topological Architecture

### 1. Flat Uint8Array Lattice & 6-Neighbour Shell Erosion

A lattice of `nx * ny * nz` cells with voxel pitch `pitchMm` is stored in a flat `Uint8Array` indexed by `x + nx * (y + ny * z)`. Boolean operations (`addBox`, `subtractBox`, `addCylinder`, `subtractCylinder`, `addSphere`, `subtractSphere`, `mirrorGrid`, `unionGrid`, `subtractGrid`) evaluate cell centers at `((x + 0.5) * pitchMm, (y + 0.5) * pitchMm, (z + 0.5) * pitchMm)`. `shellGrid(grid, wallMm)` performs `round(wallMm / pitchMm)` passes of 6-neighbour morphological erosion on the solid set and subtracts the surviving interior core from the original solid, leaving a closed shell of uniform wall thickness.

### 2. Analytic Signed Distance Fields (SDF)

For smooth fillets and blended booleans, `sdfBox`, `sdfSphere`, and `sdfCylinder` evaluate exact signed distances in millimetres. Combinators `sdfUnion`, `sdfSubtract`, `sdfIntersect`, and polynomial `sdfSmoothUnion(a, b, k)` compose arbitrary implicit surfaces that `rasterizeSDF(grid, fn, op)` samples across the lattice.

### 3. Greedy Coplanar Quad Meshing Without T-Junctions

For each of the six principal axis directions (`+X, -X, +Y, -Y, +Z, -Z`), `buildQuads(grid)` extracts a 2D binary mask of solid voxels whose face neighbour in that direction is empty air. Internal faces between adjacent solid voxels are culled immediately. A greedy 2D sweep expands each exposed face into a maximal coplanar rectangle `[u0..u1, v0..v1]`, reducing flat walls to a handful of quads.

In a naive greedy mesher, triangulating each merged rectangle directly with two long triangles creates T-junctions wherever a long quad edge borders smaller neighbouring quads. Slicers such as PrusaSlicer and Cura flag T-junctions as non-manifold open edges. VoxelSynth resolves this by recording the greedy quad count and then emitting triangles on the shared integer vertex lattice so every unit boundary segment shares identical vertex indices with its neighbour across corners and steps. A defensive signed-volume pass checks the divergence-theorem volume over all triangles and flips winding if negative.

### 4. Half-Edge Manifold Verification & Euler Characteristic

`extractManifoldMesh` verifies that every directed triangle edge `u -> v` has an exact opposite partner `v -> u` in the mesh. The diagnostics table reports:

- **Unmatched directed edges:** must equal `0` for `watertight = true`.
- **Surface area (`mm2`) & Enclosed volume (`cm3`):** computed directly from triangle cross products and the divergence theorem `sum(a . (b x c)) / 6`, matching `voxelCount * pitchMm^3`.
- **Euler characteristic (`chi = V - E + F`) & Genus estimate (`g = (2 - chi) / 2`):** calculated from unique vertices `V`, undirected edges `E`, and triangle count `F`.
- **PLA (`1.24 g/cm3`) and PETG (`1.27 g/cm3`) filament mass:** scaled by enclosed volume and infill percentage.

### 5. Exporters & OpenSCAD Cuboid Compression

- `exportAsciiSTL(mesh, name)` and `exportBinarySTL(mesh, name)` (80-byte header + uint32 facet count + 50-byte little-endian records).
- `exportOBJ(mesh, name)` with indexed `v`, `vn`, and `f v//vn` records.
- `exportOpenSCAD(grid, pitchMm)` merges each Z slice into maximal 2D rectangles and extrudes identical rectangles across consecutive Z layers into compact `translate(...) cube(...)` primitives inside a `union()`. For the default Desk Organizer preset, 4,128 solid voxels compress into 9 `cube()` statements.

## License

MIT. See [LICENSE](LICENSE).
