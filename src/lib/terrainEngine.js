import * as THREE from 'three';

// Earth constants for Web Mercator (EPSG:3857)
const R_EARTH = 6378137.0;
const C_EARTH = 2.0 * Math.PI * R_EARTH; // ~40075016.68557849 meters

// Fully CORS-enabled, reliable, high-speed free map tile providers
export const MAP_STYLES = {
  satellite: {
    id: 'satellite',
    name: 'Satellite HD',
    icon: '🛰️',
    description: 'Immagini aeree e satellitari ad alta risoluzione Esri',
    getTileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  },
  topo: {
    id: 'topo',
    name: 'Topografico HD',
    icon: '🗻',
    description: 'Curve di livello, vette alpine, ombreggiature e sentieri Esri',
    getTileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, Garmin, USGS, NPS',
  },
  outdoors: {
    id: 'outdoors',
    name: 'Outdoor & Sentieri',
    icon: '🧭',
    description: 'Cartografia dettagliata sentieri, strade e boschi Carto',
    getTileUrl: (z, x, y) =>
      `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors, © CARTO',
  },
  shaded: {
    id: 'shaded',
    name: 'Rilievo Fisico',
    icon: '⛰️',
    description: 'Morfologia naturale delle montagne e geologia alpina',
    getTileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, US National Park Service',
  },
  dark: {
    id: 'dark',
    name: 'Dark Cyber',
    icon: '🌌',
    description: 'Mappa notturna scura ad alto contrasto con traccia neon',
    getTileUrl: (z, x, y) =>
      `https://basemaps.cartocdn.com/rastertiles/dark_all/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors, © CARTO',
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

    img.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(`Failed to load image ${url}`));
    };

    img.src = url;
  });
}

/**
 * Build a complete Three.js scene with 3D terrain mesh, map texture, track tube, and animated marker.
 */
export async function buildTerrainScene(trackPoints, options = {}, onProgress = () => {}) {
  const config = {
    mapStyle: 'satellite',
    heightExaggeration: 1.5,
    trackColor: '#14b8a6',
    trackWidth: 2.0,
    padding: 0.35,
    ...options,
  };

  if (!trackPoints || trackPoints.length < 2) {
    throw new Error('Traccia GPX non valida o con troppi pochi punti.');
  }

  onProgress(5, 'Calcolo coordinate e bounding box...');

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

  const trackWidthM = Math.max(500, maxMx - minMx);
  const trackHeightM = Math.max(500, maxMy - minMy);
  const maxSpanM = Math.max(trackWidthM, trackHeightM);

  // Add padding around the track
  const padM = maxSpanM * config.padding;
  const boundMinMx = minMx - padM;
  const boundMaxMx = maxMx + padM;
  const boundMinMy = minMy - padM;
  const boundMaxMy = maxMy + padM;

  const totalSpanM = Math.max(boundMaxMx - boundMinMx, boundMaxMy - boundMinMy);

  // 2. Select optimal zoom level based on area extent
  let zoom = 12;
  if (totalSpanM < 6000) zoom = 14;       // < 6km -> zoom 14 (~9m/px)
  else if (totalSpanM < 18000) zoom = 13;  // < 18km -> zoom 13 (~19m/px)
  else if (totalSpanM < 45000) zoom = 12;  // < 45km -> zoom 12 (~38m/px)
  else if (totalSpanM < 120000) zoom = 11; // < 120km -> zoom 11 (~76m/px)
  else zoom = 10;

  const tileSizeM = C_EARTH / Math.pow(2, zoom);

  // Determine tile grid range
  const minTile = mercatorToTile(boundMinMx, boundMaxMy, zoom); // North-West
  const maxTile = mercatorToTile(boundMaxMx, boundMinMy, zoom); // South-East

  let startTx = minTile.tx;
  let endTx = maxTile.tx;
  let startTy = minTile.ty;
  let endTy = maxTile.ty;

  // Safety limit: max 6x6 tiles (36 tiles)
  if (endTx - startTx > 5) endTx = startTx + 5;
  if (endTy - startTy > 5) endTy = startTy + 5;

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

  onProgress(15, `Scaricamento ${totalTiles} mappe e dati altimetrici...`);

  // 3. Load Map Tiles and DEM Elevation Tiles in Parallel
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = numTilesX * 256;
  mapCanvas.height = numTilesY * 256;
  const mapCtx = mapCanvas.getContext('2d');

  // Fill initial background with pleasing landscape tone
  mapCtx.fillStyle = '#222831';
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  const elevations = new Map();
  const mapStyleObj = MAP_STYLES[config.mapStyle] || MAP_STYLES.satellite;

  let loadedCount = 0;
  const tileTasks = [];

  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      const col = tx - startTx;
      const row = ty - startTy;
      const px = col * 256;
      const py = row * 256;

      const task = (async () => {
        // A. Load Map Texture Tile
        try {
          const url = mapStyleObj.getTileUrl(zoom, tx, ty);
          const img = await loadImage(url);
          mapCtx.drawImage(img, px, py, 256, 256);
        } catch (e) {
          // Fallback to Esri satellite if other provider fails
          try {
            const fallbackUrl = MAP_STYLES.satellite.getTileUrl(zoom, tx, ty);
            const fallbackImg = await loadImage(fallbackUrl);
            mapCtx.drawImage(fallbackImg, px, py, 256, 256);
          } catch (e2) {
            // Draw subtle topographic placeholder grid
            mapCtx.fillStyle = '#2d3748';
            mapCtx.fillRect(px, py, 256, 256);
            mapCtx.strokeStyle = '#4a5568';
            mapCtx.strokeRect(px, py, 256, 256);
          }
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
          15 + Math.floor((loadedCount / totalTiles) * 45),
          `Scaricati tile ${loadedCount}/${totalTiles}...`
        );
      })();

      tileTasks.push(task);
    }
  }

  await Promise.all(tileTasks);

  onProgress(65, 'Generazione mesh 3D del terreno...');

  // 4. Sample Elevation at any Web Mercator (mx, my)
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

    const inPx = Math.max(0, Math.min(255, Math.floor((px - tx) * 256)));
    const inPy = Math.max(0, Math.min(255, Math.floor((py - ty) * 256)));

    return eleArray[inPy * 256 + inPx] || 0;
  };

  // Find lowest elevation across the region to anchor base at Y=0
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
  const scale = worldWidth / gridSpanX; // 3D units per real meter

  const segmentsX = Math.min(240, numTilesX * 48);
  const segmentsY = Math.min(240, numTilesY * 48);

  // PlaneGeometry lies on X-Y, rotated so X=East, Y=Up (elevation), Z=South
  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2); // Put on X-Z plane (X=East, Z=South, Y=Up)

  const posAttr = geometry.attributes.position;

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);

    // Map vertex (vx, vz) to Mercator (mx, my)
    const nx = (vx / worldWidth) + 0.5;   // 0 (West) to 1 (East)
    const ny = (vz / worldHeight) + 0.5;  // 0 (North) to 1 (South)

    const mx = gridMinMx + nx * gridSpanX;
    const my = gridMaxMy - ny * gridSpanY; // South has smaller Mercator Y

    const rawEle = getElevationAtMercator(mx, my);
    const clampedEle = Math.max(lowestEle, Math.min(8848, rawEle));
    const vy = (clampedEle - lowestEle) * scale * config.heightExaggeration;

    posAttr.setY(i, vy);
  }

  geometry.computeVertexNormals();

  // Create CanvasTexture with exact orientation
  const texture = new THREE.CanvasTexture(mapCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: false,
  });

  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;

  onProgress(80, 'Creazione percorso 3D in rilievo...');

  // 6. Project GPX Track to 3D World Space
  const track3dPoints = [];
  let lastVector = null;

  mercatorPoints.forEach((p) => {
    const nx = (p.mx - gridMinMx) / gridSpanX;
    const ny = (gridMaxMy - p.my) / gridSpanY;

    const vx = (nx - 0.5) * worldWidth;
    const vz = (ny - 0.5) * worldHeight;

    const sampleEle = getElevationAtMercator(p.mx, p.my);
    const baseEle = sampleEle > 0 ? sampleEle : p.ele;
    const vy = (baseEle - lowestEle) * scale * config.heightExaggeration + (config.trackWidth * 0.8);

    const pt = new THREE.Vector3(vx, vy, vz);

    // Deduplicate points closer than 0.8 units to avoid CatmullRom singularities
    if (!lastVector || lastVector.distanceTo(pt) > 0.8) {
      track3dPoints.push(pt);
      lastVector = pt;
    }
  });

  if (track3dPoints.length < 2) {
    track3dPoints.push(new THREE.Vector3(0, 2, 0));
  }

  const trackCurve = new THREE.CatmullRomCurve3(track3dPoints, false, 'centripetal', 0.25);
  const tubularSegments = Math.max(300, Math.min(3000, track3dPoints.length * 2));

  const trackTubeGeom = new THREE.TubeGeometry(
    trackCurve,
    tubularSegments,
    config.trackWidth,
    10,
    false
  );

  const trackMaterial = new THREE.MeshStandardMaterial({
    color: config.trackColor,
    emissive: config.trackColor,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.6,
  });

  const trackMesh = new THREE.Mesh(trackTubeGeom, trackMaterial);
  trackMesh.castShadow = true;

  const totalIndexCount = trackTubeGeom.index
    ? trackTubeGeom.index.count
    : trackTubeGeom.attributes.position.count;

  // 7. Animated Leading Marker (Glowing Sphere)
  const markerGeom = new THREE.SphereGeometry(config.trackWidth * 2.2, 20, 20);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: config.trackColor,
    emissiveIntensity: 0.9,
    roughness: 0.1,
    metalness: 0.2,
  });
  const markerMesh = new THREE.Mesh(markerGeom, markerMaterial);
  markerMesh.position.copy(track3dPoints[0]);
  markerMesh.castShadow = true;

  // 8. Construct Three.js Scene & Lighting
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#10141d');
  scene.fog = new THREE.FogExp2('#1a2333', 0.0006);

  scene.add(terrainMesh);
  scene.add(trackMesh);
  scene.add(markerMesh);

  // Sunlight (Directional)
  const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
  sunLight.position.set(worldWidth * 0.4, worldHeight * 0.7, -worldWidth * 0.3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 4000;
  sunLight.shadow.camera.left = -worldWidth;
  sunLight.shadow.camera.right = worldWidth;
  sunLight.shadow.camera.top = worldHeight;
  sunLight.shadow.camera.bottom = -worldHeight;
  scene.add(sunLight);

  // Ambient & Atmospheric Light
  const ambLight = new THREE.AmbientLight(0xdbeafe, 0.7);
  scene.add(ambLight);

  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.5);
  scene.add(hemiLight);

  // 9. Camera Setup
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
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
