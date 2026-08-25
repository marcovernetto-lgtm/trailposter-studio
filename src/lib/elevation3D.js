import * as THREE from 'three';
import { latLonToMercator } from './gpxParser';

/**
 * Generates a watertight 3D solid terrain mesh (top relief, 4 side skirts, flat bottom)
 * suitable for 3D printing (STL/OBJ) and real-time WebGL rendering.
 */
export function createTerrainSolidGeometry(elevGrid, options = {}) {
  if (!elevGrid || !elevGrid.grid) return null;

  const {
    modelWidth = 140, // mm
    modelHeight = 140, // mm (or scaled to aspect ratio)
    baseThickness = 4, // mm below lowest elevation
    heightScale = 1.8, // vertical elevation exaggeration
    maxElevationHeight = 25, // max height relief in mm
  } = options;

  const grid = elevGrid.grid;
  const resY = grid.length;
  const resX = grid[0].length;
  const minEle = elevGrid.minEle || 0;
  const maxEle = elevGrid.maxEle || 1000;
  const eleSpan = Math.max(1, maxEle - minEle);

  const halfW = modelWidth / 2;
  const halfH = modelHeight / 2;

  // Arrays for top vertices, normals, UVs
  const positions = [];
  const indices = [];
  const uvs = [];

  // Helper to get normalized 3D coords
  const getZ = (xIdx, yIdx) => {
    const rawEle = grid[yIdx][xIdx];
    const normalized = (rawEle - minEle) / eleSpan;
    return baseThickness + normalized * maxElevationHeight * heightScale;
  };

  const getX = (xIdx) => -halfW + (xIdx / (resX - 1)) * modelWidth;
  const getY = (yIdx) => -halfH + (yIdx / (resY - 1)) * modelHeight;

  // 1. GENERATE TOP TERRAIN GRID VERTICES
  for (let j = 0; j < resY; j++) {
    for (let i = 0; i < resX; i++) {
      const x = getX(i);
      const y = getY(j);
      const z = getZ(i, j);

      positions.push(x, y, z);
      uvs.push(i / (resX - 1), j / (resY - 1));
    }
  }

  // 2. TOP TERRAIN TRIANGLES
  for (let j = 0; j < resY - 1; j++) {
    for (let i = 0; i < resX - 1; i++) {
      const a = j * resX + i;
      const b = j * resX + (i + 1);
      const c = (j + 1) * resX + i;
      const d = (j + 1) * resX + (i + 1);

      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // 3. GENERATE SKIRT / SIDE WALLS (South, North, West, East)
  const addWallQuad = (p1, p2, p3, p4) => {
    const startIdx = positions.length / 3;
    positions.push(
      p1.x, p1.y, p1.z,
      p2.x, p2.y, p2.z,
      p3.x, p3.y, p3.z,
      p4.x, p4.y, p4.z
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(startIdx, startIdx + 1, startIdx + 2);
    indices.push(startIdx, startIdx + 2, startIdx + 3);
  };

  // South Wall (j = 0)
  for (let i = 0; i < resX - 1; i++) {
    const x0 = getX(i), x1 = getX(i + 1), y = getY(0);
    const z0 = getZ(i, 0), z1 = getZ(i + 1, 0);
    addWallQuad(
      { x: x0, y, z: 0 },
      { x: x1, y, z: 0 },
      { x: x1, y, z: z1 },
      { x: x0, y, z: z0 }
    );
  }

  // North Wall (j = resY - 1)
  for (let i = 0; i < resX - 1; i++) {
    const x0 = getX(i), x1 = getX(i + 1), y = getY(resY - 1);
    const z0 = getZ(i, resY - 1), z1 = getZ(i + 1, resY - 1);
    addWallQuad(
      { x: x1, y, z: 0 },
      { x: x0, y, z: 0 },
      { x: x0, y, z: z0 },
      { x: x1, y, z: z1 }
    );
  }

  // West Wall (i = 0)
  for (let j = 0; j < resY - 1; j++) {
    const y0 = getY(j), y1 = getY(j + 1), x = getX(0);
    const z0 = getZ(0, j), z1 = getZ(0, j + 1);
    addWallQuad(
      { x, y: y1, z: 0 },
      { x, y: y0, z: 0 },
      { x, y: y0, z: z0 },
      { x, y: y1, z: z1 }
    );
  }

  // East Wall (i = resX - 1)
  for (let j = 0; j < resY - 1; j++) {
    const y0 = getY(j), y1 = getY(j + 1), x = getX(resX - 1);
    const z0 = getZ(resX - 1, j), z1 = getZ(resX - 1, j + 1);
    addWallQuad(
      { x, y: y0, z: 0 },
      { x, y: y1, z: 0 },
      { x, y: y1, z: z1 },
      { x, y: y0, z: z0 }
    );
  }

  // 4. FLAT BOTTOM SURFACE (z = 0)
  const bStart = positions.length / 3;
  positions.push(
    -halfW, -halfH, 0,
    halfW, -halfH, 0,
    halfW, halfH, 0,
    -halfW, halfH, 0
  );
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  indices.push(bStart, bStart + 2, bStart + 1);
  indices.push(bStart, bStart + 3, bStart + 2);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return geom;
}

/**
 * Samples elevation at normalized [0, 1] SVG/Canvas space (sx, sy)
 */
export function sampleElevationAt(elevGrid, sx, sy) {
  if (!elevGrid || !elevGrid.grid) return 0;
  const grid = elevGrid.grid;
  const resY = grid.length;
  const resX = grid[0].length;

  const SVG_SIZE = 1000;
  const u = Math.max(0, Math.min(1, sx / SVG_SIZE));
  const v = Math.max(0, Math.min(1, sy / SVG_SIZE));

  const gx = u * (resX - 1);
  const gy = v * (resY - 1);

  const x0 = Math.floor(gx), x1 = Math.min(resX - 1, x0 + 1);
  const y0 = Math.floor(gy), y1 = Math.min(resY - 1, y0 + 1);

  const fx = gx - x0;
  const fy = gy - y0;

  const h00 = grid[y0][x0];
  const h10 = grid[y0][x1];
  const h01 = grid[y1][x0];
  const h11 = grid[y1][x1];

  const top = h00 * (1 - fx) + h10 * fx;
  const btm = h01 * (1 - fx) + h11 * fx;
  return top * (1 - fy) + btm * fy;
}

/**
 * Creates a 3D extruded tube / ribbon geometry for the GPX track draped on the 3D relief
 */
export function createTrackTubeGeometry(points, elevGrid, options = {}) {
  if (!points || points.length < 2 || !elevGrid) return null;

  const {
    modelWidth = 140,
    modelHeight = 140,
    baseThickness = 4,
    heightScale = 1.8,
    maxElevationHeight = 25,
    tubeRadius = 1.2, // mm
    trackLift = 0.8, // mm above terrain surface
    trackPadding = 25,
  } = options;

  const minEle = elevGrid.minEle || 0;
  const maxEle = elevGrid.maxEle || 1000;
  const eleSpan = Math.max(1, maxEle - minEle);

  const SVG_SIZE = 1000;
  const MARGIN = Math.max(15, Math.min(250, trackPadding * 2.5));
  const DRAW_AREA = SVG_SIZE - MARGIN * 2;

  // Find track bounds
  let minMx = Infinity, maxMx = -Infinity;
  let minMy = Infinity, maxMy = -Infinity;
  points.forEach((p) => {
    const mx = p.mx != null ? p.mx : latLonToMercator(p.lat, p.lon).x;
    const my = p.my != null ? p.my : latLonToMercator(p.lat, p.lon).y;
    if (mx < minMx) minMx = mx;
    if (mx > maxMx) maxMx = mx;
    if (my < minMy) minMy = my;
    if (my > maxMy) maxMy = my;
  });

  const widthMx = maxMx - minMx || 1;
  const heightMy = maxMy - minMy || 1;
  const maxDim = Math.max(widthMx, heightMy);
  const offsetX = (maxDim - widthMx) / 2;
  const offsetY = (maxDim - heightMy) / 2;

  const halfW = modelWidth / 2;
  const halfH = modelHeight / 2;

  // Subsample or smooth points if too dense
  const step = Math.max(1, Math.floor(points.length / 400));
  const curvePoints = [];

  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const mx = p.mx != null ? p.mx : latLonToMercator(p.lat, p.lon).x;
    const my = p.my != null ? p.my : latLonToMercator(p.lat, p.lon).y;

    const normX = (mx - (minMx - offsetX)) / maxDim;
    const normY = (my - (minMy - offsetY)) / maxDim;

    // SVG coordinates
    const sx = MARGIN + normX * DRAW_AREA;
    const sy = MARGIN + (1.0 - normY) * DRAW_AREA;

    // 3D physical coordinates
    const x3d = -halfW + (sx / SVG_SIZE) * modelWidth;
    const y3d = -halfH + (sy / SVG_SIZE) * modelHeight;

    const sampleEle = sampleElevationAt(elevGrid, sx, sy);
    const normalizedEle = (sampleEle - minEle) / eleSpan;
    const z3d = baseThickness + normalizedEle * maxElevationHeight * heightScale + trackLift;

    curvePoints.push(new THREE.Vector3(x3d, y3d, z3d));
  }

  // Ensure last point is included
  if (curvePoints.length > 1) {
    const lastP = points[points.length - 1];
    const mx = lastP.mx != null ? lastP.mx : latLonToMercator(lastP.lat, lastP.lon).x;
    const my = lastP.my != null ? lastP.my : latLonToMercator(lastP.lat, lastP.lon).y;
    const normX = (mx - (minMx - offsetX)) / maxDim;
    const normY = (my - (minMy - offsetY)) / maxDim;
    const sx = MARGIN + normX * DRAW_AREA;
    const sy = MARGIN + (1.0 - normY) * DRAW_AREA;
    const x3d = -halfW + (sx / SVG_SIZE) * modelWidth;
    const y3d = -halfH + (sy / SVG_SIZE) * modelHeight;
    const sampleEle = sampleElevationAt(elevGrid, sx, sy);
    const normalizedEle = (sampleEle - minEle) / eleSpan;
    const z3d = baseThickness + normalizedEle * maxElevationHeight * heightScale + trackLift;
    curvePoints[curvePoints.length - 1] = new THREE.Vector3(x3d, y3d, z3d);
  }

  if (curvePoints.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const segments = Math.min(800, curvePoints.length * 3);
  const radialSegments = 8;

  return new THREE.TubeGeometry(curve, segments, tubeRadius, radialSegments, false);
}

/**
 * Creates 3D pin markers for GPX waypoints
 */
export function createWaypointMarkers(waypoints, elevGrid, options = {}) {
  if (!waypoints || waypoints.length === 0 || !elevGrid) return [];

  const {
    modelWidth = 140,
    modelHeight = 140,
    baseThickness = 4,
    heightScale = 1.8,
    maxElevationHeight = 25,
    trackPadding = 25,
  } = options;

  const minEle = elevGrid.minEle || 0;
  const maxEle = elevGrid.maxEle || 1000;
  const eleSpan = Math.max(1, maxEle - minEle);

  const halfW = modelWidth / 2;
  const halfH = modelHeight / 2;

  return waypoints.map((wp) => {
    const sx = wp.svgX || 500;
    const sy = wp.svgY || 500;

    const x3d = -halfW + (sx / 1000) * modelWidth;
    const y3d = -halfH + (sy / 1000) * modelHeight;
    const sampleEle = sampleElevationAt(elevGrid, sx, sy);
    const normalizedEle = (sampleEle - minEle) / eleSpan;
    const z3d = baseThickness + normalizedEle * maxElevationHeight * heightScale + 2.0;

    return {
      name: wp.name,
      position: new THREE.Vector3(x3d, y3d, z3d),
    };
  });
}
