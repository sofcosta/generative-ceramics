// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";

// -----------------------------------------------------------
// FONT SETUP
// -----------------------------------------------------------
let loadedFont = null;

export function setFont(font) {
    loadedFont = font;
}

// -----------------------------------------------------------
// WORKER MANAGEMENT
//
// We keep a single persistent worker alive between calls.
// If a new generation is requested while the previous one is
// still running, we terminate the old worker and start fresh
// so the UI is never blocked by a stale result.
// -----------------------------------------------------------
let _activeWorker = null;

function _getWorker() {
    // Terminate any worker still crunching from a previous call
    if (_activeWorker) {
        _activeWorker.terminate();
        _activeWorker = null;
    }
    _activeWorker = new Worker(
        new URL('./geometry-worker.js', import.meta.url),
        { type: 'module' }
    );
    return _activeWorker;
}

// -----------------------------------------------------------
// FONT SHAPE PRE-PROCESSING
//
// The worker has no DOM access, so we resolve Three.js font
// shapes here and hand the worker plain [{x,y}] arrays.
//
// We replicate the *exact* RNG sequence used inside the worker
// (2 calls per character in text-mode: scale + rotation) so
// the scale baked into each shape matches what the worker
// will generate independently.
// -----------------------------------------------------------

// Seeded RNG — must match the one in geometry-worker.js */
function _createGenerator(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Build the font-shape point arrays that geometry-worker.js expects.
 *
 * Returns null when text-mode is disabled or the font isn't loaded.
 * Returns an Array (one entry per character) where each entry is an
 * Array of { x, y } objects already centred, re-ordered, and scaled
 * to world-space so they can be used directly in getPointOnPrimitive.
 *
 * @param {object} params
 * @returns {Array<Array<{x:number,y:number}>>|null}
 */
export function buildFontShapeData(params) {
    if (!params.textMode || !params.textContent || !loadedFont) return null;

    // Use the same seeded RNG sequence the worker will run internally.
    // In text-mode the worker makes exactly 2 RNG calls per character
    // (scale + rotation), so we mirror that here to derive the correct scale.
    const getShapeRand = _createGenerator(params.seedShape);

    return params.textContent.split('').map((char) => {
        // Call 1 — scale (mirrors worker: 0.6 + getShapeRand() * 0.8)
        const scale = 0.6 + getShapeRand() * 0.8;
        // Call 2 — rotation (mirrors worker: getShapeRand() * (Math.PI / 2))
        getShapeRand();
        // Call 3 - keep rotation and scale the same as when textMode is false, so the font shapes are consistent between modes
        getShapeRand();

        const size = params.shapeRadius * scale * 2;
        const shapes = loadedFont.generateShapes(char, size, 12);
        const shape = shapes[0];

        let pts = shape.getPoints();
        if (pts.length > 0) pts.pop(); // remove duplicate closing point

        // Centre the glyph
        const box = new THREE.Box2().setFromPoints(pts);
        const centre = new THREE.Vector2();
        box.getCenter(centre);
        pts.forEach(p => p.sub(centre));

        // Ensure the font path is definitely CCW to match our primitives
        if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();

        // Ensure consistency: Primitives are defined CCW.
        // Three.js generateShapes returns CCW for outer contours.
        // Do NOT reverse, otherwise miter logic will flip direction.

        // Robust Reordering: Find Top-Most, then Left-Most point
        let bestIdx = 0, maxY = -Infinity;
        pts.forEach((p, i) => {
            if (p.y > maxY + 0.001) {
                maxY = p.y; bestIdx = i;
            } else if (Math.abs(p.y - maxY) < 0.001 && p.x < pts[bestIdx].x) {
                bestIdx = i;
            }
        });
        pts = [...pts.slice(bestIdx), ...pts.slice(0, bestIdx)];

        return pts.map(p => ({ x: p.x, y: p.y }));
    });
}

// Shared helper to convert raw worker data into a THREE.Mesh.
// This removes the "serialized" boilerplate from your main files.
export function createMeshFromData(geometryData) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(geometryData.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        flatShading: false,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
}

/**
 * Updates an existing mesh with new geometry data.
 * Useful for progressive loading (swapping low-poly for high-poly).
 */
export function updateMeshFromData(mesh, geometryData) {
    if (!mesh || !geometryData) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(geometryData.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));

    // Dispose of the old geometry to prevent memory leaks
    if (mesh.geometry) mesh.geometry.dispose();

    mesh.geometry = geometry;
}

// -----------------------------------------------------------
// ASYNC MESH CREATION  (public API)
//
// Usage:
//   const mesh = await createMandalaAsync(params);
//   scene.add(mesh);
//
// The promise rejects if the worker errors or is cancelled.
// -----------------------------------------------------------

/**
 * @param {object}  params    – all the PARAMS_CONFIG values
 * @param {string}  lod       – 'low', 'mid', or 'high' quality
 * @returns {Promise<THREE.Mesh>}
 */

// This function is just used in editor.js, 
// in gallery.js we use the worker pool to generate batches of meshes, 
// so this function is not used there
export function createMandalaAsync(params, lod = 'high') {
    return new Promise((resolve, reject) => {
        const fontShapeData = buildFontShapeData(params);
        console.log("Generating high-poly geometry for editor...");

        const worker = _getWorker();

        worker.onmessage = function (e) {
            if (!e.data.success) {
                _activeWorker = null;
                reject(new Error(e.data.error));
                return;
            }

            const mesh = createMeshFromData(e.data.geometryData);
            _activeWorker = null;
            resolve(mesh);
        };

        worker.onerror = function (err) {
            _activeWorker = null;
            reject(err);
        };

        worker.postMessage({
            type: 'GENERATE_SINGLE',
            params,
            fontShapeData,
            lod: lod
        });
    });
}

// -----------------------------------------------------------
// CONFIGURATION PARAMETERS  (unchanged)
// -----------------------------------------------------------
export const PARAMS_CONFIG = {
    distribution: { options: ['Mandala', 'Grid'], folder: 'General', label: 'Organization' },
    height: { min: 1, max: 20, step: 1, folder: 'General', label: 'Height' },
    count: { min: 1, max: 15, step: 1, folder: 'General', label: 'Count' },
    stepAngle: { min: 0, max: 1, step: 0.1, folder: 'General', label: 'Step Angle' },
    centerOffset: { min: -10, max: 10, step: 1, folder: 'General', label: 'Center Distance' },
    reflect: { type: 'boolean', folder: 'General', label: 'Mirror' },
    wallThickness: { min: 0.3, max: 1.0, step: 0.1, folder: 'General', label: 'Wall Thickness' },
    points: { min: 2, max: 10, step: 1, folder: 'Line Path', label: 'Point Count' },
    inc: { min: 0.1, max: 10, step: 1, folder: 'Line Path', label: 'Line Spread' },
    seed: { min: 1, max: 9999, step: 1, folder: 'Line Path', label: 'Random Seed' },
    shapeCount: { min: 2, max: 10, step: 1, folder: 'Master Shapes', label: 'Shape Count' },
    shapeRadius: { min: 2, max: 5, step: 1, folder: 'Master Shapes', label: 'Shape Radius' },
    seedShape: { min: 1, max: 9999, step: 1, folder: 'Master Shapes', label: 'Random Seed Shape' },
    textMode: { type: 'boolean', folder: 'Master Shapes', label: 'Use Letters' },
    textContent: { type: 'string', folder: 'Master Shapes', label: 'Letters', default: 'CLAY' },
    cutVariation: { min: 0, max: 0.9, step: 0.05, folder: 'General', label: 'Branch Variation' },
    variationSeed: { min: 1, max: 9999, step: 1, folder: 'General', label: 'Variation Seed' },
};

// -----------------------------------------------------------
// PARAMETER RANDOMIZATION  (unchanged)
// -----------------------------------------------------------
export function randomizeParams(params) {
    Object.keys(PARAMS_CONFIG).forEach(key => {
        if (key === 'textContent') return;

        const cfg = PARAMS_CONFIG[key];
        if (cfg.type === 'text') {
            params[key] = 'CLAY';
        } else if (Array.isArray(cfg.options)) {
            params[key] = cfg.options[Math.floor(Math.random() * cfg.options.length)];
        } else if (cfg.type === 'boolean') {
            params[key] = Math.random() > 0.5;
        } else {
            let val = cfg.min + Math.random() * (cfg.max - cfg.min);
            if (cfg.step) {
                const inv = 1.0 / cfg.step;
                val = Math.round(val * inv) / inv;
            }
            params[key] = val;
        }
    });
    return params;
}
