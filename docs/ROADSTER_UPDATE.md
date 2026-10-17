# Roadster / Scenic Roads update

This update keeps the existing Yandex SDK, saves, manual steering, pedals, ads guards and road events.

## Included

- Original Blender-authored, reference-inspired silver Roadster with real wheel arch cutouts, animated wheel pivots, continuous rear lamp, carbon-style wing, dark glazing and ivory-seat cabin with yoke/display.
- Editable Blender source in `art/roadster.blend`; deterministic generator in `scripts/create_roadster.py`; optimized runtime `public/assets/roadster.glb`.
- Three daytime scenic variants: Mountain Lake, Conifer Pass and Coastal Highway. Layered atmospheric ridges, lake ripples, shaped terrain, instanced vegetation/rocks/guardrails, roadside chalet/lookout landmarks.
- Four low-draw-call traffic types: sedan, hatchback, SUV and delivery van. Per-vehicle brake lamps, shared geometry, separate paint, same-lane following and safe spawning.
- Short arcade hover: hold F or the mobile flight control at 44 km/h or more. Uses the same nitro reserve, reaches 3.3 m, descends when released or empty, then has a 2-second landing cooldown. Collisions are bypassed only above the vehicle-specific clearance (1.65–2.25 m). The shadow remains on the road.

Flight height, consumption and cooldown are game balancing values, not manufacturer specifications. No claim of unlimited real-world flight is made.

## Art direction references

The user's supplied exterior and interior references guided the new car; no third-party mesh was copied. Overall scenery/lighting research used official presentation references only:

- Forza Horizon 5 biomes: https://news.xbox.com/en-us/2021/07/26/exploring-the-biomes-and-seasons-of-forza-horizon-5/amp/
- Gran Turismo 7 / HDR Scapes: https://blog.playstation.com/2021/09/09/gran-turismo-7-arrives-on-ps5-and-ps4-march-4/
- Three.js post-processing guidance: https://threejs.org/manual/pages/post-processing.html

The implementation favors coherent daylight, atmospheric distance and readable road users over expensive fullscreen bloom. Poly Haven texture/HDR attribution remains in `public/assets/CREDITS.txt`.

## Validation and release

Run `npm ci`, `npm test`, `npm run check`, `npm run build`. The Yandex-ready archive is `output/potok-yandex.zip`. Nothing is pushed to GitHub or published automatically. Final visual/QA results are recorded separately in `docs/ROADSTER_QA.md`.

Real Yandex platform moderation, live advertising and physical mobile GPU performance still require testing in the platform draft/on devices. Desktop mobile emulation is not a physical-phone performance claim.
