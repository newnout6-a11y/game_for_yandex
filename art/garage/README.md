# Original four-tier garage environment

Room geometry, diagnostic graphics, mural and concrete surfaces are original and authored in Blender. The TV poster and separate video are a declared exception: third-party Tesla footage supplied by the user, with redistribution license unverified and no affiliation or endorsement claimed. Existing project transport assets are not edited or bundled as geometry into these rooms.

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
- A continuous four-wall shell and a real panelled ceiling enclose the showroom. The front now has an inward-facing sectional entrance, a separate personnel door, electrical cabinets and service runs.
- The authored interior is x = [-9.88, 9.88], y = [0.02, 6.45], z = [-8.97, 7.57] m. Camera clearance is 0.25 m, including near-plane width.
- Scene and root `garageCamera` metadata include actual per-part obstacle AABBs, including beams, suspended fixtures and peripheral equipment. The 6 m preferred orbit radius is not a collision guarantee; constrain against the room and obstacles, then widen FOV if needed. Never move through or hide the wall to fit the car.
- Runtime key lights must be inside the completed ceiling, rather than above it (for example y = 5.7 m).
- No cars, cameras or lights are exported. Emissive diffusers are geometry only. Runtime should use a coherent environment/key/fill setup, not dozens of point lights.
- GLB meshes are consolidated by material; editable .blend files preserve individually named components and manufacturing details.
- Original room texture files and the declared user-provided TV poster live alongside GLBs; exports embed them. Blender sources pack images. The full muted video is separate.
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
triangles across tiers 1–4. The historical mural-only and numeric-cleanup audits identify the accepted
intermediate exports; current interior-completion signatures and costs are recorded
in `interior-completion-audit.json`. The ordinary export and parking audits are
rerun against the completed rooms. Existing `previews/tierN.png` are clearly marked as
pre-mural architectural references in provenance; use the current mural preview
and actual application captures when reviewing the new artwork.

## Reverse-side interior completion (historical shell stage)

The completion preserves every accepted rear object, its mesh topology, transform,
UVs and material assignment, including the rose mural. The upgrade checks an exact
SHA-256 signature of those source properties before and after adding the new work.
Only parts tagged `garage_interior_completion` are replaced on a repeat upgrade:

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --interior-only
    blender -b --python scripts/create_garage.py -- --tiers 1 --resume --interior-only --render-reverse --preview-car

All four tiers now have front walls, complete side returns, ceiling panels and
seams, inward-facing entrance and personnel doors, shallow electrical cabinets,
ventilation housings, protected cable trays, conduit and additional ceiling fixtures.
Tier 1 keeps the utilitarian concrete/petrol palette; tier 2 uses ceramic service
panels and inspection windows; tier 3 adds warm acoustic details and wall-wash
lighting; tier 4 uses machined piers, an overhead crown and integrated light strips.
No original equipment, text, branding, car asset or mural texture is moved or replaced.

The additions stay outside the selected car and parked-vehicle envelopes, except
for architecture above the 2.6 m vehicle-clear height. `interior-completion-audit.json`
records export cost changes. `tests/garage-interior-completion.test.mjs` independently
checks editable parts, camera metadata and rays covering every azimuth plus the ceiling.
The finite-geometry, normals, full triangle-clearance and portable-source tests remain in force. The historical 5 MB room budget applied before the functional reverse workshop described below.

## Current arrival zone and physically scaled finishes

The user-approved scope now replaces both the wall and floor finish and fills the
previously empty reverse-side view. The accepted rear set, pink mural, every
pre-existing editable mesh/UV/material assignment, cars, UI and runtime lighting
remain unchanged. The full interior and every camera azimuth stay available.

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --reverse-workshop-only

The negative-X/front quadrant visible behind the selected car is a distinct
arrival and utilities zone: a large physical wall television, an overhead intake plenum with real louver blades, connected
extraction trunk/riser, and one slim charging pedestal with tethered connector,
status interface and protection hoop. The free wall by the gate has its drive,
output shaft, manual chain and isolation switch. Flush lane dashes and threshold
drain grating relate the equipment to the entrance. There is no second repair
bench, toolboard or duplicated storage cupboard. The retained rear repair
workshop stays intact. Higher tiers add dual charge connectors, replaceable air
filters, clean-air distribution, a charger canopy and regulated service outlets.
Protective lower wall panels, cast joints and flush floor seams give scale.
New equipment stays at |X| > 8.65 m or Z < -7.95 m; millimetre floor seams are
not elevated obstructions. The independent saved-source audit compares all old
mesh transforms/topology/UVs/material assignments and every new part’s vertices.

`scripts/garage_surface_finish.py` authors six original 512 × 512 PBR maps:
base colour, normal and roughness for matte mineral walls and honed concrete.
Tiles are 0.75 m / 1.0 m in physical space using the original metre UVs. No broad
albedo clouds, photo textures, global brightness change or extra point lights
are used. Each finish exports standard glTF normal and roughness textures with
matching UV transforms, linear non-colour data and mipmapped filtering. The
roughness factor defaults to one, rather than darkening the absolute map twice.
The six embedded surface maps total 1,150,397 bytes, replacing 1,517,297 bytes
of surface maps in the checked pre-update GLB. The unchanged mural remains 587,374 bytes. The user-provided video-derived screen poster adds 20,303 bytes.
Eight embedded maps at RGBA8 occupy approximately 9,310,208 bytes before mipmaps
(12,413,456 bytes including full mip chains). This is a storage estimate, not measured
hardware allocation; the external movie and runtime video texture are additional.
Only one tier is displayed at a time, but loaded GLBs can be cached separately;
there is no cross-room image-source reuse. GPU figure excludes geometry and
runtime vehicle/environment textures; no real-device frame-rate claim is made.

To refresh only these two materials without rebuilding a single mesh:

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --workshop-surface-only

That route asserts exact geometry and camera-contract parity. Retired map files
remain historical source assets but are not packed into current sources or GLBs.
Current exact per-tier costs are in `reverse-workshop-audit.json`, reports and
provenance. `reverse-workshop-source-audit.json` verifies source geometry and
perimeter placement; `workshop-surface-source-audit.json` verifies unrelated
materials, mural and preview-light/camera/render preservation. Full triangle
parking clearances, noncollapsed geometry, inward ray enclosure and near-plane
camera safety remain independently tested against the actual runtime exports.
Historical `.png` Blender previews are not evidence of the current finish; use
native application screenshots from the final TV-inclusive arrival-zone runtime
review for current appearance. Earlier `output/garage-entry-preview` shows the
accepted distinct arrival layout before the user-requested television was added.

## Physical wall television and current media status

The negative-X wall has one 4.20 × 2.3625 m, 16:9 display. Its room-facing normal
is +X; plane bounds are X=-9.02, Y=[1.46875,3.83125], Z=[-6.40,-2.20] metres.
The upper part remains above the checked 2.6 m parked-van height. A shallow
chassis, wall plates and mounting arms, four-piece bezel, power cable and soft
surround diffuser are individually editable meshes. The diffuser reuses the
existing fixture material and adds no dynamic point lights. The intake moves
above the TV; the original front repair workshop and mural are not touched.

`Arrival wall television display` is an independent quad with UV0 covering
[0,1], material `garage_screen_display`, a +X normal and two exported triangles.
It adds exactly one material draw. The source packs the supplied-video-derived 640 × 360
`roadster-screen-poster.jpg` unchanged into white-factor base and emission slots
in sRGB. Standard glTF export inverts Blender V coordinates; runtime textures
use the normal glTF `flipY=false` convention. The fixture's solid housing is in
the camera metadata; the zero-thickness display plane is visual, not a collision
box. `garageScreen` metadata records the plane contract; fixture bounds describe
the mounted screen assembly, excluding its lower power-cable outlet.

The runtime media hook replaces only this material and uses the matched poster
as fallback. The user supplied the Tesla clip “The Kickflip | Roadster”; its full
1,052-frame timeline (43.877167 seconds) is retained. Video packets are stream
copied without cropping, resizing, retiming or re-encoding; audio is removed.
The poster is taken at 14.2 seconds. The separate silent MP4 is 1,707,750 bytes;
it is not embedded in room GLBs. Exact input/output hashes and transformations
are recorded in `screen/supplied-video-provenance.json` and reproduced by
`scripts/import_garage_screen.py`.

This footage is third-party content supplied by the user, not original game art.
Tesla is credited as the creator using the source reference in the media
provenance. No affiliation or endorsement is claimed. A redistribution license
is not inferred from possession; public release remains a separate decision.

For a matching-poster-only update without rebatching or re-exporting geometry:

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --screen-poster-only

This route fingerprints every saved Blender mesh, transform, UV, shader and
render setting and compares every non-poster GLB bufferView byte exactly. Only
packed display image bytes and two truthful attribution strings change; camera
metadata, all surface/mural images and screen UV/normal/dimensions stay exact.
`reverse-workshop-source-audit.json` independently reopens the before/after
sources and verifies those fingerprints again.

To add or refresh just this fixture on an existing arrival-zone source:

    blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --resume --arrival-tv-only

This route replaces only the tagged TV and its newly authored overhead intake.
The full rebuild and `--reverse-workshop-only` also produce the current TV.
Source assertions require the physical display, charger, connector and gate
hardware and reject the superseded duplicate workbench/toolboard/cupboards.

## Current measured room cost

After the arrival-zone, PBR and television changes, tiers 1–4 respectively are:

| Tier | GLB bytes | Triangles | Material draws |
| --- | ---: | ---: | ---: |
| 1 | 4,831,864 | 42,428 | 18 |
| 2 | 5,338,080 | 50,222 | 21 |
| 3 | 4,811,228 | 37,834 | 20 |
| 4 | 5,218,628 | 43,274 | 20 |

The current download ceiling is **5,500,000 bytes per room**, the largest measured
room rounded up to the next 250 kB, not an unrestricted increase. This includes
the poster and all seven pre-TV embedded images, but not the separately delivered
movie. The 100,000-triangle/40-draw limits, exact geometry checks, parked-car
clearance checks and full camera safety checks are not relaxed. Source `.blend`
files are editable authoring deliverables and are not runtime downloads.
