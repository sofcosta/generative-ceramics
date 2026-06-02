// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "https://esm.sh/three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from 'https://esm.sh/three/examples/jsm/exporters/OBJExporter.js';
import GUI from "https://esm.sh/lil-gui";
import * as fflate from "https://esm.sh/fflate"; // ZIP
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "https://unpkg.com/three-mesh-bvh@0.7.3/build/index.module.js";
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";
import { CSS2DRenderer, CSS2DObject } from "https://esm.sh/three/examples/jsm/renderers/CSS2DRenderer.js";

// My imports
import { createMandala, randomizeParams, PARAMS_CONFIG, setFont } from "./mandala_tree.js";

// -----------------------------------------------------------
// SET UP
// -----------------------------------------------------------
// To accelerate voxel creation
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Setup CSS2D Renderer
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // So you can still click the 3D scene
document.body.appendChild(labelRenderer.domElement);

// FONT
const loader = new FontLoader();
const FONT_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/fonts/helvetiker_bold.typeface.json';
loader.load(FONT_URL, (font) => {
    console.log("Font Ready");
    setFont(font);
    buildGeometry();
});

// -----------------------------------------------------------
// SCENE SETUP
// -----------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Dark background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

camera.up.set(0, 0, 1); // z-axis "UP"
camera.position.set(0, -50, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2; // Overall brightness boost
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Near your renderer setup
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);


// OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.minPolarAngle = 0;        // Allow looking from top
controls.maxPolarAngle = Math.PI;  // Allow looking from bottom (180 degrees)
controls.target.set(0, 0, 10);
controls.update();

// -----------------------------------------------------------
// LIGHTING
// -----------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.2)); // Soft overall light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(30, -30, 30); // Side/Top light to create shadows and depth

light.castShadow = true;
light.shadow.mapSize.width = 2048; // Higher resolution shadows
light.shadow.mapSize.height = 2048;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;

light.shadow.camera.left = -50;
light.shadow.camera.right = 50;
light.shadow.camera.top = 50;
light.shadow.camera.bottom = -50;

scene.add(light);

const topLight = new THREE.DirectionalLight(0xffffff, 1); // "Z" Light (Top)
topLight.position.set(0, 0, 50);
scene.add(topLight);

const sideLight = new THREE.DirectionalLight(0x70613f, 1.2); // "X" Light (Right)
sideLight.position.set(50, 0, 10);
scene.add(sideLight);

const frontLight = new THREE.DirectionalLight(0xb49e68, 1.2); // "Y" Light (Front)
frontLight.position.set(0, -50, 10);
scene.add(frontLight);

// Ground Plane - to see shadows being "cast" onto something
const planeGeo = new THREE.PlaneGeometry(200, 200);
const planeMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(planeGeo, planeMat);
ground.receiveShadow = true; // Let shadows fall on this
scene.add(ground);

// -----------------------------------------------------------
// PARAMETERS
// -----------------------------------------------------------
let params = {};
const savedData = localStorage.getItem('selectedMandala');

if (savedData) {
    params = JSON.parse(savedData);
    localStorage.removeItem('selectedMandala');
} else {
    params = {
        distribution: 'Mandala',
        height: 10,          // Total Z-height
        count: 8,            // How many times the branch repeats in a circle
        stepAngle: 0.5,
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
        textMode: false,
        textContent: "CLAY"
        //withText: false,
        //text: "A"
    };
}

// -----------------------------------------------------------
// BUILD GEOMETRY
// -----------------------------------------------------------
let currentMesh = null;

const clipSettings = {
    planeHeight: 1
}

function buildGeometry() {
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        if (currentMesh.material.dispose) currentMesh.material.dispose();
    }
    currentMesh = createMandala(params, false, clipSettings.planeHeight);

    currentMesh.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    currentMesh.geometry.boundingBox.getSize(size);

    const label = document.getElementById('dimensions-label'); // Update the HUD
    if (label) {
        label.innerHTML = `
            WIDTH:  ${size.x.toFixed(2)}mm<br>
            DEPTH:  ${size.y.toFixed(2)}mm<br>
            HEIGHT: ${size.z.toFixed(2)}mm
        `;
    }
    scene.add(currentMesh);
    //console.log(currentMesh);
    //updateDimensionLines();
}


let dimensionsGroup = new THREE.Group();
scene.add(dimensionsGroup);

function updateDimensionLines() {
    // 1. Clear previous lines
    dimensionsGroup.clear();
    if (!currentMesh) return;

    // 2. Compute current object sizing
    currentMesh.geometry.computeBoundingBox();
    const box = currentMesh.geometry.boundingBox;
    const min = box.min;
    const max = box.max;
    const size = new THREE.Vector3();
    box.getSize(size);

    // Subtle technical styling
    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x555555,
        transparent: true,
        opacity: 0.9
    });

    // --- WIDTH DIMENSION LINE (X-Axis) ---
    const widthPoints = [
        new THREE.Vector3(min.x, min.y - 5, min.z), // Offset line slightly outside mesh
        new THREE.Vector3(max.x, min.y - 5, min.z)
    ];
    createDimLine(widthPoints, `${size.x.toFixed(1)} cm`, lineMaterial);

    // --- HEIGHT DIMENSION LINE (Z-Axis) ---
    const heightPoints = [
        new THREE.Vector3(max.x + 5, min.y, min.z),
        new THREE.Vector3(max.x + 5, min.y, max.z)
    ];
    createDimLine(heightPoints, `${size.z.toFixed(1)} cm`, lineMaterial);
}

function createDimLine(points, labelText, material) {
    // 1. Draw the Line
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    dimensionsGroup.add(line);

    // 2. Create the HTML Label
    const textDiv = document.createElement('div');
    textDiv.className = 'dim-label';
    textDiv.textContent = labelText;
    textDiv.style.color = 'white';
    textDiv.style.fontFamily = 'monospace';
    textDiv.style.fontSize = '12px';
    textDiv.style.padding = '2px 5px';
    textDiv.style.background = 'rgba(0, 0, 0, 0.5)';
    textDiv.style.borderRadius = '3px';
    textDiv.style.marginTop = '-1em'; // Center it over the point

    const label = new CSS2DObject(textDiv);

    // Position label at the midpoint of the line
    const middlePoint = new THREE.Vector3().addVectors(points[0], points[1]).multiplyScalar(0.5);
    label.position.copy(middlePoint);

    dimensionsGroup.add(label);
}

// -----------------------------------------------------------
// VOXELIZATION LOGIC
// -----------------------------------------------------------
let voxelMesh = null;

let voxelData = {
    positions: [],
    voxelSize: 0.15
};

function voxelize() {
    if (!currentMesh) return;

    // 1. Ensure BVH exists
    if (!currentMesh.geometry.boundsTree) {
        console.time("BVH Generation");
        currentMesh.geometry.computeBoundsTree();
        console.timeEnd("BVH Generation");
    }
    const voxelSize = 0.15;
    const box = new THREE.Box3().setFromObject(currentMesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = false;
    const direction = new THREE.Vector3(0, 0, 1);

    const tempPositions = [];
    const gridX = Math.ceil(size.x / voxelSize);
    const gridY = Math.ceil(size.y / voxelSize);

    console.time("Voxel Scan");

    for (let x = 0; x < gridX; x++) {
        for (let y = 0; y < gridY; y++) {
            const worldX = box.min.x + x * voxelSize + voxelSize / 2;
            const worldY = box.min.y + y * voxelSize + voxelSize / 2;
            const origin = new THREE.Vector3(worldX, worldY, box.min.z - 0.5);
            raycaster.set(origin, direction);
            const intersects = raycaster.intersectObject(currentMesh);

            // If we hit an odd number, the mesh is "open"
            if (intersects.length > 0 && intersects.length % 2 === 0) {
                intersects.sort((a, b) => a.distance - b.distance);

                for (let i = 0; i < intersects.length; i += 2) {
                    const startZ = intersects[i].point.z;
                    const endZ = intersects[i + 1].point.z;
                    // Convert world Z to integer grid indices
                    const startZIndex = Math.ceil(startZ / voxelSize);
                    const endZIndex = Math.floor(endZ / voxelSize);
                    for (let zi = startZIndex; zi <= endZIndex; zi++) {
                        const worldZ = zi * voxelSize;
                        tempPositions.push(worldX, worldY, worldZ);
                    }
                }
            }
        }
    }

    voxelData.positions = new Float32Array(tempPositions);
    voxelData.voxelSize = voxelSize;

    console.timeEnd("Voxel Scan");
    console.log(`Total Voxels: ${voxelData.positions.length / 3}`);

    updateVoxelVisualization();
}

function updateVoxelVisualization() {
    if (voxelMesh) {
        scene.remove(voxelMesh);
        voxelMesh.geometry.dispose();
        voxelMesh.material.dispose();
    }

    const count = voxelData.positions.length / 3;
    const s = voxelData.voxelSize;
    const cubeGeo = new THREE.BoxGeometry(s, s, s);
    const cubeMat = new THREE.MeshStandardMaterial({
        color: 0xbc9a7c, // Clay-like color
        roughness: 0.8
    });

    voxelMesh = new THREE.InstancedMesh(cubeGeo, cubeMat, count);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        dummy.position.set(
            voxelData.positions[i * 3],
            voxelData.positions[i * 3 + 1],
            voxelData.positions[i * 3 + 2]
        );
        dummy.updateMatrix();
        voxelMesh.setMatrixAt(i, dummy.matrix);
    }

    currentMesh.visible = false;
    scene.add(voxelMesh);
}

// -----------------------------------------------------------
// CONNECTIVITY LOGIC
// -----------------------------------------------------------
function checkConnectivity() {
    if (!voxelData.positions || voxelData.positions.length === 0) return;

    const positions = voxelData.positions;
    const s = voxelData.voxelSize;
    const voxelMap = new Map();
    const totalVoxels = positions.length / 3;

    let startVoxelKey = null;
    let minZ = Infinity;

    for (let i = 0; i < totalVoxels; i++) {
        const x = Math.round(positions[i * 3] / s);
        const y = Math.round(positions[i * 3 + 1] / s);
        const z = Math.round(positions[i * 3 + 2] / s);
        const key = `${x},${y},${z}`;
        voxelMap.set(key, { x, y, z, visited: false });

        if (z < minZ) {
            minZ = z;
            startVoxelKey = key;
        }
    }

    const queue = [startVoxelKey]; // Flood Fill (BFS)
    voxelMap.get(startVoxelKey).visited = true;
    let connectedCount = 0;

    while (queue.length > 0) {
        const currentKey = queue.shift();
        connectedCount++;

        const curr = voxelMap.get(currentKey);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;

                    const nx = curr.x + dx;
                    const ny = curr.y + dy;
                    const nz = curr.z + dz;
                    const neighborKey = `${nx},${ny},${nz}`;

                    if (voxelMap.has(neighborKey)) {
                        const neighbor = voxelMap.get(neighborKey);
                        if (!neighbor.visited) {
                            neighbor.visited = true;
                            queue.push(neighborKey);
                        }
                    }
                }
            }
        }
    }
    const disconnectedCount = totalVoxels - connectedCount;
    if (disconnectedCount === 0) {
        console.log("Connectivity Check: All parts are connected");
        alert("Success: The piece is a single solid object");
    } else {
        console.warn(`Connectivity Check: ${disconnectedCount} floating voxels found`);
        alert(`Warning: Found ${disconnectedCount} disconnected fragments`);
    }
}

// -----------------------------------------------------------
// USER INTERFACE (GUI)
// -----------------------------------------------------------
const gui = new GUI();

const folders = {
    'General': gui.addFolder('General'),
    'Line Path': gui.addFolder('Line Path'),
    'Master Shapes': gui.addFolder('Master Shapes')
};

Object.keys(PARAMS_CONFIG).forEach(key => {
    const config = PARAMS_CONFIG[key];
    const targetFolder = folders[config.folder] || gui; // Fallback to main GUI if no folder specified
    const label = config.label || key;

    let controller;

    if (config.options) {
        controller = targetFolder.add(params, key, config.options);
    } else if (typeof params[key] === 'number' && config.min !== undefined) {
        controller = targetFolder.add(params, key, config.min, config.max, config.step || 0.1);
    } else {
        controller = targetFolder.add(params, key);
    }

    controller.name(label).onChange(buildGeometry);
});

// gShapes.add(params, 'withText').name('Text Shapes?').onChange((value) => {
//     textController.show(value);
//     buildGeometry();
// });
// const textController = gShapes.add(params, 'text').name('Text').onChange(buildGeometry);
// textController.show(params.withText);



//// Add to GUI
// gui.add({ voxelize }, 'voxelize').name('View as Voxels');
// gui.add({
//     showMesh: () => {
//         if (currentMesh) currentMesh.visible = true;
//         if (voxelMesh) scene.remove(voxelMesh);
//     }
// }, 'showMesh').name('Back to Mesh');

// // Add to GUI
// gui.add({ checkConnectivity }, 'checkConnectivity').name('Check Connectivity');

const folder = gui.addFolder('Visualization');
folder.add(clipSettings, 'planeHeight', 0, 1, 0.1).name('Section Cut').onChange((value) => {
    clipSettings.planeHeight = value;
    buildGeometry();
});

gui.add({ randomizeParamsGUI }, 'randomizeParamsGUI').name('Randomize');
gui.add({ exportAll }, 'exportAll').name('Download');

// -----------------------------------------------------------
// GUI HELPER FUNCTIONS
// -----------------------------------------------------------
function randomizeParamsGUI() {
    randomizeParams(params);

    gui.controllers.forEach(controller => controller.updateDisplay());
    folders['General'].controllers.forEach(controller => controller.updateDisplay());
    folders['Line Path'].controllers.forEach(controller => controller.updateDisplay());
    folders['Master Shapes'].controllers.forEach(controller => controller.updateDisplay());

    buildGeometry();
}

function saveString(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function getTimestamp() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.getHours().toString().padStart(2, '0') + "-" +
        now.getMinutes().toString().padStart(2, '0') + "-" +
        now.getSeconds().toString().padStart(2, '0');
    return `${date}_${time}`;
}

function exportAll() {
    const stamp = getTimestamp();
    const exporterOBJ = new OBJExporter();
    const exporterSTL = new STLExporter();

    const exportClone = currentMesh.clone();
    exportClone.scale.set(10, 10, 10);
    exportClone.updateMatrixWorld();

    // Convert strings to "Uint8Arrays"
    const encoder = new TextEncoder();
    const objData = encoder.encode(exporterOBJ.parse(exportClone));
    const stlData = encoder.encode(exporterSTL.parse(exportClone));
    const jsonData = encoder.encode(JSON.stringify(params, null, 4));
    //const objectData = encoder.encode(JSON.stringify(exportClone, null, 4));

    const zipped = fflate.zipSync({
        [`mandala_${stamp}.obj`]: objData,
        [`mandala_${stamp}.stl`]: stlData,
        [`params_${stamp}.json`]: jsonData,
        //[`object_${stamp}.json`]: objectData,
    }, { level: 0 });

    const blob = new Blob([zipped], { type: 'application/zip' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mandala_bundle_${stamp}.zip`;
    link.click();

    exportClone.removeFromParent();
}

// -----------------------------------------------------------
// OTHER
// -----------------------------------------------------------
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
    labelRenderer.render(scene, camera);
}

//buildGeometry();
animate();