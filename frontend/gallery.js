// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/examples/jsm/controls/OrbitControls.js";
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";

// My imports
import { buildFontShapeData, PARAMS_CONFIG, randomizeParams, setFont, createMeshFromData, updateMeshFromData } from "./engine.js";
import * as EVO from "./evolution.js";
import { WorkerPool } from "./worker-pool.js";

// -----------------------------------------------------------
// SET UP
// -----------------------------------------------------------
const canvas = document.getElementById('canvas');
const content = document.getElementById('content');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scenes = [];
let nObjects = 10;
let individualsShown = 10;
let selectedIndices = new Set();
let population = [];
let isOrbitAll = false;
let lastInteractedControl = null;

const loader = new FontLoader();
const FONT_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/fonts/helvetiker_bold.typeface.json';
loader.load(FONT_URL, (font) => {
    console.log("Font Ready");
    setFont(font);
    buildGallery();
});

function resetAllCameras() {
    scenes.forEach(data => {
        if (!data.mesh) return;
        data.camera.position.set(data.target.x, data.target.y - data.fitDistance, data.target.z);
        data.controls.target.copy(data.target);
        data.controls.update();
    });
    lastInteractedControl = null;
}

// -----------------------------------------------------------
// GALLERY CONTROLS
// -----------------------------------------------------------
const popSize = document.getElementById('popultation-size');
popSize.value = nObjects;
popSize.oninput = function () {
    console.log(popSize.value);
    nObjects = popSize.value;
    indivShow.max = nObjects;
}

const indivShow = document.getElementById('individuals-show');
indivShow.value = individualsShown;
indivShow.max = nObjects;
indivShow.oninput = function () {
    console.log(indivShow.value);
    individualsShown = indivShow.value;
    updateVisibleSet();
}

const orbitToggle = document.getElementById('orbit-toggle');
orbitToggle.onclick = () => {
    isOrbitAll = !isOrbitAll;
    orbitToggle.innerText = isOrbitAll ? 'Orbit Single' : 'Orbit Together';
    if (isOrbitAll) resetAllCameras();
};

// -----------------------------------------------------------
// EVOLUTION BUTTONS
// -----------------------------------------------------------
document.getElementById('next-gen-btn').onclick = evolve;
document.getElementById('reset-btn').onclick = () => {
    if (confirm("This will delete your current evolutionary progress and start with random shapes")) {
        localStorage.removeItem('currentPopulation');
        population = [];
        selectedIndices.clear();

        // Clear the DOM
        content.innerHTML = '';
        scenes.length = 0;

        buildGallery();

        console.log("Population Reset");
    }
};


function updateVisibleSet() {
    const allIndices = Array.from({ length: scenes.length }, (_, i) => i);
    for (let j = allIndices.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [allIndices[j], allIndices[k]] = [allIndices[k], allIndices[j]];
    }
    scenes.forEach(data => {
        data.visible = false;
        data.element.style.display = 'none';
    });
    const count = Math.min(individualsShown, scenes.length);
    for (let idx = 0; idx < count; idx++) {
        const data = scenes[allIndices[idx]];
        data.visible = true;
        data.element.style.display = '';
    }
}

// -----------------------------------------------------------
// BUILD GALLERY
// -----------------------------------------------------------
async function buildGallery() {
    console.log("Starting gallery build");

    const workerPool = new WorkerPool();
    console.log(workerPool.getStats());

    // Clear previous gallery
    content.innerHTML = '';
    scenes.length = 0;
    selectedIndices.clear();

    // GET PARAMETERS SAVED IN LOCAL STORAGE OR CREATE RANDOM ONES
    let storedData = loadPopulationFromStorage();

    if (storedData.length > 0 && population.length === 0) {
        population = storedData;
    }

    if (population.length === 0) {
        const genomeLength = Object.keys(PARAMS_CONFIG).length;
        for (let i = 0; i < nObjects; i++) {
            const dna = Array.from({ length: genomeLength }, () => Math.random());
            population.push({
                id: i,
                dna: dna,
                params: EVO.genotypeToParams(dna)
            });
        }
        savePopulationToStorage();
    }

    // Prepare font data for each individual
    population.forEach(item => {
        item.fontShapeData = buildFontShapeData(item.params);
    });

    // Phase 1: Fire off all low-poly generation tasks immediately.
    // This "floods" the worker pool with the priority tasks. Because workers 
    // process messages in FIFO order, they will finish all 100 low-poly tasks 
    // before they ever start on a mid-poly upgrade.
    const totalStartTime = performance.now();

    const lowPolyTasks = population.map(item =>
        workerPool.generateSingle(item.params, item.fontShapeData, 'low', item.id)
    );
    console.log(`GALLERY: All ${lowPolyTasks.length} LOW-POLY tasks queued.`);

    Promise.all(lowPolyTasks).then(() => {
        const elapsed = (performance.now() - totalStartTime).toFixed(2);
        console.log(`GALLERY: All ${lowPolyTasks.length} LOW-POLY meshes generated in ${elapsed}ms`);
    });

    const midPolyProgressPromises = [];

    // Phase 2: Create UI placeholders and attach handlers to the pre-dispatched tasks
    for (let i = 0; i < population.length; i++) {
        const item = population[i];

        const element = document.createElement('div');
        element.className = 'item';
        element.innerHTML = `<div class="item-label"></div>`;
        content.appendChild(element);

        // MOUSE CLICK VS DRAG LOGIC
        let mouseStartPos = { x: 0, y: 0 };

        element.addEventListener('mousedown', (e) => {
            mouseStartPos = { x: e.clientX, y: e.clientY };
        });

        element.addEventListener('mouseup', (e) => {
            const dx = e.clientX - mouseStartPos.x;
            const dy = e.clientY - mouseStartPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // If the mouse moved less than 5 pixels, treat it as a click
            if (distance < 5) {
                if (selectedIndices.has(i)) {
                    selectedIndices.delete(i);
                    element.classList.remove('item-selected');
                } else {
                    selectedIndices.add(i);
                    element.classList.add('item-selected');
                }
                console.log("Selected Parents:", Array.from(selectedIndices));
            }
        });

        element.addEventListener('dblclick', () => {
            localStorage.setItem('selectedMandala', JSON.stringify(population[i].params));
            //localStorage.setItem('selectedDNA', JSON.stringify(population[i].dna));
            savePopulationToStorage(); // Save the CURRENT population
            window.location.href = 'index.html';
        });

        // INDIVIDUAL SCENES
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        camera.up.set(0, 0, 1);
        camera.position.set(0, -50, 15);
        camera.lookAt(0, 0, 8);

        // ORBIT CONTROLS SETUP
        const controls = new OrbitControls(camera, element);
        controls.target.set(0, 0, 10);
        controls.enablePan = false;
        controls.enableZoom = false;

        controls.addEventListener('start', () => {
            lastInteractedControl = controls;
        });

        controls.update();

        // LIGHT
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, -20, 30);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.3));

        // Register the scene immediately
        const sceneData = {
            element,
            scene,
            camera,
            mesh: null,
            controls,
            id: item.id,
            fitDistance: 0,
            target: new THREE.Vector3(),
            geometryOffset: new THREE.Vector3()
        };
        scenes.push(sceneData);

        // Handle the result of the task we dispatched earlier
        const taskChain = lowPolyTasks[i]
            .then(lowData => {
                // 1. Create and add the Low-Poly mesh
                const mesh = createMeshFromData(lowData.geometryData);

                // 2. Center the geometry so rotation happens at the object center
                const box = new THREE.Box3().setFromObject(mesh);
                const center = new THREE.Vector3();
                box.getCenter(center);

                // Shift vertices to local origin and move the mesh container to the center
                const offset = center.clone().negate();
                mesh.geometry.translate(offset.x, offset.y, offset.z);
                mesh.position.copy(center);

                sceneData.geometryOffset.copy(offset);
                sceneData.target.copy(center);

                // 3. Position camera for this specific mesh
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

                sceneData.fitDistance = cameraZ;

                // Use center.x instead of 0 to fix the "Orbit All" alignment jump
                camera.position.set(center.x, center.y - cameraZ, center.z);
                controls.target.copy(center);
                controls.update();

                // Add to scene and register mesh for the renderer
                scene.add(mesh);
                sceneData.mesh = mesh;

                // 4. Immediately trigger Mid-Poly generation
                // This request enters the worker queue AFTER all initial 100 low-poly tasks
                return workerPool.generateSingle(item.params, item.fontShapeData, 'mid', item.id);
            })
            .then(midData => {
                // 5. Swap geometry to Mid-Poly
                updateMeshFromData(sceneData.mesh, midData.geometryData);

                // Re-apply the same centering offset to the new geometry
                const off = sceneData.geometryOffset;
                sceneData.mesh.geometry.translate(off.x, off.y, off.z);
            })
            .catch(err => console.error(`Generation failed for item ${item.id}:`, err));

        midPolyProgressPromises.push(taskChain);

        //await new Promise(resolve => requestAnimationFrame(resolve));
        // Small pause every 10 items to keep the UI responsive while creating 100 scenes
        if (i % 10 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }

    Promise.all(midPolyProgressPromises).then(() => {
        const totalElapsed = (performance.now() - totalStartTime).toFixed(2);
        console.log(`GALLERY: ${nObjects} GENERATED. Total time to Mid-Poly: ${totalElapsed}ms`);
    });

    //console.log(population);
    //exportPopulationJSON(population);
    updateVisibleSet();
}

// -----------------------------------------------------------
// DISPLAY GALLERY
// -----------------------------------------------------------
function updateAndRender() {
    // Resize background canvas to fit window
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
        renderer.setSize(width, height, false);
    }

    renderer.setClearColor(0x111111);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);

    scenes.forEach(data => {
        // Get the screen position of the placeholder DIV
        const rect = data.element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > renderer.domElement.clientHeight ||
            rect.right < 0 || rect.left > renderer.domElement.clientWidth) {
            return; // Don't render if off-screen
        }
        const width = rect.right - rect.left;
        const height = rect.bottom - rect.top;
        const left = rect.left;
        const bottom = renderer.domElement.clientHeight - rect.bottom
        // Set the viewport to match the DIV
        renderer.setViewport(left, bottom, width, height);
        renderer.setScissor(left, bottom, width, height);

        // Sync rotation only (Orientation)
        if (isOrbitAll && lastInteractedControl && data.controls !== lastInteractedControl && data.mesh) {
            const masterCamera = lastInteractedControl.object;
            const masterTarget = lastInteractedControl.target;

            // Get the direction vector from the master camera to its target
            const offset = new THREE.Vector3().subVectors(masterCamera.position, masterTarget);

            // Apply that same direction to the local object, using the local target and local fitDistance
            const localOffset = offset.clone().normalize().multiplyScalar(data.fitDistance);
            data.camera.position.copy(data.target).add(localOffset);
            data.controls.target.copy(data.target);
        }

        data.controls.update();
        if (data.mesh && data.visible) {
            data.mesh.rotation.z += 0.003; // Gentle spin
            renderer.render(data.scene, data.camera);
        }
    });

    requestAnimationFrame(updateAndRender);
}

// -----------------------------------------------------------
// EVOLUTIONARY ENGINE
// -----------------------------------------------------------
async function evolve() {
    if (selectedIndices.size < 2) {
        alert("Select at least 2 parents to breed a new generation");
        return;
    }

    const parents = Array.from(selectedIndices).map(idx => population[idx]);
    const nextGenPopulation = [];

    for (let i = 0; i < nObjects; i++) {
        const p1 = parents[Math.floor(Math.random() * parents.length)];
        const p2 = parents[Math.floor(Math.random() * parents.length)];

        let childDNA = EVO.crossover(p1.dna, p2.dna);
        childDNA = EVO.mutate(childDNA, 0.05);

        nextGenPopulation.push({
            id: i,
            dna: childDNA,
            params: EVO.genotypeToParams(childDNA)
        });
    }

    population = nextGenPopulation;
    savePopulationToStorage();
    selectedIndices.clear();

    content.innerHTML = ''; // Clear the screen
    scenes.length = 0;

    await buildGallery(); // Re-run the build function using the new DNA
}

// -----------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------
function savePopulationToStorage() {
    localStorage.setItem('currentPopulation', JSON.stringify(population));
}

function loadPopulationFromStorage() {
    const stored = localStorage.getItem('currentPopulation');
    if (stored) {
        return JSON.parse(stored);
    }
    return [];
}

function exportPopulationJSON(popultation) {
    if (population.length === 0) {
        console.error("No population data to export.");
        return;
    }
    const exportData = {
        metadata: {
            timestamp: new Date().toISOString(),
            totalEntities: population.length,
            schema: PARAMS_CONFIG
        },
        entities: population
    };
    const dataStr = JSON.stringify(exportData, null, 4);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `population_${timestamp}.json`;

    saveString(dataStr, filename);
}

function saveString(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href); // Clean up memory
}

//buildGallery();
updateAndRender();