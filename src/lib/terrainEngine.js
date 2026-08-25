import * as THREE from 'three';

// Earth constants for Web Mercator (EPSG:3857)
const R_EARTH = 6378137.0;
const C_EARTH = 2.0 * Math.PI * R_EARTH; // ~40075016.68557849 meters

// High-Resolution Satellite HD Imagery Provider (Esri World Imagery)
export const MAP_STYLES = {
  satellite: {
    id: 'satellite',
    name: 'Satellite HD Max',
    icon: '🛰️',
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
 * Build a complete Three.js scene with ultra-crisp 4K UHD 3D terrain mesh,
 * guaranteed 100% complete map coverage of the whole GPX track, and a slim elegant track.
 */
export async function buildTerrainScene(trackPoints, options = {}, onProgress = () => {}) {
  const config = {
    heightExaggeration: 1.6,
    trackColor: '#14b8a6',
    trackWidth: 0.7, // Slim, high-definition track
    padding: 0.20, // 20% framing padding
    quality: 'ultra', // 'ultra' | 'high' | 'standard'
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

  // 2. Intelligent Dynamic Zoom Selection (Guaranteed 100% Coverage Without Truncation)
  let maxAxisTiles = 18;
  let maxTotalTiles = 220;

  if (config.quality === 'ultra') {
    maxAxisTiles = 20;
    maxTotalTiles = 260;
  } else if (config.quality === 'high') {
    maxAxisTiles = 16;
    maxTotalTiles = 180;
  } else {
    maxAxisTiles = 12;
    maxTotalTiles = 110;
  }

  let zoom = 14;
  let startTx = 0, endTx = 0, startTy = 0, endTy = 0;
  let numTilesX = 0, numTilesY = 0;

  // Search from highest zoom (Zoom 18) down to find the maximum possible resolution
  // that encloses 100% of the track without ever truncating
  for (let testZ = 18; testZ >= 9; testZ--) {
    const minT = mercatorToTile(boundMinMx, boundMaxMy, testZ); // North-West
    const maxT = mercatorToTile(boundMaxMx, boundMinMy, testZ); // South-East
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

  // Fallback if needed
  if (numTilesX === 0) {
    zoom = 12;
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

  // Exact geographic extent of all loaded tiles (Guaranteed to cover all points)
  const gridMinMx = startTx * tileSizeM - C_EARTH / 2;
  const gridMaxMx = (endTx + 1) * tileSizeM - C_EARTH / 2;
  const gridMaxMy = C_EARTH / 2 - startTy * tileSizeM; // North
  const gridMinMy = C_EARTH / 2 - (endTy + 1) * tileSizeM; // South

  const gridSpanX = gridMaxMx - gridMinMx;
  const gridSpanY = gridMaxMy - gridMinMy;

  onProgress(15, `Scaricamento mappa completa (${numTilesX}×${numTilesY} = ${totalTiles} tile) a Zoom ${zoom}...`);

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

  // DEM zoom level: clamp between 12 and 15
  const demZoom = Math.min(15, Math.max(12, zoom));

  await asyncPool(18, tileItems, async ({ tx, ty, col, row }) => {
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

  // High density subdivision for crisp mountain topology
  const segmentsX = Math.min(300, numTilesX * 36);
  const segmentsY = Math.min(300, numTilesY * 36);

  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2); // Orient X=East, Z=South, Y=Up

  const posAttr = geometry.attributes.position;

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);

    const nx = (vx / worldWidth) + 0.5;
    const ny = (vz / worldHeight) + 0.5;

    const mx = gridMinMx + nx * gridSpanX;
    const my = gridMaxMy - ny * gridSpanY;

    const rawEle = getElevationAtMercator(mx, my);
    const clampedEle = Math.max(lowestEle, Math.min(8848, rawEle));
    const vy = (clampedEle - lowestEle) * scale * config.heightExaggeration;

    posAttr.setY(i, vy);
  }

  geometry.computeVertexNormals();

  // Create High-Definition Texture with Anisotropy Filtering
  const texture = new THREE.CanvasTexture(mapCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16; // Maximum sharpness at grazing angles

  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: false,
  });

  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;

  onProgress(88, 'Creazione percorso GPX sottile ed elegante...');

  // 6. Project GPX Track to 3D World Space (Slim & Subtle)
  const track3dPoints = [];
  let lastVector = null;

  mercatorPoints.forEach((p) => {
    const nx = (p.mx - gridMinMx) / gridSpanX;
    const ny = (gridMaxMy - p.my) / gridSpanY;

    const vx = (nx - 0.5) * worldWidth;
    const vz = (ny - 0.5) * worldHeight;

    const sampleEle = getElevationAtMercator(p.mx, p.my);
    const baseEle = sampleEle > 0 ? sampleEle : p.ele;
    // Lower lift so track drapes naturally onto the terrain surface
    const vy = (baseEle - lowestEle) * scale * config.heightExaggeration + (config.trackWidth * 0.4);

    const pt = new THREE.Vector3(vx, vy, vz);

    if (!lastVector || lastVector.distanceTo(pt) > 0.45) {
      track3dPoints.push(pt);
      lastVector = pt;
    }
  });

  if (track3dPoints.length < 2) {
    track3dPoints.push(new THREE.Vector3(0, 1, 0));
  }

  const trackCurve = new THREE.CatmullRomCurve3(track3dPoints, false, 'centripetal', 0.2);
  const tubularSegments = Math.max(300, Math.min(3500, track3dPoints.length * 2));

  // Slim 3D tube geometry with lower radial segments for an elegant clean look
  const trackTubeGeom = new THREE.TubeGeometry(
    trackCurve,
    tubularSegments,
    config.trackWidth,
    8,
    false
  );

  const trackMaterial = new THREE.MeshStandardMaterial({
    color: config.trackColor,
    emissive: config.trackColor,
    emissiveIntensity: 0.75,
    roughness: 0.15,
    metalness: 0.4,
  });

  const trackMesh = new THREE.Mesh(trackTubeGeom, trackMaterial);
  trackMesh.castShadow = true;

  const totalIndexCount = trackTubeGeom.index
    ? trackTubeGeom.index.count
    : trackTubeGeom.attributes.position.count;

  // 7. Sleek Animated Leading Marker (Compact Glowing Sphere)
  const markerGeom = new THREE.SphereGeometry(config.trackWidth * 1.5, 16, 16);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: config.trackColor,
    emissiveIntensity: 1.0,
    roughness: 0.1,
    metalness: 0.2,
  });
  const markerMesh = new THREE.Mesh(markerGeom, markerMaterial);
  markerMesh.position.copy(track3dPoints[0]);
  markerMesh.castShadow = true;

  // 8. Construct Three.js Scene & Lighting
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0c1017');
  scene.fog = new THREE.FogExp2('#141b27', 0.00035);

  scene.add(terrainMesh);
  scene.add(trackMesh);
  scene.add(markerMesh);

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

  // 9. Camera Setup
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 9000);
  camera.position.set(0, worldHeight * 0.6, worldHeight * 0.7);
  camera.lookAt(0, 0, 0);

  // 10. Animation / Progress Update Function
  const updateProgress = (t) => {
    const clampedT = Math.max(0, Math.min(1, t));

    // Update illuminated track segment
    const drawCount = Math.floor(totalIndexCount * clampedT);
    trackTubeGeom.setDrawRange(0, drawCount);

    // Update marker position
    const pos = trackCurve.getPointAt(clampedT);
    const tangent = trackCurve.getTangentAt(clampedT);

    markerMesh.position.copy(pos);

    return { position: pos, tangent };
  };

  // Set initial state at 0%
  updateProgress(0);

  // 11. Cleanup Function
  const dispose = () => {
    geometry.dispose();
    terrainMaterial.dispose();
    texture.dispose();
    trackTubeGeom.dispose();
    trackMaterial.dispose();
    markerGeom.dispose();
    markerMaterial.dispose();
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
