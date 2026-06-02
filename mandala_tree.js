// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import * as THREE from "https://esm.sh/three";
import { mergeGeometries } from "https://esm.sh/three/examples/jsm/utils/BufferGeometryUtils.js";
import { FontLoader } from "https://esm.sh/three/examples/jsm/loaders/FontLoader.js";

// -----------------------------------------------------------
// FONT SETUP
// -----------------------------------------------------------
let loadedFont = null;

export function setFont(font) {
    loadedFont = font;
}

// const loader = new FontLoader();
// // CDN URL
// const FONT_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/fonts/helvetiker_bold.typeface.json';

// loader.load(FONT_URL,
//     (font) => {
//         console.log("Font loaded successfully!");
//         loadedFont = font;
//         // CRITICAL: Trigger a rebuild once the font is actually here
//         if (typeof buildGeometry === 'function') {
//             buildGeometry();
//             console.log("Rebuild after font loaded");
//         }
//     },
//     undefined, // onProgress
//     (err) => {
//         console.error("Font failed to load:", err);
//     }
// );

// -----------------------------------------------------------
// OBJECT GENERATION
// -----------------------------------------------------------
export function createMandala(params, isGallery = false, planeHeight = 1) {
    const primitives = ['Letter', 'Square', 'Circle', 'Triangle', 'Irregular'];
    //const primitives = ['Square', 'Circle', 'Triangle'];

    function createGenerator(seed) {
        return function () {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function getMiterOffset(points, index, offset) {
        const p2 = points[index]; // Current vertex
        const p1 = points[(index - 1 + points.length) % points.length]; // Previous
        const p3 = points[(index + 1) % points.length]; // Next

        // Get directions of the two edges meeting at this vertex
        const v1 = new THREE.Vector2().subVectors(p2, p1).normalize();
        const v2 = new THREE.Vector2().subVectors(p3, p2).normalize();

        // Get the normals (perpendiculars)
        const n1 = new THREE.Vector2(-v1.y, v1.x);
        const n2 = new THREE.Vector2(-v2.y, v2.x);

        // Get the miter vector (bisector of the two normals)
        const miter = new THREE.Vector2().addVectors(n1, n2).normalize();

        // Calculate the miter length (how far to push the corner)
        // The sharper the corner, the longer the miter length
        const dot = miter.dot(n1);
        const length = offset / Math.max(dot, 0.1);

        return {
            x: p2.x + miter.x * length,
            y: p2.y + miter.y * length
        };
    }

    function getPointOnPrimitive(type, angle, size, offset = 0, shapes) {
        let pts = [];
        const r = size;

        if (type === 'Circle') {
            const startOffset = Math.PI / 2;
            const invAngle = angle + startOffset;
            return { x: Math.cos(invAngle) * (r + offset), y: Math.sin(invAngle) * (r + offset) };
        }
        else if (type === 'Square') {
            pts = [
                new THREE.Vector2(0, r),    // Top Center
                new THREE.Vector2(-r, r),   // Top Left
                new THREE.Vector2(-r, -r),  // Bottom Left
                new THREE.Vector2(r, -r),   // Bottom Right
                new THREE.Vector2(r, r),    // Top Right
            ];
        }
        else if (type === 'Triangle') {
            const tr = r * 1.5;
            pts = [
                new THREE.Vector2(0, tr),                            // Top
                new THREE.Vector2(tr * Math.cos(7 * Math.PI / 6), tr * Math.sin(7 * Math.PI / 6)), // Bottom Left
                new THREE.Vector2(tr * Math.cos(-Math.PI / 6), tr * Math.sin(-Math.PI / 6))  // Bottom Right
            ];
        }
        else if (type === 'Irregular') {
            pts = [
                new THREE.Vector2(0, r * 1.5),          // Top
                new THREE.Vector2(-r * 0.8, -r * 0.2),  // Left
                new THREE.Vector2(0, -r * 0.5),         // Bottom
                new THREE.Vector2(r * 1.2, 0),          // Right        
            ];
        }
        else if (type === 'Letter' && shapes) {
            //const shapes = loadedFont.generateShapes(char, size * 2, 12);
            const shape = shapes[0];

            // Sample the letter into discrete points so we can use Miter logic
            //pts = shape.getPoints(64);
            pts = shape.getSpacedPoints(64);
            pts.pop();

            const box = new THREE.Box2().setFromPoints(pts);
            const center = new THREE.Vector2();
            box.getCenter(center);
            pts.forEach(p => p.sub(center)); // Center the letter
            pts.reverse();

            // RE-ORDER POINTS
            let closestIdx = 0;
            let minYDist = Infinity;
            pts.forEach((p, index) => {
                const dist = Math.hypot(p.x - 0, p.y - box.max.y);
                if (dist < minYDist) {
                    minYDist = dist;
                    closestIdx = index;
                }
            });

            // Shift the array so the top point is at index 0
            pts = [...pts.slice(closestIdx), ...pts.slice(0, closestIdx)];
        }

        if (pts.length === 0) return { x: 0, y: 0 };

        // Map Angle to the Points
        // We map 0-2PI to the perimeter of the point array
        const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
        const t = normalizedAngle / (Math.PI * 2);

        const segmentFloat = t * pts.length;
        const i = Math.floor(segmentFloat) % pts.length;
        const localT = segmentFloat - Math.floor(segmentFloat);

        // Apply Miter Offset to the relevant vertices
        const pStart = getMiterOffset(pts, i, offset);
        const pEnd = getMiterOffset(pts, (i + 1) % pts.length, offset);

        // Interpolate between the offset corners
        return {
            x: pStart.x + (pEnd.x - pStart.x) * localT,
            y: pStart.y + (pEnd.y - pStart.y) * localT
        };
    }

    function createHollowMorphedLine() {
        const getShapeRand = createGenerator(params.seedShape);
        const getPathRand = createGenerator(params.seed);

        // Generate a random path
        let pathPoints = [];
        let current = new THREE.Vector3(
            (getPathRand() - 0.5) * params.inc,
            (getPathRand() - 0.5) * params.inc, 0
        );
        pathPoints.push(current.clone());

        for (let i = 0; i < params.points; i++) {
            current.add(new THREE.Vector3(
                (getPathRand() - 0.5) * params.inc,
                (getPathRand() - 0.5) * params.inc,
                params.height / params.points
            ));
            pathPoints.push(current.clone());
        }

        const curve = new THREE.CatmullRomCurve3(pathPoints);
        //const segments = 80;   // Vertical resolution
        const segments = isGallery ? 40 : 80;
        //const radialRes = 128;  // Resolution of the shape circle
        const radialRes = isGallery ? 16 : 64;
        const vertices = [];
        const indices = [];

        // Sequence of shapes
        const branchShapes = [];
        const branchChars = []; // Array to store letters
        const shapeScales = [];
        const shapeRotation = [];

        const isTextMode = params.textMode && params.textContent;
        const effectiveShapeCount = isTextMode ? params.textContent.length : params.shapeCount;

        const shapes = [];

        for (let i = 0; i < effectiveShapeCount; i++) {
            shapeScales.push(0.6 + getShapeRand() * 0.8); //random scale multiplier (between 0.6 and 1.4)
            shapeRotation.push(getShapeRand() * (Math.PI / 2));
            if (isTextMode && loadedFont) {
                branchShapes.push('Letter');
                branchChars.push(params.textContent[i]);
                shapes.push(loadedFont.generateShapes(branchChars[i], params.shapeRadius * shapeScales[i] * 2, 12));
            } else {
                branchShapes.push(primitives[Math.floor(getShapeRand() * primitives.length)]);
                branchChars.push("A");
                shapes.push(loadedFont.generateShapes(branchChars[i], params.shapeRadius * shapeScales[i] * 2, 12));
            }
        }

        // Vertex Generation
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;        // Progress (0.0 to 1.0)
            const p = curve.getPointAt(t); // Center point of the tube at this height

            // Find which two shapes we are currently morphing between
            const sectionFloat = t * (effectiveShapeCount - 1);
            const index1 = Math.floor(sectionFloat);
            const index2 = Math.min(index1 + 1, effectiveShapeCount - 1);
            const localT = sectionFloat - index1; // Progress between Shape A and Shape B

            const currentRotation = THREE.MathUtils.lerp(
                shapeRotation[index1],
                shapeRotation[index2],
                localT
            );

            const cosR = Math.cos(currentRotation);
            const sinR = Math.sin(currentRotation);

            const char1 = branchChars[index1];
            const char2 = branchChars[index2];

            for (let j = 0; j < radialRes; j++) {
                const angle = (j / radialRes) * Math.PI * 2;

                // Get coordinates for Outer and Inner walls
                const p1Outer = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * shapeScales[index1], 0, shapes[index1]);
                const p2Outer = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * shapeScales[index2], 0, shapes[index2]);
                const p1Inner = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * shapeScales[index1], params.wallThickness, shapes[index1]);
                const p2Inner = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * shapeScales[index2], params.wallThickness, shapes[index2]);

                // To have the shapes rotate
                let lerpedOuterX = THREE.MathUtils.lerp(p1Outer.x, p2Outer.x, localT);
                let lerpedOuterY = THREE.MathUtils.lerp(p1Outer.y, p2Outer.y, localT);

                const finalOuterX = lerpedOuterX * cosR - lerpedOuterY * sinR;
                const finalOuterY = lerpedOuterX * sinR + lerpedOuterY * cosR;

                vertices.push(p.x + finalOuterX, p.y + finalOuterY, p.z);

                let lerpedInnerX = THREE.MathUtils.lerp(p1Inner.x, p2Inner.x, localT);
                let lerpedInnerY = THREE.MathUtils.lerp(p1Inner.y, p2Inner.y, localT);

                const finalInnerX = lerpedInnerX * cosR - lerpedInnerY * sinR;
                const finalInnerY = lerpedInnerX * sinR + lerpedInnerY * cosR;

                vertices.push(p.x + finalInnerX, p.y + finalInnerY, p.z);
            }
        }

        // Face Generation (Connecting vertices into triangles)
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
        // Capping the walls
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
        geometry.computeVertexNormals(); // for lighting/shading
        return geometry;
    }

    // Mirroring a mesh makes it "inside out"
    function reverseWindingOrder(geometry) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) {
            const temp = indices[i + 1];
            indices[i + 1] = indices[i + 2];
            indices[i + 2] = temp;
        }
        geometry.computeVertexNormals();
    }

    // MULTIPLY OBJECT AND ORGANIZE
    let geometries = [];
    const baseGeo = createHollowMorphedLine();
    const distribution = params.distribution || 'Mandala';

    switch (distribution) {
        case 'Mandala':
            baseGeo.translate(params.centerOffset, 0, 0);
            const stepAngle = (Math.PI * 2) / params.count;
            for (let i = 0; i < params.count; i++) {
                const angle = i * stepAngle;
                const geo = baseGeo.clone();
                geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
                geometries.push(geo);
                if (params.reflect) {
                    const reflectedGeo = baseGeo.clone();
                    reflectedGeo.scale(-1, 1, 1);
                    reverseWindingOrder(reflectedGeo);
                    const mirrorAngle = angle + (stepAngle * params.stepAngle);
                    reflectedGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(mirrorAngle));
                    geometries.push(reflectedGeo);
                }
            }
            break;

        case 'Grid':
            //const gridCount = Math.ceil(Math.sqrt(params.count));
            //const gridCount = params.count / 2;
            //const gridCount = params.count;
            const gridCol = Math.max(1, Math.floor(params.count / 2));
            const gridRow = Math.max(1, Math.floor(params.count / 2) + (params.count % 2));
            const spacing = params.centerOffset / 2;
            const angle = params.stepAngle * (Math.PI);
            for (let i = 0; i < gridCol; i++) {
                for (let j = 0; j < gridRow; j++) {

                    const geo = baseGeo.clone();
                    if (params.reflect && j % 2 == 0) {
                        geo.scale(-1, 1, 1);
                        reverseWindingOrder(geo);
                        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(params.stepAngle));
                    }
                    if (params.reflect && i % 2 == 0) {
                        geo.scale(1, -1, 1);
                        reverseWindingOrder(geo);
                        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(params.stepAngle));
                    }
                    const x = (i - (gridCol - 1) / 2) * spacing;
                    const y = (j - (gridRow - 1) / 2) * spacing;
                    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, 0));

                    geometries.push(geo);
                }
            }
            break;
    }

    const merged = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose()); // Cleanup
    baseGeo.dispose();

    const localPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), planeHeight * params.height + 0.05);

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,    // 0x8b7668  // 0xe2b49c
        roughness: 1.0,
        metalness: 0.0,
        flatShading: false,
        side: THREE.DoubleSide,
        clippingPlanes: [localPlane]
    });
    let mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// -----------------------------------------------------------
// CONFIGURATION PARAMETERS
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
};

// -----------------------------------------------------------
// PARAMETERS RANDOMIZATION
// -----------------------------------------------------------
export function randomizeParams(params) {
    Object.keys(PARAMS_CONFIG).forEach(key => {
        if (key === "textContent") return; // don't change textContent

        const param_config = PARAMS_CONFIG[key];
        if (param_config.type === 'text') {
            params[key] = "CLAY";
        } else if (Array.isArray(param_config.options)) {
            params[key] = param_config.options[Math.floor(Math.random() * param_config.options.length)];
        } else if (param_config.type === 'boolean') {
            params[key] = Math.random() > 0.5;
        } else {
            let val = param_config.min + Math.random() * (param_config.max - param_config.min);
            if (param_config.step) {
                const inv = 1.0 / param_config.step;
                val = Math.round(val * inv) / inv;
            }
            params[key] = val;
        }
    });
    //params["textContent"] = "CLAY";
    console.log(params);
    return params;
}

//     params.text = "A";


