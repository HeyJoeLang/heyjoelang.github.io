/*
    Scroll-driven camera: four keyframes, an off-centre framing offset applied
    after aiming, and a handheld shake layered on top.
*/

import * as THREE from "three";
import { clamp, mulberry32 } from "./common.js";

// Fractal 1-D value noise in roughly [-0.875, 0.875].
function createNoise(seed)
{
    const random = mulberry32(seed);
    const table = new Float32Array(256);

    for (let i = 0; i < 256; i++) table[i] = random() * 2 - 1;

    function value(x)
    {
        const i = Math.floor(x);
        const f = x - i;
        const u = f * f * (3 - 2 * f);
        const a = table[i & 255];
        const b = table[(i + 1) & 255];

        return a + (b - a) * u;
    }

    return function (x)
    {
        let sum = 0;
        let amplitude = 0.5;

        for (let octave = 0; octave < 3; octave++)
        {
            sum += value(x) * amplitude;
            x *= 2;
            amplitude *= 0.5;
        }

        return sum;
    };
}

function key(x, y, z, multiplier, offset, weight)
{
    return {
        position: new THREE.Vector3(x, y, z).multiplyScalar(multiplier),
        offset: new THREE.Vector3(offset[0], offset[1], offset[2]),
        weight: weight,
        threshold: 0
    };
}

export function createCameraRig(options)
{
    const camera = options.camera;
    const mobile = options.mobile;

    const target = new THREE.Vector3(0, 0.65, 0);

    const keys = [
        key(0, 3.5, 4.5, 0.7, [-0.55, 0, 0.5], 1),
        mobile ? key(3, 1.75, 0, 0.5, [0.75, 0, 0], 3) : key(1, 1.75, 3, 0.5, [0.75, 0, 0], 3),
        mobile ? key(4, 2, 0, 0.5, [1, 0, 0], 1.5) : key(2, 2, 0, 0.5, [1, 0, -1], 1.5),
        key(1, 1, -12, 0.5, [-1, -2, 0], 0)
    ];

    let total = 0;

    keys.forEach(function (k)
    {
        k.threshold = total;
        total += k.weight;
    });

    const NORMALISE = 1 / 0.75;
    const POSITION_AMPLITUDE = 0.22 * NORMALISE;
    const POSITION_FREQUENCY = 4;
    const ROTATION_AMPLITUDE = 0.15 * NORMALISE;
    const ROTATION_FREQUENCY = 1;

    const noise = createNoise(1337);
    const random = mulberry32(99);

    // Separate clocks for position x/y/z and rotation x/y/z, each started
    // somewhere different so the six channels never move together.
    const clocks = [];
    for (let i = 0; i < 6; i++) clocks.push(random() * 256);

    const position = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const rig = new THREE.Matrix4();
    const shakeMatrix = new THREE.Matrix4();
    const euler = new THREE.Euler();

    const pointer = { targetX: 0, targetY: 0, x: 0, y: 0, vx: 0, vy: 0 };

    window.addEventListener("pointermove", function (event)
    {
        pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    return {
        target: target,

        /*
            progress: scroll progress 0..1 through the hero.
            dt: unscaled frame time, so the shake keeps its own tempo.
            settings.shake: 0 freezes the handheld motion entirely.
            settings.framing: scale on the off-centre offsets (1 = as keyed).
        */
        update: function (progress, dt, settings)
        {
            const aspect = camera.aspect;
            const s = clamp(progress, 0, 1) * total;

            let i = 0;
            while (i < keys.length - 2 && s > keys[i + 1].threshold) i++;

            const from = keys[i];
            const to = keys[i + 1];
            const l = clamp((s - from.threshold) / from.weight, 0, 1);

            position.lerpVectors(from.position, to.position, l);
            position.x *= aspect;

            camera.position.copy(position);
            camera.lookAt(target);

            // Shift after aiming, so the runner sits off-centre instead of
            // the camera re-aiming at it from the shifted spot.
            offset.lerpVectors(from.offset, to.offset, l).multiplyScalar(settings.framing);
            offset.x *= aspect;

            rig.makeRotationFromQuaternion(camera.quaternion);
            rig.setPosition(position.add(offset));

            const shake = settings.shake;

            if (shake > 0)
            {
                for (let c = 0; c < 3; c++) clocks[c] += dt * POSITION_FREQUENCY;
                for (let c = 3; c < 6; c++) clocks[c] += dt * ROTATION_FREQUENCY;

                // No roll: rotation scale is (1, 1, 0).
                euler.set(
                    noise(clocks[3]) * ROTATION_AMPLITUDE * shake,
                    noise(clocks[4]) * ROTATION_AMPLITUDE * shake,
                    0
                );

                shakeMatrix.makeRotationFromEuler(euler);
                shakeMatrix.setPosition(
                    noise(clocks[0]) * POSITION_AMPLITUDE * shake,
                    noise(clocks[1]) * POSITION_AMPLITUDE * shake,
                    noise(clocks[2]) * POSITION_AMPLITUDE * shake
                );

                rig.multiply(shakeMatrix);
            }

            rig.decompose(camera.position, camera.quaternion, camera.scale);

            if (shake > 0)
            {
                camera.position.x += (Math.random() * 2 - 1) * 0.001;
                camera.position.y += (Math.random() * 2 - 1) * 0.001;
                camera.position.z += (Math.random() * 2 - 1) * 0.001;
            }

            // Not in the original; off unless the debug panel turns it on.
            if (settings.mouseLook)
            {
                pointer.vx += (pointer.targetX - pointer.x) * 0.15;
                pointer.vy += (pointer.targetY - pointer.y) * 0.15;
                pointer.vx *= 0.8;
                pointer.vy *= 0.8;
                pointer.x += pointer.vx;
                pointer.y += pointer.vy;

                camera.rotateY(-0.03 * pointer.x);
                camera.rotateX(0.03 * pointer.y);
            }

            camera.updateMatrixWorld();
        }
    };
}
