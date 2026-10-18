# Original four-tier garage environment

All geometry, diagnostic graphics and concrete textures are original and procedurally authored in Blender. No external models, branded art, paid assets or image sources are used. Existing transport assets are not edited or bundled into these environments.

## Rebuild

From the project root:

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --render --preview-car

Omit `--preview-car` to render empty workshops. The preview-only roadster import happens **after** the GLB has been exported and is never saved in the editable garage source. Omit `--render` for production exports only.

## Four genuinely different architectural tiers

1. **Service Bay**: cared-for concrete workshop, exposed conduit, sectional door, complete tool wall and vise, compressor and coiled hose, tyre rack, rolling tool chest, clock, stool, broom and embedded floor wear.
2. **Precision Service**: modular workshop wall, twin-post service lift with arms retracted outside the car envelope, expanded drawer storage, diagnostic trolley and keyboard, fluid equipment and orderly circulation markings.
3. **Engineering Studio**: acoustic fin wall, integrated telemetry display, clean continuous low cabinetry, optical tracking heads, engineering sample displays, linear suspended light enclosure and flush calibration datums.
4. **Performance Hangar**: full-height equipment wings, broad sectional hangar door, service gantry, faceted overhead luminaires, paired diagnostic islands and flush luminous floor datums.

## Runtime contract

- Metres, exported glTF axes +Y up and -Z front.
- Named scene roots: `GARAGE_TIER_01` through `GARAGE_TIER_04`.
- Continuous floor top at y = -0.005 m. No elevated display platform.
- Clear display-car envelope x = ±2 m and z = ±3.6 m, above the floor.
- Front at z ≈ -9 m is open; the front-right camera has no foreground wall.
- Suggested camera (7, 3.5, -8), target (0, 0.9, 0), with restrained orbit.
- No cars, cameras or lights are exported. Emissive diffusers are geometry only. Runtime should use a coherent environment/key/fill setup, not dozens of point lights.
- GLB meshes are consolidated by material; editable .blend files preserve individually named components and manufacturing details.
- Original texture files live alongside GLBs; exports embed them. Blender sources pack images.
- Sources include preview-only lights and camera. Geometry can be edited directly or regenerated with the script.

Detailed counts, bounds and SHA-256 values are written to `tierN-report.json` on each successful build. Image previews contain the game's existing roadster purely as a scale and composition reference.

## Verified parked-owned-car envelopes

Approved display counts are **1 / 2 / 3 / 3**, including the central selected car. Runtime must insert real owned models; the GLBs deliberately contain no cars.

- Tier 2 extra bay: position **(-6.2, 0, -0.8)**, rotationY **0**.
- Tiers 3 and 4 extra bays: **(-6.2, 0, -0.8)** and **(6.2, 0, -0.8)**, rotationY **0** for both.
- Heading 0 faces -Z. Coordinates assume a centred model origin at floor contact.
- Maximum checked dimensions are **5.62 m long × 2.18 m wide × 2.6 m high**.
- Side-bay X envelopes: [-7.29,-5.11] and [5.11,7.29]; Z envelope: [-3.61,2.01].
- Independent triangle-level checks found no authored geometry intersecting these volumes above the flush floor. The test is reproducible with `python art/garage/audit_parking.py`.
- These are static display clearances, not a guarantee of door-swing space or drive-through turning paths. They can be shown through bounded orbit or a wider inspection view. No foreground parking or enlarged room is needed.

## Original rose wall painting

“Rose Velocity” is an original hand-authored coupe/flight/road composition in plum,
magenta, rose and blush. It contains no lettering, logo, stock image or external
character. Editable paths, deterministic texture generation and hashes live in
`mural/rose-velocity.svg`, `mural/create_mural.py` and `mural/manifest.json`.

    python art/garage/mural/create_mural.py
    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --mural-only

The mural-only route preserves accepted workshop geometry, original material
values, cameras and lights. One added non-collision decal mesh follows actual
wall faces, sectional door leaves and studio fins, 2 mm above their surfaces;
gaps and equipment naturally occlude the paint. All four rooms use the same
1024 × 512 transparent pigment texture with mipmapped filtering and one extra
material batch. There are no dynamic lights, canvases, render targets or per-frame
mural updates. The artwork is deliberately placed in the wall/door area visible
from the runtime overview rather than behind its right-hand customization panel.

`mural/architecture-preservation-audit.json` independently compares every original
mesh’s positions, normals, UVs, indices, transforms and original material values
against the accepted pre-mural GLBs. All original components are byte-equivalent
at the accessor level. Only the new paint batch is added: 16 / 16 / 40 / 28
triangles across tiers 1–4. The ordinary export, numeric-clean and parking audits
still apply unchanged. Existing `previews/tierN.png` are clearly marked as
pre-mural architectural references in provenance; use the current mural preview
and actual application captures when reviewing the new artwork.
