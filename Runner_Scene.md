# Running Man Hero Scene — Build Spec for Claude Code

A reverse-engineered spec of the WebGL hero at the top of zuinc.com/about, written so Claude Code can rebuild the **technique** as a new page in a local repo.

> **Licensing:** zuinc's model (`female.glb`), strand data (`buffers.buf`), textures and source code are theirs. Do **not** download or copy them. Everything below is re-implemented from a description, using your own assets.

---

## Part A — What YOU do (in order)

### Step 1 — Get a rigged runner (Mixamo, ~10 min)
1. Go to https://www.mixamo.com and sign in (free Adobe account).
2. **Characters** tab → pick a slim humanoid (e.g. "X Bot" / "Y Bot" — simple topology works best for the wire effect).
3. **Animations** tab → search **"Running"** → select one → tick **In Place** ✅ (critical: the runner must not travel).
4. **Download** → Format **FBX Binary**, Skin **With Skin**, 30 fps → save as `run.fbx`.
5. *(Optional, for click-to-jump later)* Download **"Jump"** and **"Running Slide"** the same way but with Skin **Without Skin**.

### Step 2 — Convert to GLB in Blender (~10 min)
1. Install Blender (free) if needed. Open it, delete the default cube/camera/light (A → X).
2. **File → Import → FBX** → `run.fbx`.
3. In the **Dope Sheet → Action Editor**, rename the action to exactly **`Run`**. (If you imported Jump/Slide, rename those actions `Jump` and `Slide` and push each to an NLA track.)
4. **File → Export → glTF 2.0** with: Format **glTF Binary (.glb)**, Include → **Selected Objects** off, Transform → **+Y Up** on, Data → Mesh ✅, Skinning ✅, Animation ✅. Save as **`runner.glb`**.
5. Keep it under ~5 MB (in export settings, Compression → Draco is optional; if you enable it, tell Claude Code so it adds `DRACOLoader`).

### Step 3 — Get a floor normal map (~2 min)
Download any **tileable CC0 normal map** (e.g. ambientCG.com or polyhaven.com → a subtle concrete/tile texture, 1K, "NormalGL" variant). Save it as **`floor_normal.jpg`**.
*(Skip this and Claude Code will generate a procedural one.)*

### Step 4 — Put the assets in the repo
Copy `runner.glb` and `floor_normal.jpg` into your repo's static folder, e.g.
`public/assets/runner/` (Vite/Next/React) or `assets/runner/` (plain HTML). Also copy **this file** to the repo root.

### Step 5 — Run Claude Code
```bash
cd path/to/your-repo
git checkout -b runner-hero
claude
```
Paste the prompt from **Part B**.

### Step 6 — Review
1. Start the dev server Claude Code tells you about and open the new page.
2. Check: runner centered and facing camera, wires pulsing, particles trailing, streaks flying past, floor reflection, camera moves as you scroll.
3. Tune via the debug panel (`?debug` in the URL) — then tell Claude Code the values to bake in.
4. Commit when happy.

---

## Part B — Prompt to paste into Claude Code

```
Read RUNNER_SCENE.md (Part C is the technical spec). Build a new page in this repo
called "Runner" (route /runner or runner.html — match the repo's routing conventions)
with a full-viewport WebGL hero that implements the spec.

Before coding: inspect the repo (framework, bundler, routing, styling, existing nav)
and tell me your plan in a few lines. Use three.js (pin a recent version, e.g. 0.160+)
via the repo's package manager; if the repo has no bundler, use an ES-module importmap
from a pinned CDN. Assets are in the folder I copied them to (find runner.glb and
floor_normal.jpg; if floor_normal.jpg is missing, generate a procedural normal map).

Structure the code as small modules: scene.js (setup/loop), runner.js (model+wires),
particles.js, streaks.js, floor.js, cameraRig.js, post.js. Add a lil-gui debug panel
only when the URL contains ?debug. Add a link to the page in the site nav.

Build in the order of the "Build order" section, verifying each milestone runs without
console errors before moving on. Finish by running the dev server, and tell me the URL
and anything I need to tune.
```

---

## Part C — Technical spec

### C1. Overall look
- Dark scene, background **#07080b**. A **translucent red humanoid** (barely visible) runs in place toward the camera. Its body is wrapped in **hundreds of glowing wire strands** (teal/pink/ice-blue) with **light pulses traveling along them**.
- The runner **sheds particles** every 0.25 s that stream away behind it.
- **Light streaks** (thin glowing bars, pink and teal) fly past on a half-tunnel above the floor, creating warp-speed motion.
- A **glossy, blurred, normal-mapped floor reflection** whose texture scrolls backward (sells forward motion).
- Heavy **bloom**. Camera is **scroll-driven** through 4 keyframes with **handheld noise shake**. (The original does **not** use the mouse for this camera — see C8 optional.)
- HTML hero text overlays the canvas (title + subtitle, centered).

### C2. Page / layout
- `<section id="runner-hero">` height **100vh**, with centered overlay text. Canvas `position:fixed; inset:0; z-index:-1` (or absolute within the section).
- **Scroll progress** `p = clamp(scrollY / heroHeight, 0, 1)` drives the camera.
- Pause rendering when the hero is fully off-screen (IntersectionObserver).
- Clamp `dt` to ≤ 0.04 s. Global `speed = 0.8` multiplies `dt` for all scene animation.
- Pixel ratio `min(devicePixelRatio, 2)` (1.5 on mobile).

### C3. Runner body (runner.js)
- Load `runner.glb` with GLTFLoader. **Normalize** the model so its height ≈ **1.4 units**, feet at y = 0, at the origin, **facing +Z** (toward the camera's start position).
- Body material: `MeshBasicMaterial({ color: 0xff2a49, transparent: true, opacity: 0.15 })`, `renderOrder = 1`.
- `AnimationMixer`; play clip **"Run"** looping (fall back to `animations[0]`). If `Jump`/`Slide` exist, load them as `LoopOnce` with weight 0 (used only by the optional click interaction).
- Mesh `frustumCulled = false`.

### C4. Wire strands (the signature effect)
Generate strands that hug the skinned body and deform with the skeleton:

**Generation (at load, once):**
- Build a vertex adjacency graph from the body mesh index buffer.
- Create **256 strands × 128 points** (scale down to 128 strands on mobile).
- Each strand: start at a random vertex; walk to neighboring vertices for 128 steps, preferring the neighbor that best continues the current direction (add slight randomness) so strands flow smoothly across the surface. Offset each point outward along the vertex normal by ~0.005–0.01 so it sits just above the skin.
- Per point copy the source vertex's **`skinIndex` / `skinWeight`** and **normal**.
- Per point store a `color` attribute used as data, not color:
  - `x` = random phase per strand (0–1),
  - `y` = progress along strand (0 at start → 1 at end),
  - `z` = random 0/1 per strand (palette pick).
- Render as `THREE.LineSegments` (index pairs i,i+1 within each strand) using the same skeleton as the body. Easiest: create a `THREE.SkinnedMesh`-compatible object — e.g. build the geometry, then use a `ShaderMaterial` that includes three's skinning chunks (`skinning_pars_vertex`, `skinbase_vertex`, `skinnormal_vertex`, `skinning_vertex`) and bind it to the body's skeleton (`bind(skeleton, body.bindMatrix)`). Verify it deforms with the run.

**Shader behavior:**
- Uniforms: `u_time` (advanced by `dt * wireSpeed`, `wireSpeed = 1.75`), `u_emitRatio`, `u_boost`.
- A **traveling pulse** per strand: `lineLength = 0.2`; `m = mod(u_time + phase*(1+lineLength), 1+lineLength)`; brightness `t` is a smoothstep window around `progress` so a short bright segment slides along each strand.
- Base lighting `b = 0.04 + max(0, dot(viewNormal, normalize(1,1,1))) * 1.25`.
- Color = `mix(teal #2b8db2, red #ff3b59, b) * (0.65 + 3t) * mix(ice #b3c4ee, cyan #00f6ff, palettePick) * (0.75 + (0.025 + t) * u_emitRatio * 12)`.
- **Emit flash:** every **0.25 s** set `u_emitRatio = 1` (and trigger a particle emit, C5); each frame multiply it by 0.9.
- Draw wires twice: once in the main scene (opaque), and once more **after post-processing** with additive blending at `u_boost = 0.2` for an extra glow layer.

### C5. Shed particles (particles.js)
Simplified CPU version of the original GPU (ping-pong render target) system — fine for ~8k points:
- Pool of **4 generations** × N points (N ≈ min(vertexCount, 1.25 × min(screen.w, screen.h)), ~1500–2500).
- On each emit (every 0.25 s): overwrite the oldest generation with the **current skinned world positions** of N evenly sampled body vertices (use `SkinnedMesh.getVertexPosition` / `applyBoneTransform`). Set life `w = 1`. Store per-point brightness from the vertex normal and a random size factor.
- Each frame: `life -= dt`; move `z -= dt * (≈3.9 + ratio * 10)` where `ratio = smoothstep(1, ~0.45, life)` (slow at birth, accelerating backward). Optional slight curl-noise drift.
- Render as `THREE.Points`, additive blending, `depthWrite: false`, round soft sprite (`smoothstep(0.5, 0.3, length(gl_PointCoord - 0.5))`), color `mix(#2b8db2, #ff3b59, brightness)`, alpha `life * smoothstep(1, 0.9, life)`, size ≈ `12 / -mvPos.z + 4 * size³ * life`. Hide dead points.
- GPU/FBO upgrade (GPUComputationRenderer) is optional later.

### C6. Light streaks (streaks.js)
- `InstancedMesh`-style `InstancedBufferGeometry` of a unit box, **384 instances** (192 on mobile).
- Per instance: angle `a = random * π` (upper half-tunnel only); radial position `(cos a, sin a) * (innerSpace 2.5 + thickness 4 * rand)`; radius ≈ `0.02 * 1`; length `= 20 * 0.35 * (0.2 + 0.8 rand)`; speed `0.6 + 0.4 rand`; color pick 0/1.
- Vertex shader stretches the box along Z to the length and scrolls: `z = -mod(baseZ + time * speed * 30, 2*length + 20) + 1` — bars spawn near the camera and fly toward -Z, giving the impression of running forward. Clamp `y ≥ 0.01`.
- Color: `mix(mix(#2b8db2, #ff3b59, pick), white, 0.15 + viewNormal.z*0.6) * 0.75`, then fade to background #07080b with `smoothstep(-20, -15, worldZ)`.

### C7. Floor (floor.js)
- `PlaneGeometry(20, 20)` at y = 0, z = −6 (extends behind the runner), using a planar **reflection render target** (three's `Reflector` approach, half resolution, min 512 px) that renders streaks, wires, particles and body mirrored.
- **Blur** the reflection (two-pass gaussian, ~4px) for a glossy look.
- Fragment: sample the reflection with UVs **offset by the normal map** (`normal.xz * 0.02`), brighten where normals tilt, and fade to #07080b with distance (`smoothstep(18, 0, viewDepth)`).
- Normal map `floor_normal.jpg`, `RepeatWrapping`, repeat (16,16); each frame `offset.y -= 0.2667 * dt * 16` (mod 1) so the floor scrolls under the runner.
- Reflected copies can be brightened near the floor (the original boosts reflection color by `1 + smoothstep(0.5, 0, y) * 2.5`).

### C8. Camera rig (cameraRig.js)
`PerspectiveCamera(fov ~45, near 0.01, far 400)`. Look-at target `T = (0, 0.65, 0)` (scale with model height if you normalized differently).

**Scroll keyframes** (desktop values; positions are multiplied as shown):

| # | position | refOffset | weight |
|---|---|---|---|
| 0 | (0, 3.5, 4.5) × 0.7 | (−0.55, 0, 0.5) | 1 |
| 1 | (1, 1.75, 3) × 0.5 — mobile (3, 1.75, 0) × 0.5 | (0.75, 0, 0) | 3 |
| 2 | (2, 2, 0) × 0.5 — mobile (4, 2, 0) × 0.5 | (1, 0, −1) — mobile (1, 0, 0) | 1.5 |
| 3 | (1, 1, −12) × 0.5 | (−1, −2, 0) | 0 |

Thresholds are cumulative weights (0, 1, 4, 5.5). Each frame:
1. `s = p * 5.5`; find segment where `k.threshold ≤ s ≤ next.threshold`; `l = (s − k.threshold) / k.weight`.
2. `camPos = lerp(k.pos, next.pos, l)`; `camPos.x *= aspect`. `camera.position = camPos; camera.lookAt(T)`.
3. `offset = lerp(k.refOffset, next.refOffset, l)`; `offset.x *= aspect`. Build a matrix `R` = translation(camPos + offset) × rotation(camera.quaternion) — i.e. **shift the camera by the offset after aiming**, so the runner sits off-center.
4. Multiply `R` by a **handheld-shake matrix** and decompose back into the camera:
   - Fractal 1-D value noise (256 random values, smoothstep interpolation, 3 octaves, amplitude halves/frequency doubles), separate time accumulators for pos x/y/z and rot x/y/z (random start offsets).
   - Position amplitude **0.22**, frequency **4**/s; rotation amplitude **0.15** rad, frequency **1**/s, rotation scale (1,1,0) (no roll). Multiply amplitudes by 1/0.75.
5. Add micro jitter `±0.001` to camera position each frame.
- So at scroll 0 the camera looks down at the runner from the front; scrolling swings it low and to the side, then behind.
- **Optional (not in original):** small mouse look — spring-smoothed pointer (`vel += (target − cur) * 0.15; vel *= 0.8; cur += vel`), then `camera.rotateY(-0.03 * mx)`, `rotateX(0.03 * my)` after step 5. Behind a flag, default off.

### C9. Post-processing (post.js)
- `EffectComposer` → `RenderPass` → `UnrealBloomPass` (start: strength ~1.2, radius 0.1–0.4, threshold 0 — tune to match the strong neon glow) → `SMAAPass` (or `OutputPass` + MSAA render target) → final wires additive overlay (C4).
- As scroll progress goes 0.6 → 0.8 of the keyframe range, desaturate the image toward grey (custom ShaderPass with a `greyRatio` uniform).
- On mobile: lower bloom resolution, skip SMAA.

### C10. Optional interaction (original has it disabled on About)
Click toggles a one-shot **Jump** or **Slide**: crossfade weight from Run with a smoothstep around the clip midpoint (`blend 0.08` for jump, `0.2` for slide), speed scale `0.6 + 0.4 * cos(progress^0.75 * 2π)`; spawn 64 instanced box "obstacles" sweeping from z = 4 to z = −20. Skip unless asked.

### C11. Build order (verify each before continuing)
1. Page + section + canvas + renderer + loop + resize + scroll progress. Background #07080b.
2. Load runner, translucent red body, Run loop, normalized scale/orientation.
3. Camera rig: keyframes + offset + shake (test by scrolling).
4. Streaks.
5. Floor with reflection + blur + scrolling normal map.
6. Wire strand generation + skinned line shader + pulses + emit flash.
7. Particles.
8. Bloom + SMAA + desaturation + additive wire overlay.
9. Mobile reductions, off-screen pause, `prefers-reduced-motion` (freeze shake/streak speed, keep a static frame), `?debug` lil-gui (speed, wireSpeed, bloom, emit button, camera keyframe scrub).
10. Performance check: target 60 fps on a mid laptop; report draw calls (`renderer.info`).

### C12. Acceptance checklist
- [ ] No console errors; assets load with a simple loading fade-in.
- [ ] Runner loops smoothly in place facing the camera; wires move with the body.
- [ ] Pulses travel along wires; every 0.25 s a flash + new particle shell.
- [ ] Streaks and floor convey forward motion; reflection is blurred and distorted.
- [ ] Scrolling the hero moves the camera through all 4 keyframes; subtle handheld shake always on.
- [ ] Hero text readable above the canvas; page works on mobile at reduced density.