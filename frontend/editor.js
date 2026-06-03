// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { OrbitControls } from "https://esm.sh/three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "https://esm.sh/three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from 'https://esm.sh/three/examples/jsm/exporters/OBJExporter.js';
import GUI from "https://esm.sh/lil-gui";
import * as fflate from "https://esm.sh/fflate"; // ZIP
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";
import { CSS2DRenderer, CSS2DObject } from "https://esm.sh/three/examples/jsm/renderers/CSS2DRenderer.js";

// My imports
import { createMandala, randomizeParams, PARAMS_CONFIG, setFont } from "./mandala_tree.js";

// -----------------------------------------------------------
// SET UP
// -----------------------------------------------------------

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
document.body.appendChild(renderer.domElement);

// OrbitControls allow us to rotate, zoom, and pan around the object
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

const topLight = new THREE.DirectionalLight(0xffffff, 1); // "Z" Light (Top)
topLight.position.set(0, 0, 50);
scene.add(topLight);

const sideLight = new THREE.DirectionalLight(0x70613f, 1.2); // "X" Light (Right)
sideLight.position.set(50, 0, 10);
scene.add(sideLight);

const frontLight = new THREE.DirectionalLight(0xb49e68, 1.2); // "Y" Light (Front)
frontLight.position.set(0, -50, 10);
scene.add(frontLight);

// Ground Plane (to see shadows being "cast" onto something)
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
        textContent: "CLAY",
        cutVariation: 0.0,
        variationSeed: 1234
    };
}

// -----------------------------------------------------------
// BUILD GEOMETRY
// -----------------------------------------------------------
let currentMesh = null;
let overhangMesh = null;

function buildGeometry() {
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        if (currentMesh.material.dispose) currentMesh.material.dispose();
    }

    // Reset UI and Overhangs ---
    if (overhangMesh) {
        scene.remove(overhangMesh);
        overhangMesh.geometry.dispose();
        if (overhangMesh.material.dispose) overhangMesh.material.dispose();
        overhangMesh = null;
    }

    // Limpar o marcador de centro de massa antigo, se existir
    if (comMarker) {
        scene.remove(comMarker);
        comMarker.geometry.dispose();
        if (comMarker.material.dispose) comMarker.material.dispose();
        comMarker = null;
    }
    // ---------------------------------------------------------

    const panel = document.getElementById('fitness-panel');
    if (panel) panel.style.display = 'none'; // Hides the report
    // -----------------------------------

    currentMesh = createMandala(params, false);

    const pointCount = currentMesh.geometry.attributes.position.count;

    console.log(`Total points in this object: ${pointCount}`);

    currentMesh.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    currentMesh.geometry.boundingBox.getSize(size);

    const label = document.getElementById('dimensions-label');
    if (label) {
        label.innerHTML = `
            WIDTH:  ${size.x.toFixed(2)}mm<br>
            DEPTH:  ${size.y.toFixed(2)}mm<br>
            HEIGHT: ${size.z.toFixed(2)}mm
        `;
    }
    scene.add(currentMesh);
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

gui.add({ randomizeParamsGUI }, 'randomizeParamsGUI').name('Randomize');
gui.add({ evaluateMesh }, 'evaluateMesh').name('Evaluate Model');
gui.add({ exportAll }, 'exportAll').name('Download');
//gui.add({ export100 }, 'export100').name('Download 100');

// -----------------------------------------------------------
// GUI HELPER FUNCTIONS
// -----------------------------------------------------------
function export100() {
    const totalToExport = 10;
    const exporterOBJ = new OBJExporter();
    const stamp = getTimestamp();

    // Object to hold files before zipping
    const zipFiles = {};

    console.log(`Starting bulk generation & OBJ compression for ${totalToExport} meshes...`);
    const tStart = performance.now();

    // Determine parameter keys configuration length
    const genomeLength = Object.keys(PARAMS_CONFIG).length;

    for (let i = 0; i < totalToExport; i++) {
        // 1. Generate random genetic combinations
        const dna = Array.from({ length: genomeLength }, () => Math.random());

        // Convert array traits to usable structural parameters
        // Note: Make sure EVO is imported or accessible if genotypeToParams lives there,
        // otherwise if randomizeParams works directly, you can pass a temporary object:
        let tempParams = params;
        randomizeParams(tempParams);

        // 2. Build the 3D geometry invisibly in memory
        // passing 'true' for isGallery enforces a low-poly configuration for quick parsing
        const tempMesh = createMandala(tempParams, false);

        // 3. Match the export scaling factor used in exportAll()
        tempMesh.scale.set(10, 10, 10);
        tempMesh.updateMatrixWorld();

        // 4. Parse geometry structure to OBJ text asset
        const objText = exporterOBJ.parse(tempMesh);

        // 5. Convert strings to Uint8Arrays for fflate parsing
        const encoder = new TextEncoder();
        const objData = encoder.encode(objText);
        const jsonData = encoder.encode(JSON.stringify(tempParams, null, 4));

        // 6. Append entries to our staging archive layout object
        // Padding digits (e.g. 003) keeps filenames ordered neatly inside windows file explorer
        const padIndex = String(i + 1).padStart(3, '0');
        zipFiles[`bulk_export_${stamp}/mandala_${padIndex}.obj`] = objData;
        zipFiles[`bulk_export_${stamp}/params_${padIndex}.json`] = jsonData;

        // 7. Dispose allocations from processor memory instantly to prevent page crashes
        tempMesh.geometry.dispose();
    }

    // 8. Compress and package layout structure instantly (level: 0 for max execution speed)
    const zipped = fflate.zipSync(zipFiles, { level: 0 });

    // 9. Deliver bundle straight to user browser downloads folder
    const blob = new Blob([zipped], { type: 'application/zip' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bulk_mandalas_obj_${stamp}.zip`;
    link.click();
    URL.revokeObjectURL(link.href); // Free up browser allocation references

    const tEnd = performance.now();
    console.log(`Successfully packed 100 objects in ${(tEnd - tStart).toFixed(2)}ms!`);
}

function randomizeParamsGUI() {
    randomizeParams(params);

    gui.controllers.forEach(controller => controller.updateDisplay());
    folders['General'].controllers.forEach(controller => controller.updateDisplay());
    folders['Line Path'].controllers.forEach(controller => controller.updateDisplay());
    folders['Master Shapes'].controllers.forEach(controller => controller.updateDisplay());

    buildGeometry();
}

// Helper function to handle the browser download
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

    // Create the Zip structure
    const zipped = fflate.zipSync({
        [`mandala_${stamp}.obj`]: objData,
        [`mandala_${stamp}.stl`]: stlData,
        [`params_${stamp}.json`]: jsonData
    }, { level: 0 }); // Level 0 = No compression (Instant)

    // Download
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
}

// -----------------------------------------------------------
// BACKEND EVALUATION BRIDGE
// -----------------------------------------------------------
async function evaluateMesh() {
    if (!currentMesh) return;

    // Clear previous overhangs if user clicks evaluate twice in a row
    if (overhangMesh) {
        scene.remove(overhangMesh);
        overhangMesh.geometry.dispose();
        if (overhangMesh.material.dispose) overhangMesh.material.dispose();
        overhangMesh = null;
    }

    const panel = document.getElementById('fitness-panel');
    const content = document.getElementById('fitness-content');

    // Show panel with a loading state
    panel.style.display = 'block';
    content.innerHTML = '<span style="color: #b49e68;">Evaluating geometry...</span>';

    // 1. Prepare the mesh for export
    const exportClone = currentMesh.clone();
    exportClone.scale.set(10, 10, 10);
    exportClone.updateMatrixWorld();

    const exporter = new STLExporter();
    const stlString = exporter.parse(exportClone);

    // 2. Create a file-like Blob to send in the request
    const blob = new Blob([stlString], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, 'mesh.stl');

    // 3. Send POST request to FastAPI server
    try {
        const response = await fetch('http://localhost:8000/evaluate', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        // --- Calculate Porosity Label ---
        const lightPass = data.permeability.max_light_pass;
        let porosityLabel = "";
        if (lightPass < 0.25) {
            porosityLabel = '<span style="color: #60a5fa;">Dense</span>';    // Blue
        } else if (lightPass >= 0.25 && lightPass < 0.55) {
            porosityLabel = '<span style="color: #4ade80;">Balanced</span>'; // Green
        } else {
            porosityLabel = '<span style="color: #a78bfa;">Open</span>';     // Purple
        }

        // --- Cálculos de Etiquetas de Carga e Massa ---
        const bal = data.balance;
        const pressureLabel = bal.load_pressure > 15.0 ?
            '<span style="color: #f87171;">Critical (Risk of collapse)</span>' :
            '<span style="color: #4ade80;">Safe</span>';

        const massDistLabel = bal.is_top_heavy ?
            '<span style="color: #fbbf24;">Top-Heavy (Risk of collapse)</span>' :
            '<span style="color: #4ade80;">Bottom-Heavy (Stable)</span>';

        // ---> Etiqueta de Tensão nos Overhangs (Stress Index) <---
        const maxStress = data.overhangs.max_stress_index;
        let stressLabel = "";
        if (maxStress < 0.20) {
            stressLabel = '<span style="color: #4ade80;">Safe (Low Stress)</span>';
        } else if (maxStress >= 0.20 && maxStress < 0.45) {
            stressLabel = '<span style="color: #fbbf24;">Moderate (Risk of drooping)</span>';
        } else {
            stressLabel = '<span style="color: #f87171;">Critical (Will collapse)</span>';
        }

        // --- Renderização do Painel Completo ---
        content.innerHTML = `
            <div style="margin-bottom: 8px;">
                <b>Connectivity:</b> ${data.connectivity.is_solid ? '<span style="color: #4ade80;">Solid</span>' : `<span style="color: #f87171;">Broken (${data.connectivity.part_count} parts)</span>`}
            </div>
            
            <div style="margin-bottom: 8px;">
                <b>Balance:</b> ${bal.is_stable ? '<span style="color: #4ade80;">Stable</span>' : '<span style="color: #f87171;">Unstable</span>'}
                <span style="color: #aaa; font-size: 11px;">(Margin: ${bal.margin_mm.toFixed(1)}mm)</span>
            </div>

            <div style="margin-bottom: 8px;">
                <b>Base Pressure:</b> ${pressureLabel}
                <br><span style="color: #aaa; font-size: 11px;">Load: ${bal.load_pressure.toFixed(2)} (Vol/Area)</span>
            </div>

            <div style="margin-bottom: 8px;">
                <b>Mass Distribution:</b> ${massDistLabel}
                <br><span style="color: #aaa; font-size: 11px;">CoM Height: ${(bal.mass_distribution_ratio * 100).toFixed(0)}% of total height</span>
            </div>

            <div style="margin-bottom: 8px;">
                <b>Stability:</b> ${bal.is_slender ? '<span style="color: #f87171;">Risky (High Oscillation)</span>' : '<span style="color: #4ade80;">Safe (Rigid)</span>'}
                <span style="color: #aaa; font-size: 11px;">(Height-to-Base: ${bal.slenderness_ratio.toFixed(2)})</span>
            </div>

            <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">

            <div style="margin-bottom: 8px;">
                <b>Overhang Angles:</b> ${data.overhangs.is_printable ? '<span style="color: #4ade80;">Printable</span>' : '<span style="color: #f87171;">Steep Geometry</span>'} 
                <span style="color: #aaa; font-size: 11px;">(${(data.overhangs.overhang_ratio * 100).toFixed(1)}% area)</span>
            </div>

            <div style="margin-bottom: 8px;">
                <b>Overhang Stress:</b> ${stressLabel}
                <br><span style="color: #aaa; font-size: 11px;">Max Shear Stress Index: ${maxStress.toFixed(2)}</span>
            </div>

            <div style="margin-bottom: 8px;">
                <b>Light Pass:</b> ${porosityLabel} 
                <span style="color: #aaa; font-size: 11px;">(${(lightPass * 100).toFixed(1)}% porosity)</span>
            </div>
            
            <hr style="border-color: rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="font-size: 11px; color: #888;">
                Volume: ${bal.volume_mm3.toFixed(0)} mm³ | Base: ${bal.base_area_mm2.toFixed(0)} mm²
            </div>
        `;

        // 5. Desenhar o Mapa de Calor do Overhang Stress
        // Agora desenhamos sempre que há geometria inclinada para ver o gradiente
        if (data.overhangs.stress_heatmap && data.overhangs.stress_heatmap.length > 0) {
            highlightOverhangs(data.overhangs.stress_heatmap);
        }

        // Ativar a visualização 3D do CoM
        visualizeCoM(data.balance.center_of_mass);

    } catch (error) {
        console.error("Evaluation failed:", error);
        content.innerHTML = '<span style="color: #f87171;">Server offline or error. Make sure Python backend is running on port 8000.</span>';
    } finally {
        exportClone.removeFromParent(); // Cleanup memory
    }
}

// -----------------------------------------------------------
// HIGHLIGHT OVERHANGS (STEEP VS STRESS)
// -----------------------------------------------------------
function highlightOverhangs(heatmapData) {
    if (heatmapData.length === 0) return;

    const vertices = [];
    const colors = [];

    for (let i = 0; i < heatmapData.length; i++) {
        const tri = heatmapData[i].vertices;
        const stress = heatmapData[i].stress;

        let r, g, b;

        // SE O STRESS FOR BAIXO (< 0.20): É apenas Steep Geometry.
        if (stress < 0.20) {
            // Cor: Roxo (Magenta/Purple)
            r = 0.7; // Mistura de muito vermelho
            g = 0.0; // Sem verde
            b = 1.0; // Com muito azul
        }
        // SE O STRESS FOR ALTO (>= 0.20): É Risco de Colapso (Stress).
        else {
            // Cor: Gradiente de Laranja para Vermelho Vivo
            r = 1.0;
            // O verde diminui à medida que o stress sobe até ao limite crítico de 0.45
            g = Math.max(0, 1.0 - ((stress - 0.20) / 0.25));
            b = 0.0;
        }

        for (let j = 0; j < 3; j++) {
            vertices.push(tri[j][0] / 10, tri[j][1] / 10, tri[j][2] / 10);
            colors.push(r, g, b);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    });

    overhangMesh = new THREE.Mesh(geometry, material);
    scene.add(overhangMesh);
}

let comMarker = null;

function visualizeCoM(pos) {
    if (comMarker) {
        scene.remove(comMarker);
        comMarker.geometry.dispose();
        comMarker.material.dispose();
    }

    // Criar uma pequena esfera para marcar o Centro de Massa
    const geo = new THREE.SphereGeometry(0.5); // Tamanho pequeno
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    comMarker = new THREE.Mesh(geo, mat);

    // Dividir por 10 para compensar o scale de exportação
    comMarker.position.set(pos[0] / 10, pos[1] / 10, pos[2] / 10);
    scene.add(comMarker);
}

//buildGeometry();
animate();