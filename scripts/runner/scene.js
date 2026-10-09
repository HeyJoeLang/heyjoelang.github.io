/*
    Runner hero: renderer setup, the frame loop, scroll progress and resize.
    Everything visible is built by the sibling modules and assembled here.

    Query flags:
      ?debug     adds a lil-gui panel and exposes window.__runner
      ?stage=N   stops at build-order milestone N (1-8), for isolating a layer
      ?still     forces the prefers-reduced-motion path (one static frame)
      ?palette=  one of the names in common.js PALETTES
*/

import * as THREE from "three";
import { COLORS, PALETTES, applyPalette, clamp, smoothstep } from "./common.js";
import { loadRunner } from "./runner.js";
import { createParticles } from "./particles.js";
import { createStreaks } from "./streaks.js";
import { createFloor } from "./floor.js";
import { createCameraRig } from "./cameraRig.js";
import { createPost } from "./post.js";
import { prepareGameDom, showGameDom } from "./handoff.js";
import { GAME_CAMERA, gameFov } from "./plus/view.js";

const ASSETS = "assets/runner/";

const query = new URLSearchParams(window.location.search);
const debug = query.has("debug");
const stage = Number(query.get("stage")) || 10;

const mobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
const reducedMotion = query.has("still")
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/*
    The canvas names the element it scrolls against (data-track) and how it is
    being used (data-mode):

      default   the Runner page's hero. Progress runs 0 -> 1 as the track
                scrolls off the top, through all four camera keyframes.
      ambient   a background behind page content (index.html). Progress runs
                over the track's whole pass through the viewport, mapped onto
                a short, calm stretch of the camera path, and everything that
                costs fill rate or pulls the eye is turned down.
*/
const canvas = document.getElementById("runner-canvas");
const hero = document.getElementById(canvas.dataset.track || "runner-hero");
const ambient = canvas.dataset.mode === "ambient";
const statusEl = document.getElementById("runner-status");

// Slice of the keyframe path the ambient camera travels: a low three-quarter
// view that keeps the runner to one side, clear of the centred text column,
// and stops well short of the swing behind it and the grey-out.
const AMBIENT_RANGE = [0.13, 0.4];

const MAX_DT = 0.04;

const params = {
    // Applied here, before any material exists, so nothing is built in the
    // default colours and then repainted.
    palette: applyPalette(query.get("palette")),

    speed: 0.8,
    wireSpeed: 1.75,
    emitInterval: 0.25,

    // Spec amplitudes are the 1.0 point; see the note in the hand-off.
    shake: ambient ? 0.2 : 0.4,
    // Scales the keyframes' off-centre offsets; 1 is the spec, 0 centres.
    // Ambient pulls the runner in a little so it clears the viewport edge.
    framing: ambient ? 0.8 : 1,
    mouseLook: false,
    useScroll: true,
    scrub: 0,

    // The spec's starting point (1.2 / threshold 0) whites out the frame with
    // UnrealBloomPass, which sums five blur levels; these keep the neon read.
    bloomStrength: ambient ? 0.3 : 0.4,
    bloomRadius: 0.3,
    bloomThreshold: 0.1,

    particleSpeed: 3.9,
    particleAcceleration: 10,
    particleDrift: 0.12,
    particleSize: 1
};

const stats = { fps: 0, quality: 1, drawCalls: 0, triangles: 0, points: 0 };

// Resolution scale never drops below this, however slow the machine.
const MIN_QUALITY = 0.6;
const budget = { frames: 0, time: 0 };

let renderer, scene, camera, rig, runner, particles, streaks, floor, post;
let heroHeight = 1;
let pixelRatio = 1;
let emitClock = 0;
let last = 0;
let frameId = 0;
let heroVisible = true;
let ready = false;

/*
    The shaders read the shared COLORS through uniforms and follow by
    themselves. These three do not: the body material and the clear colour hold
    their own copies, and the page around the canvas is CSS.
*/
function syncPalette()
{
    if (renderer) renderer.setClearColor(COLORS.bg, 1);
    if (runner) runner.bodyMaterial.color.copy(COLORS.body);

    const root = document.documentElement.style;
    root.setProperty("--runner-bg", "#" + COLORS.bg.getHexString());
    root.setProperty("--runner-teal", "#" + COLORS.cool.getHexString());
    root.setProperty("--runner-warm", "#" + COLORS.warm.getHexString());
    root.setProperty("--runner-tint", "#" + COLORS.tintB.getHexString());

    requestStill();
}

function setPalette(name)
{
    params.palette = applyPalette(name);
    syncPalette();
}

/*
    Hand-off to Runner+.

    Play does not navigate. This scene keeps running while its camera swings
    round to the game's view from behind the runner, the floor and streaks
    fade out, and the game's modules and markup load in the background. When
    both are done the game is given the renderer, scene, runner, particles and
    post chain and carries on in the same canvas, building its tunnel outward
    from the runner. The figure never stops running and no frame is dropped.
*/
const HANDOFF_SECONDS = 1.6;

let handoff = null;         // set while the camera is flying
let handedOff = false;      // true once the game owns the scene

const handoffLook = new THREE.Vector3();
const gameTarget = new THREE.Vector3().fromArray(GAME_CAMERA.target);
const runnerCentre = new THREE.Vector3(0, 0.9, 0);

function beginHandoff()
{
    const position = camera.position;

    // Where the camera is looking now, as a point about as far away as the
    // runner, so the aim can be eased from it to the game's target.
    const lookFrom = camera.getWorldDirection(new THREE.Vector3())
        .multiplyScalar(position.distanceTo(rig.target))
        .add(position);

    handoff = {
        time: 0,
        angle: Math.atan2(position.x, position.z),
        radius: Math.hypot(position.x, position.z),
        height: position.y,
        lookFrom: lookFrom,
        fov: camera.fov,
        floorStrength: floor ? floor.material.uniforms.u_strength.value : 0,
        game: null
    };

    document.documentElement.classList.add("runner-leaving");
    window.scrollTo({ top: 0, behavior: "instant" });

    Promise.all([import("./plus/game.js"), prepareGameDom()]).then(function (loaded)
    {
        handoff.game = { module: loaded[0], dom: loaded[1] };
    }).catch(function (error)
    {
        // Anything wrong with the seamless route: take the ordinary one.
        console.warn("Runner+ hand-off failed; navigating instead.", error);
        window.location.href = "runnerPlus.html";
    });
}

function updateHandoffCamera(rawDt)
{
    handoff.time += rawDt;

    const e = smoothstep(0, HANDOFF_SECONDS, handoff.time);
    const lerp = function (a, b) { return a + (b - a) * e; };

    // Round the runner rather than straight through it: the angle about the
    // vertical axis runs to directly behind, by whichever side is nearer.
    const endAngle = handoff.angle >= 0 ? Math.PI : -Math.PI;
    const endRadius = Math.hypot(GAME_CAMERA.position[0], GAME_CAMERA.position[2]);

    const angle = lerp(handoff.angle, endAngle);
    const radius = lerp(handoff.radius, endRadius);

    camera.position.set(
        Math.sin(angle) * radius,
        lerp(handoff.height, GAME_CAMERA.position[1]),
        Math.cos(angle) * radius
    );

    // Aim in two overlapping moves: first settle on the runner, so the figure
    // stays in frame for the whole swing, then lift to the game's target down
    // the tunnel, which from behind lies almost straight past it.
    const t = handoff.time / HANDOFF_SECONDS;

    handoffLook.lerpVectors(handoff.lookFrom, runnerCentre, smoothstep(0, 0.35, t));
    handoffLook.lerp(gameTarget, smoothstep(0.55, 1, t));

    camera.lookAt(handoffLook);
    camera.fov = lerp(handoff.fov, gameFov(camera.aspect));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // What the game has no use for leaves as the camera arrives.
    if (floor) floor.material.uniforms.u_strength.value = handoff.floorStrength * (1 - e);
    if (streaks) streaks.material.uniforms.u_fade.value = 1 - e;
}

function finishHandoff()
{
    const game = handoff.game;

    handedOff = true;
    handoff = null;

    window.cancelAnimationFrame(frameId);
    frameId = 0;

    if (floor) scene.remove(floor.object);
    if (streaks) scene.remove(streaks.object);

    showGameDom(game.dom);

    game.module.boot({
        renderer: renderer,
        scene: scene,
        camera: camera,
        runner: runner,
        particles: particles,
        post: post,
        stage: game.dom.stage
    });
}

const playLink = document.querySelector(".runner-play");

if (playLink && !ambient)
{
    playLink.addEventListener("click", function (event)
    {
        // Not ours to intercept: a new-tab click, a scene that never came
        // up, a visitor who asked for less motion, or a fly-through already
        // under way. All of those just follow the link.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!ready || !frameId || reducedMotion || stage < 8) return;

        event.preventDefault();

        if (!handoff) beginHandoff();
    });
}

function scrollProgress()
{
    if (!params.useScroll) return params.scrub;

    if (ambient)
    {
        // 0 as the track's top edge enters at the bottom of the viewport,
        // 1 as its bottom edge leaves at the top.
        const rect = hero.getBoundingClientRect();
        const through = clamp((window.innerHeight - rect.top) / (rect.height + window.innerHeight), 0, 1);

        return AMBIENT_RANGE[0] + (AMBIENT_RANGE[1] - AMBIENT_RANGE[0]) * through;
    }

    return clamp(window.scrollY / heroHeight, 0, 1);
}

function emit()
{
    if (runner && runner.wires) runner.wires.uniforms.emitRatio.value = 1;

    if (particles)
    {
        // Particles are dropped on the pose as it stands right now.
        runner.group.updateMatrixWorld(true);
        particles.emit();
    }
}

// Move the simulation forward. rawDt is wall-clock, already clamped.
function advance(rawDt)
{
    const dt = rawDt * params.speed;

    if (runner)
    {
        runner.mixer.update(dt);

        if (runner.wires)
        {
            runner.wires.uniforms.time.value += dt * params.wireSpeed;
            runner.wires.uniforms.emitRatio.value *= Math.pow(0.9, rawDt * 60);
        }

        emitClock += dt;

        if (emitClock >= params.emitInterval)
        {
            emitClock %= params.emitInterval;
            emit();
        }
    }

    if (streaks) streaks.update(dt);
    if (floor) floor.update(dt);

    if (particles)
    {
        particles.update(dt, {
            speed: params.particleSpeed,
            acceleration: params.particleAcceleration,
            drift: params.particleDrift
        });
    }
}

function draw(rawDt)
{
    // Scroll position is frozen at the top for the length of the fly-through.
    const progress = handoff ? 0 : scrollProgress();

    if (handoff)
    {
        updateHandoffCamera(rawDt);
    }
    else
    {
        rig.update(progress, rawDt, {
            shake: reducedMotion ? 0 : params.shake,
            framing: params.framing,
            mouseLook: params.mouseLook
        });
    }

    renderer.info.reset();

    if (floor) floor.render(scene, camera);
    post.render(progress);

    stats.drawCalls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    stats.points = renderer.info.render.points;
}

function frame(now)
{
    frameId = window.requestAnimationFrame(frame);

    const elapsed = (now - last) / 1000;
    last = now;

    if (elapsed > 0) stats.fps += (1 / elapsed - stats.fps) * 0.05;

    /*
        Fill rate is the cost here (bloom, SMAA and the mirrored render all
        scale with pixels), so when a machine cannot hold the frame rate the
        resolution steps down. It only ever steps down: climbing back would
        just find the same limit again and oscillate.
    */
    if (elapsed > 0 && elapsed < 0.25)
    {
        budget.frames++;
        budget.time += elapsed;

        if (budget.frames >= 90)
        {
            if (budget.frames / budget.time < 50 && stats.quality > MIN_QUALITY)
            {
                stats.quality = Math.max(MIN_QUALITY, stats.quality * 0.85);
                resize();
            }

            budget.frames = 0;
            budget.time = 0;
        }
    }

    const rawDt = Math.min(elapsed, MAX_DT);

    advance(rawDt);
    draw(rawDt);

    // Camera in place and the game loaded: this was the last frame drawn here.
    if (handoff && handoff.game && handoff.time >= HANDOFF_SECONDS) finishHandoff();
}

/*
    The loop only runs while the hero is on screen and the tab is visible. With
    reduced motion it never runs: one still frame is drawn, and redrawn when
    scroll or size changes, so the camera still answers to scroll but nothing
    moves by itself.
*/
function syncLoop()
{
    if (handedOff) return;

    const shouldRun = ready && heroVisible && !document.hidden && !reducedMotion;

    if (shouldRun && !frameId)
    {
        last = performance.now();
        frameId = window.requestAnimationFrame(frame);
    }
    else if (!shouldRun && frameId)
    {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
    }
}

let stillQueued = false;

function requestStill()
{
    if (!ready || frameId || stillQueued || handedOff) return;

    stillQueued = true;

    window.requestAnimationFrame(function ()
    {
        stillQueued = false;
        draw(0);
    });
}

function resize()
{
    // The game sizes the renderer once it owns it.
    if (handedOff) return;

    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    // Behind a scrim nobody can see the extra pixels, so ambient runs lean.
    const cap = ambient ? (mobile ? 1 : 1.25) : (mobile ? 1.5 : 2);

    pixelRatio = Math.min(window.devicePixelRatio || 1, cap) * stats.quality;
    heroHeight = Math.max(1, hero.offsetHeight);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (floor) floor.setSize(width, height, pixelRatio);
    if (post) post.setSize(width, height, pixelRatio);
    if (particles) particles.material.uniforms.u_scale.value = pixelRatio * params.particleSize;

    requestStill();
}

async function initDebug()
{
    const { GUI } = await import("three/addons/libs/lil-gui.module.min.js");
    const gui = new GUI({ title: "Runner" });

    gui.add(params, "speed", 0, 2, 0.01);
    gui.add(params, "wireSpeed", 0, 5, 0.01);
    gui.add({ emit: emit }, "emit");

    // Presets, plus a picker per role for mixing one by hand. Picking a
    // preset overwrites the pickers; editing a picker leaves the preset name
    // showing whatever it was last, as a starting point rather than a label.
    const paletteFolder = gui.addFolder("Palette");
    paletteFolder.add(params, "palette", Object.keys(PALETTES)).name("preset").onChange(function (name)
    {
        setPalette(name);
        paletteFolder.controllersRecursive().forEach(function (c) { c.updateDisplay(); });
    });

    ["bg", "cool", "warm", "tintA", "tintB", "body"].forEach(function (role)
    {
        paletteFolder.addColor(COLORS, role).onChange(syncPalette);
    });

    paletteFolder.add({
        log: function ()
        {
            const out = {};
            Object.keys(COLORS).forEach(function (role) { out[role] = "0x" + COLORS[role].getHexString(); });
            console.log("palette: " + JSON.stringify(out).replace(/"/g, ""));
        }
    }, "log").name("log values to console");

    const cameraFolder = gui.addFolder("Camera");
    cameraFolder.add(params, "useScroll").name("follow scroll");
    cameraFolder.add(params, "scrub", 0, 1, 0.001).name("keyframe scrub").onChange(function ()
    {
        params.useScroll = false;
        cameraFolder.controllersRecursive().forEach(function (c) { c.updateDisplay(); });
    });
    cameraFolder.add(params, "shake", 0, 1.5, 0.01);
    cameraFolder.add(params, "framing", 0, 1.5, 0.01).name("off-centre");
    cameraFolder.add(params, "mouseLook");

    if (post.bloom)
    {
        const bloomFolder = gui.addFolder("Bloom");
        bloomFolder.add(params, "bloomStrength", 0, 3, 0.01).name("strength").onChange(function (v) { post.bloom.strength = v; });
        bloomFolder.add(params, "bloomRadius", 0, 1, 0.01).name("radius").onChange(function (v) { post.bloom.radius = v; });
        bloomFolder.add(params, "bloomThreshold", 0, 1, 0.005).name("threshold").onChange(function (v) { post.bloom.threshold = v; });
    }

    if (particles)
    {
        const particleFolder = gui.addFolder("Particles");
        particleFolder.add(params, "emitInterval", 0.05, 1, 0.01);
        particleFolder.add(params, "particleSpeed", 0, 10, 0.1).name("speed");
        particleFolder.add(params, "particleAcceleration", 0, 30, 0.1).name("acceleration");
        particleFolder.add(params, "particleDrift", 0, 1, 0.01).name("drift");
        particleFolder.add(params, "particleSize", 0.25, 3, 0.01).name("size").onChange(resize);
    }

    if (floor)
    {
        const floorFolder = gui.addFolder("Floor");
        floorFolder.add(floor.material.uniforms.u_strength, "value", 0, 2, 0.01).name("reflection");
        floorFolder.add(floor.material.uniforms.u_distortion, "value", 0, 0.1, 0.001).name("distortion");
        floorFolder.add(floor.material.uniforms.u_tiltBoost, "value", 0, 5, 0.01).name("edge boost");
        floorFolder.add(floor.settings, "blur", 0, 12, 0.1).name("blur px");
        floorFolder.add(floor.material.uniforms.u_repeat.value, "x", 1, 24, 0.5).name("tile repeat").onChange(function (v)
        {
            floor.material.uniforms.u_repeat.value.y = v;
        });
    }

    gui.add(runner.bodyMaterial, "opacity", 0, 1, 0.01).name("body opacity");

    const statsFolder = gui.addFolder("Stats");
    statsFolder.add(stats, "fps").listen().disable().decimals(0);
    statsFolder.add(stats, "quality").listen().disable().decimals(2);
    statsFolder.add(stats, "drawCalls").listen().disable();
    statsFolder.add(stats, "triangles").listen().disable();
    statsFolder.add(stats, "points").listen().disable();

    // Sliders have no visible effect on a still frame unless it is redrawn.
    gui.onChange(requestStill);

    window.__runner = {
        params: params, stats: stats, renderer: renderer, scene: scene, camera: camera,
        runner: runner, particles: particles, streaks: streaks, floor: floor, post: post,
        advance: advance, draw: draw, setPalette: setPalette
    };
}

async function init()
{
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        // Once the composer is in the chain SMAA does the anti-aliasing.
        antialias: stage < 8,
        powerPreference: "high-performance"
    });

    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    syncPalette();

    // Several renders make up one frame; count them all.
    renderer.info.autoReset = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 400);
    rig = createCameraRig({ camera: camera, mobile: mobile });

    const pending = [];

    if (stage >= 2)
    {
        runner = await loadRunner({
            url: ASSETS + "runner.glb",
            strands: mobile ? 128 : 256,
            wires: stage >= 6
        });

        scene.add(runner.group);
    }

    if (stage >= 4)
    {
        streaks = createStreaks({ count: (mobile ? 192 : 384) * (ambient ? 0.4 : 1) });
        scene.add(streaks.object);
    }

    if (stage >= 5)
    {
        floor = createFloor({
            renderer: renderer,
            normalMapUrl: ASSETS + "floor_normal.jpg",
            normalMapDirectX: false,
            repeat: 16
        });
        scene.add(floor.object);
        pending.push(floor.ready);
    }

    if (stage >= 7 && runner)
    {
        const shortSide = Math.min(window.screen.width, window.screen.height);

        particles = createParticles({
            meshes: runner.meshes,
            count: Math.round(clamp(1.25 * shortSide, 800, 2500) * (mobile || ambient ? 0.6 : 1))
        });

        scene.add(particles.object);
    }

    post = createPost({
        renderer: renderer,
        scene: scene,
        camera: camera,
        mobile: mobile,
        smaa: !mobile && !ambient,
        enabled: stage >= 8
    });

    if (post.bloom)
    {
        post.bloom.strength = params.bloomStrength;
        post.bloom.radius = params.bloomRadius;
        post.bloom.threshold = params.bloomThreshold;
    }

    await Promise.all(pending);

    ready = true;
    resize();

    // Run the sim forward a little before the first frame, so the scene
    // opens (or, with reduced motion, rests) with particles already in flight.
    for (let i = 0; i < 45; i++) advance(0.033);

    draw(0);

    window.addEventListener("resize", resize);
    window.addEventListener("scroll", requestStill, { passive: true });
    document.addEventListener("visibilitychange", syncLoop);

    // Pause entirely once the hero has scrolled off screen.
    new IntersectionObserver(function (entries)
    {
        heroVisible = entries[entries.length - 1].isIntersecting;
        syncLoop();
    }).observe(hero);

    syncLoop();

    if (debug) await initDebug();

    document.documentElement.classList.add("runner-ready");
    hero.classList.add("runner-live");
    if (statusEl) statusEl.textContent = "";

    // For anything on the page that cares the scene is now showing.
    window.dispatchEvent(new Event("runnerready"));
}

init().catch(function (error)
{
    console.error("Runner scene failed to start:", error);

    document.documentElement.classList.add("runner-failed");
    if (statusEl) statusEl.textContent = "The 3D scene could not be loaded in this browser.";
});
