# Garage and cosmetic Blender source portability

The twelve new editable sources were saved through Blender 4.3.2, with no geometry generation, GLB export, or image rendering:

- `art/garage/tier1.blend` through `tier4.blend`
- `art/cosmetics/steering-round.blend` and `steering-yoke.blend`
- The six `.blend` sources in `art/garage-cosmetics`

## Changes

- Image paths and each packed-image filepath now use paths relative to their source `.blend` file. All three textures in each garage remain packed; their packed byte hashes are unchanged.
- Absolute default render output `/tmp/` is now `//renders/`.
- The saved file-browser home-directory default is now `//`.
- Source names, source-script references, provenance, and named parts are retained. No task-specific path strings remain in the twelve `.blend` binaries.
- Unused datablocks receive Blender's persistence/fake-user flag so saving cannot discard an unused palette or other editable source data. This retention-only flag is excluded from authored-material fingerprints; material values and node graphs remain identical.
- No backup `.blend1` files were generated. Existing earlier backups were not changed.

## Verification

`output/recovery/blend-portability-audit.json` records twelve successful before/after comparisons against the exact pre-sanitation source snapshot. Verification includes mesh coordinates, topology, UVs, polygon material assignments and smooth flags; object transforms, hierarchy, modifiers and constraints; material/node/socket values and links; armature data; packed image bytes; render settings; and source statistics. Every source was reopened in Blender and inspected through RNA and binary path scans. All 22 runtime GLB hashes were unchanged.

There are no armatures, animation actions, linked libraries, or text blocks in this source set. Heavy rerendering was deliberately not performed because artwork and render settings were unchanged.

## Reuse

Run from the repository root:

    blender -b --python-exit-code 1 --python scripts/sanitize_blend_sources.py

The default is restricted to these twelve source files. Explicit relative source paths and `--report` may also be supplied after Blender's `--` separator. The three asset generators now call `save_portable` from this helper at their original editable-source save boundary, before runtime batching/export. No runtime code is changed.
