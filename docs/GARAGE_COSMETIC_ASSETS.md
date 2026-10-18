# Roadster garage cosmetic assets

This document covers the 19-item runtime catalog, its real authored attachments, isolated existing-material choices and garage inspection views. These do not replace the accepted car, tyre mesh, flight system or physics. The six retained exterior GLBs use original graphite/copper artwork; two new steering GLBs are original fictional accessories, not factory equipment. No manufacturer logos, paid assets, external downloads, textures or lights are embedded in these eight cosmetic GLBs. The separate wall mural is original project artwork, not a vehicle cosmetic.

## Retained authored exterior and upholstery choices

| Catalog ID | Slot | Compatible car | Implementation |
| --- | --- | --- | --- |
| `body_splitter` | `body.addon` | `rocket` only | Formed graphite bolt-on lower nose lip, narrow copper inlays and six captive fasteners. |
| `body_louver` | `body.addon` | `rocket` only | Six raised graphite deck louvers in a close-fitted surround, with genuine open gaps and narrow copper edge inlays. This is a decorative vented applique over the retained deck, not a newly opened functional engine intake. |
| `wheel_turbine` | `wheels.geometry` | `rocket` only | Four ventilated, ten-vane wheel-face covers with copper witness marks. Suggested label: «Турбинные накладки». Existing wheel/tyre stays intact. |
| `rim_copper` | `wheels.finish` | `rocket` only | Four separate 7.6 mm wide copper accent rings over the original outer rim lip, compatible with either stock wheels or turbine covers. The narrow annulus is real added geometry; the runtime copper finish also tints isolated original rim metal. Tyres and braking surfaces are not recolored. |
| `cockpit_stitch` | `cockpit.trim` | `rocket` only | Clone/tint the existing modeled upholstery-seam material `RC_Ivory_Double_Stitch`, mesh `detail_rc_stitch`. Suggested sRGB colour `#c77643`. Do not recolor the entire seat. |

No hatch/sedan/SUV/van fit is claimed for these five authored capabilities. Their presence in a catalog is not sufficient to enable a purchase: the loader must confirm the required source geometry or seam material. Body paint, rim finishes, glazing tint and instrument palettes are separate implemented material choices, not geometry delivered in these six files. The runtime catalog has 19 choices in total; exact prices, room levels and model compatibility are listed in [ROADSTER_GARAGE_UPDATE](ROADSTER_GARAGE_UPDATE.md#5-19-косметических-вариантов-и-честная-совместимость).

## Exact retained exterior attachment frames

Runtime files are in `public/assets/garage-cosmetics/`. All attachments use an identity root: position `[0,0,0]`, rotation `[0,0,0]`, scale `[1,1,1]`. Mesh coordinates are the accepted Roadster's **unscaled local source metres**, `+Y` up and `-Z` forward.

- `body-splitter.glb`, root `cosmetic_body_splitter`: add to `car.userData.bodyRig` (`player_sprung_body`) after `createCar`. It then inherits the same bounded pitch/roll/heave as the body, rather than staying rigidly attached to the world or wheel carrier. Alternatively attach under `Roadster` before `createCar` performs its sprung-body grouping.
- `body-louver.glb`, root `cosmetic_body_louver`: same identity body-rig attachment. Manifest key `bodyLouver`, capability `body.louver`. It stays in source `x=±0.563 m`, `z=1.493–1.731 m`, `y=0.8495–0.8859 m`, on the existing forward rear deck. `body.addon` is one catalog slot, so runtime selection shows either the lip or louver; the engineering preview fits both only to demonstrate their independent clearance.
- `wheel-turbine-left.glb`, root `cosmetic_wheel_turbine_left`: clone under `wheel_spin_fl` and `wheel_spin_rl`.
- `wheel-turbine-right.glb`, root `cosmetic_wheel_turbine_right`: clone under `wheel_spin_fr` and `wheel_spin_rr`.
- `rim-copper-left.glb`, root `cosmetic_rim_copper_left`: clone under `wheel_spin_fl` and `wheel_spin_rl`.
- `rim-copper-right.glb`, root `cosmetic_rim_copper_right`: clone under `wheel_spin_fr` and `wheel_spin_rr`. Manifest key `rims`, capability `rims.copperAccent`, catalog slot `wheels.finish`. The source radius is `0.2846–0.2922 m`, axle offset `|x|=0.1586–0.165 m`; no added spin or scale is needed. The annulus lies radially beyond the `0.282 m` turbine-cover envelope and inside the original tyre bead.
- Never attach a cover directly under the car or steer carrier. The existing spinner provides local-X spin; its parent supplies front steering. Do not copy or invent a second spin clock.
- Do not center, ground, normalize or scale an attachment. The Roadster root scale is `0.9866073727607727`; it is inherited, not applied twice.
- Existing source wheel centers are `x=±0.908`, `y=0.390`, front `z=-1.470`, rear `z=1.470`. The source tyre radius is `0.3830000078417506`; exported measured radius is approximately `0.37787064 m`. The covers have a `0.282 m` source radius and never reach the tyre bead or contact patch.
- Removing a cosmetic removes only the added clone. Never dispose shared geometry or mutate the loaded template. Material tinting must clone material state per car and restore it on canceled preview.

The machine-readable `manifest.json` records paths, roots, slot IDs, source hash, bounds, budgets and transforms. Its current accepted Roadster SHA-256 is checked by the asset tests. If the accepted vehicle changes, the tests deliberately require re-fitting rather than silently assuming compatibility.

## Authored geometry and budgets

- Lower lip: 9 individually editable parts; 1,040 runtime triangles; 3 material batches; approximately 44 KB.
- Each side wheel cover: 20 editable parts; 1,790 triangles; 2 batches; approximately 46 KB. Share a loaded left/right geometry between front/rear clones.
- Rear-deck louver: 12 editable parts; 1,532 triangles; 2 batches; approximately 63 KB. Every strip follows ray-cast measurements of the actual accepted body triangles rather than a proxy shell.
- Each copper ring: 1 editable closed profiled annulus; 864 triangles; 1 batch; approximately 18 KB. Share each side between the front and rear spinners.
- All six files together: approximately 233 KB before transfer compression. Fitting both body alternatives plus all four covers and rings for engineering inspection costs 13,188 triangles and 17 additional batches. The actual catalog allows only one body addon at a time. No added texture memory. These are asset budgets, not a claim of measured phone FPS.
- The lip remains inside the accepted nominal car bounds, above road contact, and ahead of the front lift apertures. Copper is a narrow inlay, not emissive lighting.
- Wheel faces have actual ventilating openings, raised lips and swept vanes. Existing spokes/brake disc remain visible through the gaps; this is honestly a removable cover, not a fake full replacement rim.
- The louver leaves the original glazing, passenger vessel, deck skin, wing recess and nozzle mouths intact. The vented applique is cosmetic and does not claim to change cooling, aerodynamics or collision dimensions.

## Editable sources and regeneration

Each runtime GLB has its separate editable source `.blend` in `art/garage-cosmetics/`. Individual vanes, inlays and fasteners are preserved there; joining by material happens only for export.

`source-audit.json` records all new editable mesh parts and their closed manifold topology. New source scenes contain only their authored attachment and no embedded reference textures or vehicle objects. `preservation-audit.json` records unchanged hashes of the accepted car/source and the previous three cosmetic GLB/source pairs.

Generate geometry and preview renders:

```sh
blender --background --python scripts/create_garage_cosmetics.py -- --render
node --test tests/garage-cosmetic-assets.test.mjs
```

The new louver/ring delivery was built with `--new-only`, which preserves the original splitter, left turbine and right turbine GLBs and `.blend` files byte for byte. It also rejects a changed Roadster reference. To rebuild only those new parts and render their fit:

```sh
blender --background --python scripts/create_garage_cosmetics.py -- --new-only --render --view new
```

Render the existing exported assets without rebuilding them:

```sh
blender --background --python scripts/create_garage_cosmetics.py -- --render-only --samples 32
```

Cycles denoising is disabled because this environment's Blender build has no OpenImageDenoise support. The accepted `public/assets/roadster.glb` is imported read-only for fitting and previews; its hash is asserted unchanged. The generator never writes the accepted Roadster/traffic sources or exports.

## New steering GLBs: real geometry, fictional variants

| ID / runtime file | Price / minimum room | Capability | Budget |
| --- | --- | --- | --- |
| `steering_round` / `public/assets/cosmetics/steering-round.glb` | 650 credits / level 1 | `cockpit.steeringRound` | 262,948 bytes; 5,608 triangles; 4 material batches; 49 editable parts |
| `steering_yoke` / `public/assets/cosmetics/steering-yoke.glb` | 850 credits / level 2 | `cockpit.steeringYoke` | 263,972 bytes; 5,488 triangles; 4 material batches; 49 editable parts |

Both use the single `cockpit.steering` slot and are **Rocket-only**. Source files are `art/cosmetics/steering-round.blend` and `steering-yoke.blend`; generator: `scripts/create_steering_cosmetics.py`. The author/runtime manifest is `public/assets/cosmetics/steering-manifest.json`, with a matching copy in `art/cosmetics/`. These are original fictional game steering designs, not Tesla factory variants, certified hardware or manufacturer CAD.

- Mount root `cosmetic_steering_round` or `cosmetic_steering_yoke` under the existing `car.userData.yoke` / `steering_yoke`, using identity position, quaternion and scale. Coordinates are pivot-local metres: +Y up, +Z toward the driver. Existing local-Z steering animation is inherited without another animation clock or runtime rescale.
- Preserve the pivot's original translation `[-0.43000003695487976, 0.7950000762939453, -0.20500001311302185]`. The actual mount and measured local bounds are in the steering manifest.
- Hide only `steering_yoke_rc_black`, `steering_yoke_rc_carbon`, `steering_yoke_rc_ivory`, `steering_yoke_rc_liner` and `steering_yoke_rc_metal` while a loaded alternative is selected. Keep the stationary column, tablet and controls unchanged. Stock selection restores those original meshes.
- A valid matching GLB root is required independently for each capability. Missing/malformed assets disable that purchase rather than supplying primitive replacement geometry or charging for a missing item. Neither variant may be enabled on the other four cars.
- The two alternatives total 526,920 bytes before transfer compression; only one is visible at a time. Both are texture-free. These are file/geometry budgets, not frame-rate measurements.

Rebuild and inspect the dedicated steering assets:

```sh
blender --background --python scripts/create_steering_cosmetics.py
node --test tests/steering-cosmetic-assets.test.mjs
```

`art/cosmetics/previews/` contains `steering-round-product.png`, `steering-yoke-product.png` and matching `*-fitted.png` views. Preview geometry is the actual authored assembly, not a drawn icon. The existing vehicle is imported read-only for fitting; its accepted SHA is unchanged.

`tests/steering-cosmetic-assets.test.mjs` covers manifest hashes, exact pivot/identity mounting, finite nondegenerate one-sided geometry, real open areas/grips, inherited steering animation and unchanged template visibility. Screen sightline checks sample the authored eye box at five steering angles; stationary-cabin triangle clearance samples 25 angles from −1.2 to +1.2 rad. These are regression samples, not a continuous mechanical certification. Final integrated/browser results must be recorded separately by the integrator.

## Rim finishes, tint and finite inspection motion

The six new catalog choices, compared with the former 13-item catalog, are the two steering assemblies above, `rim_titanium` (210 credits), `rim_rose` (270), `tint_light` (160) and `tint_smoke` (260). The four material-only additions are available for all five cars from room level 1, without new meshes or image downloads. Titanium uses sRGB `#A8A5AF`; rose uses `#B56683`.

Rim finishes operate on isolated per-wheel metal material instances, not tyres, body paint, safety lamps or a whole wheel-group override. Every rim has its own 0.95-second front-to-back color boundary using the existing single-pass `VehiclePaintTransition`. It measures the actual metal geometry in the relevant wheel's coordinates, avoiding a wipe stretched across the whole wheelbase. The accepted Rocket's brake scoring rings share a historical rim-metal batch; an exact existing-vertex mask restores their source albedo after the color mix. No geometry split, texture, extra pass or brake repaint is introduced. Copper accent geometry remains a separate ring attachment.

Tint belongs to **Body → Glass**, `body.tint`, rather than upholstery. `tint_light` uses `#292933` with +0.04 source-opacity; `tint_smoke` uses `#17191f` with +0.12. Actual runtime opacity is `min(0.92, original + increment)`, not the catalog's illustrative swatch opacity. Interior Rocket viewing uses the retained cap of 0.10 for visibility and restores the selected exterior state on exit; resetting the slot restores exact stock material state. Tint is artistic opacity, not certified optical transmission. Clones isolate it from other owned cars and the loaded templates.

Selecting an atelier category dispatches the real inspection view: Body → overview, Rims → close-up of the actual front-left wheel, Cabin → the authored seated eye in Rocket. `GarageCameraMotion` blends the last displayed pose to the current fitted target over 0.85 seconds, including orientation, FOV, near plane and viewport offset. `frameCockpitCustomization` fits the actual steering assembly and tablet to the visible UI region while retaining the authored eye position. It does not move the racing camera or change physics. A changed category interrupts from the displayed position rather than snapping back; no idle camera orbit is added.

For both camera and paint, hidden/offscreen views and reduced motion settle immediately. Rapid color choices finish the visible boundary and retain only the latest pending color. Changes remain reversible, and stock selections restore the underlying materials or steering meshes. `tests/garage-customization-motion.test.mjs` covers these contracts; `scripts/garage-customization-qa.mjs` exercises the integrated browser workflow. Their presence does not by itself claim a passed final acceptance run.

## Original mural, separate from the cosmetic catalog

All four Blender room sources and GLB exports contain **Rose Velocity**, original plum/magenta/rose/blush wall artwork. Editable vector: `art/garage/mural/rose-velocity.svg`; generator: `art/garage/mural/create_mural.py`; source/texture hashes: `art/garage/mural/manifest.json`. The 1024×512 PNG at `public/assets/garage/original-rose-velocity-mural.png` is 587,374 bytes and is also embedded in every room. It contains original strokes, aerosol speckling, porosity and chips, no copied photograph, text or logo.

The wall additions cost one material batch per room and 16 / 16 / 40 / 28 triangles respectively, with a 2 mm surface offset and no collision role. Original room meshes/materials/transforms/UVs/normals are preserved by the recorded `art/garage/mural/architecture-preservation-audit.json`; parked-car capacity stays 1 / 2 / 3 / 3. The mural is neither a purchase nor a vehicle decal. Older `art/garage/previews/tier*.png` images predate the mural; use the mural preview or current runtime captures for its appearance.

## Retained exterior verification and visual evidence

`tests/garage-cosmetic-assets.test.mjs` loads actual GLB buffers, not proxy shapes. It checks:

1. Exact accepted-asset SHA, IDs, roots, identity attachment transforms, editable sources and mobile size/draw budgets.
2. Every vertex/normal is finite, every shading normal is unit length, and all exported triangles are nondegenerate. Outward-face rays verify one-sided front faces, rather than hiding reversed winding with double-sided materials.
3. Actual bounds stay within accepted nominal dimensions; lip stays above road contact and leaves all four lift-nozzle apertures clear.
4. Five wing deployment samples (`0, .25, .5, .75, 1`) do not overlap the lip or louver. Louver triangles stay clear of all retained car surfaces; every vertex has the actual existing metal deck immediately below. Vertical rays confirm all six real slats and their open gaps.
5. Original rubber meshes and measured wheel radii are retained; covers inherit steer and spin exactly.
6. Narrow-phase edge/triangle clearance of both covers and copper rings against the actual body/fenders/calipers for five steering angles through ±0.5 rad, three wheel phases and neutral/bounded-body-deflection poses. Copper triangles also clear the original wheel/tyre and optional turbine cover. This is sampled geometric regression coverage, not a continuous certified mechanical-clearance proof.
7. Existing modeled upholstery seams, not a broad leather material, provide the contrast-stitch target.
8. New attachments do not intercept driver tablet/mirror sightlines sampled across the established eye box.

Blender previews under `art/garage-cosmetics/previews/`:

- `rocket-cosmetics-front.png`: fitted exterior, parked wing.
- `turbine-fitted-detail.png`: fitted left front cover and accepted tyre.
- `splitter-fitted-detail.png`: lower-lip fit, fasteners and copper inlay.
- `stitch-copper-cutaway.png`: actual upholstery seam material with copper tint. Glazing/roof lining is hidden **only in this inspection render**, not runtime.
- `louver-fitted-detail.png`: six raised slats, open gaps, retained rear glazing and metal deck.
- `rocket-cosmetics-rear.png`: complete rear exterior showing separation from the stowed wing.
- `copper-turbine-fitted-detail.png`: copper annulus fitted outside a turbine cover.
- `copper-stock-fitted-detail.png`: the same annulus with the unmodified original wheel and tyre.

The supplied accepted vehicle has its own unresolved commercial design/trademark release gate. New original bolt-ons do not resolve or change that gate. Previews are engineering/art inspection evidence, not an endorsement or manufacturer specification claim.
