# Roadster — asset credits and provenance

This file supplements, and does not replace, the retained [runtime asset credits](public/assets/CREDITS.txt). Existing Ferrari/Poly Haven attribution, Three.js and Draco license notices remain applicable. New game geometry and authored material resources are original project artwork created for Roadster in October 2026; the separately credited, user-supplied Tesla television footage below is third-party content. The common [asset manifest](public/assets/manifest.json) records their byte counts, SHA-256 hashes and source paths.

`Original-project-artwork` is a provenance label, not an assertion that a depicted vehicle design or trademark has been commercially cleared, and not a blanket third-party license grant.

## Four original garage environments

- Runtime: `public/assets/garage/tier1.glb`, `tier2.glb`, `tier3.glb`, `tier4.glb`.
- Original supporting textures: `original-concrete-grain.png`, `original-concrete-roughness.png` and `original-rose-velocity-mural.png` in the same directory. Copies are embedded in the GLB exports.
- Editable sources: `art/garage/tier1.blend` through `tier4.blend`.
- Reproduction source: `scripts/create_garage.py`.
- Provenance, export budgets and source hashes: `art/garage/provenance.json`; implementation notes: [art/garage/README.md](art/garage/README.md).

All room geometry, equipment assemblies, concrete textures, diagnostic graphics and floor markings were authored procedurally in Blender for this project. No external model, purchased pack or manufacturer CAD is used in these environments. The television embeds a poster from the separately credited user-supplied Tesla footage; all other environment textures are original project artwork. Preview renders may show the retained Rocket for scale; that vehicle is not embedded in the garage GLBs or saved garage source scenes. Diagnostic panels are original decorative artwork, not manufacturer interfaces or certified measuring instruments.

### User-supplied garage television film

The television plays **The Kickflip | Roadster**, credited to Tesla; reference: https://www.youtube.com/watch?v=r5vsHHPVhJg. The user supplied the local MP4 for this integration. This is not original project footage, a game-physics demonstration or evidence of unaided flight. Visible production cables and all original shots remain intact.

Runtime media: `public/assets/garage/roadster-screen-loop.mp4` and `roadster-screen-poster.jpg`. The full 1,052-frame video track is retained at 640×360 and 24000/1001 fps (43.877167 seconds), without cropping, retiming or video re-encoding. Only the audio stream was removed and MP4 fast-start metadata was relocated. The original container's 43.932154 seconds includes a slightly longer audio tail. The poster is extracted at 14.2 seconds.

Reproducible importer and provenance: `scripts/import_garage_screen.py` and `art/garage/screen/supplied-video-provenance.json`. The importer requires an explicitly supplied source file and verifies every decoded output frame against it; it does not download or scrape a service. User possession and this technical transformation do not establish a commercial redistribution license. No Tesla affiliation, endorsement or license grant is claimed; platform/commercial release rights remain a separate consideration.

### Rose Velocity wall artwork

The four rooms now contain the original **Rose Velocity** mural in plum, magenta, rose and blush tones. Source: `art/garage/mural/create_mural.py`; editable vector artwork: `art/garage/mural/rose-velocity.svg`; author manifest: `art/garage/mural/manifest.json`. Original SVG strokes and seeded aerosol/porosity/chip patterns produce the local 1024×512 PNG, not a photograph, downloaded graffiti, copied logo or third-party artwork. The image is applied to real wall patches in all four editable Blender rooms and exported in their GLBs, not composited over the runtime camera.

Each room gains one material batch and 16 / 16 / 40 / 28 triangles respectively, with a 2 mm wall offset and no collision role. `art/garage/mural/architecture-preservation-audit.json` records preservation of the original meshes, transforms, normals, UVs and materials. Older `art/garage/previews/tier*.png` renders are explicitly pre-mural architectural references, not evidence of this final appearance.

## Original Rocket cosmetic attachments

Runtime files in `public/assets/garage-cosmetics/`:

- `body-splitter.glb`: formed lower nose lip with narrow inlays and fasteners.
- `body-louver.glb`: open-gap decorative slats fitted over the retained rear deck.
- `wheel-turbine-left.glb`, `wheel-turbine-right.glb`: removable ventilated wheel-face covers.
- `rim-copper-left.glb`, `rim-copper-right.glb`: narrow copper accent annuli over the original rims.

Each file has a same-stem editable `.blend` source in `art/garage-cosmetics/`. Generator: `scripts/create_garage_cosmetics.py`. Attachment frames, geometry budgets, hashes and compatibility are recorded in `public/assets/garage-cosmetics/manifest.json`; source topology and preservation audits are in `art/garage-cosmetics/`. Technical notes: [GARAGE_COSMETIC_ASSETS](docs/GARAGE_COSMETIC_ASSETS.md).

All new meshes are original Blender-authored geometry, without downloaded meshes, paid assets, copied photo textures or manufacturer logos. The accepted Rocket is imported read-only for fitting and previews; these accessories do not replace its tyres, wing, nozzle apertures, cabin or physics. The upholstery-stitch option reuses and tints the existing original modeled seam material; it does not require a new third-party texture. Body/rim finishes and instrument palettes use isolated game material state.

These attachments are fitted to Rocket only. No fit to the hatch, sedan, SUV or van is asserted. The louver is cosmetic, not a newly functional intake; the wheel pieces are honestly covers/rings, not replacement factory wheels. Titanium/rose rim finishes and light/smoke glazing choices use isolated existing material state, not new downloaded textures or geometry. Rim color transitions preserve tyres and braking surfaces, including scoring rings that share an original metal batch.

## Original fictional steering alternatives

- Runtime: `public/assets/cosmetics/steering-round.glb` and `steering-yoke.glb`.
- Editable Blender sources: `art/cosmetics/steering-round.blend` and `steering-yoke.blend`.
- Generator: `scripts/create_steering_cosmetics.py`.
- Exact attachment, bounds, budgets and binary hashes: `public/assets/cosmetics/steering-manifest.json`, mirrored in `art/cosmetics/steering-manifest.json`.

Both are original fictional game accessories: authored grips, hub, spokes, paddles, seams and trim, not Tesla factory parts, official options or manufacturer CAD. No downloaded or purchased mesh, external texture or manufacturer logo is included. Each retains 49 separately editable source parts and exports as four material batches; the round option has 5,608 triangles and the compact yoke 5,488. The retained Rocket is used read-only for fitting.

Only Rocket is supported. Runtime mounts the selected assembly at the unchanged `steering_yoke` pivot and hides only the original five rotating wheel meshes. The stationary column, tablet, controls, steering animation, accepted vehicle geometry and physics remain intact; selecting stock restores the original meshes. Each option has its own successful-load capability gate. This is original accessory provenance and sampled fit validation, not mechanical certification or commercial design clearance.

## Original Roadster graphic identity

- `public/brand/roadster-emblem.svg`: original road/wing-inspired geometric mark.
- `public/brand/roadster-wordmark.svg`: Roadster wordmark lockup and workshop descriptor.
- `public/brand/road-wing-grid.svg`: original road-perspective/decorative line graphic.

The SVG files are their own editable sources. Paths, colors and composition are project-authored. They contain no linked external image, manufacturer logo or bundled font. The wordmark uses named system-font fallbacks; it is not a redistributed font asset. UI line icons are original path data in `src/garage-ui.js`. These graphic works do not establish trademark clearance for the game name.

## Retained vehicles, landscapes and software

The eight existing original Blender traffic vehicles remain credited in [public/assets/CREDITS.txt](public/assets/CREDITS.txt). The garage's four earnable ground cars reuse the hatch, sedan, SUV and van exports from that fleet; no newly downloaded vehicle is implied. The remaining traffic models are not sold by the garage catalog.

The retained Rocket GLB has SHA-256 `d71068fb3da4771f1a5945f03d078cd97a4cac4f0884442cda9c7c732722100e`. Its reference reconstruction, original cabin/tablet artwork, enlarged left mirror, smoke atlas and landscape artwork keep the provenance and limitations already documented in the runtime credits. Retained manifest entries and attributions remain; the four garage records are refreshed to the current mural-bearing GLBs, and new runtime artwork is added with its own source and hash.

Ferrari 458 Italia attribution remains with its original author and CC BY 4.0 notice even though that retained file is not the current player/traffic model. Poly Haven assets retain CC0 notices. Renderer license: [Three.js MIT](public/vendor/THREE-LICENSE.txt). Decoder license: [Draco Apache 2.0](public/vendor/draco/LICENSE.txt).

## Commercial release gate

Permission for the Tesla-associated reference vehicle design, related trademarks and any promotional use has not been established. Original authorship of a reconstruction, an enlarged gameplay mirror, new bolt-on parts or an original garage does not establish that permission. There is no claim of endorsement, affiliation, exact factory geometry, verified hardware, real flight performance or manufacturer telemetry.

Do not treat this document or a successful local build as rights clearance, approval by Yandex, live monetization or deployment. Resolve the retained reference design's rights before public commercial release without silently replacing the user's accepted model. The release gates are recorded in [YANDEX_LAUNCH_CHECKLIST](docs/YANDEX_LAUNCH_CHECKLIST.md) and [ROADSTER_GARAGE_UPDATE](docs/ROADSTER_GARAGE_UPDATE.md).
