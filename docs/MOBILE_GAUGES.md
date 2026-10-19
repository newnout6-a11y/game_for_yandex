# Mobile shared-energy gauges and distance rail

The mobile landscape racing HUD removes its redundant upper energy and mission blocks. Desktop indicators remain unchanged.

Nitro fills orange and flight fills light blue, from bottom to top inside the existing button circles. Both are two views of the same `Game.state.nitro` reserve, not independent tanks. Boost/flight drain, pickups, empty-reserve gating and control ownership are unchanged. Their common accessible description identifies the shared resource. Original vector icons retain a dark understroke for readability over an empty or full circle.

The narrow rail sits at the safe top edge, outside the lower HUD box and between the logo and utility controls. Its original car follows actual distance divided by `CONFIG.goal` (currently 1500 metres). The flag denotes that distance milestone, not an invented race ending. At and beyond the goal the car remains at the flag, the accessible description says the run continues, and the existing one-shot goal event/reward remains owned by the simulation.

Only bounded CSS interpolation follows state changes. There is no looping water animation, particle effect, timer or extra WebGL pass. Interpolation is disabled while paused and for reduced-motion preferences. Values are finite/clamped for presentation only and never mutate game state.

Verification combines pure and actual UI/Game tests, accessible markup/layout contracts, and `node scripts/mobile-gauges-qa.mjs`: actual GLB/WebGL frames at reconstructed phone iframe sizes, empty/half/full fill, start/mid/completed goal, cockpit, actual pixel bounds, and pause/reduced-motion behavior. Software-rendered captures are not claims of physical Android FPS, latency, heat or battery performance.
