# Platform crew animation

## Scope and visual intent

The three approximately 0.61-display-metre figures remain on the original bridge at deck height `3.607`, with their original positions and headings. They perform three distinct maintenance jobs. Their work establishes scale and readiness around the EVA without moving the bridge, walking off its narrow deck, or competing with the main subject.

| Figure | Placement `(x, z)` | Work at rest | Response to EVA activation |
| --- | --- | --- | --- |
| Coordinator | `(-0.73, 0.34)` | Watches the EVA, raises a clearance signal, briefly checks the work area | Turns the upper body toward the EVA and holds an elevated clearance gesture |
| Engineer | `(-0.10, 0.31)` | Supports a tablet, reads, taps three times, looks up to check the EVA | Lowers the tablet slightly, stops the tapping sequence, looks up |
| Technician | `(0.66, 0.37)` | Raises a handheld instrument, reads and adjusts its display, shifts weight | Keeps the instrument in hand and redirects attention to the EVA |

The palette clones the hangar's two archival crew finishes and gives them pale workwear colors (`#98a28f` and `#d2d6c7`) so the figures remain distinguishable against the purple armor at the initial display scale. A narrow identification band wraps the jackets and remains visible from behind. The technician's lighter jacket and engineer's hard hat distinguish the jobs even when motion is paused. The figures share geometry; differences in work, clothing-material assignment, props and timing keep them from moving as clones.

## Runtime contract

`src/crew.js` exports `createCrew(THREE, { materials, deckY })`, `sampleCrewPose(role, seconds, readiness, out)` and `solveTwoBoneIK(...)`. `src/hangar.js` constructs the crew once, adds it to the existing structure, and forwards its existing update call.

```js
hangar.update(appTimeSeconds, deltaSeconds, {
  activation: 0,       // Normalized EVA presentation state, 0..1.
  paused: false,
  reducedMotion: false,
  power: true,
});

hangar.crew.rigs;      // Three rigs, bones, held props and diagnostic joint angles.
hangar.crew.stats;     // Resource counts, internal active time, readiness values.
hangar.workers;        // The three fixed-position root groups.
```

The application owns scheduling. There is no animation mixer, extra `requestAnimationFrame`, interval, timeout, network model fetch or worker clock. The crew accumulates the caller's finite, non-negative delta, capped at `0.1` seconds. This prevents a long background interval from becoming a jump in the work cycle. Repeated identical clock timestamps do not advance ambient motion. All choreography uses seconds and bounded analytical curves.

`paused: true` or `power: false` preserves the current pose and readiness. Resume continues from that pose and active time. `reducedMotion: true` selects a static canonical work pose and resolves activation directly, without ambient cycles. The module obeys the flag it receives; the application can explicitly opt the user back into scene motion through its Resume control and pass `false`. It does not independently read or override the operating-system preference.

The hangar's existing dust and utility-light cycles honor the same state contract. Dust position and rotation stop while paused, reduced or powered down. Utility-light intensity stops while paused; reduced motion uses a constant intensity, and power-off selects the existing lower intensity. Dust visibility remains controlled by the application and the inspection mode.

## Articulation, contact and time

Each person has a 19-bone skeleton: pelvis, spine, chest, neck and head; two shoulders, upper arms, forearms and hands; and two upper legs, shins and feet. Clothing has blended skin weights across elbows, knees and the torso. Overlapping joint volumes close the shoulders, elbows and wrists. The root groups never receive a sway or turning animation.

The leg solver uses the analytical two-segment construction: project a pole direction perpendicular to the hip-to-ankle axis, solve the triangle by the cosine rule, and orient each bone to the resulting knee and ankle. Ankle targets are fixed in each person's local frame. Foot orientation cancels the upstream leg and pelvis rotations, so actual boot soles remain flat on the deck during breathing, upper-body turns and the technician's weight shift. The live choreography keeps every leg target reachable. The exported solver also clamps unreachable or degenerate targets to finite results.

Arms use the same two-bone solver, with separate elbow poles and wrist rotations. Props are parented to hands, and contact targets come from their current transforms. The engineer's tapping fingertip is solved against the moving tablet display. During the technician's adjustment hold, the free fingertip meets the actual instrument display. They do not reach for disconnected points in space.

The work cycles last `12.8` seconds for the coordinator, `8.6` seconds for the engineer and `11.6` seconds for the technician. Smooth rise/hold/fall envelopes produce deliberate actions rather than a continuous whole-body oscillation. Low-amplitude breathing and counterbalanced weight shifts provide the quieter intervals.

Activation blends with `1 - exp(-dt / tau)`, using time constants of `1.05`, `1.21` and `1.37` seconds. Reversing activation changes the target immediately while preserving the current blend value. This is exponential easing, not a spring simulation. The crew response is a presentation of the EVA state; it does not gate activation, tracking, camera controls, or any user operation.

## Resource budget and ownership

| Resource | Count |
| --- | ---: |
| Shared skinned body geometries | 1 |
| Skinned body meshes / independent skeletons | 3 / 3 |
| Bones per skeleton | 19 |
| Geometry resources, including all props | 4 |
| Shared crew material finishes | 2 |
| Crew draw calls, excluding shadow passes | 14 |
| Crew triangles | 13,484 |

The shared body uses three finish groups; the hard hat, tablet and instrument add five draws together. The identification band adds 120 triangles across all three people and no draw calls. No geometry, material, mesh or bone is created during updates. The conservative skinned bounds include the raised clearance hand, avoiding culling changes during a gesture. `crew.dispose()` releases its geometry, cloned material and skeleton resources exactly once and removes the group. Source materials supplied by the hangar remain owned by the hangar and are not modified or disposed.

## Verification

Run `node --test tests/crew.test.mjs`. Nine tests verify the following contracts:

1. Analytical IK preserves both segment lengths and stays finite for coincident, collinear and unreachable targets.
2. All three jobs use independent articulated skeletons while sharing the same body geometry and retaining fixed root headings.
3. Skin weights sum to one. Both ankle targets and actual skinned boot-sole vertices remain fixed through 36 seconds of work and activation, within `2e-7` display metres for sole vertices. Knees and elbows stay within the specified live-pose bounds.
4. Readiness eases over time, reverses continuously, freezes when paused and remains finite after an intentionally extreme timestamp/delta interruption.
5. A received reduced-motion flag keeps the unpaused scene pose static while activation can still resolve directly.
6. Fingertip contacts follow the actual tablet and instrument surfaces within `1e-7` display metres during contact phases.
7. Geometry, material and draw counts remain constant across repeated work/activation cycles; disposal is idempotent.
8. Pure choreography samples contain each intended work action and the activation-ready state.
9. A full hangar plus EVA scene, initialized paused and using the actual initial window projection, keeps all three skinned bodies in the frustum and in front of the sculpture. The GPU bone-buffer calculation agrees with CPU skinning within `3e-7` display metres, the low-quality view retains at least 26 physical pixels of figure height, and the clothing retains its minimum diffuse reflectance without emission.

### Integrated visibility diagnosis

Browser checks in Chromium 134/WebGL2/SwiftShader used the actual application pipeline at a 1100×800 viewport, performance quality, FXAA and render pixel ratio 0.78. An apparent disappearance in the initial wide view was isolated to low visual contrast at the approximately thirty-pixel figure height. It was not a bind-matrix, skeleton, culling, geometric-occlusion or postprocessing failure: the initial pipeline and direct-render frames both contained complete figures, a close view through the pipeline showed complete bodies, and GPU skinning matched a CPU-baked silhouette. Disabling received shadows did not change this result.

The visibility correction is local to workwear colors and the jacket identification band. Scale, placement, scene lighting, skeletons and draw-call count remain the same. Application-level captures compare the corrected default view at the same camera and pixel ratio and show the three work poses at 0, 3 and 6 active seconds.

These tests and captures do not establish a native-hardware frame-rate claim or WebGPU compatibility result. Application-level verification records those capabilities and remaining performance limits separately.
