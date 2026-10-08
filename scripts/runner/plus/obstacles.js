/*
    Obstacles: blocks that stand in from the tunnel wall, each covering an arc
    of one ring. The player cannot jump, so a ring is passed by being at an
    angle no block covers.

    Fairness is built into generation rather than checked afterwards. A "safe
    gap" random-walks around the tunnel from ring to ring, never moving
    further than the player can steer in the time between two rings, and no
    block is ever allowed to cover it. Whatever else a ring throws up, there
    is always somewhere reachable to be.

    All blocks are one instanced draw call: a subdivided unit box that the
    vertex shader bends round the wall.
*/

import * as THREE from "three";
import { GLSL_PALETTE, paletteUniforms } from "../common.js";

const POOL = 64;
const THICKNESS = 0.7;      // along the direction of travel
const SPAWN_AHEAD = 115;
const TAU = Math.PI * 2;

// Half-width of the runner as an angle on the wall, a little generous to the
// player: a block's edge has to be clearly over the figure to count.
const PLAYER_HALF_ANGLE = 0.035;
const PLAYER_HALF_DEPTH = 0.3;

const vertexShader = /* glsl */ `
    attribute vec4 aArc;   // centre angle, angular width, track position, height

    uniform float u_distance;
    uniform float u_radius;

    varying vec3 vLocal;
    varying vec3 vSize;
    varying float vZ;

    void main()
    {
        float angle = aArc.x + position.x * aArc.y;
        float radius = u_radius - (position.y + 0.5) * aArc.w;
        float z = aArc.z - u_distance + position.z * ${THICKNESS.toFixed(2)};

        // Angle 0 is the bottom of the tunnel.
        vec3 p = vec3(sin(angle) * radius, -cos(angle) * radius, z);

        vLocal = position;
        vSize = vec3(aArc.y * u_radius, aArc.w, ${THICKNESS.toFixed(2)});
        vZ = z;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`;

const fragmentShader = GLSL_PALETTE + /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vSize;
    varying float vZ;

    void main()
    {
        // Past the runner a block is about to meet the camera: drop it.
        if (vZ < -1.2) discard;

        // Distance to each pair of faces, in world units. On any face one of
        // these is zero, so the middle value is the distance to the nearest
        // edge of that face.
        vec3 d = (0.5 - abs(vLocal)) * vSize;
        float edgeDistance = max(min(d.x, d.y), min(max(d.x, d.y), d.z));
        float edge = 1.0 - smoothstep(0.035, 0.075, edgeDistance);

        vec3 face = mix(u_bg, u_warm, 0.16);
        vec3 color = mix(face, mix(u_warm, vec3(1.0), 0.25) * 1.8, edge);

        float visible = smoothstep(${SPAWN_AHEAD.toFixed(1)}, 60.0, vZ);

        gl_FragColor = vec4(mix(u_bg, color, visible), 1.0);
    }
`;

function wrap(angle)
{
    return angle - TAU * Math.round(angle / TAU);
}

function lerp(a, b, t)
{
    return a + (b - a) * t;
}

export function createObstacles(options)
{
    const box = new THREE.BoxGeometry(1, 1, 1, 32, 1, 1);
    const geometry = new THREE.InstancedBufferGeometry();

    geometry.index = box.index;
    geometry.setAttribute("position", box.attributes.position);
    geometry.instanceCount = POOL;

    // angle, width, track position, height per block. A block parked far
    // behind the runner is simply never drawn.
    const arcs = new Float32Array(POOL * 4);
    const arcAttribute = new THREE.InstancedBufferAttribute(arcs, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aArc", arcAttribute);

    const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({
            u_distance: { value: 0 },
            u_radius: { value: options.radius }
        }, paletteUniforms),
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;

    const PARKED = -1e6;

    let nextRing = 0;
    let safeGap = 0;

    function park()
    {
        for (let i = 0; i < POOL; i++) arcs[i * 4 + 2] = PARKED;
        arcAttribute.needsUpdate = true;
    }

    function add(angle, width, position, height, travel)
    {
        for (let i = 0; i < POOL; i++)
        {
            // Free once it is behind the camera.
            if (arcs[i * 4 + 2] > travel - 6) continue;

            arcs[i * 4] = angle;
            arcs[i * 4 + 1] = width;
            arcs[i * 4 + 2] = position;
            arcs[i * 4 + 3] = height;
            arcAttribute.needsUpdate = true;
            return;
        }
    }

    function spawnRing(position, travel, settings)
    {
        const difficulty = settings.difficulty;
        const gapWidth = lerp(1.7, 0.95, difficulty);

        // How far round the wall the player can get before this ring
        // arrives, with slack for reaction time.
        const reach = settings.steerRate * (settings.spacing / settings.speed) * 0.6;

        safeGap = wrap(safeGap + (Math.random() * 2 - 1) * Math.min(reach, Math.PI));

        if (Math.random() < 0.12 + 0.45 * difficulty)
        {
            // A full wall with one doorway.
            add(wrap(safeGap + Math.PI), TAU - gapWidth, position, 1.7, travel);
            return;
        }

        const count = Math.random() < 0.3 + 0.4 * difficulty ? 2 : 1;

        for (let n = 0; n < count; n++)
        {
            for (let attempt = 0; attempt < 6; attempt++)
            {
                const width = lerp(0.9, 2.4, Math.random());
                const centre = wrap(Math.random() * TAU);

                // Must leave the safe gap entirely clear.
                if (Math.abs(wrap(centre - safeGap)) < (width + gapWidth) / 2) continue;

                add(centre, width, position, 1.3 + Math.random() * 1.2, travel);
                break;
            }
        }
    }

    park();

    return {
        object: mesh,

        clear: park,

        // Start a run: the course begins a little way ahead, with its safe
        // gap wherever the player is standing.
        reset: function (travel, playerAngle)
        {
            park();
            nextRing = travel + 45;
            safeGap = playerAngle;
        },

        // Lay rings out to the horizon. settings: speed, difficulty, steerRate.
        update: function (travel, settings)
        {
            material.uniforms.u_distance.value = travel;

            if (!settings) return;

            settings.spacing = lerp(16, 9, settings.difficulty);

            while (nextRing < travel + SPAWN_AHEAD)
            {
                spawnRing(nextRing, travel, settings);
                nextRing += settings.spacing;
            }
        },

        /*
            Did the runner pass through a block between the last frame and
            this one? Swept along the track so a fast frame cannot step clean
            over a block. rotation is the world's roll, so the block standing
            at the bottom of the screen is the one whose angle cancels it.
        */
        hit: function (previousTravel, travel, rotation)
        {
            const depth = THICKNESS / 2 + PLAYER_HALF_DEPTH;

            for (let i = 0; i < POOL; i++)
            {
                const position = arcs[i * 4 + 2];

                if (position - travel > depth || position - previousTravel < -depth) continue;

                const offset = Math.abs(wrap(arcs[i * 4] + rotation));

                if (offset < arcs[i * 4 + 1] / 2 + PLAYER_HALF_ANGLE) return true;
            }

            return false;
        }
    };
}
