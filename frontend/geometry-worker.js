'use strict';

// ============================================================
// SEEDED RNG  (identical to the main thread version)
// ============================================================

function createGenerator(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ============================================================
// CATMULL-ROM CURVE  (replaces THREE.CatmullRomCurve3)
// Uses an arc-length look-up table so getPointAt(t) gives the
// same uniform distribution as Three.js's implementation.
// ============================================================

function _catmullRomInterp(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
        x: 0.5 * (2 * p1.x + t * (-p0.x + p2.x) + t2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) + t3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x)),
        y: 0.5 * (2 * p1.y + t * (-p0.y + p2.y) + t2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) + t3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y)),
        z: 0.5 * (2 * p1.z + t * (-p0.z + p2.z) + t2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) + t3 * (-p0.z + 3 * p1.z - 3 * p2.z + p3.z)),
    };
}

function buildCurve(pts) {
    const n = pts.length;

    // Evaluate the raw parameterised curve at t ∈ [0, 1]
    function getPoint(t) {
        const p = Math.min(t, 1 - 1e-10) * (n - 1);
        const i = Math.floor(p);
        const lt = p - i;
        return _catmullRomInterp(
            pts[Math.max(i - 1, 0)],
            pts[i],
            pts[Math.min(i + 1, n - 1)],
            pts[Math.min(i + 2, n - 1)],
            lt
        );
    }

    // Build arc-length table
    const DIVS = 200;
    const arcLen = new Float64Array(DIVS + 1); // arcLen[k] = length up to k/DIVS
    let prev = getPoint(0);
    let totalLen = 0;
    for (let k = 1; k <= DIVS; k++) {
        const curr = getPoint(k / DIVS);
        const dx = curr.x - prev.x, dy = curr.y - prev.y, dz = curr.z - prev.z;
        totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
        arcLen[k] = totalLen;
        prev = curr;
    }

    return {
        getPointAt(t) {
            const target = t * totalLen;
            // Binary search for the bracketing segment
            let lo = 0, hi = DIVS;
            while (lo < hi - 1) {
                const mid = (lo + hi) >> 1;
                if (arcLen[mid] < target) lo = mid; else hi = mid;
            }
            const segLen = arcLen[hi] - arcLen[lo];
            const lt = segLen > 1e-10 ? (target - arcLen[lo]) / segLen : 0;
            return getPoint((lo + lt) / DIVS);
        },
    };
}

// ============================================================
// 2-D VECTOR UTILITIES  (replaces THREE.Vector2)
// ============================================================

function _normalize2(x, y) {
    const l = Math.sqrt(x * x + y * y);
    return l > 1e-10 ? [x / l, y / l] : [0, 0];
}

// ============================================================
// GEOMETRY GENERATION
// Produces raw Float32Array (positions) + Uint32Array (indices).
// No Three.js objects
// ============================================================

const PRIMITIVES = ['Square', 'Circle', 'Triangle', 'Irregular'];

/**
 * Calculates the miter offset for a vertex. 
 * Includes a limit to prevent "exploding" geometry on sharp corners.
 */
function getMiterOffset(pts, index, offset) {
    const p2 = pts[index];
    const p1 = pts[(index - 1 + pts.length) % pts.length];
    const p3 = pts[(index + 1) % pts.length];

    const [v1x, v1y] = _normalize2(p2.x - p1.x, p2.y - p1.y);
    const [v2x, v2y] = _normalize2(p3.x - p2.x, p3.y - p2.y);

    const n1x = -v1y, n1y = v1x;
    const n2x = -v2y, n2y = v2x;

    const [mx, my] = _normalize2(n1x + n2x, n1y + n2y);
    const dot = mx * n1x + my * n1y;

    // Miter limit: If the angle is too sharp, we cap the length 
    // but keep it on the bisector. This "cuts off" the corner inside.
    // Using 0.5 as a threshold (approx 60 degrees) prevents self-intersection.
    const miterLimit = 2.5;
    const length = Math.min(offset / Math.max(dot, 0.1), offset * miterLimit);

    return { x: p2.x + mx * length, y: p2.y + my * length };
}

function _reorderToTop(pts) {
    if (!pts.length) return pts;
    let bestIdx = 0, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
        // Use a small epsilon to handle floating point noise at the top edge
        if (pts[i].y > maxY + 0.001) {
            maxY = pts[i].y; bestIdx = i;
        } else if (Math.abs(pts[i].y - maxY) < 0.001 && pts[i].x < pts[bestIdx].x) {
            bestIdx = i;
        }
    }
    return [...pts.slice(bestIdx), ...pts.slice(0, bestIdx)];
}

function _getTriangleArea(p1, p2, p3) {
    return Math.abs((p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2.0);
}

function visvalingamWhyatt(pts, target) {
    let current = pts.map((p, i) => ({ ...p }));
    while (current.length > target) {
        let minScore = Infinity, removeIdx = -1;
        for (let i = 0; i < current.length; i++) {
            const prev = current[(i - 1 + current.length) % current.length];
            const curr = current[i];
            const next = current[(i + 1) % current.length];

            const area = _getTriangleArea(prev, curr, next);
            // Heuristic: multiply area by the cosine of the angle to protect sharp corners
            if (area < minScore) { minScore = area; removeIdx = i; }
        }
        current.splice(removeIdx, 1);
    }
    return current;
}

function subdivideSkeleton(pts, target) {
    const n = pts.length;
    const lengths = new Float64Array(n);
    let totalLen = 0;
    for (let i = 0; i < n; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % n];
        lengths[i] = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        totalLen += lengths[i];
    }
    const counts = new Int32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        counts[i] = Math.max(1, Math.round((lengths[i] / totalLen) * target));
        sum += counts[i];
    }
    while (sum !== target) {
        const dir = sum < target ? 1 : -1;
        let bestIdx = 0, maxVal = -1;
        for (let i = 0; i < n; i++) { if (lengths[i] > maxVal) { maxVal = lengths[i]; bestIdx = i; } }
        counts[bestIdx] += dir; sum += dir;
    }
    const result = [];
    for (let i = 0; i < n; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % n];
        for (let j = 0; j < counts[i]; j++) {
            const t = j / counts[i];
            result.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
        }
    }
    return result;
}

function getShapeVertices(type, size, wallThickness, radialRes, fontPts) {
    let skeleton = [];
    const r = size;
    if (type === 'Circle') {
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2 + Math.PI / 2;
            skeleton.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
    } else if (type === 'Square') {
        skeleton = [{ x: -r, y: r }, { x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }];
    } else if (type === 'Triangle') {
        const tr = r * 1.5;
        skeleton = [{ x: 0, y: tr }, { x: tr * Math.cos(7 * Math.PI / 6), y: tr * Math.sin(7 * Math.PI / 6) }, { x: tr * Math.cos(-Math.PI / 6), y: tr * Math.sin(-Math.PI / 6) }];
    } else if (type === 'Irregular') {
        skeleton = [{ x: 0, y: r * 1.5 }, { x: -r * 0.8, y: -r * 0.2 }, { x: 0, y: -r * 0.5 }, { x: r * 1.2, y: 0 }];
    } else if (type === 'Letter' && fontPts) {
        skeleton = fontPts;
    } else {
        return { outer: new Array(radialRes).fill({ x: 0, y: 0 }), inner: new Array(radialRes).fill({ x: 0, y: 0 }) };
    }

    if (skeleton.length > radialRes) {
        skeleton = visvalingamWhyatt(skeleton, radialRes);
    }

    skeleton = _reorderToTop(skeleton);
    const innerSkeleton = skeleton.map((_, i) => getMiterOffset(skeleton, i, wallThickness));

    if (skeleton.length < radialRes) {
        return {
            outer: subdivideSkeleton(skeleton, radialRes),
            inner: subdivideSkeleton(innerSkeleton, radialRes)
        };
    }

    return { outer: skeleton, inner: innerSkeleton };
}

/**
 * Build one hollow tube along a random Catmull-Rom path.
 *
 * @param {object}      params
 * @param {Array|null}  fontShapeData  – Array of [{x,y}] point arrays, one per text char.
 *                                       Each array was built in the main thread so the
 *                                       coordinates are already in world-space for that char.
 * @param {string}      lod            – 'low', 'mid', or 'high' quality
 * @param {number}      lengthMultiplier – 0..1, trims the tube height
 * @returns {{ vertices: Float32Array, indices: Uint32Array }}
 */
function createHollowMorphedLine(params, fontShapeData, lod, lengthMultiplier = 1.0) {

    const getShapeRand = createGenerator(params.seedShape);
    const getPathRand = createGenerator(params.seed);

    // --- Build Catmull-Rom path ---
    const pathPts = [];
    let cx = (getPathRand() - 0.5) * params.inc;
    let cy = (getPathRand() - 0.5) * params.inc;
    let cz = 0;
    pathPts.push({ x: cx, y: cy, z: cz });
    for (let i = 0; i < params.points; i++) {
        cx += (getPathRand() - 0.5) * params.inc;
        cy += (getPathRand() - 0.5) * params.inc;
        cz += params.height / params.points;
        pathPts.push({ x: cx, y: cy, z: cz });
    }
    const curve = buildCurve(pathPts);

    // --- Resolution ---
    // Low: Fast batch | Mid: Smooth gallery | High: Editor/Print
    // const segments = lod === 'low' ? 30 : (lod === 'mid' ? 50 : 80);
    // const actualSegs = Math.max(1, Math.floor(segments * lengthMultiplier));
    // const radialRes = lod === 'low' ? 12 : (lod === 'mid' ? 32 : 64);

    const segments = lod === 'low' ? 10 : (lod === 'mid' ? 40 : 80);
    const actualSegs = Math.max(1, Math.floor(segments * lengthMultiplier));
    const radialRes = lod === 'low' ? 6 : (lod === 'mid' ? 32 : 64);

    const isTextMode = params.textMode && params.textContent;
    const effectiveShapeCount = isTextMode ? params.textContent.length : params.shapeCount;

    const precalcShapes = []; // Array of { outer: [{x,y}...], inner: [{x,y}...] }
    const shapeRots = [];

    for (let i = 0; i < effectiveShapeCount; i++) {
        const scale = 0.6 + getShapeRand() * 0.8;
        const type = isTextMode ? 'Letter' : PRIMITIVES[Math.floor(getShapeRand() * PRIMITIVES.length)];
        if (isTextMode) getShapeRand(); // sync RNG
        shapeRots.push(getShapeRand() * (Math.PI / 2));

        precalcShapes.push(getShapeVertices(type, params.shapeRadius * scale, params.wallThickness, radialRes, fontShapeData ? fontShapeData[i] : null));
    }

    const rowSize = radialRes * 2;                          // outer + inner vertices per ring
    const numFloats = (actualSegs + 1) * rowSize * 3;
    const numIndices = actualSegs * radialRes * 12            // side walls (outer + inner)
        + radialRes * 12;                         // bottom cap + top cap

    const vertices = new Float32Array(numFloats);
    const indices = new Uint32Array(numIndices);

    // --- Fill vertex buffer ---
    let vIdx = 0;
    for (let i = 0; i <= actualSegs; i++) {
        const t = i / segments; // divide by full `segments` to keep morph consistent when trimmed
        const p = curve.getPointAt(t);

        const sf = t * (effectiveShapeCount - 1);
        const idx1 = Math.floor(sf);
        const idx2 = Math.min(idx1 + 1, effectiveShapeCount - 1);
        const lt = sf - idx1;

        const rot = shapeRots[idx1] + (shapeRots[idx2] - shapeRots[idx1]) * lt;
        const cosR = Math.cos(rot), sinR = Math.sin(rot);

        for (let j = 0; j < radialRes; j++) {
            const angle = (j / radialRes) * Math.PI * 2;

            const s1 = precalcShapes[idx1];
            const s2 = precalcShapes[idx2];

            // Lerp then rotate
            const ox = s1.outer[j].x + (s2.outer[j].x - s1.outer[j].x) * lt;
            const oy = s1.outer[j].y + (s2.outer[j].y - s1.outer[j].y) * lt;
            const ix = s1.inner[j].x + (s2.inner[j].x - s1.inner[j].x) * lt;
            const iy = s1.inner[j].y + (s2.inner[j].y - s1.inner[j].y) * lt;

            const fox = ox * cosR - oy * sinR;
            const foy = ox * sinR + oy * cosR;
            const fix = ix * cosR - iy * sinR;
            const fiy = ix * sinR + iy * cosR;

            // Outer vertex
            vertices[vIdx++] = p.x + fox;
            vertices[vIdx++] = p.y + foy;
            vertices[vIdx++] = p.z;

            // Inner vertex  (interleaved: [outer, inner, outer, inner, …] per ring)
            vertices[vIdx++] = p.x + fix;
            vertices[vIdx++] = p.y + fiy;
            vertices[vIdx++] = p.z;
        }
    }

    // --- Fill index buffer ---
    let iIdx = 0;

    // Side walls
    for (let i = 0; i < actualSegs; i++) {
        for (let j = 0; j < radialRes; j++) {
            const nj = (j + 1) % radialRes;
            const oC = i * rowSize + j * 2, iC = oC + 1;
            const oN = i * rowSize + nj * 2, iN = oN + 1;
            const oA = (i + 1) * rowSize + j * 2, iA = oA + 1;
            const oAN = (i + 1) * rowSize + nj * 2, iAN = oAN + 1;

            // Outer face (two triangles)
            indices[iIdx++] = oC; indices[iIdx++] = oN; indices[iIdx++] = oAN;
            indices[iIdx++] = oC; indices[iIdx++] = oAN; indices[iIdx++] = oA;

            // Inner face (two triangles — opposite winding)
            indices[iIdx++] = iC; indices[iIdx++] = iAN; indices[iIdx++] = iN;
            indices[iIdx++] = iC; indices[iIdx++] = iA; indices[iIdx++] = iAN;
        }
    }

    // Bottom cap
    for (let j = 0; j < radialRes; j++) {
        const nj = (j + 1) % radialRes;
        indices[iIdx++] = j * 2; indices[iIdx++] = j * 2 + 1; indices[iIdx++] = nj * 2 + 1;
        indices[iIdx++] = j * 2; indices[iIdx++] = nj * 2 + 1; indices[iIdx++] = nj * 2;
    }

    // Top cap
    const tOff = actualSegs * rowSize;
    for (let j = 0; j < radialRes; j++) {
        const nj = (j + 1) % radialRes;
        indices[iIdx++] = tOff + j * 2; indices[iIdx++] = tOff + nj * 2 + 1; indices[iIdx++] = tOff + j * 2 + 1;
        indices[iIdx++] = tOff + j * 2; indices[iIdx++] = tOff + nj * 2; indices[iIdx++] = tOff + nj * 2 + 1;
    }

    return { vertices, indices };
}

// ============================================================
// TRANSFORMS ON FLAT VERTEX ARRAYS  (no Three.js)
// All operations are in-place on Float32Array / Uint32Array.
// ============================================================

function applyTranslate(verts, tx, ty, tz) {
    for (let i = 0; i < verts.length; i += 3) {
        verts[i] += tx; verts[i + 1] += ty; verts[i + 2] += tz;
    }
}

function applyRotateZ(verts, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let i = 0; i < verts.length; i += 3) {
        const x = verts[i], y = verts[i + 1];
        verts[i] = x * cos - y * sin;
        verts[i + 1] = x * sin + y * cos;
    }
}

function applyScaleX(verts) {
    for (let i = 0; i < verts.length; i += 3) verts[i] *= -1;
}

function applyScaleY(verts) {
    for (let i = 0; i < verts.length; i += 3) verts[i + 1] *= -1;
}

// Flip winding order so normals stay outward after a reflection.
function flipWinding(idxs) {
    for (let i = 0; i < idxs.length; i += 3) {
        const tmp = idxs[i + 1]; idxs[i + 1] = idxs[i + 2]; idxs[i + 2] = tmp;
    }
}

// ============================================================
// MERGE ALL BRANCHES INTO SINGLE TYPED ARRAYS
// ============================================================

function mergeAll(branches) {
    let totalV = 0, totalI = 0;
    for (const b of branches) { totalV += b.vertices.length; totalI += b.indices.length; }

    const positions = new Float32Array(totalV);
    const indices = new Uint32Array(totalI);

    let vOff = 0, iOff = 0;
    for (const b of branches) {
        positions.set(b.vertices, vOff);
        const base = vOff / 3; // vertex index offset (vOff is in floats, 3 per vertex)
        for (let k = 0; k < b.indices.length; k++) indices[iOff + k] = b.indices[k] + base;
        vOff += b.vertices.length;
        iOff += b.indices.length;
    }
    return { positions, indices };
}

// ============================================================
// DISTRIBUTION LOOP  (Mandala / Grid)
// ============================================================

function generateMandala(params, fontShapeData, lod) {
    const branchRand = createGenerator(params.variationSeed || 1234);
    const distribution = params.distribution || 'Mandala';
    const noVariation = params.cutVariation === 0;

    // Generate the canonical (full-length) tube once
    const baseData = createHollowMorphedLine(params, fontShapeData, lod, 1.0);

    const branches = [];

    // Helper: get source data for a branch, respecting cutVariation
    function srcFor(multiplier) {
        if (noVariation) {
            // Copy from pre-built base — Float32Array.set is a fast memcpy
            return {
                vertices: new Float32Array(baseData.vertices),
                indices: new Uint32Array(baseData.indices),
            };
        }
        return createHollowMorphedLine(params, fontShapeData, lod, multiplier);
    }

    if (distribution === 'Mandala') {
        const stepAngle = (Math.PI * 2) / params.count;

        for (let i = 0; i < params.count; i++) {
            const multiplier = noVariation ? 1.0 : 1.0 - branchRand() * params.cutVariation;
            const angle = i * stepAngle;

            // --- Primary branch ---
            const d = srcFor(multiplier);
            applyTranslate(d.vertices, params.centerOffset, 0, 0);
            applyRotateZ(d.vertices, angle);
            branches.push(d);

            // --- Reflected branch ---
            if (params.reflect) {
                const mirrorAngle = angle + stepAngle * params.stepAngle;
                const r = srcFor(multiplier);
                applyTranslate(r.vertices, params.centerOffset, 0, 0);
                applyScaleX(r.vertices);
                flipWinding(r.indices);
                applyRotateZ(r.vertices, mirrorAngle);
                branches.push(r);
            }
        }

    } else if (distribution === 'Grid') {
        const gridCol = Math.max(1, Math.floor(params.count / 2));
        const gridRow = Math.max(1, Math.floor(params.count / 2) + (params.count % 2));
        const spacing = params.centerOffset / 2;
        const angle = params.stepAngle * Math.PI;

        for (let ci = 0; ci < gridCol; ci++) {
            for (let ri = 0; ri < gridRow; ri++) {
                const multiplier = noVariation ? 1.0 : 1.0 - branchRand() * params.cutVariation;
                const d = srcFor(multiplier);

                // Mirror rules (kept identical to original — both can trigger independently)
                if (params.reflect && ri % 2 === 0) {
                    applyScaleX(d.vertices);
                    flipWinding(d.indices);
                    applyRotateZ(d.vertices, angle);
                }
                if (params.reflect && ci % 2 === 0) {
                    applyScaleY(d.vertices);
                    flipWinding(d.indices);
                    applyRotateZ(d.vertices, angle);
                }

                const gx = (ci - (gridCol - 1) / 2) * spacing;
                const gy = (ri - (gridRow - 1) / 2) * spacing;
                applyTranslate(d.vertices, gx, gy, 0);
                branches.push(d);
            }
        }
    }

    const { positions, indices } = mergeAll(branches);
    const normals = computeNormals(positions, indices);
    return { positions, normals, indices };
}

// ============================================================
// SMOOTH NORMAL COMPUTATION
// Replicates THREE.BufferGeometry.computeVertexNormals() but
// runs entirely in the worker so the main thread never blocks.
//
// Each face normal is weighted by triangle area (un-normalised
// cross product) before accumulation — this is the standard
// approach and matches Three.js's own implementation.
// ============================================================

function computeNormals(positions, indices) {
    const normals = new Float32Array(positions.length); // zero-filled

    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        // Two edge vectors from vertex 0
        const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
        const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];

        // Cross product — magnitude is proportional to triangle area (area weighting)
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;

        // Accumulate into all three corners
        normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
        normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
        normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
    }

    // Normalise each vertex normal
    for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i], y = normals[i + 1], z = normals[i + 2];
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len > 1e-10) {
            normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
        }
    }

    return normals;
}

// ============================================================
// WORKER MESSAGE HANDLER
// ============================================================

self.onmessage = function (e) {
    const { type, params, fontShapeData, lod, population, id } = e.data;

    if (type === 'GENERATE_SINGLE') {
        const start = performance.now();
        const result = generateMandala(params, fontShapeData, lod);
        const duration = (performance.now() - start).toFixed(2);

        console.log(`WORKER: ID: ${id} | LOD: ${lod.toUpperCase()} | Time: ${duration}ms`);
        self.postMessage({
            success: true,
            type: 'SINGLE',
            id: id,
            geometryData: result,
            params: params,
            duration: duration
        }, [
            result.positions.buffer,
            result.normals.buffer,
            result.indices.buffer,
        ]);
        // } else if (type === 'GENERATE_BATCH') {
        //     const results = [];
        //     const transferables = [];

        //     for (let i = 0; i < population.length; i++) {
        //         const item = population[i];
        //         try {
        //             const res = generateMandala(item.params, item.fontShapeData, lod);
        //             results.push({
        //                 id: item.id,
        //                 geometryData: res,
        //                 dna: item.dna,
        //                 params: item.params
        //             });
        //             transferables.push(res.positions.buffer, res.normals.buffer, res.indices.buffer);
        //         } catch (err) {
        //             results.push({ id: item.id, error: err.message });
        //         }
        //     }

        //     self.postMessage({
        //         success: true,
        //         type: 'BATCH',
        //         results: results
        //     }, transferables);
    }
};
