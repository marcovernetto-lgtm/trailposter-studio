/**
 * Real Elevation Contour Generator for TrailPoster Studio
 *
 * Uses AWS S3 Open Data Terrarium Elevation Tiles (SRTM & Copernicus DEM)
 * https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *
 * Elevation decoding: elevation_meters = (R * 256 + G + B / 256) - 32768
 * Completely free, CORS enabled, no rate limits, high resolution global coverage.
 */

import { latLonToMercator } from './gpxParser';

// Earth constants for Web Mercator (EPSG:3857)
const R_EARTH = 6378137.0;
const C_EARTH = 2.0 * Math.PI * R_EARTH;

// Memory cache for decoded tile ImageData
const tileCache = new Map();
const gridCache = new Map();
const contourCache = new Map();

// SVG Coordinate extent for the elevation grid (-200 to 1200 ensures coverage when panning/zooming)
const SVG_MIN = -200;
const SVG_MAX = 1200;
const SVG_SPAN = SVG_MAX - SVG_MIN;
const GRID_SIZE = 100; // 100x100 = 10,000 elevation samples for ultra-smooth contours

/**
 * Load a single Terrarium tile and extract its 256x256 pixel buffer
 */
async function loadTile(zoom, tx, ty) {
  const key = `${zoom}/${tx}/${ty}`;
  if (tileCache.has(key)) {
    return tileCache.get(key);
  }

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, 256, 256).data;
        tileCache.set(key, imgData);
        resolve(imgData);
      } catch (err) {
        console.warn(`Failed to read tile data for ${key}:`, err);
        resolve(null);
      }
    };

    img.onerror = () => {
      // Tile may not exist (e.g. over deep ocean), return null
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Convert Web Mercator coordinate (mx, my) to Tile (tx, ty) and pixel within tile (px, py)
 */
function mercatorToTilePx(mx, my, zoom) {
  const n = 256.0 * Math.pow(2, zoom);
  const px = ((mx + C_EARTH / 2.0) / C_EARTH) * n;
  const py = ((C_EARTH / 2.0 - my) / C_EARTH) * n;
  const tx = Math.floor(px / 256.0);
  const ty = Math.floor(py / 256.0);
  const inPx = Math.max(0, Math.min(255, Math.floor(px - tx * 256.0)));
  const inPy = Math.max(0, Math.min(255, Math.floor(py - ty * 256.0)));
  return { tx, ty, inPx, inPy };
}

/**
 * Fetch and build the real elevation grid for the track
 */
export async function fetchElevationGrid(points, options = {}, onProgress) {
  if (!points || points.length === 0) return null;

  const trackPadding = options.trackPadding ?? 25;
  const SVG_SIZE = 1000;
  const MARGIN = Math.max(15, Math.min(250, trackPadding * 2.5));
  const DRAW_AREA = SVG_SIZE - MARGIN * 2;

  // 1. Calculate Mercator bounds of track
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

  const cacheKey = `${minMx.toFixed(0)}_${maxMx.toFixed(0)}_${minMy.toFixed(0)}_${maxMy.toFixed(0)}_${trackPadding}`;
  if (gridCache.has(cacheKey)) {
    if (onProgress) onProgress(100);
    return gridCache.get(cacheKey);
  }

  // 2. Function to convert SVG (sx, sy) to Mercator (mx, my)
  const svgToMercator = (sx, sy) => {
    const normX = (sx - MARGIN) / DRAW_AREA;
    const normY = (sy - MARGIN) / DRAW_AREA;
    const mx = normX * maxDim + minMx - offsetX;
    const my = (1.0 - normY) * maxDim + minMy - offsetY;
    return { mx, my };
  };

  // 3. Choose optimal zoom level
  const zoom = Math.max(7, Math.min(12, Math.round(Math.log2((2.0 * C_EARTH) / maxDim))));

  // 4. Identify required tiles
  const testCorners = [
    { sx: SVG_MIN, sy: SVG_MIN },
    { sx: SVG_MAX, sy: SVG_MIN },
    { sx: SVG_MIN, sy: SVG_MAX },
    { sx: SVG_MAX, sy: SVG_MAX },
  ];

  let minTx = Infinity, maxTx = -Infinity;
  let minTy = Infinity, maxTy = -Infinity;

  testCorners.forEach(({ sx, sy }) => {
    const { mx, my } = svgToMercator(sx, sy);
    const { tx, ty } = mercatorToTilePx(mx, my, zoom);
    if (tx < minTx) minTx = tx;
    if (tx > maxTx) maxTx = tx;
    if (ty < minTy) minTy = ty;
    if (ty > maxTy) maxTy = ty;
  });

  // Clamp tile span (safety limit max 16 tiles)
  minTx = Math.max(0, minTx);
  minTy = Math.max(0, minTy);
  maxTx = Math.min(Math.pow(2, zoom) - 1, Math.min(minTx + 3, maxTx));
  maxTy = Math.min(Math.pow(2, zoom) - 1, Math.min(minTy + 3, maxTy));

  const tilePromises = [];
  const tileMap = new Map();
  const totalTiles = (maxTx - minTx + 1) * (maxTy - minTy + 1);
  let loadedCount = 0;

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      tilePromises.push(
        loadTile(zoom, tx, ty).then((imgData) => {
          if (imgData) {
            tileMap.set(`${tx}/${ty}`, imgData);
          }
          loadedCount++;
          if (onProgress) {
            onProgress(Math.round((loadedCount / totalTiles) * 90));
          }
        })
      );
    }
  }

  await Promise.all(tilePromises);

  // 5. Sample the elevation grid
  const grid = new Float64Array(GRID_SIZE * GRID_SIZE);
  let minEle = Infinity;
  let maxEle = -Infinity;

  for (let row = 0; row < GRID_SIZE; row++) {
    const sy = SVG_MIN + (row / (GRID_SIZE - 1)) * SVG_SPAN;
    for (let col = 0; col < GRID_SIZE; col++) {
      const sx = SVG_MIN + (col / (GRID_SIZE - 1)) * SVG_SPAN;
      const { mx, my } = svgToMercator(sx, sy);
      const { tx, ty, inPx, inPy } = mercatorToTilePx(mx, my, zoom);

      const tileData = tileMap.get(`${tx}/${ty}`);
      let ele = 0;

      if (tileData) {
        const idx = (inPy * 256 + inPx) * 4;
        const r = tileData[idx];
        const g = tileData[idx + 1];
        const b = tileData[idx + 2];
        ele = (r * 256.0 + g + b / 256.0) - 32768.0;
      }

      const gridIdx = row * GRID_SIZE + col;
      grid[gridIdx] = ele;

      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;
    }
  }

  if (onProgress) onProgress(100);

  const result = {
    grid,
    width: GRID_SIZE,
    height: GRID_SIZE,
    minEle,
    maxEle,
    svgMin: SVG_MIN,
    svgSpan: SVG_SPAN,
  };

  gridCache.set(cacheKey, result);
  return result;
}

/**
 * Determine ideal contour interval based on elevation range
 */
export function autoContourInterval(minEle, maxEle) {
  const range = maxEle - minEle;
  if (range <= 0) return 100;
  if (range < 300) return 25;
  if (range < 800) return 50;
  if (range < 1800) return 100;
  if (range < 3500) return 200;
  return 500;
}

/**
 * Generate contour lines from an elevation grid using Marching Squares
 */
export function generateContours(elevGrid, options = {}) {
  if (!elevGrid) return [];

  const { grid, width, height, minEle, maxEle, svgMin, svgSpan } = elevGrid;
  const intervalInput = options.interval || 'auto';
  const majorEvery = options.majorEvery || 5;

  const interval =
    intervalInput === 'auto'
      ? autoContourInterval(minEle, maxEle)
      : parseInt(intervalInput, 10);

  if (!interval || interval <= 0) return [];

  const cacheKey = `${minEle.toFixed(0)}_${maxEle.toFixed(0)}_${interval}_${width}`;
  if (contourCache.has(cacheKey)) {
    return contourCache.get(cacheKey);
  }

  // Calculate threshold levels
  const startLevel = Math.ceil(minEle / interval) * interval;
  const thresholds = [];
  for (let level = startLevel; level <= maxEle; level += interval) {
    thresholds.push(level);
  }

  // Cap thresholds to 50 max to prevent rendering clutter
  if (thresholds.length > 50) {
    thresholds.length = 50;
  }

  const allContours = [];
  let majorCounter = 0;

  for (const threshold of thresholds) {
    majorCounter++;
    const isMajor = majorCounter % majorEvery === 0;
    const paths = marchingSquares(grid, width, height, threshold, svgMin, svgSpan);

    if (paths.length > 0) {
      allContours.push({
        elevation: threshold,
        isMajor,
        pathD: paths.join(' '),
      });
    }
  }

  contourCache.set(cacheKey, allContours);
  return allContours;
}

/**
 * Marching Squares returning connected SVG path strings directly in SVG coordinates
 */
function marchingSquares(grid, width, height, threshold, svgMin, svgSpan) {
  const segments = [];

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const tl = grid[row * width + col];
      const tr = grid[row * width + col + 1];
      const br = grid[(row + 1) * width + col + 1];
      const bl = grid[(row + 1) * width + col];

      const caseIndex =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);

      if (caseIndex === 0 || caseIndex === 15) continue;

      const lerp = (v1, v2) => {
        const denom = v2 - v1;
        if (Math.abs(denom) < 1e-10) return 0.5;
        return Math.max(0, Math.min(1, (threshold - v1) / denom));
      };

      const topCol = col + lerp(tl, tr);
      const topRow = row;
      const rightCol = col + 1;
      const rightRow = row + lerp(tr, br);
      const bottomCol = col + lerp(bl, br);
      const bottomRow = row + 1;
      const leftCol = col;
      const leftRow = row + lerp(tl, bl);

      // Convert grid col/row to SVG coordinate
      const toSvgPt = (c, r) => ({
        x: svgMin + (c / (width - 1)) * svgSpan,
        y: svgMin + (r / (height - 1)) * svgSpan,
      });

      const top = toSvgPt(topCol, topRow);
      const right = toSvgPt(rightCol, rightRow);
      const bottom = toSvgPt(bottomCol, bottomRow);
      const left = toSvgPt(leftCol, leftRow);

      switch (caseIndex) {
        case 1:  segments.push([left, bottom]); break;
        case 2:  segments.push([bottom, right]); break;
        case 3:  segments.push([left, right]); break;
        case 4:  segments.push([top, right]); break;
        case 5:  segments.push([left, top]); segments.push([bottom, right]); break;
        case 6:  segments.push([top, bottom]); break;
        case 7:  segments.push([left, top]); break;
        case 8:  segments.push([top, left]); break;
        case 9:  segments.push([top, bottom]); break;
        case 10: segments.push([top, right]); segments.push([left, bottom]); break;
        case 11: segments.push([top, right]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
      }
    }
  }

  return joinSegmentsToPaths(segments);
}

/**
 * Fast O(N) polyline joining into SVG path strings
 */
function joinSegmentsToPaths(segments) {
  if (segments.length === 0) return [];

  const key = (pt) => `${Math.round(pt.x * 10)},${Math.round(pt.y * 10)}`;
  const endpointMap = new Map();

  segments.forEach((seg, idx) => {
    const k0 = key(seg[0]);
    const k1 = key(seg[1]);
    if (!endpointMap.has(k0)) endpointMap.set(k0, []);
    if (!endpointMap.has(k1)) endpointMap.set(k1, []);
    endpointMap.get(k0).push({ segIdx: idx, end: 0 });
    endpointMap.get(k1).push({ segIdx: idx, end: 1 });
  });

  const used = new Uint8Array(segments.length);
  const pathStrings = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;

    const line = [segments[i][0], segments[i][1]];

    // Extend forward
    let extending = true;
    while (extending) {
      extending = false;
      const lastKey = key(line[line.length - 1]);
      const neighbors = endpointMap.get(lastKey);
      if (neighbors) {
        for (const nb of neighbors) {
          if (used[nb.segIdx]) continue;
          used[nb.segIdx] = 1;
          const seg = segments[nb.segIdx];
          line.push(nb.end === 0 ? seg[1] : seg[0]);
          extending = true;
          break;
        }
      }
    }

    // Extend backward
    extending = true;
    while (extending) {
      extending = false;
      const firstKey = key(line[0]);
      const neighbors = endpointMap.get(firstKey);
      if (neighbors) {
        for (const nb of neighbors) {
          if (used[nb.segIdx]) continue;
          used[nb.segIdx] = 1;
          const seg = segments[nb.segIdx];
          line.unshift(nb.end === 0 ? seg[1] : seg[0]);
          extending = true;
          break;
        }
      }
    }

    if (line.length >= 2) {
      const d = line
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      pathStrings.push(d);
    }
  }

  return pathStrings;
}
