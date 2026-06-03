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


// -----------------------------------------------------------
// OBJECT GENERATION
// -----------------------------------------------------------
export function createMandala(params, isGallery = false) {
    // 1. START OVERALL TIMER
    const totalStart = performance.now();

    // Object to store individual breakdown durations
    const metrics = {};


    const primitives = ['Letter', 'Square', 'Circle', 'Triangle', 'Irregular'];

    function createGenerator(seed) {
        return function () {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function getMiterOffset(points, index, offset) {
        const p2 = points[index];
        const p1 = points[(index - 1 + points.length) % points.length];
        const p3 = points[(index + 1) % points.length];
        const v1 = new THREE.Vector2().subVectors(p2, p1).normalize();
        const v2 = new THREE.Vector2().subVectors(p3, p2).normalize();
        const n1 = new THREE.Vector2(-v1.y, v1.x);
        const n2 = new THREE.Vector2(-v2.y, v2.x);
        const miter = new THREE.Vector2().addVectors(n1, n2).normalize();
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
            return { x: Math.cos(invAngle) * (r - offset), y: Math.sin(invAngle) * (r - offset) };
        }
        else if (type === 'Square') {
            pts = [
                new THREE.Vector2(0, r),
                new THREE.Vector2(-r, r),
                new THREE.Vector2(-r, -r),
                new THREE.Vector2(r, -r),
                new THREE.Vector2(r, r),
            ];
        }
        else if (type === 'Triangle') {
            const tr = r * 1.5;
            pts = [
                new THREE.Vector2(0, tr),
                new THREE.Vector2(tr * Math.cos(7 * Math.PI / 6), tr * Math.sin(7 * Math.PI / 6)),
                new THREE.Vector2(tr * Math.cos(-Math.PI / 6), tr * Math.sin(-Math.PI / 6))
            ];
        }
        else if (type === 'Irregular') {
            pts = [
                new THREE.Vector2(0, r * 1.5),
                new THREE.Vector2(-r * 0.8, -r * 0.2),
                new THREE.Vector2(0, -r * 0.5),
                new THREE.Vector2(r * 1.2, 0),
            ];
        }
        else if (type === 'Letter' && shapes) {
            //const shapes = loadedFont.generateShapes(params.text || "A", size * 2, 12);
            const shape = shapes[0];
            //pts = shape.getSpacedPoints(64);
            pts = shape.getPoints();
            pts.pop();
            const box = new THREE.Box2().setFromPoints(pts);
            const center = new THREE.Vector2();
            box.getCenter(center);
            pts.forEach(p => p.sub(center));
            pts.reverse();

            let closestIdx = 0;
            let minYDist = Infinity;
            pts.forEach((p, index) => {
                const dist = Math.hypot(p.x - 0, p.y - box.max.y);
                if (dist < minYDist) {
                    minYDist = dist;
                    closestIdx = index;
                }
            });
            pts = [...pts.slice(closestIdx), ...pts.slice(0, closestIdx)];
        }

        if (pts.length === 0) return { x: 0, y: 0 };

        const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
        const t = normalizedAngle / (Math.PI * 2);
        const segmentFloat = t * pts.length;
        const i = Math.floor(segmentFloat) % pts.length;
        const localT = segmentFloat - Math.floor(segmentFloat);

        const pStart = getMiterOffset(pts, i, offset);
        const pEnd = getMiterOffset(pts, (i + 1) % pts.length, offset);

        return {
            x: pStart.x + (pEnd.x - pStart.x) * localT,
            y: pStart.y + (pEnd.y - pStart.y) * localT
        };
    }

    function createHollowMorphedLine(lengthMultiplier = 1.0) {
        // Master timer for this individual line execution
        const moduleStart = performance.now();
        const subMetrics = {};

        // ---------------------------------------------------
        // PHASE 1: PATH & CURVE COMPUTATION
        // ---------------------------------------------------
        const tPathStart = performance.now();

        const getShapeRand = createGenerator(params.seedShape);
        const getPathRand = createGenerator(params.seed);

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

        subMetrics["1. Path Generation"] = (performance.now() - tPathStart).toFixed(2) + " ms";

        // ---------------------------------------------------
        // PHASE 2: SHAPE CONFIGURATION & FONT GENERATION
        // ---------------------------------------------------
        const tShapeSetupStart = performance.now();

        const segments = isGallery ? 40 : 80;
        const actualSegments = Math.max(1, Math.floor(segments * lengthMultiplier));

        const radialRes = isGallery ? 16 : 64;
        const vertices = [];
        const indices = [];

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
        subMetrics["2. Base Shape Generation"] = (performance.now() - tShapeSetupStart).toFixed(2) + " ms";

        // ---------------------------------------------------
        // PHASE 3: THE MAIN VERTEX GEN LOOP (The likely bottleneck)
        // ---------------------------------------------------
        const tVertexLoopStart = performance.now();

        // ---> O ciclo agora só vai até aos 'actualSegments' <---
        for (let i = 0; i <= actualSegments; i++) {
            const t = i / segments; // IMPORTANT: Continua a dividir pelo total para manter o morph coerente
            const p = curve.getPointAt(t);

            const sectionFloat = t * (effectiveShapeCount - 1);
            const index1 = Math.floor(sectionFloat);
            const index2 = Math.min(index1 + 1, effectiveShapeCount - 1);
            const localT = sectionFloat - index1;

            const currentRotation = THREE.MathUtils.lerp(
                shapeRotation[index1],
                shapeRotation[index2],
                localT
            );

            const cosR = Math.cos(currentRotation);
            const sinR = Math.sin(currentRotation);

            for (let j = 0; j < radialRes; j++) {
                const angle = (j / radialRes) * Math.PI * 2;

                const p1Outer = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * shapeScales[index1], 0, shapes[index1]);
                const p2Outer = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * shapeScales[index2], 0, shapes[index2]);
                const p1Inner = getPointOnPrimitive(branchShapes[index1], angle, params.shapeRadius * shapeScales[index1], params.wallThickness, shapes[index1]);
                const p2Inner = getPointOnPrimitive(branchShapes[index2], angle, params.shapeRadius * shapeScales[index2], params.wallThickness, shapes[index2]);

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
        subMetrics["3. Vertex + Lerping"] = (performance.now() - tVertexLoopStart).toFixed(2) + " ms";

        // ---------------------------------------------------
        // PHASE 4: INDEX BUILDING & BUFFER ASSEMBLY
        // ---------------------------------------------------
        const tIndexStart = performance.now();

        const rowSize = radialRes * 2;
        // ---> As faces também param no actualSegments <---
        for (let i = 0; i < actualSegments; i++) {
            for (let j = 0; j < radialRes; j++) {
                const nextJ = (j + 1) % radialRes;
                const outCurr = i * rowSize + j * 2, inCurr = outCurr + 1;
                const outNext = i * rowSize + nextJ * 2, inNext = outNext + 1;
                const outAbove = (i + 1) * rowSize + j * 2, inAbove = outAbove + 1;
                const outAboveNext = (i + 1) * rowSize + nextJ * 2, inAboveNext = outAboveNext + 1;

                indices.push(outCurr, outNext, outAboveNext, outCurr, outAboveNext, outAbove);
                indices.push(inCurr, inAboveNext, inNext, inCurr, inAbove, inAboveNext);
            }
        }

        for (let j = 0; j < radialRes; j++) {
            const nextJ = (j + 1) % radialRes;
            const bOut = j * 2, bIn = j * 2 + 1, bOutN = nextJ * 2, bInN = nextJ * 2 + 1;
            indices.push(bOut, bIn, bInN, bOut, bInN, bOutN);

            // ---> A tampa do topo fecha no sítio onde a malha foi cortada <---
            const tOffset = actualSegments * rowSize;
            const tOut = tOffset + j * 2, tIn = tOffset + j * 2 + 1, tOutN = tOffset + nextJ * 2, tInN = tOffset + nextJ * 2 + 1;
            indices.push(tOut, tInN, tIn, tOut, tOutN, tInN);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        subMetrics["4. Face Assembly"] = (performance.now() - tIndexStart).toFixed(2) + " ms";

        // Print out internal line sub-metrics cleanly grouped together
        const lineTotal = performance.now() - moduleStart;
        console.groupCollapsed(`Module Generation: ${lineTotal.toFixed(2)}ms`);
        console.table(subMetrics);
        console.groupEnd();

        return geometry;
    }

    function reverseWindingOrder(geometry) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) {
            const temp = indices[i + 1];
            indices[i + 1] = indices[i + 2];
            indices[i + 2] = temp;
        }
        geometry.computeVertexNormals();
    }

    let geometries = [];
    const distribution = params.distribution || 'Mandala';

    // gerador para garantir que a aletoriedade das alturas é consistente
    const branchRand = createGenerator(params.variationSeed || 1234);

    // 2. MEASURE BASE GEOMETRY GENERATION
    const tModuleStart = performance.now();


    const fullBaseGeo = createHollowMorphedLine(1.0);

    // Time measurement 
    metrics["1 Module Generation"] = (performance.now() - tModuleStart).toFixed(2) + " ms";

    // 3. MEASURE THE DISTRIBUTION SYSTEM (Mandala / Grid loops)
    const tOrganizationStart = performance.now();


    switch (distribution) {
        case 'Mandala':
            const stepAngle = (Math.PI * 2) / params.count;
            for (let i = 0; i < params.count; i++) {
                // Calcular o tamanho deste braço específico
                let multiplier = 1.0;
                if (params.cutVariation > 0) {
                    // Ex: Se cutVariation for 0.6, o tamanho flutua entre 40% e 100%
                    multiplier = 1.0 - (branchRand() * params.cutVariation);
                }

                const angle = i * stepAngle;

                // chamar createHollowMorphedLine() dentro de um loop, 
                //torna o sistema muito lento
                // Se a variação for 0, usamos o CLONE super rápido. Se não, geramos um novo.
                const geo = (params.cutVariation === 0) ? fullBaseGeo.clone() : createHollowMorphedLine(multiplier);

                geo.translate(params.centerOffset, 0, 0);
                geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
                geometries.push(geo);

                if (params.reflect) {
                    const reflectedGeo = (params.cutVariation === 0) ? fullBaseGeo.clone() : createHollowMorphedLine(multiplier);
                    reflectedGeo.translate(params.centerOffset, 0, 0);
                    reflectedGeo.scale(-1, 1, 1);
                    reverseWindingOrder(reflectedGeo);
                    const mirrorAngle = angle + (stepAngle * params.stepAngle);
                    reflectedGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(mirrorAngle));
                    geometries.push(reflectedGeo);
                }
            }
            break;

        case 'Grid':
            const gridCol = Math.max(1, Math.floor(params.count / 2));
            const gridRow = Math.max(1, Math.floor(params.count / 2) + (params.count % 2));
            const spacing = params.centerOffset / 2;
            const angle = params.stepAngle * (Math.PI);
            for (let i = 0; i < gridCol; i++) {
                for (let j = 0; j < gridRow; j++) {
                    let multiplier = 1.0;
                    if (params.cutVariation > 0) {
                        multiplier = 1.0 - (branchRand() * params.cutVariation);
                    }

                    const geo = (params.cutVariation === 0) ? fullBaseGeo.clone() : createHollowMorphedLine(multiplier);

                    if (params.reflect && j % 2 == 0) {
                        geo.scale(-1, 1, 1);
                        reverseWindingOrder(geo);
                        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
                    }
                    if (params.reflect && i % 2 == 0) {
                        geo.scale(1, -1, 1);
                        reverseWindingOrder(geo);
                        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
                    }
                    const x = (i - (gridCol - 1) / 2) * spacing;
                    const y = (j - (gridRow - 1) / 2) * spacing;
                    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, 0));

                    geometries.push(geo);
                }
            }
            break;
    }

    metrics["Organization Loops"] = (performance.now() - tOrganizationStart).toFixed(2) + " ms";

    // 4. MEASURE MERGING AND CLEANUP
    const tMergeStart = performance.now();

    const merged = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    fullBaseGeo.dispose(); // Limpa o molde original da memória

    metrics["Merging"] = (performance.now() - tMergeStart).toFixed(2) + " ms";

    // 5. MEASURE FINAL MESH AND MATERIAL COMPILATION
    const tMaterialStart = performance.now();

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        flatShading: true,
        side: THREE.DoubleSide,
        opacity: 0.5,
        transparent: false
    });
    let mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    metrics["Material"] = (performance.now() - tMaterialStart).toFixed(2) + " ms";


    // 6. STOP OVERALL TIMER & OUTPUT
    const totalTime = (performance.now() - totalStart).toFixed(2);

    // Print clear analytics to the browser Console
    console.groupCollapsed(`Render Profiling: ${totalTime}ms (Branches: ${geometries.length})`);
    console.table(metrics);
    console.groupEnd();


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
    cutVariation: { min: 0, max: 0.9, step: 0.05, folder: 'General', label: 'Branch Variation' },
    variationSeed: { min: 1, max: 9999, step: 1, folder: 'General', label: 'Variation Seed' }
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
    //params["cutVariation"] = Math.random() > 0.5 ? 0.0 : Math.random() * 0.8;
    params["cutVariation"] = 0.0;
    //params["textMode"] = false;
    console.log(params);
    return params;
}