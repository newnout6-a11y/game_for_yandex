# Reclaimed garage space and local showroom light

This additive update removes the HOME/garage bottom strip and the decorative
“Линия автомобилей” caption. It does not remove save operations, ownership,
progression or authentication. A healthy save no longer occupies permanent UI
space. Failures mark the existing Settings button with a compact indicator and
accessible description; details and retry remain inside Settings. The existing
whole-profile cloud-conflict dialog remains explicit and blocking. Confirmed
`durable`/`server-durable` writes and an already `loaded` cloud copy are described
accurately; loading a copy is not described as performing a new server write.

The stage and workbench reclaim the removed row. HOME framing accepts an absent
footer, while invalid measured geometry still fails closed. Essential Atelier
category, reset and purchase/equip controls stay in the viewport. A longer item
catalog remains scrollable with one overflow cue for the whole panel; this does not claim that every
item in every catalog is simultaneously visible on a phone.

## Shadow density without a new GPU pass

The local key uses one cached 1024×1024 shadow map, focus 1, near 0.1 m, far 16 m,
66-degree half-angle and a soft penumbra. Its proxy position is (0,4.5,-0.8),
below all four rooms' actual suspended light casings. This is a shared workshop
lighting proxy, not a claim that one fixture occupies that point in every tier.

At the floor, this puts a 20.24m footprint into the fixed map, about 19.76 mm per
texel. The first off-centre broad-cone candidate spent roughly 46–69 mm per texel
across the same main-car floor region. The map size, number of shadow passes,
cache policy, vehicle meshes and shadow bias are unchanged. Light and shadow
projection share the same cone, so no lit area is cut off by a smaller map frustum.

Tests raycast actual exported room triangles between useful floor receivers and
the light, including the exact points that previously showed a suspended-fixture
stripe. They also verify non-vacuous lit-volume coverage and useful parked-car
floor bounds. Walls, roof, furniture and cars remain visible and shadow-capable.

## Reproduction

`node scripts/garage-toy-space-qa.mjs` uses a complete source tree and an isolated
local profile inside reconstructed 551×360 and 560×315 landscape iframes. It steps
the real renderer and real GLB previews. For deterministic software capture only,
the harness selects the existing synchronous miniature readback branch; production
keeps its asynchronous readback and bounded fallback unchanged. This avoids
waiting indefinitely for a software GPU fence while the main RAF is manually
stepped. No fake thumbnail image substitutes for the real model render.

The harness is not a real Android FPS, battery, authenticated Yandex, ad or cloud
save test. DOM hit/focus tests independently cover the reclaimed panel area and
save-error settings flow. Camera/room clearance tests use actual model bounds
across four tiers and all five selectable vehicles.

## Physical McQueen toy and provenance

The separately loaded decorative prop is a Blender-authored depiction of the
Lightning McQueen diecast toy requested in the supplied reference. Its curved
body, wheels, canopy and close-fitting spoiler are real geometry. The eyes are
opaque UV paint on that canopy, not stacked near-coplanar patches. A conformal
printed decal atlas carries the other character graphics; the reference photograph is
not a billboard, texture, source asset or public download. The packed editable
Blender file, vector decal source and generator are retained for reproduction.

The mesh and atlas were authored for this task, but the Disney/Pixar Cars
character identity and Rust-eze/racing graphics are third-party subject matter.
This work does not establish an official affiliation, endorsement or commercial
redistribution license. See the asset provenance and public credits.

The rebuilt toy has 40,698 triangles in eight material batches, a roughly 1.86 MB
GLB transfer, an embedded 1024×1024 marking atlas and a 512×256 opaque windshield
texture. Their combined RGBA8 allocation including mip levels is 6.00 MiB;
the larger editable artwork does not ship as runtime textures. Material batches
are not draw-call counts: the existing double-sided transparent marking material
submits two colour passes. A matched native colour-pass control measures nine
additional submissions and 46,220 submitted triangles, including that second
paint pass. This visibility-only control excludes a fresh shadow-map update and
is not a frame-time benchmark.
The prop participates in the existing cached shadow/environment passes; it does not create a new
light, shadow map, render context or continuous animation loop.

The larger geometry budget retains the sculpted arch loops, compact volumetric
tyres, recessed red rims with real ventilation openings, and surface-conforming
printed triangles. This is an explicit increase from the earlier rejected
17,596-triangle / 808 kB candidate, not a performance optimization. It is not a
claim of Android frame rate or battery performance.

Regression checks sample the entire upper tyre footprint across both shoulders,
not merely the wheel centre or the widest global body box. The independent
clearance audit also checks triangle edges in both directions and tyre-vertex
containment; an in-memory raised-wheel positive control confirms that it detects
real penetration. Printed surface winding, actual rim openings and local rocker
clearance are tested on exported GLB geometry. These are sampled geometry checks,
not a claim of exact manufacturing dimensions or visual identity from one ratio.

The red enamel is an opaque nonmetallic material with sRGB base colour #d60918,
roughness 0.17 and a clear coat. Native Blender evidence uses neutral white
studio lights and AgX, whereas the game uses its existing ACES showroom lighting.
Bright coat reflections and tone mapping can make the rendered red look lighter;
no pink texture, grain map, global blur or recoloured preview is used. Residual
grain in an unfiltered CPU preview is renderer sampling noise, not a runtime
surface texture. User and web reference photographs are not redistributed.

The opaque windshield replaces ten thin overlapping eye-art components while
retaining the existing canopy geometry and facial layout. This removes both
microscopic tessellation crossings and depth-buffer competition at the normal
distant garage camera; the camera near/far planes are unchanged. Other flush
paint graphics use a material-name-scoped polygon offset of −2/−2 with depth
testing retained. This is not a global draw-order or visibility override: solid
car parts and room objects still occlude the paint normally.

The toy is independently loaded once, does not delay entry or become a playable
vehicle, and participates in real contact shadows and room-camera clearance.
Its rear-side position avoids the selected vehicle and both parking bays. A
normal reachable orbit reveals it; the initial HOME composition is not zoomed
or moved simply to advertise the prop. Its independent GPU resources are
released once, including on a late load after disposal.

## Test timing

The platform-service test fixture gives unrelated successful fake operations a
1,000 ms default budget to avoid CPU-contention false timeouts during geometry
checks. Explicit timeout tests retain their 5/10 ms deadlines and assertions.
No production service timeout or save behavior changed.
