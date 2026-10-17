# Alpine sky and distant background update

## Included

- Three surrounding mountain ranges replace the old finite strips. The horizon now continues into wide and side views without a visible cut-off.
- Connected irregular shoulders, summit notches, gullies, directional rock/snow shading and layered aerial perspective add depth. This is an original stylized alpine landscape, not a reproduction of a specific mountain.
- The existing 2048×1024 sky is replaced with an original procedurally generated cloud panorama. It is built once and mip-filtered, with no volumetric raymarching or per-frame cloud render pass.
- The accepted lake shader/normal-map functions are byte-for-byte unchanged. Car materials, game controls, physics and viewport pixel budgets are unchanged.

## Matched-scene checks

The comparison uses the same 125 m road position, camera, traffic, lighting, viewport and DPR. The clean scenery view is a fixed inspection camera, not a newly added gameplay camera.

Full submitted calls including shadows stay at 204; renderer texture objects remain 18. Submitted triangles increase from 203,186 to 237,026 (+33,840, approximately 16.7%) for the complete horizon and mountain detail. The extra geometry is real work, not a zero-cost effect. Existing drawing-buffer budgets and batching remain in place. Raw measurements are in `docs/background-metrics/`.

74 unit tests cover the prior car/traffic/hover/water work plus horizon coverage, finite background attributes, bounded geometry, sky mipmaps/wrapping and stable background buffers across long drives and route changes. The 18-module code/assets/style check and production build pass. Matched desktop and emulated-touch captures check JavaScript and WebGL shader errors.

Timing values in the raw diagnostic files are local scripted measurements, not hardware FPS. Real phones, Safari/WebKit and live Yandex SDK/ad behavior remain release checks. No GitHub push or Yandex publication was performed.

## Internet references

Used as visual and technical study only; no photographs, sky textures or mountain meshes were copied into the game.

- Switzerland Tourism, Lake Oeschinen: alpine basin, snowy rock faces and atmospheric layering. https://www.myswitzerland.com/en-ca/destinations/lake-oeschinen/
- Official Seiser Alm destination site: varied Dolomite silhouettes, rock forms and foothill separation. https://www.seiseralm.it/en/dolomite-villages/holiday-villages/seiser-alm.html
- Three.js Sky documentation and example: sky color and atmospheric rendering concepts. https://threejs.org/docs/pages/Sky.html and https://threejs.org/examples/webgl_shaders_sky.html
