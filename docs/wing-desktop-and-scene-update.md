# Rear-wing seating and shared driving HUD

## Authored rear-wing correction

The stowed Rocket wing had a constant-width trailing edge while the rear
quarters narrow toward the bumper. The blade cap and hinge therefore extended
about 49 mm past the local upper quarter at the aft end. The folding direction
was already correct.

The blade, cap, fence, slanted hinge, pedestals and pocket cutter now share a
tapered authored planform. The cap uses its whole polygon's signed area when
orienting the inward 4 mm wall. Runtime deployment still uses the same rigid
translation and rotation, with no hidden parts or animated scaling. Lift travel,
blade pitch, flight rules and collision simulation are unchanged.

The exact exported stowed geometry is inside the actual quarter by at least
7.5 mm at the critical aft hinge and 12.2 mm at the blade/cap. Tests check actual
indexed cross-sections on both sides, plus the existing sampled deployment,
sleeve and body-clearance checks. This is a reconstructed art mechanism, not
manufacturer CAD or a continuous mechanical-clearance certification.

The original measured collision compound and its historical mesh survey remain
unchanged. Indexed triangles of the revised rear body/wing are clipped against
the two original rear longitudinal bands at nine deployment poses and remain
inside the existing proxies. This sampled containment check and the explicit
old-to-new art chain replace the obsolete whole-file "unchanged model" assertion;
they do not alter collision behavior or claim continuous mesh-level contact.

Only 25 of 775 editable meshes change, confined to the wing, its pocket and
adjoining rear returns. All 61 unaffected runtime mesh batches, materials and
texture content are preserved. The historical tablet-artwork provenance remains
historical; a separate wing-revision proof links its output to this later
intentional geometry change instead of pretending the whole model is unchanged.

## Desktop presentation

The accepted lightweight driving design is no longer restricted to touch input:

- The obsolete flight/roll status panel, separate energy widget, wide goal card
  and top sound/help buttons are absent while driving.
- Sound and Help remain reachable through Pause.
- The top route rail uses the actual selected model and paint. Its target remains
  the existing distance milestone, not a fabricated end to endless driving.
- Nitro and flight display the same real shared reserve, orange and light blue.
  Desktop keeps keyboard hints and independent ability actions without showing
  touch steering or pedals on a mouse-only device.
- Speed, score, camera, fullscreen, pause, keyboard bindings, bonus accessibility
  announcements and real flight/roll actions remain.

The existing model snapshot cache and no-op HUD DOM guards remain in use.
No per-frame miniature renderer or new input ownership policy is introduced.
Mobile layout rules remain unchanged and desktop rules are separately scoped.

## Scene CPU work

Traffic-driver IK now refreshes its world matrices explicitly once before using
fresh matrix values, instead of repeatedly refreshing unchanged ancestors through
Object3D getters. Static authored mesh-local transforms are composed once;
vehicle roots, suspension, wheels, trailer and animated driver joints remain
dynamic.

Independent all-eight-kind animation traces compare 8,064,000 world-matrix
components over 1,200 frames and 12 reset/pool cycles exactly, including translated,
rotated and scaled parents. The measured eight-car local-matrix composition
count falls from 1,520 to 426. This is redundant CPU-work removal, not a reduction
in model detail, simulation frequency or rendered frames. Cloud microbenchmarks
are not handset temperature or whole-game FPS measurements.

## Rejected experiments

Neither experimental physics bitmask caching nor the zero-intensity spotlight
shader guard is included. The former regressed the representative full-game CPU
trace despite a favorable microbenchmark. The latter matched all 41 sampled
native main/mirror RGBA pairs but did not establish a timing benefit: the noisy
software-ANGLE main-view medians were 2.7→2.9, 2.2→2.4 and 1.8→2.0 ms.
Pixel equality alone is not a reason to ship an optimization. GPU scene culling
and shader behavior are unchanged; no whole-game GPU or thermal gain is claimed.


## Safe authoring rebuild (2026-10-21)

Rebuilding `scripts/create_roadster.py` requires Blender **4.3.x, 64-bit little-endian**.
The packed-image metadata parser deliberately supports only that file layout.
Unsupported versions fail before creating preview directories, clearing the scene,
or writing source assets. The editable source is saved uncompressed to a temporary
sibling file, sanitized and validated, then atomically replaces `art/roadster.blend`.
A failed save or sanitizer leaves the previous source intact and removes the temporary file.
The source safety correction changes authoring code and 432 unused Image.name padding
bytes in the existing Blender source. Geometry, materials, textures and GLB are untouched;
no model regeneration is claimed. The separate desktop ready-outline correction changes CSS only.

The metadata sanitizer covers both `ImagePackedFile.filepath` and the SDNA
`Image.name` array backing `Image.filepath`. It rejects known private absolute
path markers in the saved source before atomic replacement. The second field was
verified with a native Blender long-path-to-relative-path negative control.

Desktop ability controls retain a distinct ready-state outline, separate from active
and disabled states. The entire old flight-status panel remains intentionally hidden,
as specifically requested for mobile and then desktop; it must not be restored as a
new compact panel. Existing buttons, reserve fills, keyboard keys and accessible
announcements remain. This is an intentional visual simplification, not a missing
telemetry feature to reintroduce during code review.

Desktop Space always reaches the global nitro shortcut even when a flight/roll
control owns keyboard focus. Enter remains focused-control activation. Mobile
focused-control Space behavior and all pointer/touch ownership are unchanged.
