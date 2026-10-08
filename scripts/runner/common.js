/*
    Shared palette and helpers for the Runner scene.

    The scene works in raw display values, the way the spec's numbers are
    written: colour management is off and the renderer outputs linear, so a hex
    in a shader is the colour that reaches the screen. That has to be switched
    off before the first THREE.Color is built, and every other module imports
    this one, so it happens here.
*/

import * as THREE from "three";

THREE.ColorManagement.enabled = false;

/*
    Palettes. Each one fills the same six roles:

      bg      clear colour, and what distance fades into
      cool    the unlit end of the wire / particle / streak ramp
      warm    the lit end of that ramp
      tintA   } every wire strand is multiplied by one of these two, picked
      tintB   } at random per strand. A tint with a channel at zero removes
                that channel from its strands, which is where the original's
                hard cyan-against-pink split comes from.
      body    the translucent figure under the wires

    "neon" is the spec's palette; DEFAULT_PALETTE below is the one the page
    ships with. Pick another with ?palette=name, or live from the ?debug panel.
*/
export const PALETTES = {
    neon:        { bg: 0x07080b, cool: 0x2b8db2, warm: 0xff3b59, tintA: 0xb3c4ee, tintB: 0x00f6ff, body: 0xff2a49 },

    // Neon family: the same teal-against-pink split, pushed in one direction.
    "neon-rose": { bg: 0x08070b, cool: 0x2b8db2, warm: 0xff3b8f, tintA: 0xc4b3ee, tintB: 0x00f6ff, body: 0xff2a7a },
    "neon-ice":  { bg: 0x06080c, cool: 0x2b6fb2, warm: 0xff4b6b, tintA: 0xb3d4ee, tintB: 0x3bd0ff, body: 0xff2a49 },
    "neon-mint": { bg: 0x06090a, cool: 0x2bb29a, warm: 0xff3b6b, tintA: 0xb3eedc, tintB: 0x00ffd0, body: 0xff2a5a },

    // Between the two families: indigo where neon has teal, cyan tint kept.
    synthwave:   { bg: 0x08060d, cool: 0x3b4fd6, warm: 0xff3b7a, tintA: 0xe0b3ee, tintB: 0x00e1ff, body: 0xff2ab0 },
    plasma:      { bg: 0x07060d, cool: 0x2b5fd6, warm: 0xe03bff, tintA: 0xc8c0ff, tintB: 0x3bffe6, body: 0x8a2aff },

    // Ultraviolet family.
    ultraviolet: { bg: 0x08060d, cool: 0x5b3bd6, warm: 0xff3bd0, tintA: 0xd0b3ee, tintB: 0x5ab4ff, body: 0xa02aff },
    "uv-cyan":   { bg: 0x08060d, cool: 0x5b3bd6, warm: 0xff3bd0, tintA: 0xd0b3ee, tintB: 0x00f6ff, body: 0xa02aff },
    "uv-deep":   { bg: 0x06050b, cool: 0x3b2bb2, warm: 0xc03bff, tintA: 0xb9b3ee, tintB: 0x6a7cff, body: 0x6a2aff },
    "uv-hot":    { bg: 0x0a060b, cool: 0x7a3bd6, warm: 0xff3b8a, tintA: 0xeeb3dc, tintB: 0xb45aff, body: 0xff2ad0 },

    portfolio:  { bg: 0x070b14, cool: 0x2f5fe0, warm: 0x3ddc9a, tintA: 0xc8d6ff, tintB: 0x8cffd2, body: 0x6f9bff },
    ember:       { bg: 0x0b0706, cool: 0xb2402b, warm: 0xffc23b, tintA: 0xffd9b3, tintB: 0xffb000, body: 0xff5a2a },
    aurora:     { bg: 0x05090a, cool: 0x1f8fa3, warm: 0xb6ff3b, tintA: 0xb3eedc, tintB: 0x00ffb4, body: 0x2affa0 },
    sunset:      { bg: 0x0a0709, cool: 0x7a3bd6, warm: 0xff8a3b, tintA: 0xffc4b3, tintB: 0xff5ea0, body: 0xff5a6a },
    mono:        { bg: 0x07080b, cool: 0x56657a, warm: 0xffffff, tintA: 0xd0d8e8, tintB: 0xffffff, body: 0x8fa0b8 }
};

export const DEFAULT_PALETTE = "plasma";

export const COLORS = {
    bg: new THREE.Color(),
    cool: new THREE.Color(),
    warm: new THREE.Color(),
    tintA: new THREE.Color(),
    tintB: new THREE.Color(),
    body: new THREE.Color()
};

// Copies into the shared Color objects, so every material holding them (via
// paletteUniforms) changes at once. Returns the name actually applied.
export function applyPalette(name)
{
    const key = Object.prototype.hasOwnProperty.call(PALETTES, name) ? name : DEFAULT_PALETTE;
    const palette = PALETTES[key];

    Object.keys(COLORS).forEach(function (role) { COLORS[role].setHex(palette[role]); });

    return key;
}

const blendScratch = new THREE.Color();

// Sets the shared colours to a mix of two palettes: t = 0 is all `from`,
// t = 1 all `to`. Like applyPalette, every material follows at once.
export function blendPalettes(from, to, t)
{
    const a = PALETTES[from];
    const b = PALETTES[to];

    Object.keys(COLORS).forEach(function (role)
    {
        COLORS[role].setHex(a[role]).lerp(blendScratch.setHex(b[role]), t);
    });
}

applyPalette(DEFAULT_PALETTE);

// Spread into a ShaderMaterial's uniforms; the values are the shared Colors.
export const paletteUniforms = {
    u_bg: { value: COLORS.bg },
    u_cool: { value: COLORS.cool },
    u_warm: { value: COLORS.warm },
    u_tintA: { value: COLORS.tintA },
    u_tintB: { value: COLORS.tintB }
};

// Prepended to every fragment shader that uses the palette.
export const GLSL_PALETTE = [
    "uniform vec3 u_bg;",
    "uniform vec3 u_cool;",
    "uniform vec3 u_warm;",
    "uniform vec3 u_tintA;",
    "uniform vec3 u_tintB;"
].join("\n") + "\n";

/*
    1 while the floor is rendering its mirrored copy of the scene, 0 otherwise.
    One uniform object shared by every material that brightens near the floor.
*/
export const reflectPass = { value: 0 };

export function clamp(x, lo, hi)
{
    return Math.min(hi, Math.max(lo, x));
}

export function smoothstep(a, b, x)
{
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

// Small seeded generator, so strand layout and streak placement are the same
// on every load and a tuned value keeps meaning the same thing.
export function mulberry32(seed)
{
    let a = seed >>> 0;

    return function ()
    {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
