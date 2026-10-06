# EVA surface and exhibition lighting

## Integration

Call `applySurfaceDetail(THREE, scene, { maxAnisotropy })` after adding the EVA and hangar. It visits only standard/physical materials carrying an explicit `userData.surfaceRole`. The returned `{ stats, dispose }` reports the installed resources and restores prior materials and geometry attributes on disposal.

`createHangarEnvironment(THREE)` returns a temporary `THREE.Scene` suitable for `runtime.createEnvironment(source)`. Dispose the source after the PMREM bake. The renderer runtime owns the resulting environment render target. The reflection source contains ordinary meshes and basic materials, so both renderers can bake it.

The lighting contract remains `lightRig.update(time, activation, mode, dt, motionAllowed)`. `lightRig.isSettled(mode, activation)` allows the application to stop requesting frames. Passing `motionAllowed = false` applies the final state immediately. Alarm is a steady preset; none of its intensities pulse as a function of time.

## Material hierarchy

| Finish | Applied to | Surface response |
| --- | --- | --- |
| Paint | Amethyst armor, plum shadow coat, violet undercuts, lime plates, orange collar, mandible | Mostly dielectric diffuse coating, a restrained protective clearcoat, broad roughness variation and very shallow orange peel |
| Cast | Pectoral carbon alloy and exposed gunmetal | Rougher, slightly irregular specular response with fine casting texture |
| Machined | Titanium rods, blackened fasteners and crimson metal ports | Cleaner reflection and interrupted axial machining bands; much shallower bump than castings |
| Elastomer | Graphite understructure, seals and oxide-colored gaskets | High roughness, little metal response, fine molded texture |

The original paint colors, silhouette, articulation and rigid mesh batches remain. The emissive optical lenses keep their original clean surfaces. Hangar materials retain their authored wall runoff, floor wear and contact maps.

The old 128-pixel grain texture reused one repeat factor across normalized shell UVs and metre-based extrusions. The new detail channel derives a physical scale from the surface tangents of each connected UV chart. Hard box faces stay separate; smooth curved joins remain continuous. The original UV channel is not edited, so stencils and other authored maps retain their placement.

## Causal, restrained wear

The detail bake estimates convex or concave curvature at coincident geometry vertices, weighting adjacent faces by corner angle so cap subdivision does not change the result. Exposed convex edges receive interrupted clearcoat polish. Concave folds receive a small retained deposit tint and indirect occlusion. The interruption is fixed in the object, not generated in screen space or from frame time.

This is a modest geometry-based wear approximation. It does not simulate metal loss, remove paint, ray-trace ambient occlusion, or infer contact between disconnected components. Existing physical recesses and the single shadowed key provide the main depth and contact cues. The added indirect occlusion is deliberately weak and does not blacken direct light.

The coating field combines broad, middle and fine periodic variation. Microdetail lives mostly in roughness and shallow bump rather than strongly varying the base color. Metal machining has a directional field, while paint and seals remain less directional. No whole-screen noise or material animation is used.

## Filtering and renderer compatibility

Scalar maps use `NoColorSpace`, `LinearMipmapLinearFilter`, generated mipmaps and capped anisotropy. Paint uses 512-square maps; the other three finishes use 256-square maps. The scalar response ramps use 64-square maps. Browser builds upload CanvasTextures; the deterministic headless path uploads equivalent DataTextures. Their explicit `flipY = false` convention is the same.

UV channel 1 carries physical surface detail. UV channel 2 carries the geometric response coordinates. All sampling uses stock `MeshStandardMaterial` and `MeshPhysicalMaterial` properties. There is no `onBeforeCompile`, shader string replacement, or GLSL-only material path.

Three 0.186.1 reads `clearcoatRoughnessMap.r` in its node material path and `.g` in its WebGL shader path. The polish ramp is therefore a separate grayscale texture with equal RGB values. Packing polish and occlusion into different channels of the same image would create a renderer-dependent appearance, so this implementation intentionally spends one additional tiny texture to preserve parity.

## Lighting and reflection decisions

The light rig retains six lights and exactly one shadow caster. The key still enters from the exhibition opening. Fill and bounce directions correspond to the visible side and upper rear fixtures. The rim is restrained to keep the violet armor readable without bleaching the green enclosure. The original shadow bias is retained to preserve its validated placement. Contact comes from authored interfaces and the shadow silhouette. Fine-detail antialiasing belongs to the renderer; it is not corrected by changing lighting or shadow bias.

The reflection source matches the muted green enclosure and crimson floor. Elongated HDR cards approximate the visible fixture diffusers and the exhibition key. Cards include a small illuminated area around the tiny physical lamps so their shape survives the mobile PMREM resolution. This is a compact image-based lighting proxy rather than a reflection capture of the complete animated hangar. It is baked once and contributes no meshes to the displayed scene.

Exposure and tone mapping belong to the renderer runtime and are not changed by these modules.

## Cost and verification

Measured on the current EVA before the optional stencil is created in a browser:

| Resource | Amount |
| --- | ---: |
| Affected meshes | 32 |
| Shared affected materials | 16 |
| New texture objects | 10 |
| Added render draw calls | 0 |
| RGBA8 texels including complete mip chains | 4,937,032 bytes / 4.71 MiB |
| Added UV and color arrays | 7,739,256 bytes / 7.38 MiB |
| Texture/chart bake in one local Node run | Approximately 415 ms |

Texture bytes are the RGBA8 texel storage calculation; browser canvases, transient bake data, driver metadata and the separately owned PMREM target are not included. CPU duration is a local measurement, not a mobile performance guarantee. The additional attributes trade a few MiB of stable geometry data for correct scale and wear without extra per-frame geometry work or draw calls.

### Lower-cost antialiasing limit

The performance profile can break the hangar's very thin access-plate edges, fasteners and grating into visible stippling at the software renderer's 0.78 pixel ratio. A controlled browser comparison kept the camera and pixel ratio fixed: the pattern persisted with shadows disabled, hangar bump maps removed, and the near plane raised from 0.1 to 1. The same scene was clean when the balanced profile selected supported MSAA 4×. The artifact is therefore treated as a limitation of the lower-cost single-sample/FXAA path with subpixel mechanical detail, not as surface wear or shadow acne. The higher-quality path preserves the intended panel lines. Lighting, texture detail and shadow bias are not altered to conceal this tradeoff, and the third-party FXAA shader is unchanged.

`node --test tests/surface.test.mjs` checks deterministic bounded fields, physical UV scale, preservation of original geometry and optics, filtering and color space, the Canvas/Data texture conventions, finite attributes on the full EVA, restoration/disposal, steady reduced-motion lighting, and disposal of the reflection source. The tests establish data and lifecycle behavior; integrated browser screenshots are still required to judge highlights, shadow bias and visual balance.
