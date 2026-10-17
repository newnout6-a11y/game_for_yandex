# Daylight, underbody and vapor artwork revision

This revision changes presentation, not successful flight controls or game rules. `src/flight.js`, `src/game.js`, `src/input.js` and `src/landscape.js` remain byte-identical to the previous realism release.

## Lighting and readability

The former full-width HUD and header gradients darkened the mountains and sky independently of the actual scene lights. They are removed during gameplay. Compact local translucent backing protects text and controls; the speed gauge itself remains transparent. Menu shading is retained.

The original clear-sky panorama now also supplies the car's roughness-prefiltered environment reflections. Previously the visible blue sky and a separate brown overcast HDR disagreed. A neutral daylight directional key and sky/road hemisphere fill now work together; ACES exposure is adjusted moderately from 0.72 to 0.84, rather than trying to fix shadows by blowing out highlights. Contact shadows are less opaque and still stay on the road during flight.

There is still only one directional shadow light. PMREM is generated once during loading, from a 1024×512 derivative of the existing panorama, keeping the normal 256px cube budget. The temporary input texture is disposed. The obsolete HDR is no longer downloaded by the game, but remains in the source assets with its original attribution. No dynamic environment/reflection pass, post-processing blur or screen-wide color filter is added.

## Underbody

The prior plain bottom slab is replaced by original modeled battery shielding, rails, subframes, suspension links, routing and nozzle collars. Authored matte-composite and satin-metal materials are retained separately from silver exterior paint. Existing wheel pivots, nozzle sockets and the normalized 4.7 m vehicle length are preserved.

This is an artist's plausible EV-inspired interpretation for the game, not Tesla CAD or a claim that unseen manufacturer engineering has been reconstructed accurately.

## Vapor artwork

Eight original Blender Cycles volume renders are packed into a 1024×512 transparent RGBA atlas. The editable Blender scene, procedural generator and atlas packer are included. The runtime uses filtered billboard particles with actual irregular volumetric shading, not cone meshes or a purchased stock smoke image. Rendering remains bounded and uses the existing takeoff/hover/soft-landing thrust state; physics is not retuned to make a screenshot.

This is pre-rendered volume artwork used in particles, not live computational fluid dynamics. The 600,548-byte PNG occupies about 2 MiB decoded RGBA on the GPU, without mipmaps. Two atlas samples per particle fragment blend variants; translucent overdraw is a real cost. The effect remains one batch capped at 160 desktop / 112 compact particles, including eight reserved soft near-nozzle pressure billboards. These connect the gas stream to the billowing atlas puffs; broader particles deflect outward along the road at touchdown. Main support cores attenuate as the car rotates away from upright.

## Verification method

Matched ground, roll and flare captures use the same viewport, input sequence and initial safe traffic fixture as the preceding release. The supplemental underbody view uses a temporary inspection camera, not a new selectable game camera. Controlled-time browser captures are visual/functional evidence, not hardware FPS measurements. Physical-device frame pacing, Safari/WebKit and live Yandex integration remain unmeasured.

## Primary technical references

- Three.js light types and combining hemisphere fill with directional light: https://threejs.org/manual/pages/lights.html
- Three.js roughness-prefiltered image-based lighting and input-size guidance: https://threejs.org/docs/pages/PMREMGenerator.html
- Three.js linear/sRGB workflow: https://threejs.org/manual/pages/color-management.html

No third-party smoke bitmap or manufacturer underside mesh is copied. No GitHub push or Yandex publication is performed.

## Matched cost and tests

At the same 125 m road position, three vehicles, camera, viewport and pixel budgets, grounded submitted draw calls including shadows rise from 204 to 208. Triangles rise from 235,782 to 249,782 (+14,000 submitted, about 5.9%) because the additional 7,000 model triangles are also submitted to the existing shadow pass. The car grows from 25 to 27 mesh primitives, 34,744 to 41,744 triangles and 1,365,540 GLB bytes. This is an explicit quality cost, not a performance gain claim. The daylight setup itself adds no per-frame light or shadow pass and removes the old HDR load.

Render buffers remain 1440×900 desktop and 585×1266 for the 390×844 DPR2 mobile profile. MSAA remains enabled and preserveDrawingBuffer remains false. Raw matched counters are in `docs/daylight-metrics/`. The scene illumination is intentionally changed in this comparison.

Final checks: `npm test` passes 95/95; `npm run check` verifies 20 JavaScript modules with 0 errors. Actual keyboard/touch scenarios reach 3.3 m, complete the paid roll upright, maintain descent thrust and land at 0 m. The atlas reports decoded before gameplay. Desktop and mobile captures plus 844×390, 480×320 and 280×640 layout checks have no JavaScript/shader errors, horizontal overflow or offscreen controls. Raw input/scenario results are in `docs/daylight-metrics/flight-inputs.json`.

An intermittent black sky seen only in the capture harness was traced to its CPU-only renderer stub suppressing Three.js's internal first-use cubemap conversion. The harness now warms real GPU resources and restores the real render entry point during captures. Fresh desktop and mobile images were visually checked after that correction; no production lighting workaround was introduced.
