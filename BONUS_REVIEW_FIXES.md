# Live bonus preferences, narrow route rail and accessible rewards

This repair preserves the accepted mobile HUD and actual-model route marker. It does not change rewards, physics, save ownership or authored assets.

- Runtime reduced-motion preference changes propagate through the existing renderer property to active and future bonus cues. A paused cue switches to a static scale without advancing its age, source position or fade; toggling back uses the preserved age. The renderer invalidates one frame for that visual change.
- Narrow landscape iframes reserve only the space the logo actually needs. At the smallest widths the optional home logo yields to the top route rail; camera and pause retain their 44 px hit targets. The 551 px layout remains unchanged. The model still moves by real milestone progress and never implies the endless run has ended.
- A separate visually-hidden polite live region restores bonus information for screen-reader users without putting text or numbers back on the road. Ordinary passes remain silent. Its bounded queue is cleared on run/revive/activity changes and cannot replay stale announcements after pause, modal, page hide or disposal.

The repair's native QA covers narrow rail endpoints and current preference/lifecycle transitions. Software-rendered browser evidence is not a physical Android performance or screen-reader speech-output test. Existing extreme-viewport driving-control limitations are not claimed fixed by this route-rail-only change.
