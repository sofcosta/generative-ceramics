import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "https://esm.sh/three/examples/jsm/utils/BufferGeometryUtils.js";
import { STLExporter } from "https://esm.sh/three/examples/jsm/exporters/STLExporter.js";
import GUI from "https://esm.sh/lil-gui";

import { OBJExporter } from 'https://esm.sh/three/examples/jsm/exporters/OBJExporter.js';

import * as BufferGeometryUtils from "https://esm.sh/three/examples/jsm/utils/BufferGeometryUtils.js";

// -----------------------------------------------------------
// SCENE SETUP
// -----------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Dark background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// We tell Three.js that the Z-axis is "Up" (default is Y). 
camera.up.set(0, 0, 1);
camera.position.set(0, -50, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// Use ACESFilmicToneMapping to make colors look more natural and "high-end"
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2; // Overall brightness boost
renderer.shadowMap.enabled = true;  // Enable shadow mapping in the renderer
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

// OrbitControls allow us to rotate, zoom, and pan around the object
const controls = new OrbitControls(camera, renderer.domElement);
controls.minPolarAngle = 0;        // Allow looking from top
controls.maxPolarAngle = Math.PI;  // Allow looking from bottom (180 degrees)
controls.target.set(0, 0, 10);     // Look at the middle of the object height
controls.update();

// -----------------------------------------------------------
// LIGHTING
// -----------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.2)); // Soft overall light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(20, -30, 40); // Side/Top light to create shadows and depth

light.castShadow = true;
// Improve shadow quality
light.shadow.mapSize.width = 2048; // Higher resolution shadows
light.shadow.mapSize.height = 2048;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;

// Adjust these if the shadow looks cut off:
light.shadow.camera.left = -50;
light.shadow.camera.right = 50;
light.shadow.camera.top = 50;
light.shadow.camera.bottom = -50;

scene.add(light);

// "Z" Light (Top)
const topLight = new THREE.DirectionalLight(0xffffff, 1);
topLight.position.set(0, 0, 50);
scene.add(topLight);

// "X" Light (Right)
const sideLight = new THREE.DirectionalLight(0x70613f, 1.2);
sideLight.position.set(50, 0, 10);
scene.add(sideLight);

// "Y" Light (Front)
const frontLight = new THREE.DirectionalLight(0xb49e68, 1.2);
frontLight.position.set(0, -50, 10);
scene.add(frontLight);



// Ground Plane (Crucial to see shadows being "cast" onto something)
const planeGeo = new THREE.PlaneGeometry(200, 200);
const planeMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(planeGeo, planeMat);
ground.receiveShadow = true; // Let shadows fall on this
scene.add(ground);

// -----------------------------------------------------------
// PARAMETERS
// -----------------------------------------------------------
const params = {
    height: 10,          // Total Z-height
    count: 8,            // How many times the branch repeats in a circle
    centerOffset: 2,
    reflect: true,       // If true, mirrors each branch for symmetry
    wallThickness: 0.3,  // Thickness of the tube wall (for 3D printing)

    points: 6,           // Number of "joints" in the random path
    inc: 3,              // Maximum distance the path can "drift" horizontally
    seed: 1234,          // Random seed to recreate the same shape

    shapeCount: 4,       // How many different shapes to morph through along the line
    shapeRadius: 2,      // Outer radius of the tube
    ratio: 1.0,          // X/Y stretch (1.0 is uniform)
    seedShape: 1,

    randomize: () => {
        params.height = 1 + Math.floor(Math.random() * 20);
        params.count = 2 + Math.floor(Math.random() * 15);
        params.centerOffset = Math.floor(Math.random() * 10);
        params.reflect = Math.random() > 0.5;
        params.wallThickness = 0.3;

        params.points = 2 + Math.floor(Math.random() * 10);
        params.inc = 0.1 + Math.floor(Math.random() * 10);
        params.seed = Math.floor(Math.random() * 10000);

        params.shapeCount = 2 + Math.floor(Math.random() * 10);
        params.shapeRadius = 1 + Math.floor(Math.random() * 5);
        params.ratio = 1.0;
        params.seedShape = Math.floor(Math.random() * 10000);

        gui.controllers.forEach(controller => controller.updateDisplay());
        gGeneral.controllers.forEach(controller => controller.updateDisplay());
        gLine.controllers.forEach(controller => controller.updateDisplay());
        gShapes.controllers.forEach(controller => controller.updateDisplay());

        build();
    }
};

//let internalSeed = params.seed;
const primitives = ['Square', 'Circle', 'Triangle'];

// OLD SEEDED RANDOM
// // A simple Deterministic Random function. 
// // Given the same seed, it always produces the same "random" numbers.
// function seededRandom() {
//     internalSeed = (internalSeed * 16807) % 2147483647;
//     return (internalSeed - 1) / 2147483646;
// }

function createGenerator(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// -----------------------------------------------------------
// SHAPE MATH (XY PROFILE)
// -----------------------------------------------------------
// This function calculates the (x,y) coordinate for a point on a 2D shape rim
function getPointOnPrimitive(type, angle, size) {
    const r = size;
    const rat = params.ratio;

    if (type === 'Circle') {
        return { x: Math.cos(angle) * r * rat, y: Math.sin(angle) * r };
    }
    if (type === 'Square') {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const scale = 1 / Math.max(Math.abs(cos), Math.abs(sin));
        return { x: cos * scale * r * rat, y: sin * scale * r };
    }
    if (type === 'Triangle') {
        // Logic to draw a 3-sided polygon using trigonometry
        const a = (angle + Math.PI / 2) % (Math.PI * 2);
        const step = (Math.PI * 2) / 3;
        const i = Math.floor(a / step), t = (a % step) / step;
        const p1 = { x: Math.cos(i * step - Math.PI / 2), y: Math.sin(i * step - Math.PI / 2) };
        const p2 = { x: Math.cos((i + 1) * step - Math.PI / 2), y: Math.sin((i + 1) * step - Math.PI / 2) };
        return { x: (p1.x + (p2.x - p1.x) * t) * r * 1.5 * rat, y: (p1.y + (p2.y - p1.y) * t) * r * 1.5 };
    }
}

// -----------------------------------------------------------
// GEOMETRY GENERATION (THE CORE)
// -----------------------------------------------------------
function createHollowMorphedLine() {
    //internalSeed = params.seed; // Reset seed so every branch starts with the same random logic

    const getShapeRand = createGenerator(params.seedShape);
    const getPathRand = createGenerator(params.seed);

    // Generate a random path (The skeleton of the branch)
    let pathPoints = [];
    let startX = (getPathRand() - 0.5) * params.inc * 2;
    let startY = (getPathRand() - 0.5) * params.inc * 2;
    let current = new THREE.Vector3(startX, startY, 0);
    pathPoints.push(current.clone());

    for (let i = 0; i < params.points; i++) {
        current.add(new THREE.Vector3(
            (getPathRand() - 0.5) * params.inc,
            (getPathRand() - 0.5) * params.inc,
            params.height / params.points
        ));
        pathPoints.push(current.clone());
    }

    // Smooth the random points into a curve
    const curve = new THREE.CatmullRomCurve3(pathPoints);
    const segments = 80;   // Vertical resolution
    const radialRes = 32;  // Resolution of the shape circle
    const vertices = [];
    const indices = [];

    // Choose the sequence of shapes this branch will morph through
    const branchShapes = [];
    const branchScales = [];
    for (let i = 0; i < params.shapeCount; i++) {
        branchShapes.push(primitives[Math.floor(getShapeRand() * primitives.length)]);
        branchScales.push(0.6 + getShapeRand() * 0.8); //random scale multiplier (between 0.6 and 1.4)
    }

    // --- Vertex Generation ---
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;        // Progress (0.0 to 1.0)
        const p = curve.getPointAt(t); // Center point of the tube at this height

        // Find which two shapes we are currently morphing between
        const sectionFloat = t * (params.shapeCount - 1);
        const index1 = Math.floor(sectionFloat);
        const index2 = Math.min(index1 + 1, params.shapeCount - 1);
        const localT = sectionFloat - index1; // Progress between Shape A and Shape B

        for (let j = 0; j < radialRes; j++) {
            const angle = (j / radialRes) * Math.PI * 2;

            // Get coordinates for Outer and Inner walls
            const p1Outer = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * branchScales[index1]);
            const p2Outer = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * branchScales[index2]);
            const p1Inner = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * branchScales[index1] - params.wallThickness);
            const p2Inner = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * branchScales[index2] - params.wallThickness);

            // LERP (Linear Interpolation) calculates the transition between Shape A and Shape B
            vertices.push(p.x + THREE.MathUtils.lerp(p1Outer.x, p2Outer.x, localT), p.y + THREE.MathUtils.lerp(p1Outer.y, p2Outer.y, localT), p.z);
            vertices.push(p.x + THREE.MathUtils.lerp(p1Inner.x, p2Inner.x, localT), p.y + THREE.MathUtils.lerp(p1Inner.y, p2Inner.y, localT), p.z);
        }
    }

    // --- Face Generation (Connecting vertices into triangles) ---
    const rowSize = radialRes * 2;
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < radialRes; j++) {
            const nextJ = (j + 1) % radialRes;
            const outCurr = i * rowSize + j * 2, inCurr = outCurr + 1;
            const outNext = i * rowSize + nextJ * 2, inNext = outNext + 1;
            const outAbove = (i + 1) * rowSize + j * 2, inAbove = outAbove + 1;
            const outAboveNext = (i + 1) * rowSize + nextJ * 2, inAboveNext = outAboveNext + 1;

            // Triangles for outer shell
            indices.push(outCurr, outNext, outAboveNext, outCurr, outAboveNext, outAbove);
            // Triangles for inner shell (reversed winding so it faces inward)
            indices.push(inCurr, inAboveNext, inNext, inCurr, inAbove, inAboveNext);
        }
    }

    // --- Capping the Rims ---
    // This connects the inner wall to the outer wall at the very start and end
    // making the object "Water Tight" for 3D printing.
    for (let j = 0; j < radialRes; j++) {
        const nextJ = (j + 1) % radialRes;
        const bOut = j * 2, bIn = j * 2 + 1, bOutN = nextJ * 2, bInN = nextJ * 2 + 1;
        indices.push(bOut, bIn, bInN, bOut, bInN, bOutN); // Bottom rim
        const tOffset = segments * rowSize;
        const tOut = tOffset + j * 2, tIn = tOffset + j * 2 + 1, tOutN = tOffset + nextJ * 2, tInN = tOffset + nextJ * 2 + 1;
        indices.push(tOut, tInN, tIn, tOut, tOutN, tInN); // Top rim
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // Crucial for lighting/shading
    return geometry;
}

// Mirroring a mesh makes it "inside out." This function flips the triangles back.
function reverseWindingOrder(geometry) {
    const indices = geometry.index.array;
    for (let i = 0; i < indices.length; i += 3) {
        const temp = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = temp;
    }
    geometry.computeVertexNormals();
}

// -----------------------------------------------------------
// BUILD LOOP (CREATING THE MANDALA)
// -----------------------------------------------------------
let currentMesh = null;
function build() {
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        if (currentMesh.material.dispose) currentMesh.material.dispose();
    }

    let geometries = [];
    const baseGeo = createHollowMorphedLine();
    baseGeo.translate(params.centerOffset, 0, 0);
    const stepAngle = (Math.PI * 2) / params.count;

    for (let i = 0; i < params.count; i++) {
        // Calculate the circular rotation for this repetition
        //const matrix = new THREE.Matrix4().makeRotationZ((i / params.count) * Math.PI * 2);
        const angle = i * stepAngle;

        // Add the standard branch
        const geo = baseGeo.clone();
        //geo.applyMatrix4(matrix);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
        geometries.push(geo);

        // Add the mirrored branch if reflect is checked
        if (params.reflect) {
            const reflectedGeo = baseGeo.clone();
            reflectedGeo.scale(-1, 1, 1);
            reverseWindingOrder(reflectedGeo);

            const mirrorAngle = angle + (stepAngle / 2);
            //reflectedGeo.applyMatrix4(matrix);
            reflectedGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(mirrorAngle));
            geometries.push(reflectedGeo);
        }
    }

    baseGeo.dispose();
    checkConnectivity(geometries);
    const merged = mergeGeometries(geometries); // Merge into one single mesh for performance

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,    // 0x8b7668  // 0xe2b49c
        roughness: 1.0,
        metalness: 0.0,
        flatShading: false,
        side: THREE.DoubleSide
    });

    currentMesh = new THREE.Mesh(merged, material);

    // CRITICAL for shadows:
    currentMesh.castShadow = true;
    currentMesh.receiveShadow = true;

    scene.add(currentMesh);
}


function checkConnectivity(geometries) {
    const n = geometries.length;
    // Create a 'touching' map (Adjacency Matrix)
    const adj = Array.from({ length: n }, () => new Array(n).fill(false));

    // 1. Check which geometries intersect each other
    for (let i = 0; i < n; i++) {
        const boxA = new THREE.Box3().setFromBufferAttribute(geometries[i].attributes.position)
        for (let j = i + 1; j < n; j++) {
            const boxB = new THREE.Box3().setFromBufferAttribute(geometries[j].attributes.position)
            // Fast check: Do their bounding boxes even touch?
            if (boxA.intersectsBox(boxB)) {
                // Precision check: This is where it gets tricky.
                adj[i][j] = adj[j][i] = true;
            }
        }
    }
    // 2. Breadth-First Search (BFS) to find "Islands"
    const visited = new Set();
    const queue = [0]; // Start with the first branch
    visited.add(0);
    while (queue.length > 0) {
        const curr = queue.shift();
        for (let neighbor = 0; neighbor < n; neighbor++) {
            if (adj[curr][neighbor] && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    // 3. The Result
    const warningEl = document.getElementById('connectivity-warning');
    if (visited.size === n) {
        console.log("✅ Success: All branches are connected in one single piece!");
        warningEl.style.display = 'none'; // Everything is connected
    } else {
        console.warn(`❌ Warning: Found ${n - visited.size} floating shards!`);
        warningEl.style.display = 'block'; // Shards detected!
    }
}



// -----------------------------------------------------------
// USER INTERFACE (GUI)
// -----------------------------------------------------------
const gui = new GUI();

const gGeneral = gui.addFolder('General');
gGeneral.add(params, 'height', 1, 20, 1).name('Total Height').onChange(build);
gGeneral.add(params, 'count', 2, 15, 1).name('Radial Count').onChange(build);
gGeneral.add(params, 'centerOffset', 0, 10, 0.1).name('Center Distance').onChange(build);
gGeneral.add(params, 'reflect').name('Mirror Symmetry').onChange(build);
gGeneral.add(params, 'wallThickness', 0.3, 1.0, 0.1).name('Wall Thickness').onChange(build);

const gLine = gui.addFolder('Line Path');
gLine.add(params, 'points', 2, 10, 1).name('Point Count').onChange(build);
gLine.add(params, 'inc', 0.1, 10, 1).name('Line Spread').onChange(build);
gLine.add(params, 'seed', 1, 9999, 1).name('Random Seed').onChange(build);

const gShapes = gui.addFolder('Master Shapes');
gShapes.add(params, 'shapeCount', 2, 10, 1).name('Shape Count').onChange(build);
gShapes.add(params, 'shapeRadius', 1, 5, 1).name('Shape Radius').onChange(build);
gShapes.add(params, 'ratio', 0.1, 5.0).name('Stretch (XY)').onChange(build);
gShapes.add(params, 'seedShape', 1, 9999, 1).name('Random Seed Shape').onChange(build);

// Add the button to the GUI (it looks like a button because it points to a function)
gui.add(params, 'randomize').name('Randomize');

// STL Export Functionality
function exportSTL() {
    const exporter = new STLExporter();
    const blob = new Blob([exporter.parse(currentMesh)], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tree_mandala.stl`;
    link.click();
}
gui.add({ exportSTL }, 'exportSTL').name('Download STL');

// OBJ Export Functionality
function exportOBJ() {
    const exportClone = currentMesh.clone();
    exportClone.scale.set(10, 10, 10);
    exportClone.updateMatrixWorld();

    const exporter = new OBJExporter();
    const blob = new Blob([exporter.parse(exportClone)], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tree_mandala.obj`;
    link.click();

    exportClone.removeFromParent();
}
gui.add({ exportOBJ }, 'exportOBJ').name('Download OBJ');

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation Loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

build();
animate();