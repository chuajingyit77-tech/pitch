# Learned: SimReady Central (NVIDIA, October 2026)

Source: [Announcing SimReady Central](https://huggingface.co/blog/nvidia/simready-central-assets-robotics-ai-factories),
Hugging Face community article by John Kosnik, Frank DeLise and Pomi Lee (NVIDIA), published 21 October 2026.
Read alongside the two repos it points at: [NVIDIA/simready-foundation](https://github.com/NVIDIA/simready-foundation)
and [NVIDIA-Omniverse/simready-central](https://github.com/NVIDIA-Omniverse/simready-central).

## What it is, in one paragraph

A 3D model is not enough to run a simulation. A robot or a digital twin also needs the object's
mass, collision shape, friction, joints and limits, semantic labels, materials, and for data-centre
equipment its electrical and thermal data. A **SimReady** asset is an OpenUSD model that ships with
those properties. **SimReady Central** is a free, ungated library of more than 2,000 such assets on
Hugging Face, searchable in natural language, where equipment makers (OEMs) publish validated models
of their own products so developers and AI agents can assemble robot workcells and "AI factory"
(data-centre) digital twins from them.

## The pieces

| Piece | What it does | Where |
| --- | --- | --- |
| SimReady Foundation | The spec: **features** (atomic requirements, e.g. `FET_003` rigid-body physics, `FET_006` materials, `FET_033` provenance metadata and thumbnail), grouped into versioned **profiles** (e.g. `Robotics-Prop`, `Robot-Body`, `AIF-Entity`, `Package-Candidate`). Plus validators, packaging tools and agent skills to add or update profiles. Apache 2.0. | github.com/NVIDIA/simready-foundation, docs at nvidia.github.io/simready-foundation |
| SimReady Central (repo) | The review entry point. OEMs keep packages in their own public Hugging Face datasets; a submission is a text file of immutable URLs (one per package, pinned to a 40-character commit). CI validates every acceptance criterion by id (`SUB.001`...), NVIDIA reviews, merge publishes. | github.com/NVIDIA-Omniverse/simready-central |
| SimReady Central (library) | The Hugging Face Space that indexes all participating datasets and offers semantic search over USD properties and simulation metadata, with RTX previews. | huggingface.co/spaces/nvidia/simready-central, API at nvidia-simready-central.hf.space |
| USD Search | NVIDIA's natural-language search over USD assets, powering the library and also integrated into Hugging Face platform search. | github.com/NVIDIA-Omniverse/usd-search |
| Agent skills | `submit-simready-assets` (validate, package, upload, open the PR), `index-to-library` (pull a submission into a local JSON library and HTML browser), `omniverse-cad-to-simready` (turn CAD into SimReady assets). | in the repos above and github.com/NVIDIA/skills |

## What makes an asset SimReady (the contract)

- **Layout**: `<asset-name>/<intermediate>/<asset>.usd`, with `materials/`, `textures/` and a
  256x256 PNG thumbnail at `.thumbs/256x256/<file>.usd.png`. Folder name equals the logical asset
  name, no version in it.
- **Profile**: the submitter picks one (what the asset is for) and validation records per-feature
  pass/fail in a sidecar; the USD itself is never modified.
- **Provenance metadata** (`FET_033`, requirement `SR.004`): who made it, what it is, licence, and
  measured values such as extents and mass, in the root USD or a sidecar.
- **Packaging** (hard requirement): references relative and inside the folder, a valid
  `com.nvidia.simready.packaging.json`, a bill of materials with a SHA-256 per file, and
  conformance results in `.metadata/`.
- **Identity**: package name `simready.hf.<namespace>.<dataset>.<asset>`, plus a date version
  `YYYY.MM.DD`. A version once accepted is immutable; a change means a new version.
- **Licence**: the package licence must equal the Hugging Face dataset licence; the dataset must be
  public and ungated.

## How it is used

1. **Robot pick-and-place**: prompt an agent to find a FANUC arm, a Robotiq gripper and warehouse
   props via the search API, reference them into a USD stage, generate Isaac Sim Python to assemble
   the workcell and the task, render a preview, and record asset and runtime versions for
   reproducibility.
2. **AI factory layouts**: the same flow for racks, CDUs, CRAHs and UPS units, producing two
   alternative layouts as USD scenes with scripts that check overlaps and aisle clearance.
3. **Extending**: keep layout and task changes in separate USD layers; vary placements for
   training; connect robotics scenes to Isaac Lab and factory scenes to power and cooling analyses;
   feed live BMS and IT telemetry so the twin stays synchronised with the real facility.

Named partners: Vertiv (data-centre equipment), Comau, FANUC, Franka, Robotiq, Standard Bots,
Universal Robots (robots and grippers), Palatial (NVIDIA Robotics 1K dataset), LG Electronics
(home appliances for household robots), ForgeCAD (articulated props). Hugging Face's Microduck
robot is cited as an environment consumer.

## Why it matters beyond robotics: the pattern

SimReady Central is a clean example of how to make a domain "agent-ready":

1. **A spec with atomic features and versioned profiles**, so "ready" is checkable, not a vibe.
2. **Validation that writes a sidecar and never edits the source.**
3. **Immutable, content-addressed packages** (commit hash plus per-file SHA-256) so a result can be
   reproduced later.
4. **Acceptance criteria with ids**, so a rejection is a pointer, not an argument.
5. **Distributed storage, central index**: owners keep their data in their own datasets; the hub
   only catalogues pinned versions.
6. **Agent skills as the front door**: the official way to submit or browse is to hand an agent a
   SKILL.md URL.
7. **Natural-language search over structured metadata**, used by humans and agents alike.

This maps directly onto the Pitch Engine plan in `docs/pitch-engine-plan.md`:

| SimReady Central | Pitch Engine |
| --- | --- |
| Profile a scene needs | Evidence profile a verdict needs (what must be sourced, measured, and from whom) |
| Validation sidecar, source untouched | Evidence ledger: claim, source URL, fetch date, confidence; raw sources kept |
| Immutable package versions | Versioned runs in Supabase; a pivot is a new version, never an overwrite |
| Acceptance criteria by id | Kill criteria by id, each pass / fail / untested in the scorecard |
| Skills as the entry point | `/pe-run` and the twelve agent skills |
| Semantic search over assets | Search over past runs, evidence and panel answers |

## Possible business angles (to check against what you actually pitch)

- **OEM onboarding service**: manufacturers in the region (racks, cooling, power, automation
  equipment) need their CAD turned into SimReady assets and submitted. The tooling is free and
  agent-driven; the work is knowing the spec and the client's CAD.
- **Digital-twin pitch pages**: a pitch for a factory, data centre or warehouse project can embed
  an interactive USD or glTF scene built from SimReady assets, rendered in the browser.
- **Robotics and physical-AI startups** as Pitch Engine customers: their "Competitors" step can
  pull from SimReady Central to see which OEMs already publish and who is missing.

## Open questions

- Whether any of your pitch clients are in manufacturing, data centres, logistics or robotics.
- Whether you want a browser-side USD or glTF viewer in the pitch toolkit, which would make these
  assets usable in a pitch page without Omniverse.
