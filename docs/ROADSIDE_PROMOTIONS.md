# Roadster roadside promotions

## Implemented scope

Three original, non-interactive roadside billboards are recycled through the same
800 m interval as the landscape. They show **Roadster**, its garage, and its
driving/flight motifs. No real advertisers, invented sponsorships, social handles,
URLs, QR codes, external ad networks, tracking, click targets, or navigation are
included. This is scenery and configurable first-party promotional artwork, not a
paid advertising integration and not a Yandex 3D-ad format.

The 8.4 × 3.8 m metal panels use muted forest, lake, sand, and copper colors.
Steel posts and concrete footings follow the terrain individually. The complete
structure, including panel width and foundation corners, stays outside the road's
±8.2 m edge; tests check a further 1.5 m margin through a full curvature cycle.
The boards do not occupy the HUD, blink, animate, glow, block input, or add shadow
passes. Artwork is rendered once to a canvas texture, with mipmaps for distance.

## Integration

```js
import { createRoadsidePromos } from './roadside-promos.js';

// After the scene/landscape has been created:
this.roadsidePromos = createRoadsidePromos(this.scene, { bend: roadBend });

// Alongside the scenery's distance update (the identical distance and route):
this.roadsidePromos.update(distance, this.route);

// When this renderer is destroyed:
this.roadsidePromos.dispose();
```

The factory returns `group`, `boards`, `posters`, `update`, and `dispose`.
`boards` is diagnostic data, not a click registry. Do not mutate its seeds or
transform ownership. A repeated distance does no transform work. Invalid/nonfinite
distances are ignored. Unknown routes use the normal metal palette. Disposal is
idempotent, detaches the group, releases every owned resource exactly once, and
makes later updates no-ops.

The default uses 3 boards, 21 meshes, 5 shared geometries, 5 materials, and 3
1024 × 448 textures. There are no per-frame GPU allocations and no network calls.

## Supplying your own posters

Pass `posters` to the factory. Up to three records are accepted; fewer records are
reused across the three boards. An empty/invalid collection restores the defaults.

```js
const roadsidePromos = createRoadsidePromos(scene, {
  bend: roadBend,
  posters: [{
    id: 'my-own-game',
    title: 'Название своей игры',
    subtitle: 'Короткая подпись',
    kicker: 'НАША ИГРА',
    motif: 'road', // road | workshop | flight
    background: '#173b40',
    accent: '#d8b768',
    ink: '#f4efdf',
    // Optional already-decoded, authorized local/SDK cover image:
    // artwork: decodedCoverImage,
  }],
});
```

All copy is rendered as plain canvas text, never HTML. Text lengths are bounded;
URLs and `@` handles are rejected in text fields, and colors must be six-digit hex.
URL/callback fields are ignored. This is not a comprehensive content-moderation
system: the developer still owns the compliance and rights review of custom copy
and artwork. Local-only artwork is the default.

`artwork` can be a caller-supplied, already-decoded `CanvasImageSource`. The renderer
bakes one still image into a reserved cover window; it does not download the
source, create a video texture, poll an ad server, or retain ownership of the source.
Malformed or unavailable artwork falls back to the original roadster silhouette.
Use owned assets or properly authorized images. If adding another own Yandex game
later, use verified GamesAPI metadata and an appropriately loaded/CORS-safe SDK
cover; do not turn this field into an arbitrary external-ad URL loader.

Changing poster records after creation is intentionally not a per-frame API.
Dispose/recreate at a safe menu transition if the selected owned-game campaign
changes. Do not rebuild textures during driving.

## Platform boundaries

Checked against official documentation on 2026-10-18:

- [Yandex Games SDK: links to other games](https://yandex.ru/dev/games/doc/ru/sdk/sdk-other-games)
  provides `ysdk.features.GamesAPI.getAllGames()` and `getGameByID(appID)` for the
  developer's own games available on the current platform/domain. Returned metadata
  includes `title`, `url`, `coverURL`, and `iconURL`; `getGameByID` also supplies
  `isAvailable` and may return no game.
- [Requirement 8.4.1](https://yandex.ru/dev/games/doc/ru/requirements/8/4/1)
  requires links to own games to come through the SDK. Navigation must clearly say
  where it goes, be available only outside active gameplay, and preserve the current
  game tab.

Consequently these roadside boards remain **non-clickable during driving**. A
future cross-promotion menu must use current SDK-returned game metadata, handle
unavailability, and open an explicitly selected game in a separate tab only outside
active gameplay. No such navigation is implemented here.

No verified social community or game IDs were supplied. Social promotion is
disabled rather than substituting a personal profile or guessed handle.
[Requirements 8.4.2–8.4.4](https://yandex.ru/dev/games/doc/ru/concepts/requirements)
permit a social-community exception only for a public community about this
developer's Yandex Games titles, with “Яндекс Игры” in its name, and no external
links or unrelated content inside it. Other external-resource links, including
links embedded in graphics, and prompts to find an external resource are restricted.
Review the actual destination before adding anything; a generic studio channel is
not automatically eligible.

[Requirements 1.16, 4.1, and 4.6](https://yandex.ru/dev/games/doc/ru/concepts/requirements)
prohibit third-party advertising, including static advertising text/images, and
custom RTB banners. SDK ad blocks may not be modified or imitated. Therefore do not
paste paid external ads or SDK ad creatives onto these textures. No public 3D
billboard-ad API was established by this review.

This implementation does not alter SDK-managed interstitial/rewarded advertising.
Static first-party roadside artwork is a design choice, not special platform
approval of a 3D promotion format. Submission/moderation and future destinations
remain a separate review step; nothing is published by this change.

## Verification

```sh
node --test tests/roadside-promos.test.mjs
```

Coverage: bounded counts; no hit targets; shared resources; curved-road transforms;
negative/large-distance wrapping; full-geometry road clearance; individual footing
elevation; route tint fallback; invalid input; owned poster configuration; caller
artwork ownership; and complete, idempotent disposal.

Browser visual QA should also check the first board approaching from the chase and
cockpit cameras, close pass-by, the lake-side sightline, and distant mip/fog blending.
