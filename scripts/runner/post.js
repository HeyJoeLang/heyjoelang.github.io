/*
    Post: bloom, the scroll-driven desaturation, SMAA, and the additive wire
    overlay that is drawn straight to the screen after everything else.
*/

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { smoothstep } from "./common.js";
import { OVERLAY_LAYER } from "./runner.js";

const GreyShader = {
    uniforms: {
        tDiffuse: { value: null },
        u_grey: { value: 0 }
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;

        void main()
        {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float u_grey;

        varying vec2 vUv;

        void main()
        {
            vec4 color = texture2D(tDiffuse, vUv);
            float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

            gl_FragColor = vec4(mix(color.rgb, vec3(luma), u_grey), 1.0);
        }
    `
};

export function createPost(options)
{
    const renderer = options.renderer;
    const scene = options.scene;
    const camera = options.camera;
    const mobile = options.mobile;

    // Milestones before post-processing render the scene directly.
    if (!options.enabled)
    {
        return {
            bloom: null,
            setSize: function () {},
            render: function () { renderer.render(scene, camera); }
        };
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 1.2, 0.3, 0);
    composer.addPass(bloom);

    const grey = new ShaderPass(GreyShader);
    composer.addPass(grey);

    if (options.smaa) composer.addPass(new SMAAPass(512, 512));

    return {
        composer: composer,
        bloom: bloom,

        setSize: function (width, height, pixelRatio)
        {
            composer.setPixelRatio(pixelRatio);
            composer.setSize(width, height);

            // Bloom is a blur; phones can run its chain at half the size.
            if (mobile) bloom.setSize(width * pixelRatio * 0.5, height * pixelRatio * 0.5);
        },

        render: function (progress)
        {
            // Colour drains out as the camera swings behind the runner.
            grey.uniforms.u_grey.value = smoothstep(0.6, 0.8, progress);

            composer.render();

            // Second, additive draw of the wires on top of the finished frame.
            const autoClear = renderer.autoClear;

            renderer.autoClear = false;
            camera.layers.set(OVERLAY_LAYER);
            renderer.render(scene, camera);
            camera.layers.set(0);
            renderer.autoClear = autoClear;
        }
    };
}
