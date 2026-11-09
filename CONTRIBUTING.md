# Contributing to VoxelSynth

Thanks for your interest in VoxelSynth. This project is an offline integer
lattice constructive solid geometry (CSG) and signed distance field (SDF) CAD
workstation for 3D-printable enclosures, cable combs, and PCB fixtures, with
watertight STL, OBJ, and OpenSCAD export.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep the workstation offline. No network requests, no CDN assets, no
  analytics.
- Watertightness is the core contract. Every exported mesh must remain a
  closed 2-manifold: each directed edge must have exactly one opposite, and the
  Euler characteristic must hold. Never merge code that weakens that invariant.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification
- Optional: OpenSCAD or a slicer to confirm exports print

```sh
git clone https://github.com/draarivpatel-ui/voxelsynth.git
cd voxelsynth
node --test
```

To open the workstation locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `voxel.js` | The geometry core: lattice grid, SDF evaluation, CSG boolean ops, mesh generation, and exporters |
| `ui-test.js` | A headless DOM smoke test that drives the workspace through a stubbed document |
| `app.js` | UI wiring: viewport, controls, view modes, and export buttons |
| `index.html`, `style.css` | The workstation shell and its styling |
| `test.js` | The unit test suite for the geometry core |

Note that the Node test runner's default discovery also picks up `ui-test.js`
because it ends in `-test.js`. Keep that in mind when adding test files, and run
`node --test` to execute both the unit suite and the smoke test.

`voxel.js` is a UMD module, so `require('./voxel.js')` works in Node and
`window.VoxelSynth` is available in the browser. Match that pattern in new
modules.

## Coding standards

- Use 2-space indentation and single quotes, matching the surrounding file.
- Prefer `const`, and use `let` only when reassignment is required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason, the topological
  invariant you are preserving, or the non-obvious trade-off.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Keep the lattice integer throughout the geometry core. Do not introduce
  floating-point subdivision into the boolean pipeline.

## Adding a primitive, a boolean op, or an exporter

Any addition to the geometry core needs tests that assert the manifold
invariants, not just that a triangle count is non-zero. For a new exporter,
assert the header, the element structure, and that a known solid round trips.
For a regression you are fixing, add a test that fails before your fix and
pins the resulting topology.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests, including manifold checks for geometry work.
3. Run the full suite locally: `node --test`.
4. Update documentation where behaviour, file formats, or defaults changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI changes,
   - confirmation that exported meshes still pass the watertight checks.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the configuration
or script, the exporter you used, what you expected, and what happened instead.
Include the slicer and version when a mesh fails to print. Security issues
follow `SECURITY.md` instead.
