/*
    Shed particles: every emit drops a shell of points on the runner's current
    pose, which then streams away behind it. A CPU pool of four generations;
    at roughly 8k points that is cheaper than the plumbing a GPU sim needs.
*/

import * as THREE from "three";
import { GLSL_PALETTE, paletteUniforms, clamp, smoothstep, mulberry32 } from "./common.js";

const GENERATIONS = 4;

const vertexShader = /* glsl */ `
    attribute float aLife;
    attribute vec2 aInfo;

    uniform float u_scale;

    varying float vLife;
    varying float vBrightness;

    void main()
    {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        vLife = aLife;
        vBrightness = aInfo.x;

        float size = aInfo.y;
        gl_PointSize = (12.0 / max(0.05, -mvPosition.z) + 4.0 * size * size * size * aLife) * u_scale;
        gl_Position = projectionMatrix * mvPosition;

        // Dead points are moved off-screen rather than drawn at zero alpha.
        if (aLife <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
`;

const fragmentShader = GLSL_PALETTE + /* glsl */ `
    varying float vLife;
    varying float vBrightness;

    void main()
    {
        float sprite = smoothstep(0.5, 0.3, length(gl_PointCoord - 0.5));
        float alpha = vLife * smoothstep(1.0, 0.9, vLife);

        gl_FragColor = vec4(mix(u_cool, u_warm, vBrightness), sprite * alpha);
    }
`;

export function createParticles(options)
{
    const meshes = options.meshes;
    const totalVertices = meshes.reduce(function (sum, mesh)
    {
        return sum + mesh.geometry.attributes.position.count;
    }, 0);

    const perGeneration = Math.max(1, Math.min(options.count, totalVertices));
    const total = perGeneration * GENERATIONS;
    const random = mulberry32(977);

    // Evenly spaced through the vertex lists, with a brightness taken from
    // the vertex normal against the same key direction the wires use.
    const samples = [];
    const key = new THREE.Vector3(1, 1, 1).normalize();
    const normal = new THREE.Vector3();

    for (let i = 0; i < perGeneration; i++)
    {
        let vertex = Math.floor(i * totalVertices / perGeneration);
        let m = 0;

        while (vertex >= meshes[m].geometry.attributes.position.count)
        {
            vertex -= meshes[m].geometry.attributes.position.count;
            m++;
        }

        normal.fromBufferAttribute(meshes[m].geometry.attributes.normal, vertex);

        samples.push({
            mesh: meshes[m],
            index: vertex,
            brightness: clamp(0.04 + Math.max(0, normal.dot(key)) * 1.25, 0, 1)
        });
    }

    const positions = new Float32Array(total * 3);
    const life = new Float32Array(total);
    const info = new Float32Array(total * 2);
    const drift = new Float32Array(total);

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    const lifeAttribute = new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage);
    const infoAttribute = new THREE.BufferAttribute(info, 2).setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("aLife", lifeAttribute);
    geometry.setAttribute("aInfo", infoAttribute);

    const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({ u_scale: { value: 1 } }, paletteUniforms),
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;

    const scratch = new THREE.Vector3();
    let generation = 0;

    return {
        object: points,
        material: material,
        count: total,

        // Overwrite the oldest generation with the body's current pose. The
        // caller must have brought world matrices up to date first.
        emit: function ()
        {
            const base = generation * perGeneration;
            generation = (generation + 1) % GENERATIONS;

            for (let i = 0; i < perGeneration; i++)
            {
                const sample = samples[i];
                const p = base + i;

                sample.mesh.getVertexPosition(sample.index, scratch);
                scratch.applyMatrix4(sample.mesh.matrixWorld);

                positions[p * 3] = scratch.x;
                positions[p * 3 + 1] = scratch.y;
                positions[p * 3 + 2] = scratch.z;

                life[p] = 1;
                info[p * 2] = sample.brightness;
                info[p * 2 + 1] = random();
                drift[p] = random() * Math.PI * 2;
            }

            infoAttribute.needsUpdate = true;
        },

        update: function (dt, settings)
        {
            for (let p = 0; p < total; p++)
            {
                let l = life[p];
                if (l <= 0) continue;

                l -= dt;
                life[p] = l;

                // Slow at birth, accelerating backward as the point ages.
                const ratio = 1 - smoothstep(0.45, 1, l);
                const z = positions[p * 3 + 2] - dt * (settings.speed + ratio * settings.acceleration);

                positions[p * 3 + 2] = z;
                positions[p * 3] += Math.sin(z * 2.3 + drift[p]) * dt * settings.drift;
                positions[p * 3 + 1] += Math.cos(z * 1.7 + drift[p]) * dt * settings.drift;
            }

            positionAttribute.needsUpdate = true;
            lifeAttribute.needsUpdate = true;
        }
    };
}
