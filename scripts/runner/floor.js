/*
    Floor: a planar reflection of the scene, blurred for gloss, distorted by a
    normal map that scrolls backward under the runner.

    The mirror maths follows three's Reflector. It is done here rather than
    with that class because the reflection needs a blur between the mirrored
    render and the floor's own shader.
*/

import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { GLSL_PALETTE, paletteUniforms, reflectPass } from "./common.js";

const SIZE = 20;

// Default tiling, from the spec; it suits a map with a few large tiles per
// repeat. A denser map (the penny-tile one packs about fourteen across) wants
// roughly 6 - pass options.repeat.
const REPEAT = 16;

// Plane-lengths per second the surface slides back; independent of REPEAT so
// retiling does not change how fast the floor appears to move.
const SCROLL_RATE = 0.2667;

const floorVertex = /* glsl */ `
    uniform mat4 u_textureMatrix;

    varying vec4 vReflectUv;
    varying vec2 vUv;
    varying float vViewDepth;

    void main()
    {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        vUv = uv;
        vReflectUv = u_textureMatrix * vec4(position, 1.0);
        vViewDepth = -mvPosition.z;

        gl_Position = projectionMatrix * mvPosition;
    }
`;

const floorFragment = GLSL_PALETTE + /* glsl */ `
    uniform sampler2D u_reflection;
    uniform sampler2D u_normalMap;
    uniform vec2 u_repeat;
    uniform vec2 u_offset;
    uniform float u_normalFlipY;
    uniform float u_strength;
    uniform float u_distortion;
    uniform float u_tiltBoost;

    varying vec4 vReflectUv;
    varying vec2 vUv;
    varying float vViewDepth;

    void main()
    {
        vec3 n = texture2D(u_normalMap, vUv * u_repeat + u_offset).xyz * 2.0 - 1.0;

        // -1 for a DirectX-convention map (green points down), which flips
        // it to the OpenGL convention the rest of the maths assumes.
        n.y *= u_normalFlipY;

        vec2 uv = vReflectUv.xy / vReflectUv.w + n.xy * u_distortion;
        vec3 reflection = texture2D(u_reflection, uv).rgb;

        // Brighter where the surface tilts, so the tile edges catch light.
        reflection *= 1.0 + length(n.xy) * u_tiltBoost;

        float fade = smoothstep(18.0, 0.0, vViewDepth);

        gl_FragColor = vec4(u_bg + max(reflection - u_bg, 0.0) * u_strength * fade, 1.0);
    }
`;

const blurFragment = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 u_step;

    varying vec2 vUv;

    void main()
    {
        vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270;

        sum += (texture2D(tDiffuse, vUv + u_step).rgb + texture2D(tDiffuse, vUv - u_step).rgb) * 0.1946;
        sum += (texture2D(tDiffuse, vUv + u_step * 2.0).rgb + texture2D(tDiffuse, vUv - u_step * 2.0).rgb) * 0.1216;
        sum += (texture2D(tDiffuse, vUv + u_step * 3.0).rgb + texture2D(tDiffuse, vUv - u_step * 3.0).rgb) * 0.0541;
        sum += (texture2D(tDiffuse, vUv + u_step * 4.0).rgb + texture2D(tDiffuse, vUv - u_step * 4.0).rgb) * 0.0162;

        gl_FragColor = vec4(sum, 1.0);
    }
`;

const blurVertex = /* glsl */ `
    varying vec2 vUv;

    void main()
    {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

function configureNormalMap(texture, renderer)
{
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    return texture;
}

// Stand-in for a missing normal map image: a tileable ripple field, built
// from whole-number frequencies so the edges meet.
function createProceduralNormalMap()
{
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);

    const waves = [[1, 2, 0.3], [3, 1, 1.7], [2, 5, 4.1], [7, 3, 2.2], [5, 8, 0.9]];
    const TAU = Math.PI * 2;

    function height(x, y)
    {
        let h = 0;

        for (let i = 0; i < waves.length; i++)
        {
            const w = waves[i];
            h += Math.sin((w[0] * x + w[1] * y) * TAU / size + w[2]) / (i + 1);
        }

        return h;
    }

    for (let y = 0; y < size; y++)
    {
        for (let x = 0; x < size; x++)
        {
            const dx = (height(x + 1, y) - height(x - 1, y)) * 2.5;
            const dy = (height(x, y + 1) - height(x, y - 1)) * 2.5;
            const length = Math.hypot(dx, dy, 1);
            const i = (y * size + x) * 4;

            image.data[i] = (-dx / length * 0.5 + 0.5) * 255;
            image.data[i + 1] = (-dy / length * 0.5 + 0.5) * 255;
            image.data[i + 2] = (1 / length * 0.5 + 0.5) * 255;
            image.data[i + 3] = 255;
        }
    }

    context.putImageData(image, 0, 0);

    return new THREE.CanvasTexture(canvas);
}

export function createFloor(options)
{
    const renderer = options.renderer;

    const targetOptions = {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter
    };

    const reflection = new THREE.WebGLRenderTarget(512, 512, targetOptions);
    const scratch = new THREE.WebGLRenderTarget(512, 512, Object.assign({ depthBuffer: false }, targetOptions));

    const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({
            u_reflection: { value: reflection.texture },
            u_normalMap: { value: null },
            u_textureMatrix: { value: new THREE.Matrix4() },
            u_repeat: { value: new THREE.Vector2(options.repeat || REPEAT, options.repeat || REPEAT) },
            u_offset: { value: new THREE.Vector2() },
            u_normalFlipY: { value: options.normalMapDirectX ? -1 : 1 },
            u_strength: { value: 0.7 },
            u_distortion: { value: 0.02 },
            u_tiltBoost: { value: 1.0 }
        }, paletteUniforms),
        vertexShader: floorVertex,
        fragmentShader: floorFragment
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, -6);
    mesh.updateMatrixWorld();

    const blurMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            u_step: { value: new THREE.Vector2() }
        },
        vertexShader: blurVertex,
        fragmentShader: blurFragment,
        depthTest: false,
        depthWrite: false
    });

    const quad = new FullScreenQuad(blurMaterial);
    const settings = { blur: 4 };

    // A missing or broken image falls back to the procedural map rather than
    // leaving the floor undistorted.
    const ready = new Promise(function (resolve)
    {
        new THREE.TextureLoader().load(
            options.normalMapUrl,
            function (texture)
            {
                material.uniforms.u_normalMap.value = configureNormalMap(texture, renderer);
                resolve();
            },
            undefined,
            function ()
            {
                console.warn("Floor normal map did not load; using a procedural one.");
                material.uniforms.u_normalFlipY.value = 1;
                material.uniforms.u_normalMap.value = configureNormalMap(createProceduralNormalMap(), renderer);
                resolve();
            }
        );
    });

    const virtualCamera = new THREE.PerspectiveCamera();
    const reflectorPlane = new THREE.Plane();
    const normal = new THREE.Vector3();
    const reflectorPosition = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const rotationMatrix = new THREE.Matrix4();
    const lookAt = new THREE.Vector3();
    const clipPlane = new THREE.Vector4();
    const view = new THREE.Vector3();
    const target = new THREE.Vector3();
    const q = new THREE.Vector4();
    const textureMatrix = material.uniforms.u_textureMatrix.value;

    function mirror(camera)
    {
        reflectorPosition.setFromMatrixPosition(mesh.matrixWorld);
        cameraPosition.setFromMatrixPosition(camera.matrixWorld);

        rotationMatrix.extractRotation(mesh.matrixWorld);
        normal.set(0, 0, 1).applyMatrix4(rotationMatrix);

        view.subVectors(reflectorPosition, cameraPosition);

        // Camera is under the floor: nothing to reflect.
        if (view.dot(normal) > 0) return false;

        view.reflect(normal).negate();
        view.add(reflectorPosition);

        rotationMatrix.extractRotation(camera.matrixWorld);

        lookAt.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraPosition);

        target.subVectors(reflectorPosition, lookAt);
        target.reflect(normal).negate();
        target.add(reflectorPosition);

        virtualCamera.position.copy(view);
        virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
        virtualCamera.lookAt(target);
        virtualCamera.far = camera.far;
        virtualCamera.updateMatrixWorld();
        virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

        textureMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        textureMatrix.multiply(virtualCamera.projectionMatrix);
        textureMatrix.multiply(virtualCamera.matrixWorldInverse);
        textureMatrix.multiply(mesh.matrixWorld);

        // Oblique near plane, so nothing below the floor leaks into the
        // mirrored render. See Lengyel, "Oblique View Frustum Depth Projection
        // and Clipping".
        reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorPosition);
        reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);

        clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);

        const projection = virtualCamera.projectionMatrix;

        q.x = (Math.sign(clipPlane.x) + projection.elements[8]) / projection.elements[0];
        q.y = (Math.sign(clipPlane.y) + projection.elements[9]) / projection.elements[5];
        q.z = -1.0;
        q.w = (1.0 + projection.elements[10]) / projection.elements[14];

        clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

        projection.elements[2] = clipPlane.x;
        projection.elements[6] = clipPlane.y;
        projection.elements[10] = clipPlane.z + 1.0;
        projection.elements[14] = clipPlane.w;

        return true;
    }

    return {
        object: mesh,
        material: material,
        settings: settings,
        ready: ready,

        setSize: function (width, height, pixelRatio)
        {
            // Half resolution, but never below 512 on a side.
            const w = Math.max(512, Math.floor(width * pixelRatio * 0.5));
            const h = Math.max(512, Math.floor(height * pixelRatio * 0.5));

            reflection.setSize(w, h);
            scratch.setSize(w, h);
        },

        update: function (dt)
        {
            const offset = material.uniforms.u_offset.value;
            const rate = SCROLL_RATE * material.uniforms.u_repeat.value.y;

            offset.y = (((offset.y - rate * dt) % 1) + 1) % 1;
        },

        // Call once per frame, after the camera is final and before the main
        // render reads the reflection.
        render: function (scene, camera)
        {
            if (!mirror(camera)) return;

            const previousTarget = renderer.getRenderTarget();

            mesh.visible = false;
            reflectPass.value = 1;

            renderer.setRenderTarget(reflection);
            renderer.clear();
            renderer.render(scene, virtualCamera);

            reflectPass.value = 0;
            mesh.visible = true;

            // Two-pass gaussian; the 9-tap kernel spans +/- settings.blur px.
            const spread = settings.blur / 4;

            blurMaterial.uniforms.tDiffuse.value = reflection.texture;
            blurMaterial.uniforms.u_step.value.set(spread / reflection.width, 0);
            renderer.setRenderTarget(scratch);
            quad.render(renderer);

            blurMaterial.uniforms.tDiffuse.value = scratch.texture;
            blurMaterial.uniforms.u_step.value.set(0, spread / reflection.height);
            renderer.setRenderTarget(reflection);
            quad.render(renderer);

            renderer.setRenderTarget(previousTarget);
        }
    };
}
