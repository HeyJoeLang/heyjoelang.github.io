/*
    The runner: the rigged model, its translucent body, and the wire strands
    that hug the skin and deform with the skeleton.
*/

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COLORS, GLSL_PALETTE, paletteUniforms, reflectPass, mulberry32 } from "./common.js";

const POINTS_PER_STRAND = 128;
const TARGET_HEIGHT = 1.4;

// Layer the additive wire copy lives on; drawn once more after post.
export const OVERLAY_LAYER = 1;

/*
    Lines that skin. three only uploads bone uniforms and defines USE_SKINNING
    for a SkinnedMesh, and only draws gl.LINES for a LineSegments, so this is
    a SkinnedMesh that reports itself as line segments to the draw call.
*/
class SkinnedLines extends THREE.SkinnedMesh
{
    constructor(geometry, material)
    {
        super(geometry, material);

        this.isMesh = false;
        this.isLine = true;
        this.isLineSegments = true;
        this.type = "LineSegments";
        this.frustumCulled = false;
    }
}

const wireVertex = /* glsl */ `
    attribute vec3 aData;

    varying vec3 vData;
    varying vec3 vViewNormal;
    varying float vWorldY;

    #include <common>
    #include <skinning_pars_vertex>

    void main()
    {
        vec3 objectNormal = normal;
        vec3 transformed = position;

        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>

        vData = aData;
        vViewNormal = normalize(normalMatrix * objectNormal);
        vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
`;

const wireFragment = GLSL_PALETTE + /* glsl */ `
    uniform float u_time;
    uniform float u_emitRatio;
    uniform float u_boost;
    uniform float u_reflect;

    varying vec3 vData;
    varying vec3 vViewNormal;
    varying float vWorldY;

    const float LINE_LENGTH = 0.2;

    void main()
    {
        float phase = vData.x;
        float progress = vData.y;
        float pick = vData.z;

        // Head of the pulse runs 0 -> 1 + LINE_LENGTH so the tail clears the
        // end of the strand before the next lap starts.
        float m = mod(u_time + phase * (1.0 + LINE_LENGTH), 1.0 + LINE_LENGTH);
        float t = smoothstep(m - LINE_LENGTH, m, progress) * step(progress, m);

        float b = 0.04 + max(0.0, dot(normalize(vViewNormal), normalize(vec3(1.0)))) * 1.25;

        vec3 color = mix(u_cool, u_warm, b)
            * (0.65 + 3.0 * t)
            * mix(u_tintA, u_tintB, pick)
            * (0.75 + (0.025 + t) * u_emitRatio * 12.0);

        color *= 1.0 + u_reflect * smoothstep(0.5, 0.0, vWorldY) * 2.5;

        gl_FragColor = vec4(color * u_boost, 1.0);
    }
`;

function createWireMaterial(uniforms, overlay)
{
    return new THREE.ShaderMaterial({
        uniforms: Object.assign({
            u_time: uniforms.time,
            u_emitRatio: uniforms.emitRatio,
            u_boost: { value: overlay ? 0.2 : 1 },
            u_reflect: reflectPass
        }, paletteUniforms),
        vertexShader: wireVertex,
        fragmentShader: wireFragment,
        transparent: overlay,
        blending: overlay ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthTest: !overlay,
        depthWrite: !overlay
    });
}

/*
    glTF splits a vertex wherever its UV or normal differs, so the index buffer
    alone describes a surface cut along every seam and a walk would dead-end
    there. Weld by position first and walk the welded graph.
*/
function weld(geometry)
{
    const position = geometry.attributes.position;
    const index = geometry.index;

    const ids = new Uint32Array(position.count);
    const representative = [];
    const seen = new Map();

    for (let i = 0; i < position.count; i++)
    {
        const key = Math.round(position.getX(i) * 2000) + "_"
            + Math.round(position.getY(i) * 2000) + "_"
            + Math.round(position.getZ(i) * 2000);

        let id = seen.get(key);

        if (id === undefined)
        {
            id = representative.length;
            representative.push(i);
            seen.set(key, id);
        }

        ids[i] = id;
    }

    const neighbours = representative.map(function () { return new Set(); });
    const corners = index ? index.count : position.count;

    function corner(i)
    {
        return ids[index ? index.getX(i) : i];
    }

    for (let i = 0; i + 2 < corners; i += 3)
    {
        const a = corner(i);
        const b = corner(i + 1);
        const c = corner(i + 2);

        if (a !== b) { neighbours[a].add(b); neighbours[b].add(a); }
        if (b !== c) { neighbours[b].add(c); neighbours[c].add(b); }
        if (c !== a) { neighbours[c].add(a); neighbours[a].add(c); }
    }

    return {
        representative: representative,
        adjacency: neighbours.map(function (set) { return Array.from(set); })
    };
}

/*
    Each strand starts on a random vertex and walks 128 steps across the
    surface, preferring the neighbour that best continues its heading. Every
    point copies its source vertex's skin weights, so the strand rides the
    skeleton exactly as the skin under it does.
*/
function buildStrandGeometry(sourceGeometry, graph, strandCount, random)
{
    const srcPosition = sourceGeometry.attributes.position;
    const srcNormal = sourceGeometry.attributes.normal;
    const srcSkinIndex = sourceGeometry.attributes.skinIndex;
    const srcSkinWeight = sourceGeometry.attributes.skinWeight;

    const representative = graph.representative;
    const adjacency = graph.adjacency;

    const pointCount = strandCount * POINTS_PER_STRAND;
    const positions = new Float32Array(pointCount * 3);
    const normals = new Float32Array(pointCount * 3);
    const data = new Float32Array(pointCount * 3);
    const skinIndices = new Uint16Array(pointCount * 4);
    const skinWeights = new Float32Array(pointCount * 4);

    const segmentCount = strandCount * (POINTS_PER_STRAND - 1);
    const indices = pointCount > 65535
        ? new Uint32Array(segmentCount * 2)
        : new Uint16Array(segmentCount * 2);

    // How strongly a step may wander off the current heading.
    const WANDER = 0.55;

    let point = 0;
    let segment = 0;

    for (let s = 0; s < strandCount; s++)
    {
        let current = Math.floor(random() * representative.length);

        for (let tries = 0; tries < 16 && adjacency[current].length === 0; tries++)
        {
            current = Math.floor(random() * representative.length);
        }

        const phase = random();
        const pick = random() < 0.5 ? 0 : 1;
        const lift = 0.006 + random() * 0.006;

        let previous = -1;
        let dx = 0, dy = 0, dz = 0;

        for (let k = 0; k < POINTS_PER_STRAND; k++)
        {
            const v = representative[current];

            const px = srcPosition.getX(v);
            const py = srcPosition.getY(v);
            const pz = srcPosition.getZ(v);

            const nx = srcNormal.getX(v);
            const ny = srcNormal.getY(v);
            const nz = srcNormal.getZ(v);

            // Sit just above the skin.
            positions[point * 3] = px + nx * lift;
            positions[point * 3 + 1] = py + ny * lift;
            positions[point * 3 + 2] = pz + nz * lift;

            normals[point * 3] = nx;
            normals[point * 3 + 1] = ny;
            normals[point * 3 + 2] = nz;

            // Data, not colour: strand phase, progress along it, palette pick.
            data[point * 3] = phase;
            data[point * 3 + 1] = k / (POINTS_PER_STRAND - 1);
            data[point * 3 + 2] = pick;

            skinIndices[point * 4] = srcSkinIndex.getX(v);
            skinIndices[point * 4 + 1] = srcSkinIndex.getY(v);
            skinIndices[point * 4 + 2] = srcSkinIndex.getZ(v);
            skinIndices[point * 4 + 3] = srcSkinIndex.getW(v);

            skinWeights[point * 4] = srcSkinWeight.getX(v);
            skinWeights[point * 4 + 1] = srcSkinWeight.getY(v);
            skinWeights[point * 4 + 2] = srcSkinWeight.getZ(v);
            skinWeights[point * 4 + 3] = srcSkinWeight.getW(v);

            if (k > 0)
            {
                indices[segment * 2] = point - 1;
                indices[segment * 2 + 1] = point;
                segment++;
            }

            point++;

            const options = adjacency[current];
            if (options.length === 0) continue;

            let best = -1;
            let bestScore = -Infinity;
            let bx = 0, by = 0, bz = 0;

            for (let n = 0; n < options.length; n++)
            {
                const candidate = options[n];
                if (candidate === previous && options.length > 1) continue;

                const c = representative[candidate];
                let ex = srcPosition.getX(c) - px;
                let ey = srcPosition.getY(c) - py;
                let ez = srcPosition.getZ(c) - pz;

                const length = Math.hypot(ex, ey, ez) || 1;
                ex /= length; ey /= length; ez /= length;

                const score = (ex * dx + ey * dy + ez * dz) + random() * WANDER;

                if (score > bestScore)
                {
                    bestScore = score;
                    best = candidate;
                    bx = ex; by = ey; bz = ez;
                }
            }

            // Ease the heading toward the step just taken, so a strand curves
            // rather than zig-zagging along the mesh's edge directions.
            dx = dx * 0.5 + bx * 0.5;
            dy = dy * 0.5 + by * 0.5;
            dz = dz * 0.5 + bz * 0.5;

            const heading = Math.hypot(dx, dy, dz) || 1;
            dx /= heading; dy /= heading; dz /= heading;

            previous = current;
            current = best;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aData", new THREE.BufferAttribute(data, 3));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return geometry;
}

function buildWires(meshes, strandCount)
{
    const uniforms = {
        time: { value: 0 },
        emitRatio: { value: 0 }
    };

    const mainMaterial = createWireMaterial(uniforms, false);
    const overlayMaterial = createWireMaterial(uniforms, true);

    const random = mulberry32(20240607);
    const graphs = meshes.map(function (mesh) { return weld(mesh.geometry); });
    const totalVertices = graphs.reduce(function (sum, graph) { return sum + graph.representative.length; }, 0);

    const objects = [];

    meshes.forEach(function (mesh, i)
    {
        // Strands are shared out by how much surface each mesh carries.
        const share = graphs[i].representative.length / totalVertices;
        const count = Math.max(1, Math.round(strandCount * share));
        const geometry = buildStrandGeometry(mesh.geometry, graphs[i], count, random);

        [mainMaterial, overlayMaterial].forEach(function (material, pass)
        {
            const lines = new SkinnedLines(geometry, material);

            // Same skeleton and bind pose as the body it wraps.
            lines.bind(mesh.skeleton, mesh.bindMatrix);
            lines.position.copy(mesh.position);
            lines.quaternion.copy(mesh.quaternion);
            lines.scale.copy(mesh.scale);

            if (pass === 1) lines.layers.set(OVERLAY_LAYER);

            mesh.parent.add(lines);
            objects.push(lines);
        });
    });

    return { uniforms: uniforms, objects: objects };
}

/*
    Scale to TARGET_HEIGHT, feet on y = 0, centred on the origin, facing +Z.

    Measured across the run cycle rather than at one frame: a single frame
    catches the model mid-stride, with one foot off the ground and the head at
    an arbitrary point of its bob.
*/
function normalize(group, pivot, model, meshes, mixer, clip)
{
    const SAMPLES = 8;
    const duration = clip ? clip.duration : 0;

    function pose(i)
    {
        mixer.setTime(duration * i / SAMPLES);
        group.updateMatrixWorld(true);
    }

    // Facing: toes sit in front of the ankle, so foot -> toe averaged over
    // the cycle and both feet points the way the model is running.
    const feet = [];

    model.traverse(function (object)
    {
        if (object.isBone && /toe/i.test(object.name) && object.parent && object.parent.isBone)
        {
            feet.push([object.parent, object]);
        }
    });

    if (feet.length)
    {
        const forward = new THREE.Vector3();
        const ankle = new THREE.Vector3();
        const toe = new THREE.Vector3();

        for (let i = 0; i < SAMPLES; i++)
        {
            pose(i);

            feet.forEach(function (pair)
            {
                ankle.setFromMatrixPosition(pair[0].matrixWorld);
                toe.setFromMatrixPosition(pair[1].matrixWorld);
                forward.add(toe.sub(ankle));
            });
        }

        forward.y = 0;

        if (forward.lengthSq() > 1e-8)
        {
            // Snapped to a quarter turn: the estimate only has to pick an axis.
            const angle = -Math.atan2(forward.x, forward.z);
            pivot.rotation.y = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
        }
    }

    const bounds = new THREE.Box3();
    const box = new THREE.Box3();

    for (let i = 0; i < SAMPLES; i++)
    {
        pose(i);

        meshes.forEach(function (mesh)
        {
            // SkinnedMesh computes this from the posed vertices.
            mesh.computeBoundingBox();
            box.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
            bounds.union(box);
        });
    }

    const scale = TARGET_HEIGHT / (bounds.max.y - bounds.min.y);
    const centre = bounds.getCenter(new THREE.Vector3());

    group.scale.setScalar(scale);
    group.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);

    mixer.setTime(0);
    group.updateMatrixWorld(true);
}

export async function loadRunner(options)
{
    const gltf = await new GLTFLoader().loadAsync(options.url);
    const model = gltf.scene;

    // group carries scale and placement, pivot the facing correction.
    const pivot = new THREE.Group();
    pivot.add(model);

    const group = new THREE.Group();
    group.add(pivot);

    const meshes = [];
    model.traverse(function (object) { if (object.isSkinnedMesh) meshes.push(object); });

    if (!meshes.length) throw new Error("runner.glb contains no skinned mesh");

    // The spec has the body faintly visible at 0.15. Here it is fully clear:
    // the wires alone draw the figure. It is still rendered, so it keeps
    // writing depth and hides the particles passing behind it.
    const bodyMaterial = new THREE.MeshBasicMaterial({
        color: COLORS.body,
        transparent: true,
        opacity: 0
    });

    meshes.forEach(function (mesh)
    {
        mesh.material = bodyMaterial;
        mesh.renderOrder = 1;
        mesh.frustumCulled = false;
    });

    const mixer = new THREE.AnimationMixer(model);
    const runClip = THREE.AnimationClip.findByName(gltf.animations, "Run") || gltf.animations[0];
    const actions = {};

    if (runClip)
    {
        actions.run = mixer.clipAction(runClip);
        actions.run.play();
    }

    // Present only if the optional clips were exported; held at weight 0 for
    // the click interaction the spec leaves switched off.
    ["Jump", "Slide"].forEach(function (name)
    {
        const clip = THREE.AnimationClip.findByName(gltf.animations, name);
        if (!clip || clip === runClip) return;

        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(0);
        actions[name.toLowerCase()] = action;
    });

    normalize(group, pivot, model, meshes, mixer, runClip);

    const wires = options.wires === false ? null : buildWires(meshes, options.strands);

    return {
        group: group,
        meshes: meshes,
        mixer: mixer,
        actions: actions,
        bodyMaterial: bodyMaterial,
        wires: wires
    };
}
