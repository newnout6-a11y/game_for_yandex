# Roadster Rocket fidelity revision

## Target and evidence

The selected target is the **flying Rocket** version of the latest Roadster, not
an amalgam of the 2017 prototype and the two-seat road car. The user selected the
flying version on 2026-10-17 after the configuration distinction was explained.

Primary references reviewed on 2026-10-17:

- [Tesla Roadster](https://www.tesla.com/roadster): current exterior media and
  Performance / Thrust / Rocket configuration descriptions. Rocket has one seat;
  the two other descriptions specify two seats.
- [Tesla, The Kickflip](https://www.youtube.com/watch?v=r5vsHHPVhJg): maneuver and
  visible propulsion reference, not a source of unpublished control algorithms.
- [Tesla, Roadster Event](https://www.youtube.com/watch?v=qt5p-_tE8d0): presentation
  context and additional viewpoints.
- [Hagerty's engineering interview](https://www.youtube.com/watch?v=22rvpUecLts):
  its verified publisher description distinguishes Thrust's 200-L reservoir
  behind the seats from Rocket's additional 400-L vessel in the passenger-seat
  space. This description was read directly; the spoken transcript was not
  available. It does not establish the exact tank shape, orientation or mounts.
- Seven user-supplied images: two exterior/propulsion views and five detailed
  cabin views. The two-seat cabin images inform shared trim design, not a claim
  that Rocket has a passenger seat.

No manufacturer CAD, measured body scan, complete Rocket cabin blueprint or
flight-controller specification has been supplied. Visible surfaces are being
reconstructed from photographic evidence; unseen packaging and game controls
must remain labelled as reconstruction/arcade interpretation. Official photos
are inspection references only, not game textures or redistributed model assets.

## Baseline defects and acceptance checklist

| Area | Accepted baseline gap | Revision acceptance |
| --- | --- | --- |
| Body | Faceted hood/shoulder highlights, flat slab-like doors | Continuous manufactured panels with deliberate reference creases, not unintended triangulation; matched front/side/top silhouette checks |
| Greenhouse | Tent-like windshield/roof and exposed panel intersections | Shallow continuous arc, fitted glazing/seals/pillars, real enclosed cabin; glazing does not conceal missing geometry |
| Nose | Raised tube-like light signature and generic intake | Reference-shaped inset triangular lamp lenses, thin horizontal signature, trapezoidal hood and shaped fascia |
| Wheels | Generic thin spokes and approximate radius | Swept aero spoke profile, rounded tire shoulder, recessed rim, brake hardware, measured radius, steer/spin axis and arch-clearance regression |
| Rear | Flat fascia with attached fan/nozzle rows | Deep inset propulsion surround, reference row spacing, real apertures, shaped diffuser and rear lamp band |
| Wing | Flat rectangle and box endplates | Bowed aerofoil, correct span/chord/endplate/support proportions; optional articulation only when supported by evidence |
| Cabin | Simplified seats, yoke, console and door trim | One-seat Rocket arrangement; shaped bucket seat/headrest opening, accurate yoke/spokes, slim console/dash, red door accent, believable material separation |
| Underbody | Generic EV shielding and simplified nozzle mounts | Visible Rocket reference features reproduced; unseen structure documented as inferred, with no wheel/body/nozzle intersections |
| Effects | Four generic emitters disconnected from detailed hardware | Emission follows authored aperture origins/directions, restrained cold-gas appearance, thrust/braking/roll phases and persistent world-space wake |
| Materials | Broad runtime paint replacement loses authored response | Preserve paint/clearcoat, carbon, upholstery, glass, emissive lenses and rough underfloor roles; inspect in game daylight and neutral studio |

## Implementation and verification sequence

1. Preserve the merged source and capture the existing production GLB from fixed
   front, rear, side, top, wheel, cabin, dashboard and underside cameras.
2. Rebuild exterior and cabin in editable Blender sources, using separate helper
   modules to keep ownership clear. Export the game GLB from those same sources.
3. Review silhouette and broad surface shading before spending geometry on small
   details. Compare the actual Three.js export, not only Blender renders.
4. Integrate authored materials, wheel-radius metadata, steering/spin pivots,
   cockpit movement and nozzle sockets. Preserve the accepted traffic/scenery.
5. Check actual exported geometry: finite/unit normals, outward winding, closed
   footwells and wheel wells, full steering clearance, bounds, light/nozzle
   placement, and named animation contracts.
6. Review effects and airborne/landing/roll states with actual game controls and
   simulation. Avoid portraying game assistance as a manufacturer's flight law.
7. Run the full regression suite, build, desktop/mobile browser smoke and matched
   render-cost comparison. Report submitted triangles/draws, texture memory and
   loading size separately; software controlled-time recordings are not real
   mobile frame-rate measurements.
8. Publish only an accepted immutable snapshot on a new branch/PR based on merged
   main `4a58fae9c6f5d1b73013ee7d10dffb96ebe0c8ea`. Do not alter completed PR #1.

The initial near-player art budget is provisional, approximately 120–180k
triangles and 35–45 mesh draws before shadows. This is a fidelity target to
measure, not a claim that extra detail has no cost. Material batching, meaningful
mipmapped maps and selective invisible-detail costs will be considered without
substituting low-detail geometry for the requested model.

The implemented moving mechanism and detailed cabin exceed that initial
triangle/draw estimate. The release's explicit revised ceilings and measured
costs are recorded in [ROADSTER_ROCKET_UPDATE.md](ROADSTER_ROCKET_UPDATE.md);
the earlier estimate is retained here as planning history, not represented as met.
