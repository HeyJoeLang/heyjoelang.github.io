/*
    The tunnel wall: one open cylinder seen from inside, with everything on it
    drawn by the fragment shader. A grid of rings and rails gives the surface,
    and a scattering of lit panels stands in for the hero scene's streaks. All
    of it is keyed to distance travelled, so the wall slides past at exactly
    the speed the obstacles do.
*/

import * as THREE from "three";
import { GLSL_PALETTE, paletteUniforms } from "../common.js";

// How far ahead of the runner the wall is drawn, and how far behind.
const AHEAD = 130;
const BEHIND = 10;

const vertexShader = /* glsl */ `
    varying vec3 vPosition;

    void main()
    {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = GLSL_PALETTE + /* glsl */ `
    uniform float u_distance;
    uniform float u_flash;
    uniform float u_time;
    uniform float u_intensity;  // 0 at the start of a run, 1 deep into one
    uniform float u_shock;      // how far ahead the milestone ring has got

    varying vec3 vPosition;

    const float RAILS = 24.0;       // lines running the length of the tunnel
    const float RING_SPACING = 4.0; // world units between hoops
    const float PANEL_LENGTH = 8.0;

    float hash(vec2 p)
    {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main()
    {
        // 0 at the bottom of the tunnel, running to +/- PI at the top. The
        // seam lands on a rail, so the derivative jump there is hidden.
        float angle = atan(vPosition.x, -vPosition.y);
        float along = vPosition.z + u_distance;

        vec2 grid = vec2((angle / 6.2831853 + 0.5) * RAILS, along / RING_SPACING);
        vec2 toLine = abs(fract(grid - 0.5) - 0.5) / fwidth(grid);
        float line = 1.0 - min(min(toLine.x, toLine.y), 1.0);

        // Lit panels: a bar inside the cell. About one cell in eight to begin
        // with, filling in to nearly one in three as the run goes on.
        vec2 cell = vec2(floor(grid.x), floor(along / PANEL_LENGTH));
        float lit = step(mix(0.875, 0.68, u_intensity), hash(cell));
        vec2 inCell = vec2(fract(grid.x), fract(along / PANEL_LENGTH));
        float bar = smoothstep(0.30, 0.42, inCell.x) * smoothstep(0.70, 0.58, inCell.x)
            * smoothstep(0.05, 0.12, inCell.y) * smoothstep(0.90, 0.70, inCell.y);
        vec3 panelColor = mix(u_cool, u_warm, step(0.5, hash(cell + 17.0)));

        // Waves of brightness that run away down the tunnel ahead of the
        // runner. Absent at first; they arrive with intensity.
        float wave = pow(max(0.0, sin(vPosition.z * 0.22 - u_time * 5.0)), 6.0);
        float pulse = 1.0 + u_intensity * wave * 0.9;

        // The milestone ring: one bright hoop sweeping out to the horizon.
        float ring = exp(-pow((vPosition.z - u_shock) / 1.6, 2.0));

        // Panels are held below the brightness of a block's edge at every
        // intensity: decoration must never outshine the thing to avoid.
        vec3 color = u_bg
            + u_cool * line * (0.35 + u_flash + u_intensity * wave * 0.35)
            + mix(panelColor, vec3(1.0), 0.2) * lit * bar * 0.7 * pulse
            + mix(u_tintB, vec3(1.0), 0.4) * ring * (0.25 + line * 1.2);

        // Lose the wall into the dark with distance.
        float visible = smoothstep(${AHEAD.toFixed(1)}, 25.0, vPosition.z);

        gl_FragColor = vec4(mix(u_bg, color, visible), 1.0);
    }
`;

export function createTunnel(options)
{
    const length = AHEAD + BEHIND;
    const geometry = new THREE.CylinderGeometry(options.radius, options.radius, length, 96, 1, true);

    // Cylinders are built along Y; lay it along the direction of travel.
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, length / 2 - BEHIND);

    const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({
            u_distance: { value: 0 },
            u_flash: { value: 0 },
            u_time: { value: 0 },
            u_intensity: { value: 0 },
            // Parked far behind the runner, where the ring contributes nothing.
            u_shock: { value: -1000 }
        }, paletteUniforms),
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;

    return {
        object: mesh,
        uniforms: material.uniforms
    };
}
