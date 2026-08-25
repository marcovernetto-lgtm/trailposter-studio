import * as THREE from 'three';

// Earth constants for Web Mercator (EPSG:3857)
const R_EARTH = 6378137.0;
const C_EARTH = 2.0 * Math.PI * R_EARTH; // ~40075016.68557849 meters

// High-Resolution Satellite HD Imagery Provider (Esri World Imagery)
export const MAP_STYLES = {
  satellite: {
    id: 'satellite',
    name: 'Satellite HD Max',
    description: 'Immagini aeree e satellitari ad altissima risoluzione Esri / Maxar',
    getTileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  },
};

// Coordinate transformations: Lat/Lon <-> Web Mercator meters
export function latLonToMercator(lat, lon) {
  const x = lon * (Math.PI / 180) * R_EARTH;
  const latRad = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
  const y = R_EARTH * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { x, y };
}

export function mercatorToLatLon(x, y) {
  const lon = (x / R_EARTH) * (180 / Math.PI);
  const latRad = 2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2;
  const lat = latRad * (180 / Math.PI);
  return { lat, lon };
}

// Convert Mercator (mx, my) to Tile Coordinates (tx, ty) at zoom z
function mercatorToTile(mx, my, zoom) {
  const n = Math.pow(2, zoom);
  const px = ((mx + C_EARTH / 2) / C_EARTH) * n;
  const py = ((C_EARTH / 2 - my) / C_EARTH) * n;
  const tx = Math.floor(px);
  const ty = Math.floor(py);
  return { tx, ty, px, py };
}

// Load Image with Promise, Timeout and CORS safety
function loadImage(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let timer = setTimeout(() => {
      img.src = '';
      reject(new Error(`Timeout loading image ${url}`));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to load image ${url}`));
    };

    img.src = url;
  });
}

/**
 * Concurrency helper to run promises in parallel with max batch limit
 */
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

/**
 * Draw custom rounded rectangle with clean corners
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Creates a dynamic content-aware 2D canvas texture for a 3D waypoint placard / signboard.
 * Exactly fitted to the place name width with centered content and no wasted empty space!
 */
function createWaypointPlacardTexture(name, index = 1) {
  const displayText = (name || `Tappa ${index}`).trim();

  // 1. Measure text width accurately
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  const font = 'bold 28px "Outfit", system-ui, -apple-system, sans-serif';
  tempCtx.font = font;
  const metrics = tempCtx.measureText(displayText);
  const textWidth = Math.ceil(metrics.width);

  const height = 72;
  const paddingX = 18;
  const badgeRadius = 18;
  const badgeWidth = badgeRadius * 2;
  const gap = 12;

  // Dynamic width fitted strictly to content
  const totalContentWidth = badgeWidth + gap + textWidth;
  const width = Math.max(90, Math.ceil(totalContentWidth + paddingX * 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const borderWidth = 3;
  const x = borderWidth;
  const y = borderWidth;
  const w = width - borderWidth * 2;
  const h = height - borderWidth * 2;
  const pillRadius = h / 2;

  // Frosted dark pill background
  drawRoundedRect(ctx, x, y, w, h, pillRadius);
  ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
  ctx.fill();
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.stroke();

  // Center all content inside the pill
  const startX = (width - totalContentWidth) / 2;

  // Index Badge (Teal circle with clean number)
  const badgeCenterX = startX + badgeRadius;
  const badgeCenterY = height / 2;
  ctx.fillStyle = '#14b8a6';
  ctx.beginPath();
  ctx.arc(badgeCenterX, badgeCenterY, badgeRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px "Outfit", system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${index}`, badgeCenterX, badgeCenterY + 1);

  // Place Name Text
  ctx.fillStyle = '#ffffff';
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, startX + badgeWidth + gap, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return {
    texture,
    aspectRatio: width / height,
  };
}

/**
 * Builds a flat 3D ribbon geometry that is strictly clamped to the ground terrain
 * at EVERY vertex so it can NEVER sink into or get hidden by mountains!
 */
function createConformalFlatRibbonGeometry(
  curve,
  numSegments = 1800,
  width = 1.4,
  getGroundYAt = (vx, vz) => 0
) {
  const points = curve.getSpacedPoints(numSegments);
  const vertexCount = (numSegments + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 3);
  const indices = [];

  const lift = 0.55; // Clearance above ground mesh

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const pt = points[i];
    const tangent = curve.getTangentAt(Math.min(0.999, t)).normalize();

    // Perpendicular horizontal vector
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const halfW = width * 0.5;

    // Left vertex position
    const lx = pt.x - perp.x * halfW;
    const lz = pt.z - perp.z * halfW;
    const groundLeftY = getGroundYAt(lx, lz);
    const ly = Math.max(pt.y, groundLeftY) + lift;

    // Right vertex position
    const rx = pt.x + perp.x * halfW;
    const rz = pt.z + perp.z * halfW;
    const groundRightY = getGroundYAt(rx, rz);
    const ry = Math.max(pt.y, groundRightY) + lift;

    const idx = i * 2;
    // Left vertex
    positions[idx * 3] = lx;
    positions[idx * 3 + 1] = ly;
    positions[idx * 3 + 2] = lz;
    uvs[idx * 2] = 0;
    uvs[idx * 2 + 1] = t;
    normals[idx * 3] = 0;
    normals[idx * 3 + 1] = 1;
    normals[idx * 3 + 2] = 0;

    // Right vertex
    positions[(idx + 1) * 3] = rx;
    positions[(idx + 1) * 3 + 1] = ry;
    positions[(idx + 1) * 3 + 2] = rz;
    uvs[(idx + 1) * 2] = 1;
    uvs[(idx + 1) * 2 + 1] = t;
    normals[(idx + 1) * 3] = 0;
    normals[(idx + 1) * 3 + 1] = 1;
    normals[(idx + 1) * 3 + 2] = 0;

    if (i < numSegments) {
      const a = idx;
      const b = idx + 1;
      const c = idx + 2;
      const d = idx + 3;

      // Two double-sided triangles
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

/**
 * Build a complete Three.js scene with ultra-crisp 4K UHD 3D terrain mesh,
 * guaranteed 100% full map coverage, flat ribbon track, and prominent 3D waypoint signs.
 */
export async function buildTerrainScene(trackPoints, options = {}, onProgress = () => {}) {
  const config = {
    heightExaggeration: 1.6,
    trackColor: '#ff5500', // Default: High-Contrast Orange
    trackWidth: 1.4, // Wide flat ribbon width
    padding: 0.20, // 20% framing padding
    quality: 'ultra', // 'ultra' | 'high' | 'standard'
    waypoints: [], // Array of waypoints [{ id, name, percent, lat, lon }]
    ...options,
  };

  if (!trackPoints || trackPoints.length < 2) {
    throw new Error('Traccia GPX non valida o con troppi pochi punti.');
  }

  onProgress(5, 'Calcolo perimetro completo e ottimizzazione risoluzione...');

  // 1. Calculate Track Mercator Bounds
  let minMx = Infinity, maxMx = -Infinity;
  let minMy = Infinity, maxMy = -Infinity;
  let minEle = Infinity, maxEle = -Infinity;

  const mercatorPoints = trackPoints.map((p) => {
    const m = p.mx != null && p.my != null ? { x: p.mx, y: p.my } : latLonToMercator(p.lat, p.lon);
    if (m.x < minMx) minMx = m.x;
    if (m.x > maxMx) maxMx = m.x;
    if (m.y < minMy) minMy = m.y;
    if (m.y > maxMy) maxMy = m.y;

    const ele = p.ele || 0;
    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;

    return { ...p, mx: m.x, my: m.y, ele };
  });

  const trackWidthM = Math.max(300, maxMx - minMx);
  const trackHeightM = Math.max(300, maxMy - minMy);
  const maxSpanM = Math.max(trackWidthM, trackHeightM);

  // Add framing padding around the track
  const padM = maxSpanM * config.padding;
  const boundMinMx = minMx - padM;
  const boundMaxMx = maxMx + padM;
  const boundMinMy = minMy - padM;
  const boundMaxMy = maxMy + padM;

  const totalSpanM = Math.max(boundMaxMx - boundMinMx, boundMaxMy - boundMinMy);

  // 2. Intelligent Dynamic Zoom Selection (Always Maximum Ultra 4K HD Resolution)
  const maxAxisTiles = 28;
  const maxTotalTiles = 450;

  let zoom = 15;
  let startTx = 0, endTx = 0, startTy = 0, endTy = 0;
  let numTilesX = 0, numTilesY = 0;

  for (let testZ = 18; testZ >= 9; testZ--) {
    const minT = mercatorToTile(boundMinMx, boundMaxMy, testZ);
    const maxT = mercatorToTile(boundMaxMx, boundMinMy, testZ);
    const nX = maxT.tx - minT.tx + 1;
    const nY = maxT.ty - minT.ty + 1;
    const totalT = nX * nY;

    if (nX <= maxAxisTiles && nY <= maxAxisTiles && totalT <= maxTotalTiles) {
      zoom = testZ;
      startTx = minT.tx;
      endTx = maxT.tx;
      startTy = minT.ty;
      endTy = maxT.ty;
      numTilesX = nX;
      numTilesY = nY;
      break;
    }
  }

  if (numTilesX === 0) {
    zoom = 13;
    const minT = mercatorToTile(boundMinMx, boundMaxMy, zoom);
    const maxT = mercatorToTile(boundMaxMx, boundMinMy, zoom);
    startTx = minT.tx;
    endTx = maxT.tx;
    startTy = minT.ty;
    endTy = maxT.ty;
    numTilesX = endTx - startTx + 1;
    numTilesY = endTy - startTy + 1;
  }

  const tileSizeM = C_EARTH / Math.pow(2, zoom);
  const totalTiles = numTilesX * numTilesY;

  // Exact geographic extent of all loaded tiles
  const gridMinMx = startTx * tileSizeM - C_EARTH / 2;
  const gridMaxMx = (endTx + 1) * tileSizeM - C_EARTH / 2;
  const gridMaxMy = C_EARTH / 2 - startTy * tileSizeM;
  const gridMinMy = C_EARTH / 2 - (endTy + 1) * tileSizeM;

  const gridSpanX = gridMaxMx - gridMinMx;
  const gridSpanY = gridMaxMy - gridMinMy;

  onProgress(15, `Scaricamento mappa (${numTilesX}×${numTilesY} tile) a Zoom ${zoom}...`);

  // 3. Load Map Tiles and DEM Elevation Tiles in Parallel Pool
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = numTilesX * 256;
  mapCanvas.height = numTilesY * 256;
  const mapCtx = mapCanvas.getContext('2d');

  mapCtx.fillStyle = '#141a22';
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  const elevations = new Map();
  let loadedCount = 0;

  const tileItems = [];
  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      tileItems.push({ tx, ty, col: tx - startTx, row: ty - startTy });
    }
  }

  const demZoom = Math.min(15, Math.max(12, zoom));

  await asyncPool(24, tileItems, async ({ tx, ty, col, row }) => {
    const px = col * 256;
    const py = row * 256;

    // A. Load Esri Satellite Ultra HD Tile
    try {
      const url = MAP_STYLES.satellite.getTileUrl(zoom, tx, ty);
      const img = await loadImage(url);
      mapCtx.drawImage(img, px, py, 256, 256);
    } catch (e) {
      mapCtx.fillStyle = '#1e2836';
      mapCtx.fillRect(px, py, 256, 256);
    }

    // B. Load AWS Terrarium DEM Tile
    try {
      const tileCenterMx = (tx + 0.5) * tileSizeM - C_EARTH / 2;
      const tileCenterMy = C_EARTH / 2 - (ty + 0.5) * tileSizeM;
      const demTile = mercatorToTile(tileCenterMx, tileCenterMy, demZoom);

      const demKey = `${demTile.tx}/${demTile.ty}_${demZoom}`;
      let eleArray = elevations.get(demKey);

      if (!eleArray) {
        const demUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${demZoom}/${demTile.tx}/${demTile.ty}.png`;
        const demImg = await loadImage(demUrl);
        const demCanvas = document.createElement('canvas');
        demCanvas.width = 256;
        demCanvas.height = 256;
        const demCtx = demCanvas.getContext('2d', { willReadFrequently: true });
        demCtx.drawImage(demImg, 0, 0);
        const imgData = demCtx.getImageData(0, 0, 256, 256).data;

        eleArray = new Float32Array(256 * 256);
        for (let i = 0; i < 256 * 256; i++) {
          const r = imgData[i * 4];
          const g = imgData[i * 4 + 1];
          const b = imgData[i * 4 + 2];
          eleArray[i] = (r * 256 + g + b / 256) - 32768;
        }
        elevations.set(demKey, eleArray);
      }
    } catch (demErr) {
      // Continue gracefully
    }

    loadedCount++;
    onProgress(
      15 + Math.floor((loadedCount / totalTiles) * 55),
      `Scaricamento texture satellitare 4K (${loadedCount}/${totalTiles})...`
    );
  });

  onProgress(75, 'Costruzione mesh 3D del rilievo montuoso...');

  // 4. Sample Elevation with Bilinear Filtering across DEM
  const getElevationAtMercator = (mx, my) => {
    if (mx < gridMinMx || mx > gridMaxMx || my < gridMinMy || my > gridMaxMy) {
      return 0;
    }

    const demTileSizeM = C_EARTH / Math.pow(2, demZoom);
    const px = ((mx + C_EARTH / 2) / C_EARTH) * Math.pow(2, demZoom);
    const py = ((C_EARTH / 2 - my) / C_EARTH) * Math.pow(2, demZoom);
    const tx = Math.floor(px);
    const ty = Math.floor(py);

    const demKey = `${tx}/${ty}_${demZoom}`;
    const eleArray = elevations.get(demKey);
    if (!eleArray) return 0;

    const exactX = (px - tx) * 255;
    const exactY = (py - ty) * 255;

    const x0 = Math.max(0, Math.min(255, Math.floor(exactX)));
    const x1 = Math.max(0, Math.min(255, x0 + 1));
    const y0 = Math.max(0, Math.min(255, Math.floor(exactY)));
    const y1 = Math.max(0, Math.min(255, y0 + 1));

    const fx = exactX - x0;
    const fy = exactY - y0;

    const e00 = eleArray[y0 * 256 + x0] || 0;
    const e10 = eleArray[y0 * 256 + x1] || 0;
    const e01 = eleArray[y1 * 256 + x0] || 0;
    const e11 = eleArray[y1 * 256 + x1] || 0;

    return (
      e00 * (1 - fx) * (1 - fy) +
      e10 * fx * (1 - fy) +
      e01 * (1 - fx) * fy +
      e11 * fx * fy
    );
  };

  // Find lowest elevation across the region
  let lowestEle = Infinity;
  for (const arr of elevations.values()) {
    if (arr) {
      for (let i = 0; i < arr.length; i += 32) {
        if (arr[i] < lowestEle && arr[i] > -500) lowestEle = arr[i];
      }
    }
  }
  if (lowestEle === Infinity) lowestEle = Math.max(0, minEle);

  // 5. 3D World Space Dimensions
  const worldWidth = 1000;
  const worldHeight = worldWidth * (gridSpanY / gridSpanX);
  const scale = worldWidth / gridSpanX; // 3D units per meter

  // Helper to convert 3D (vx, vz) directly to terrain ground Y
  const getGroundYAt = (vx, vz) => {
    const nx = (vx / worldWidth) + 0.5;
    const ny = (vz / worldHeight) + 0.5;
    const mx = gridMinMx + nx * gridSpanX;
    const my = gridMaxMy - ny * gridSpanY;
    const rawEle = getElevationAtMercator(mx, my);
    const clampedEle = Math.max(lowestEle, Math.min(8848, rawEle));
    return (clampedEle - lowestEle) * scale * config.heightExaggeration;
  };

  // High density subdivision for crisp mountain topology
  const segmentsX = Math.min(300, numTilesX * 36);
  const segmentsY = Math.min(300, numTilesY * 36);

  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2); // Orient X=East, Z=South, Y=Up

  const posAttr = geometry.attributes.position;

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, getGroundYAt(vx, vz));
  }

  geometry.computeVertexNormals();

  // Create High-Definition Texture with Anisotropy Filtering
  const texture = new THREE.CanvasTexture(mapCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;

  // Terrain material with polygonOffset to prevent any Z-fighting with track
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: 1.0,
    polygonOffsetUnits: 4.0,
  });

  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  terrainMesh.renderOrder = 0;

  // 5.b Distant Surrounding Terrain Skirt (Low-Resolution, Softly Blurred Distant Horizon)
  const skirtWidth = worldWidth * 2.8;
  const skirtHeight = worldHeight * 2.8;
  const skirtGeom = new THREE.PlaneGeometry(skirtWidth, skirtHeight, 70, 70);
  skirtGeom.rotateX(-Math.PI / 2);

  const skirtPosAttr = skirtGeom.attributes.position;
  const halfInnerW = worldWidth * 0.495;
  const halfInnerH = worldHeight * 0.495;

  for (let i = 0; i < skirtPosAttr.count; i++) {
    const vx = skirtPosAttr.getX(i);
    const vz = skirtPosAttr.getZ(i);

    const clampedVx = Math.max(-halfInnerW, Math.min(halfInnerW, vx));
    const clampedVz = Math.max(-halfInnerH, Math.min(halfInnerH, vz));
    const edgeY = getGroundYAt(clampedVx, clampedVz);

    const distOutX = Math.max(0, Math.abs(vx) - halfInnerW) / (skirtWidth * 0.5 - halfInnerW);
    const distOutZ = Math.max(0, Math.abs(vz) - halfInnerH) / (skirtHeight * 0.5 - halfInnerH);
    const distOut = Math.min(1.0, Math.sqrt(distOutX * distOutX + distOutZ * distOutZ));

    const undulation = Math.sin(vx * 0.012) * Math.cos(vz * 0.012) * 20 * (1.0 - distOut);
    const skirtY = Math.max(0, edgeY * (1.0 - distOut * 0.85) + undulation);
    skirtPosAttr.setY(i, skirtY);
  }
  skirtGeom.computeVertexNormals();

  const skirtCanvas = document.createElement('canvas');
  skirtCanvas.width = 256;
  skirtCanvas.height = 256;
  const skirtCtx = skirtCanvas.getContext('2d');

  skirtCtx.filter = 'blur(6px)';
  skirtCtx.drawImage(mapCanvas, 0, 0, 256, 256);
  skirtCtx.filter = 'none';

  const hazeGrad = skirtCtx.createRadialGradient(128, 128, 60, 128, 128, 140);
  hazeGrad.addColorStop(0, 'rgba(12, 16, 23, 0.0)');
  hazeGrad.addColorStop(1, 'rgba(12, 16, 23, 0.75)');
  skirtCtx.fillStyle = hazeGrad;
  skirtCtx.fillRect(0, 0, 256, 256);

  const skirtTexture = new THREE.CanvasTexture(skirtCanvas);
  skirtTexture.colorSpace = THREE.SRGBColorSpace;
  skirtTexture.minFilter = THREE.LinearFilter;
  skirtTexture.magFilter = THREE.LinearFilter;

  const skirtMaterial = new THREE.MeshStandardMaterial({
    map: skirtTexture,
    roughness: 0.95,
    metalness: 0.01,
    flatShading: false,
  });

  const skirtMesh = new THREE.Mesh(skirtGeom, skirtMaterial);
  skirtMesh.receiveShadow = true;
  skirtMesh.renderOrder = -1;

  onProgress(88, 'Creazione percorso GPX e cartelli 3D...');

  // 6. Project GPX Track to 3D World Space with Exact Ground Conformance
  const track3dPoints = [];
  let lastVector = null;

  mercatorPoints.forEach((p) => {
    const nx = (p.mx - gridMinMx) / gridSpanX;
    const ny = (gridMaxMy - p.my) / gridSpanY;

    const vx = (nx - 0.5) * worldWidth;
    const vz = (ny - 0.5) * worldHeight;
    const groundY = getGroundYAt(vx, vz);

    const pt = new THREE.Vector3(vx, groundY + 0.4, vz);

    if (!lastVector || lastVector.distanceTo(pt) > 0.4) {
      track3dPoints.push(pt);
      lastVector = pt;
    }
  });

  if (track3dPoints.length < 2) {
    track3dPoints.push(new THREE.Vector3(0, 1, 0));
  }

  const trackCurve = new THREE.CatmullRomCurve3(track3dPoints, false, 'centripetal', 0.2);

  // FLAT RIBBON GEOMETRY: strictly clamped to ground elevation at every vertex
  const ribbonGeom = createConformalFlatRibbonGeometry(
    trackCurve,
    Math.max(600, track3dPoints.length * 4),
    config.trackWidth,
    getGroundYAt
  );

  const trackMaterial = new THREE.MeshStandardMaterial({
    color: config.trackColor,
    emissive: config.trackColor,
    emissiveIntensity: 1.25,
    roughness: 0.15,
    metalness: 0.35,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2.0,
    polygonOffsetUnits: -4.0,
    depthTest: true,
    depthWrite: true,
  });

  const trackMesh = new THREE.Mesh(ribbonGeom, trackMaterial);
  trackMesh.castShadow = true;
  trackMesh.renderOrder = 10;

  const totalIndexCount = ribbonGeom.index
    ? ribbonGeom.index.count
    : ribbonGeom.attributes.position.count;

  // 7. Sleek Leading Marker (Glowing Beacon Disc)
  const markerGeom = new THREE.CylinderGeometry(config.trackWidth * 0.95, config.trackWidth * 0.95, 0.5, 24);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: config.trackColor,
    emissiveIntensity: 1.35,
    roughness: 0.1,
    metalness: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -3.0,
    polygonOffsetUnits: -6.0,
  });
  const markerMesh = new THREE.Mesh(markerGeom, markerMaterial);
  markerMesh.position.copy(track3dPoints[0]);
  markerMesh.castShadow = true;
  markerMesh.renderOrder = 20;

  // 8. 3D Waypoint Signs / Placards (Cartelli 3D dinamici, perfettamente sagomati e centrati sul testo!)
  const waypointsGroup = new THREE.Group();
  const waypointDisposables = [];

  const waypointsList = Array.isArray(config.waypoints) ? config.waypoints : [];

  waypointsList.forEach((wpt, index) => {
    if (!wpt || !wpt.name) return;

    // Handle percent 0 properly (avoid 0 || 50 bug)
    const rawPercent = wpt.percent != null && !isNaN(wpt.percent) ? Number(wpt.percent) : 0;
    const t = Math.max(0, Math.min(1, rawPercent / 100));

    const pt = trackCurve.getPointAt(Math.min(0.999, t));
    const groundY = getGroundYAt(pt.x, pt.z);
    const baseY = Math.max(pt.y, groundY);

    // A. Ground Base Ring
    const baseGeom = new THREE.CylinderGeometry(1.8, 1.8, 0.35, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: '#14b8a6',
      emissive: '#14b8a6',
      emissiveIntensity: 0.8,
    });
    const baseMesh = new THREE.Mesh(baseGeom, baseMat);
    baseMesh.position.set(pt.x, baseY + 0.2, pt.z);
    waypointsGroup.add(baseMesh);
    waypointDisposables.push(baseGeom, baseMat);

    // B. Slim Vertical Pin Pole
    const poleHeight = 15;
    const poleGeom = new THREE.CylinderGeometry(0.35, 0.35, poleHeight, 8);
    const poleMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      metalness: 0.6,
      roughness: 0.3,
    });
    const poleMesh = new THREE.Mesh(poleGeom, poleMat);
    poleMesh.position.set(pt.x, baseY + poleHeight / 2, pt.z);
    waypointsGroup.add(poleMesh);
    waypointDisposables.push(poleGeom, poleMat);

    // C. 3D Billboard Placard (Dynamic Content-Aware Fit with Centered Content)
    const { texture: placardTexture, aspectRatio } = createWaypointPlacardTexture(wpt.name, index + 1);
    const spriteMat = new THREE.SpriteMaterial({
      map: placardTexture,
      transparent: true,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(spriteMat);

    const signHeight = 6.2;
    const signWidth = signHeight * aspectRatio;

    sprite.scale.set(signWidth, signHeight, 1);
    sprite.position.set(pt.x, baseY + poleHeight + signHeight * 0.5 + 1.2, pt.z);
    sprite.renderOrder = 30;

    waypointsGroup.add(sprite);
    waypointDisposables.push(placardTexture, spriteMat);
  });

  // 9. Construct Three.js Scene & Lighting
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0c1017');
  scene.fog = new THREE.FogExp2('#141b27', 0.00035);

  scene.add(skirtMesh);
  scene.add(terrainMesh);
  scene.add(trackMesh);
  scene.add(markerMesh);
  scene.add(waypointsGroup);

  // Sunlight (Directional)
  const sunLight = new THREE.DirectionalLight(0xfff8ee, 1.9);
  sunLight.position.set(worldWidth * 0.35, worldHeight * 0.75, -worldWidth * 0.3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 4500;
  sunLight.shadow.camera.left = -worldWidth;
  sunLight.shadow.camera.right = worldWidth;
  sunLight.shadow.camera.top = worldHeight;
  sunLight.shadow.camera.bottom = -worldHeight;
  scene.add(sunLight);

  // Ambient & Sky Dome Light
  const ambLight = new THREE.AmbientLight(0xe0f2fe, 0.8);
  scene.add(ambLight);

  const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x1e293b, 0.55);
  scene.add(hemiLight);

  // 10. Camera Setup
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 9000);
  camera.position.set(0, worldHeight * 0.6, worldHeight * 0.7);
  camera.lookAt(0, 0, 0);

  // 11. Animation / Progress Update Function
  const updateProgress = (t) => {
    const clampedT = Math.max(0, Math.min(1, t));

    // Update illuminated ribbon draw range
    const drawCount = Math.floor(totalIndexCount * clampedT);
    ribbonGeom.setDrawRange(0, drawCount);

    // Update marker position
    const pos = trackCurve.getPointAt(clampedT);
    const groundY = getGroundYAt(pos.x, pos.z);
    markerMesh.position.set(pos.x, Math.max(pos.y, groundY) + 0.6, pos.z);

    return { position: pos };
  };

  // Set initial state at 0%
  updateProgress(0);

  // 12. Cleanup Function
  const dispose = () => {
    geometry.dispose();
    terrainMaterial.dispose();
    texture.dispose();
    skirtGeom.dispose();
    skirtMaterial.dispose();
    skirtTexture.dispose();
    ribbonGeom.dispose();
    trackMaterial.dispose();
    markerGeom.dispose();
    markerMaterial.dispose();
    waypointDisposables.forEach((item) => {
      if (item && typeof item.dispose === 'function') item.dispose();
    });
  };

  onProgress(100, 'Pronto!');

  return {
    scene,
    camera,
    trackCurve,
    trackLength: trackCurve.getLength(),
    worldBounds: {
      minLat: mercatorToLatLon(gridMinMx, gridMinMy).lat,
      maxLat: mercatorToLatLon(gridMaxMx, gridMaxMy).lat,
      minLon: mercatorToLatLon(gridMinMx, gridMinMy).lon,
      maxLon: mercatorToLatLon(gridMaxMx, gridMaxMy).lon,
      spanKm: totalSpanM / 1000,
    },
    updateProgress,
    dispose,
  };
}
