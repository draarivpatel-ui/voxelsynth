# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting under this repository's Security tab. Include the affected file and function, a small reproduction, the expected behavior and the impact. Do not publish private project contents in a report.

## Scope

VoxelSynth is a local browser CAD application with no server, authentication or runtime dependencies. Relevant reports include DOM injection through project or export fields, unexpectedly large allocations, malformed snapshot validation, nonfinite geometry and unexpected execution of imported text.

Project imports are JSON snapshots with validated dimensions, pitch, exact occupancy length and canonical base64. The browser editor limits dimensions to 48 x 48 x 32 cells and files to 1 MB. The engine caps lattice allocation at 2,000,000 cells. Export validation reads numeric records and never executes imported OpenSCAD text.

## Supported version

Only the current `main` version receives fixes. Good-faith reports will be reviewed through the repository's private reporting channel.
