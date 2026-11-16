# VoxelSynth

## Inspiration

A useful design tool should let someone understand what they are making and keep the result. A rendered enclosure alone cannot explain a missing wall, a closed mounting bore or a mesh that fails after export. VoxelSynth makes the cells, layers and topology visible in the same workspace as the part. It turns a small local browser page into a CAD studio with an inspectable engineering contract.

## What it does

VoxelSynth builds useful parts from an editable integer lattice: a partitioned organizer, hollow card vault, cable comb, four-post board fixture and blended SDF sensor dock. Each showcase button loads real geometry in one action. Box, sphere and cylinder booleans, symmetry and shell erosion let visitors make their own variation.

The viewport provides orbit, top/front/isometric views, wireframe and clipping above a chosen Z layer. Its XY inset is an editor, with live cell and millimeter coordinate readouts. A direct X/Y/Z inspector and keyboard controls provide the same edits without a mouse. Undo and redo retain 32 geometry revisions. Project save/open restores exact occupancy and pitch.

The studio verifies counted edge incidences, triangle winding and connected vertex link cycles. It reports surface components, Euler characteristic, total genus, surface area and enclosed volume. A part with an empty lattice or singular point or edge contact receives an explicit diagnostic and keeps editable project save available.

Before delivery, each manufacturing download is reparsed. A separate full check compares every mesh vertex, topology, facet count, area and volume for ASCII STL, binary STL and OBJ, reconstructs all OpenSCAD cells, and round trips the project snapshot. Everything runs locally with zero runtime dependencies, build steps, accounts or uploads.

## How we built it

The geometry engine is a small UMD JavaScript module that works in Node and classic browser scripts. Occupancy lives in a flat `Uint8Array`. Primitives sample physical cell centers using explicit inclusive and exclusive boundaries. Analytic signed distance fields compose with min/max booleans and polynomial blending; failed field samples cannot partially mutate the lattice.

Six exposed-face masks cull internal faces and merge coplanar rectangles. Triangles are emitted on a shared integer lattice, preserving common boundary segments across adjacent faces. The topology checker counts every incidence rather than storing only edge presence. It also checks each vertex's local link graph and counts closed surface components before estimating genus.

Surface area comes from cross products. Enclosed volume uses the divergence theorem with a nearby reference and compensated summation. The result is checked against occupied cells times pitch cubed. Binary STL is written directly through a little endian `DataView`; OBJ uses indexed positions and unit face normals. OpenSCAD merges repeated rectangles across Z layers into disjoint cuboids.

The UI uses the Canvas 2D API, DOM controls and local CSS. The canvas draws in CSS pixels and allocates a backing store for the current device pixel ratio. Pointer picking uses the same logical coordinates. The responsive layout brings the model first on narrow screens; details keep advanced lattice, shell and material controls available without filling the workspace.

## Challenges

A surface can have every directed edge's opposite present and still fail to be a manifold. Edge contacts may have four incidences, while two solids touching at a corner can have valid edge pairs but a disconnected vertex link. The original Set-based check missed these cases. Counted incidences and link cycles now distinguish them explicitly.

A single-surface genus formula gave incorrect negative estimates for separate components and closed cavities. Component-aware Euler analysis fixes that. Center-boundary rounding also needed different rules for half-open boxes and closed radial surfaces.

File export required more than a plausible header. Six-decimal text could erase fine detail; binary float32 can collapse tiny facets after large translations; loose OpenSCAD parsing could accept unbalanced structure. Text exports now retain full double precision, binary export detects collapsed facets, and independent format readers validate structure and geometry.

Finite sphere and cylinder distances use scaled vector lengths rather than overflowing squared comparisons. Complex surfaces are rejected before allocation, and edits are committed only after their mesh is prepared.

UI correctness mattered just as much. A cut layer originally hid its top faces against voxels that were already clipped, the top view exceeded the pitch slider range, and preset changes left the layer thumb stale. DPI-aware drawing, coordinated layer state and strict DOM tests now cover these regressions. Invalid edits, failed imports and clipboard denial produce useful status without corrupting the current part.

## Accomplishments

- Five complete one-click parts, including a distance-field blend that is editable and exportable on the same lattice.
- A stronger manifold certificate with counted oriented edges, vertex link cycles and component-aware genus.
- Four independently reparsed manufacturing formats and exact editable project recovery.
- 32 revisions of geometry recovery, accessible cell editing, live coordinate inspection and high DPI picking.
- 173 passing automated tests, including all 256 local 2 x 2 x 2 occupancy configurations and malformed export/input cases.
- A local browser application that needs no server computation or dependency installation.

## Verification numbers

Measured from the final implementation on 2026-11-15. The automated run used Node v24.16.0.

| Check | Verified result |
| --- | --- |
| Engine suite | 103 passed, 0 failed |
| Export and precision suite | 35 passed, 0 failed |
| Strict DOM/UI suite | 35 passed, 0 failed |
| Full suite | 173 passed, 0 failed, 0 skipped |
| Local occupancy configurations | 256 masks preserve volume and exposed-face triangle counts |
| Showcase export paths | 5 presets x 4 manufacturing formats, plus project occupancy, pass round trips |
| Fractional-pitch recipe checks | All 5 presets also pass at 20 x 14 x 9 cells and 0.3 mm pitch |
| Export precision range tested | 0.000001 to 1,000,000 mm pitch, including 1/3 mm |
| Snapshot capacity regression | 2,000,000 cells round trip canonically |
| DOM runtime checks | Zero recorded console or reference errors |

Default organizer geometry has 4,128 occupied cells, 8,528 triangles and 33,024 mm3 enclosed volume. Its binary STL has 426,484 bytes and its OpenSCAD body uses nine disjoint cuboids. The board fixture retains all four raised posts and open bores, has total genus 4, and encloses 4,752 mm3. All default preset mesh round trips have zero measured relative volume difference at the stored precision.

Reproduce the full suite:

```sh
node --test test.js export-test.js ui-test.js
```

These verification numbers describe automated engine, file and DOM checks. No external slicer run, printer trial or hardware fit certification is claimed. Curves remain stepped at the selected voxel pitch, and the material estimate excludes slicer walls, supports and toolpaths.

## What's next

Add pitch-aware fixture dimensions and dimension constraints, SDF parameters in the workspace, conservative mesh simplification with the same topology checks, and measured export interoperability fixtures from external CAD tools. The current validation readers and recoverable edit pipeline provide concrete foundations for those additions.
