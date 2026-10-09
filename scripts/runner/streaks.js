/*
    Light streaks: thin bars on a half-tunnel above the floor, flying toward
    -Z past the runner. One instanced draw call.
*/

import * as THREE from "three";
import { GLSL_PALETTE, paletteUniforms, reflectPass, mulberry32 } from "./common.js";

const INNER_SPACE = 2.5;
const THICKNESS = 4;
const RADIUS = 0.02;
const LENGTH = 20 * 0.35;

const vertexShader = /* glsl */ `
    attribute vec3 aOffset;   // x, y on the tunnel; z = start phase
    attribute vec4 aParams;   // radius, length, speed, colour pick

    uniform float u_time;

    varying vec3 vViewNormal;
    varying float vPick;
    varying float vWorldY;
    varying float vWorldZ;
    varying float vFadeIn;

    void main()
    {
        float len = aParams.y;
        float span = 2.0 * len + 20.0;
        float travel = mod(aOffset.z + u_time * aParams.z * 30.0, span);

        vec3 p = position;
        p.xy *= aParams.x * 2.0;
        p.xy += aOffset.xy;

        // Stretch along Z, then scroll: the bar starts just ahead of the
        // runner and flies back until it has cleared the fade distance.
        p.z = p.z * len + len * 0.5 + 1.0 - travel;

        vec4 world = modelMatrix * vec4(p, 1.0);
        world.y = max(world.y, 0.01);

        vViewNormal = normalize(normalMatrix * normal);
        vPick = aParams.w;
        vWorldY = world.y;
        vWorldZ = world.z;
        vFadeIn = smoothstep(0.0, 3.0, travel);

        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const fragmentShader = GLSL_PALETTE + /* glsl */ `
    uniform float u_reflect;
    uniform float u_fade;

    varying vec3 vViewNormal;
    varying float vPick;
    varying float vWorldY;
    varying float vWorldZ;
    varying float vFadeIn;

    void main()
    {
        vec3 color = mix(mix(u_cool, u_warm, vPick), vec3(1.0), clamp(0.15 + vViewNormal.z * 0.6, 0.0, 1.0)) * 0.75;

        color *= 1.0 + u_reflect * smoothstep(0.5, 0.0, vWorldY) * 2.5;

        // Fade into the background with distance, and in from it at spawn so
        // a bar never pops into existence.
        float visible = smoothstep(-20.0, -15.0, vWorldZ) * vFadeIn * u_fade;

        gl_FragColor = vec4(mix(u_bg, color, visible), 1.0);
    }
`;

export function createStreaks(options)
{
    const count = Math.round(options.count);
    const random = mulberry32(4242);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const geometry = new THREE.InstancedBufferGeometry();

    geometry.index = box.index;
    geometry.setAttribute("position", box.attributes.position);
    geometry.setAttribute("normal", box.attributes.normal);
    geometry.instanceCount = count;

    const offsets = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);

    for (let i = 0; i < count; i++)
    {
        // Upper half of the tunnel only.
        const angle = random() * Math.PI;
        const distance = INNER_SPACE + THICKNESS * random();
        const length = LENGTH * (0.2 + 0.8 * random());

        offsets[i * 3] = Math.cos(angle) * distance;
        offsets[i * 3 + 1] = Math.sin(angle) * distance;
        offsets[i * 3 + 2] = random() * (2 * length + 20);

        params[i * 4] = RADIUS;
        params[i * 4 + 1] = length;
        params[i * 4 + 2] = 0.6 + 0.4 * random();
        params[i * 4 + 3] = random() < 0.5 ? 0 : 1;
    }

    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute("aParams", new THREE.InstancedBufferAttribute(params, 4));

    const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({
            u_time: { value: 0 },
            // 1 normally; the hand-off to Runner+ fades the streaks out with it.
            u_fade: { value: 1 },
            u_reflect: reflectPass
        }, paletteUniforms),
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;

    return {
        object: mesh,
        material: material,
        update: function (dt)
        {
            material.uniforms.u_time.value += dt;
        }
    };
}
