/*
    Runner+ : an endless runner on the inside of a tunnel.

    The runner never moves. It stands at the origin facing +Z with the camera
    behind it, and the tunnel does everything: its wall and its obstacles
    slide toward -Z as distance is covered, and the whole tunnel rolls about
    its axis when the player steers, so that wherever they have run to is
    always the bottom of the screen.

    The figure, its wires, the particles and the post chain are the Runner
    page's own modules, reused as they are.

    Query flags:
      ?debug     exposes window.__game (tuning, skip(metres), manual stepping)
      ?palette=  one of the names in common.js PALETTES
*/

import * as THREE from "three";
import { COLORS, applyPalette, blendPalettes, clamp, smoothstep } from "../common.js";
import { loadRunner } from "../runner.js";
import { createParticles } from "../particles.js";
import { createPost } from "../post.js";
import { createTunnel } from "./tunnel.js";
import { createObstacles } from "./obstacles.js";
import { createInput } from "./input.js";
import { createHud } from "./hud.js";

const ASSETS = "assets/runner/";

const query = new URLSearchParams(window.location.search);
const debug = query.has("debug");

const mobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const stage = document.getElementById("rp-stage");
const canvas = document.getElementById("rp-canvas");

const basePalette = applyPalette(query.get("palette"));

/*
    The run is divided into zones, each with its own palette. Every run opens
    in the base palette and works through the rest in this order, round again
    if the player gets that far. They are ordered so neighbours share a hue:
    each change reads as the tunnel shifting colour, not as a cut.
*/
const ZONES = [basePalette].concat(
    ["plasma", "synthwave", "ultraviolet", "uv-hot", "neon-rose", "neon", "neon-mint"]
        .filter(function (name) { return name !== basePalette; })
);

const RADIUS = 3;
const MAX_DT = 0.04;

const tuning = {
    idleSpeed: 7,           // drift speed behind the start screen
    startSpeed: 13,         // world units per second at the start of a run
    topSpeed: 34,
    rampSeconds: 55,        // time constant of the climb toward topSpeed
    difficultySeconds: 90,  // time for ring spacing and gaps to reach their tightest
    steerRate: 2.6,         // radians per second round the wall at full lock
    steerResponse: 12,      // how quickly the roll picks up and lets go
    restartDelay: 0.6,      // seconds after a crash before input restarts

    // Spectacle. Everything below changes how a run looks, not how it plays.
    milestoneEvery: 250,    // metres between callouts
    zoneLength: 500,        // metres per palette
    zoneBlend: 70,          // metres a palette change takes
    fullIntensityAt: 1500   // metres at which the tunnel is fully lit up
};

let renderer, scene, camera, world, runner, particles, tunnel, obstacles, post, hud, input;

// "ready" (start screen), "playing", "over".
let state = "loading";

let travel = 0;         // total distance the tunnel has slid past, ever
let runStart = 0;       // travel at the start of the current run
let runEnd = 0;         // travel at the moment it ended
let runTime = 0;
let speed = tuning.idleSpeed;
let rotation = 0;       // roll of the tunnel about its axis
let rollRate = 0;
let overFor = 0;
let grey = 0;
let shake = 0;
let emitClock = 0;
let nextMilestone = 0;
let settledZone = 0;       // zone whose palette is fully applied

let pixelRatio = 1;
let quality = 1;
let frameId = 0;
let last = 0;
let visible = true;

const budget = { frames: 0, time: 0 };

function score()
{
    // The tunnel keeps sliding for a moment after a crash; the run does not.
    const end = state === "over" ? runEnd : travel;

    return Math.max(0, Math.floor(end - runStart));
}

// The shaders follow COLORS by themselves; the clear colour and the page's
// CSS hold copies and have to be told.
function syncColours()
{
    renderer.setClearColor(COLORS.bg, 1);

    const root = document.documentElement.style;
    root.setProperty("--rp-bg", "#" + COLORS.bg.getHexString());
    root.setProperty("--rp-accent", "#" + COLORS.tintB.getHexString());
}

/*
    How far the run has got decides how it looks: the tunnel fills with light
    as intensity climbs, each zone boundary slides the palette into the next,
    and every milestone is marked with a flash and a ring sent down the tunnel.
*/
function updateSpectacle(metres)
{
    const intensity = clamp(metres / tuning.fullIntensityAt, 0, 1);

    tunnel.uniforms.u_intensity.value = intensity;
    post.bloom.strength = 0.4 + 0.15 * intensity;

    const zone = Math.floor(metres / tuning.zoneLength);
    const into = metres - zone * tuning.zoneLength;

    if (zone > 0 && into < tuning.zoneBlend)
    {
        blendPalettes(
            ZONES[(zone - 1) % ZONES.length],
            ZONES[zone % ZONES.length],
            smoothstep(0, tuning.zoneBlend, into)
        );
        syncColours();
    }
    else if (zone !== settledZone)
    {
        applyPalette(ZONES[zone % ZONES.length]);
        syncColours();
        settledZone = zone;
    }

    if (metres >= nextMilestone)
    {
        hud.toast(nextMilestone + " m");
        nextMilestone += tuning.milestoneEvery;

        runner.wires.uniforms.emitRatio.value = 1.5;
        tunnel.uniforms.u_flash.value = 0.5;
        tunnel.uniforms.u_shock.value = 0;
    }
}

function go()
{
    if (state === "ready" || (state === "over" && overFor > tuning.restartDelay)) start();
}

function start()
{
    state = "playing";
    runStart = travel;
    runTime = 0;
    speed = tuning.startSpeed;
    rollRate = 0;
    grey = 0;

    // Every run starts dark and in the base palette, and earns the rest.
    nextMilestone = tuning.milestoneEvery;
    settledZone = 0;
    applyPalette(basePalette);
    syncColours();
    tunnel.uniforms.u_intensity.value = 0;
    tunnel.uniforms.u_shock.value = -1000;

    // The player is at whatever angle currently sits at the bottom.
    obstacles.reset(travel, -rotation);

    hud.setScore(0);
    hud.hide();

    // With reduced motion nothing runs until the player asks for it.
    syncLoop();
}

function crash()
{
    state = "over";
    runEnd = travel;
    overFor = 0;
    shake = 1;

    runner.wires.uniforms.emitRatio.value = 1.5;
    tunnel.uniforms.u_flash.value = 1;

    hud.showOver(score());
}

function emit()
{
    runner.wires.uniforms.emitRatio.value = Math.max(runner.wires.uniforms.emitRatio.value, 1);

    runner.group.updateMatrixWorld(true);
    particles.emit();
}

function advance(dt)
{
    const previousTravel = travel;

    if (state === "playing")
    {
        runTime += dt;
        speed = tuning.startSpeed
            + (tuning.topSpeed - tuning.startSpeed) * (1 - Math.exp(-runTime / tuning.rampSeconds));
    }
    else if (state === "over")
    {
        overFor += dt;
        speed *= Math.pow(0.02, dt);        // skid to a stop
        grey = Math.min(1, grey + dt * 3);
    }
    else
    {
        speed += (tuning.idleSpeed - speed) * Math.min(1, dt * 2);
    }

    // Steering eases in and out so the roll has some weight to it.
    const wanted = state === "playing" ? input.steer() * tuning.steerRate : 0;

    rollRate += (wanted - rollRate) * Math.min(1, dt * tuning.steerResponse);
    rotation += rollRate * dt;
    travel += speed * dt;

    if (state === "playing")
    {
        obstacles.update(travel, {
            speed: speed,
            difficulty: clamp(runTime / tuning.difficultySeconds, 0, 1),
            steerRate: tuning.steerRate
        });

        hud.setScore(score());
        updateSpectacle(travel - runStart);

        if (obstacles.hit(previousTravel, travel, rotation)) crash();
    }
    else
    {
        obstacles.update(travel);
    }

    // The stride keeps time with the ground speed.
    const pace = speed / tuning.startSpeed;

    runner.mixer.update(dt * 0.8 * pace);
    runner.wires.uniforms.time.value += dt * 1.75;
    runner.wires.uniforms.emitRatio.value *= Math.pow(0.9, dt * 60);

    emitClock += dt * Math.max(pace, 0.25);

    if (emitClock >= 0.25)
    {
        emitClock %= 0.25;
        emit();
    }

    // Much gentler than the hero scene's. There the trail streams off to one
    // side of the frame; here it comes straight at the camera, and at full
    // strength it would hide the runner and the blocks ahead.
    particles.update(dt, {
        speed: 1.2 * pace,
        acceleration: 1.5 * pace,
        drift: 0.2
    });

    tunnel.uniforms.u_distance.value = travel;
    tunnel.uniforms.u_flash.value *= Math.pow(0.02, dt);
    tunnel.uniforms.u_time.value += dt;

    // The milestone ring runs out to the horizon, then parks.
    if (tunnel.uniforms.u_shock.value > -500)
    {
        tunnel.uniforms.u_shock.value += dt * 95;
        if (tunnel.uniforms.u_shock.value > 150) tunnel.uniforms.u_shock.value = -1000;
    }

    shake *= Math.pow(0.01, dt);
}

function draw()
{
    world.rotation.z = rotation;

    // Lean the figure into the turn, and roll the camera a little with it.
    // (Looking down +Z, screen-right is -X, so a positive roll leans right.)
    runner.group.rotation.z = rollRate * 0.09;

    camera.position.set(
        (Math.random() - 0.5) * shake * 0.25,
        1.55 + (Math.random() - 0.5) * shake * 0.25,
        -3.6
    );
    camera.lookAt(0, 1.15, 8);
    camera.rotateZ(-rollRate * 0.035);

    post.render(grey);
}

function frame(now)
{
    frameId = window.requestAnimationFrame(frame);

    const elapsed = (now - last) / 1000;
    last = now;

    // Same resolution step-down as the Runner page: only ever downward.
    if (elapsed > 0 && elapsed < 0.25)
    {
        budget.frames++;
        budget.time += elapsed;

        if (budget.frames >= 90)
        {
            if (budget.frames / budget.time < 50 && quality > 0.6)
            {
                quality = Math.max(0.6, quality * 0.85);
                resize();
            }

            budget.frames = 0;
            budget.time = 0;
        }
    }

    advance(Math.min(elapsed, MAX_DT));
    draw();
}

/*
    The loop stops while the tab is hidden, which also pauses a run in
    progress: no time passes, so nothing is lost by switching away. With
    reduced motion the start screen is a still frame and the loop only runs
    once the player has started.
*/
function syncLoop()
{
    const shouldRun = state !== "loading" && visible && !document.hidden
        && !(reducedMotion && state === "ready");

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

function resize()
{
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5) * quality;

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;

    // Hold the horizontal view on tall screens, or a phone in portrait would
    // see so little of the wall that blocks arrive without warning.
    camera.fov = camera.aspect < 1 ? clamp(62 / camera.aspect, 62, 95) : 62;
    camera.updateProjectionMatrix();

    post.setSize(width, height, pixelRatio);
    particles.material.uniforms.u_scale.value = pixelRatio * 0.6;

    if (!frameId && state !== "loading") draw();
}

async function init()
{
    hud = createHud({ onGo: go });

    renderer = new THREE.WebGLRenderer({ canvas: canvas, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    syncColours();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, 1, 0.05, 300);

    // Everything that rolls when the player steers. Its origin is the tunnel
    // axis, one radius above the runner's feet.
    world = new THREE.Group();
    world.position.set(0, RADIUS, 0);
    scene.add(world);

    tunnel = createTunnel({ radius: RADIUS });
    world.add(tunnel.object);

    obstacles = createObstacles({ radius: RADIUS });
    world.add(obstacles.object);

    runner = await loadRunner({ url: ASSETS + "runner.glb", strands: mobile ? 128 : 256 });
    scene.add(runner.group);

    particles = createParticles({ meshes: runner.meshes, count: mobile ? 700 : 1200 });
    scene.add(particles.object);

    post = createPost({
        renderer: renderer,
        scene: scene,
        camera: camera,
        mobile: mobile,
        smaa: !mobile,
        enabled: true
    });

    post.bloom.strength = 0.4;
    post.bloom.radius = 0.3;
    post.bloom.threshold = 0.1;

    input = createInput({ surface: stage, onGo: go });

    state = "ready";
    resize();

    // Open with particles already in flight rather than an empty first frame.
    for (let i = 0; i < 40; i++) advance(0.033);

    draw();
    hud.showReady();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncLoop);

    new IntersectionObserver(function (entries)
    {
        visible = entries[entries.length - 1].isIntersecting;
        syncLoop();
    }).observe(stage);

    syncLoop();

    if (debug)
    {
        window.__game = {
            tuning: tuning, advance: advance, draw: draw, go: go,
            // Jump the current run forward, to look at a later zone without
            // having to survive to it. The course itself is not skipped.
            skip: function (metres) { runStart -= metres; },
            renderer: renderer, camera: camera, world: world, obstacles: obstacles,
            get state() { return state; },
            get speed() { return speed; },
            get rotation() { return rotation; },
            set rotation(value) { rotation = value; },
            get score() { return score(); }
        };
    }

    document.documentElement.classList.add("rp-ready");
}

init().catch(function (error)
{
    console.error("Runner+ failed to start:", error);

    if (hud) hud.showFailed();
});
