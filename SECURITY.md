# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/voxelsynth/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static VoxelSynth browser CAD application, including project imports, occupancy snapshots, geometry exports, manufacturing audit briefs, share links, local persistence and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through project data, export fields, share links, imported text, audit output or interface labels.
- A project snapshot, geometry reader or share-link decoder flaw that bypasses validation, corrupts another project or executes attacker-controlled code.
- A JSON, CSV, Markdown or geometry export flaw that makes generated output execute a formula or script when opened.
- A prototype-pollution, object-key or canonical-encoding flaw that bypasses project validation or audit verification.
- A denial-of-service path in lattice allocation, mesh generation, export parsing, manufacturing analysis or audit verification caused by input the application accepts.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Documented approximation or modeling limits, unless a report shows a specific validation, integrity or output-safety failure.
- Denial of service through input the application already rejects, or through resource use outside the documented browser and file-size limits.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
