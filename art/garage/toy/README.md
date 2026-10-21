# Lightning McQueen diecast-style physical toy

A reference-based Blender garage prop depicting the requested red Lightning McQueen toy. This is actual geometry: a rounded U nose and raised fender shoulders, compact volumetric tyres, recessed red rims with real oval through-openings, shaped windshield eyes, three-bar rear glazing, and a rounded raked spoiler blade. The 95/Rust-eze/flame graphics conform to the receiving mesh; they are not a photograph billboard.

Our work is the authored mesh and editable vector recreation. The Lightning McQueen character, Disney/Pixar Cars identity and recreated fictional branding are third-party subject matter. Commercial rights are unverified. No commercial license, affiliation, endorsement or redistribution rights are asserted. User and web reference photos are not included in this source tree.

- Editable source: `toy-racecar.blend`, 49 semantically named parts, packed 2048 × 2048 marking atlas and 1024 × 512 opaque windshield paint, separate native preview studio.
- Editable windshield source: `windshield-paint.svg`, `windshield-paint.png`, `windshield-paint.json`. Exact vector outline, brow, irises, pupils and catchlights are painted directly into the unchanged opaque canopy. Ten stacked face-art pieces were removed to avoid genuine micro-crossings and distant depth-buffer fragmentation.
- Editable decal source: `mcqueen-decals.svg`, `mcqueen-decals.png`, `mcqueen-decals.json`. SVG lettering is paths, with no external font or photograph.
- Runtime: `public/assets/garage/toy-racecar.glb`, 40,698 triangles, 1,855,108 bytes, 8 shared material batches, two embedded PNGs: 1024 × 1024 markings and 512 × 256 windshield paint, no cameras/lights.
- Bounded budget: at most 42,000 triangles / 2,000,000 bytes / 8 material batches / two runtime textures. The rejected former production toy had 17,596 triangles / 807,796 bytes / 7 batches. The increase preserves clean arches, physical rim openings and conforming print surfaces rather than disguising these details with textures.
- Runtime texture allocation: 6,291,456 bytes, exactly 6 MiB, for RGBA8 plus all mip levels. Compressed PNG transfer size is separate. The larger packed editable textures are not sent to the runtime. The windshield texture adds 699,052 bytes of RGBA8+mips, approximately 0.67 MiB. Material batches are not a claim about total renderer submissions.
- Finish: red base `#d60918`, metalness 0, roughness .17, clearcoat .65 and coat roughness .13; black tyres roughness .49. No noise/bump/grain shader or wear texture.
- Rebuild from any working directory: `blender -t 4 -b --python-exit-code 1 --python /path/to/source/scripts/create_garage_toy.py`. Add `--render` for native preview renders.
- Safe isolated validation: add `--candidate`, writing to `output/mcqueen-diecast-validation` without changing canonical assets. Add `--quick-preview` only with `--render` for one lower-resolution front preview.
- Focused checks: `node --test tests/garage-toy-asset.test.mjs tests/garage-toy-profile.test.mjs`. For an isolated rebuild, set `TOY_ASSET_DIR=output/mcqueen-diecast-validation`.
- Game axes: +Y up, −Z nose, metres. Size approximately 1.305m long × .657m wide × .428m high. Blender source is packed and portable, with no task-specific absolute image/font paths.
- Placement: `[-2.95, -.007, 4.8]`, yaw `.20` radians. Local tyre bottom is +.003m; actual room floor top −.005m gives 1mm clearance. A 50mm horizontal shift from the earlier center avoids the actual floor expansion gasket; the lower tyre footprint is checked against room gasket triangles. Existing room/main/parked vehicle footprints remain unchanged.

Actual exported bounds, counts and hashes are in `asset-report.json`. Room and floor checks are in `placement-audit.json`. Exact retained geometry parity is in `receiver-parity-proof.json`; SDNA image-field zero-after-NUL validation is in `path-string-tail-proof.json` and can be repeated with `python art/garage/toy/verify_path_string_tails.py`. Earlier camera tests used a larger containing envelope; distinguish those from final runtime integration tests.

Native reference previews use Blender Cycles with neutral white area lights, AgX Medium High Contrast, exposure −.6, gamma 1 and no white-balance adjustment. This Blender build has no OpenImageDenoise support: evidence images are native sampled output, not denoised or post-blurred. Bright clearcoat reflections and tone mapping can make displayed red lighter than the base-color value. The preview is not a runtime ACES color-match proof.

No player vehicle, existing room, runtime UI or lighting code is modified by this generator. Final user visual acceptance and external publication are separate from local integration.
