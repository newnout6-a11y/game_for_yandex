# Garage television: supplied Tesla stunt film

The selected screen content is the full user-supplied **The Kickflip | Roadster**,
credited to Tesla. Reference: https://www.youtube.com/watch?v=r5vsHHPVhJg.
It is third-party footage, not a render of the game and not a proof of its physics.
No affiliation, endorsement or commercial redistribution license is asserted.
The original input remains in the user's supplied-file record, not duplicated
as an extra runtime download.

## Runtime outputs

- `public/assets/garage/roadster-screen-loop.mp4`: 1,707,750 bytes, H.264 Main,
  640×360, yuv420p, 24000/1001 fps, 1,052 frames, 43.877167 seconds, no audio.
- `public/assets/garage/roadster-screen-poster.jpg`: 20,303 bytes, 640×360,
  extracted at 14.2 seconds; embedded in each editable room and its GLB.
- `supplied-video-provenance.json`: input/output hashes, timing and exact operations.

Every decoded video frame is preserved. There is no video re-encoding, cropping,
resizing, retiming or temporal trim. Audio alone is removed and the MP4 `moov`
atom is relocated ahead of `mdat` for progressive playback. The input's longer
43.932154-second container includes an audio tail; no video frame is dropped.
The runtime loops from the original final frame back to the original opening.
It does not manufacture a seamless transition or remove production cables.

## Reproduce from the explicitly supplied file

Requires Python 3, ffmpeg and ffprobe, with no remote fetching or extra packages:

    python scripts/import_garage_screen.py --input /path/to/supplied.mp4 --poster-time 14.2

The importer decodes source and output to checksums and requires identical
1,052-frame sequences. The garage generator's poster-only update synchronizes
all four Blender projects and GLBs without changing their meshes, transforms,
UVs or material shaders; see the parent garage README for its exact command.

## Playback and verification

One muted inline decoder is shared by the four cached rooms. Visibility,
background/platform/ad/orientation pause, settings, reduced motion and disposal
are controlled by `src/garage-screen-player.js`. Scene refresh requests are
bounded at 12 Hz; the encoded file retains its original frame rate. Hidden TVs
do not play; reduced motion or failure shows the packed poster. No remote
iframe, live stream, advertisement network or audio is used.

    node --test tests/garage-screen-media.test.mjs tests/garage-screen-player.test.mjs

The tests check MP4 structure, dimensions, complete frame count, full duration,
absence of audio, output hashes and bounded playback lifecycle. Native garage
QA additionally checks real decoding, both sides of the loop, mobile landscape,
portrait blocking and independent pause reasons. Software-rendered captures
are not a real-device FPS benchmark.
