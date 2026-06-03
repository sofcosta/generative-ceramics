// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/examples/jsm/controls/OrbitControls.js";
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";

// My imports
import { createMandala, PARAMS_CONFIG, randomizeParams, setFont } from "./mandala_tree.js";
import * as EVO from "./evolution.js";

// -----------------------------------------------------------
// SET UP
// -----------------------------------------------------------
const canvas = document.getElementById('canvas');
const content = document.getElementById('content');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scenes = [];
const nObjects = 10;
let selectedIndices = new Set();
let population = [];

const loader = new FontLoader();
const FONT_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/fonts/helvetiker_bold.typeface.json';
loader.load(FONT_URL, (font) => {
    console.log("Font Ready");
    setFont(font);
    buildGallery();
});

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

// -----------------------------------------------------------
// BUILD GALLERY
// -----------------------------------------------------------
async function buildGallery() {
    console.log("Starting build");
    // GET PARAMETERS
    let storedData = loadPopulationFromStorage();

    if (storedData.length > 0 && population.length === 0) {
        population = storedData;
    }

    if (population.length === 0) {
        const genomeLength = Object.keys(PARAMS_CONFIG).length;
        console.log(genomeLength);
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

    for (let i = 0; i < population.length; i++) {
        const params = population[i].params;

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
                    element.style.background = "transparent";
                    element.style.borderRadius = "0";
                } else {
                    selectedIndices.add(i);
                    element.style.background = "rgba(255, 255, 255, 0.15)";
                    element.style.borderRadius = "20px";
                }
                console.log("Selected Parents:", Array.from(selectedIndices));
            }
        });

        element.addEventListener('dblclick', () => {
            localStorage.setItem('selectedMandala', JSON.stringify(population[i].params));
            localStorage.setItem('selectedDNA', JSON.stringify(population[i].dna));
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
        controls.update();

        const mesh = createMandala(params, true);
        scene.add(mesh);

        // FIT OBJECT IN SQUARE
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);

        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5; // Padding

        camera.position.set(0, -cameraZ, center.z);
        controls.target.set(center.x, center.y, center.z);
        controls.update();

        // LIGHT
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, -20, 30);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.3));

        scenes.push({ element, scene, camera, mesh, controls });

        await new Promise(resolve => requestAnimationFrame(resolve)); // loads objects as they are being created
    }

    console.log(population);
    exportPopulationJSON(population);
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

        data.controls.update();
        data.mesh.rotation.z += 0.003; // Gentle spin
        renderer.render(data.scene, data.camera);
    });

    requestAnimationFrame(updateAndRender);
}

// -----------------------------------------------------------
// EVOLUTIONARY ENGINE
// -----------------------------------------------------------
async function evolve() {
    if (selectedIndices.size < 2) {
        alert("Please select at least 2 parents to breed a new generation");
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