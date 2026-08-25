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
function loadImage(url, timeoutMs = 9000) {
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
 * Build a complete Three.js scene with ultra-crisp 3D terrain mesh, high-res satellite imagery,
 * and a thin, elegant, illuminated 3D track.
 */
export async function buildTerrainScene(trackPoints, options = {}, onProgress = () => {}) {
  const config = {
    heightExaggeration: 1.6,
    trackColor: '#14b8a6',
    trackWidth: 0.8, // Slim, high-definition elegant track line
    padding: 0.32,
    ...options,
  };

  if (!trackPoints || trackPoints.length < 2) {
    throw new Error('Traccia GPX non valida o con troppi pochi punti.');
  }

  onProgress(5, 'Calcolo perimetro e risoluzione satellitare massima...');

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

  // Add padding around the track
  const padM = maxSpanM * config.padding;
  const boundMinMx = minMx - padM;
  const boundMaxMx = maxMx + padM;
  const boundMinMy = minMy - padM;
  const boundMaxMy = maxMy + padM;

  const totalSpanM = Math.max(boundMaxMx - boundMinMx, boundMaxMy - boundMinMy);

  // 2. High-Resolution Zoom Level Strategy (Max Sharpness)
  let zoom = 14;
  if (totalSpanM < 5000) zoom = 16;        // < 5km -> Zoom 16 (~2.3m/px Ultra HD)
  else if (totalSpanM < 14000) zoom = 15;   // < 14km -> Zoom 15 (~4.7m/px HD)
  else if (totalSpanM < 35000) zoom = 14;   // < 35km -> Zoom 14 (~9.5m/px)
  else if (totalSpanM < 85000) zoom = 13;   // < 85km -> Zoom 13 (~19m/px)
  else zoom = 12;

  const tileSizeM = C_EARTH / Math.pow(2, zoom);

  // Determine tile grid range
  const minTile = mercatorToTile(boundMinMx, boundMaxMy, zoom); // North-West
  const maxTile = mercatorToTile(boundMaxMx, boundMinMy, zoom); // South-East

  let startTx = minTile.tx;
  let endTx = maxTile.tx;
  let startTy = minTile.ty;
  let endTy = maxTile.ty;

  // Max 10x10 tiles grid
  if (endTx - startTx > 9) endTx = startTx + 9;
  if (endTy - startTy > 9) endTy = startTy + 9;

  const numTilesX = endTx - startTx + 1;
  const numTilesY = endTy - startTy + 1;
  const totalTiles = numTilesX * numTilesY;

  // Exact geographic extent of all loaded tiles
  const gridMinMx = startTx * tileSizeM - C_EARTH / 2;
  const gridMaxMx = (endTx + 1) * tileSizeM - C_EARTH / 2;
  const gridMaxMy = C_EARTH / 2 - startTy * tileSizeM; // North
  const gridMinMy = C_EARTH / 2 - (endTy + 1) * tileSizeM; // South

  const gridSpanX = gridMaxMx - gridMinMx;
  const gridSpanY = gridMaxMy - gridMinMy;

  onProgress(15, `Scaricamento ${totalTiles} immagini satellitari HD a Zoom ${zoom}...`);

  // 3. Load Map Tiles and DEM Elevation Tiles in Parallel Pool
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = numTilesX * 256;
  mapCanvas.height = numTilesY * 256;
  const mapCtx = mapCanvas.getContext('2d');

  mapCtx.fillStyle = '#161c24';
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  const elevations = new Map();
  let loadedCount = 0;

  const tileItems = [];
  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      tileItems.push({ tx, ty, col: tx - startTx, row: ty - startTy });
    }
  }

  await asyncPool(12, tileItems, async ({ tx, ty, col, row }) => {
    const px = col * 256;
    const py = row * 256;

    // A. Load Esri Satellite HD Tile
    try {
      const url = MAP_STYLES.satellite.getTileUrl(zoom, tx, ty);
      const img = await loadImage(url);
      mapCtx.drawImage(img, px, py, 256, 256);
    } catch (e) {
      mapCtx.fillStyle = '#1a222d';
      mapCtx.fillRect(px, py, 256, 256);
    }

    // B. Load AWS Terrarium DEM Tile
    try {
      const demUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      const demImg = await loadImage(demUrl);
      const demCanvas = document.createElement('canvas');
      demCanvas.width = 256;
      demCanvas.height = 256;
      const demCtx = demCanvas.getContext('2d', { willReadFrequently: true });
      demCtx.drawImage(demImg, 0, 0);
      const imgData = demCtx.getImageData(0, 0, 256, 256).data;

      const eleArray = new Float32Array(256 * 256);
      for (let i = 0; i < 256 * 256; i++) {
        const r = imgData[i * 4];
        const g = imgData[i * 4 + 1];
        const b = imgData[i * 4 + 2];
        eleArray[i] = (r * 256 + g + b / 256) - 32768;
      }
      elevations.set(`${tx}/${ty}`, eleArray);
    } catch (demErr) {
      elevations.set(`${tx}/${ty}`, new Float32Array(256 * 256));
    }

    loadedCount++;
    onProgress(
      15 + Math.floor((loadedCount / totalTiles) * 55),
      `Scaricamento tile satellitari HD (${loadedCount}/${totalTiles})...`
    );
  });

  onProgress(75, 'Costruzione mesh 3D del rilievo montuoso...');

  // 4. Sample Elevation with Bilinear Filtering
  const getElevationAtMercator = (mx, my) => {
    if (mx < gridMinMx || mx > gridMaxMx || my < gridMinMy || my > gridMaxMy) {
      return 0;
    }

    const px = ((mx + C_EARTH / 2) / C_EARTH) * Math.pow(2, zoom);
    const py = ((C_EARTH / 2 - my) / C_EARTH) * Math.pow(2, zoom);
    const tx = Math.floor(px);
    const ty = Math.floor(py);

    const eleArray = elevations.get(`${tx}/${ty}`);
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
  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      const arr = elevations.get(`${tx}/${ty}`);
      if (arr) {
        for (let i = 0; i < arr.length; i += 16) {
          if (arr[i] < lowestEle && arr[i] > -500) lowestEle = arr[i];
        }
      }
    }
  }
  if (lowestEle === Infinity) lowestEle = Math.max(0, minEle);

  // 5. 3D World Space Dimensions
  const worldWidth = 1000;
  const worldHeight = worldWidth * (gridSpanY / gridSpanX);
  const scale = worldWidth / gridSpanX; // 3D units per meter

  // High density subdivision for crisp mountain topology
  const segmentsX = Math.min(280, numTilesX * 42);
  const segmentsY = Math.min(280, numTilesY * 42);

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
    roughness: 0.9,
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
    const vy = (baseEle - lowestEle) * scale * config.heightExaggeration + (config.trackWidth * 0.45);

    const pt = new THREE.Vector3(vx, vy, vz);

    if (!lastVector || lastVector.distanceTo(pt) > 0.5) {
      track3dPoints.push(pt);
      lastVector = pt;
    }
  });

  if (track3dPoints.length < 2) {
    track3dPoints.push(new THREE.Vector3(0, 1, 0));
  }

  const trackCurve = new THREE.CatmullRomCurve3(track3dPoints, false, 'centripetal', 0.2);
  const tubularSegments = Math.max(300, Math.min(3000, track3dPoints.length * 2));

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
    emissiveIntensity: 0.7,
    roughness: 0.15,
    metalness: 0.4,
  });

  const trackMesh = new THREE.Mesh(trackTubeGeom, trackMaterial);
  trackMesh.castShadow = true;

  const totalIndexCount = trackTubeGeom.index
    ? trackTubeGeom.index.count
    : trackTubeGeom.attributes.position.count;

  // 7. Sleek Animated Leading Marker (Compact Glowing Sphere)
  const markerGeom = new THREE.SphereGeometry(config.trackWidth * 1.6, 16, 16);
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
  scene.fog = new THREE.FogExp2('#141b27', 0.0004);

  scene.add(terrainMesh);
  scene.add(trackMesh);
  scene.add(markerMesh);

  // Sunlight (Directional)
  const sunLight = new THREE.DirectionalLight(0xfff8ee, 1.85);
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
  const ambLight = new THREE.AmbientLight(0xe0f2fe, 0.75);
  scene.add(ambLight);

  const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x1e293b, 0.5);
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
