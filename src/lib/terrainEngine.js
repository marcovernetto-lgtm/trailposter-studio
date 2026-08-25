import * as THREE from 'three';

// Map style definitions
export const MAP_STYLES = {
  satellite: {
    name: 'Satellite HD',
    tileUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri',
  },
  topo: {
    name: 'Topografico',
    tileUrl: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenTopoMap',
  },
  osm: {
    name: 'OpenStreetMap',
    tileUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap',
  },
  terrain: {
    name: 'Terreno Naturale',
    tileUrl: (z, x, y) => `https://b.tile.opentopomap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenTopoMap',
  },
};

// Helpers for tile math
const lon2tile = (lon, zoom) => Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
const lat2tile = (lat, zoom) =>
  Math.floor(
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
        Math.PI) /
      2) *
      Math.pow(2, zoom)
  );

const tile2lon = (x, z) => (x / Math.pow(2, z)) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// Haversine distance
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const loadImage = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
};

/**
 * Build a complete Three.js scene with 3D terrain, map texture, track tube, and animated marker.
 *
 * @param {Array} trackPoints - Array of {lat, lon, ele, cumDistance} from GPX parser
 * @param {Object} options - Options
 * @param {Function} onProgress - callback(percent, message)
 * @returns {Promise<Object>}
 */
export async function buildTerrainScene(trackPoints, options = {}, onProgress = () => {}) {
  const config = {
    mapStyle: 'satellite',
    heightExaggeration: 1.5,
    trackColor: '#14b8a6',
    trackWidth: 2.0,
    padding: 0.3,
    ...options,
  };

  if (!trackPoints || trackPoints.length === 0) {
    throw new Error('No track points provided');
  }

  onProgress(5, 'Calculating bounds...');

  // 1. Bounding Box & Tile Calculation
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  trackPoints.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });

  const latPad = (maxLat - minLat) * config.padding;
  const lonPad = (maxLon - minLon) * config.padding;

  const bMinLat = minLat - latPad;
  const bMaxLat = maxLat + latPad;
  const bMinLon = minLon - lonPad;
  const bMaxLon = maxLon + lonPad;

  const spanKm = Math.max(
    getDistanceKm(bMinLat, bMinLon, bMaxLat, bMinLon),
    getDistanceKm(bMinLat, bMinLon, bMinLat, bMaxLon)
  );

  let zoom = 11;
  if (spanKm < 10) zoom = 14;
  else if (spanKm < 30) zoom = 13;
  else if (spanKm < 100) zoom = 12;

  let startX = lon2tile(bMinLon, zoom);
  let endX = lon2tile(bMaxLon, zoom);
  let startY = lat2tile(bMaxLat, zoom);
  let endY = lat2tile(bMinLat, zoom);

  // Limit to max 6x6 tiles
  if (endX - startX > 5) endX = startX + 5;
  if (endY - startY > 5) endY = startY + 5;

  const numTilesX = endX - startX + 1;
  const numTilesY = endY - startY + 1;
  const totalTiles = numTilesX * numTilesY;

  onProgress(10, `Loading ${totalTiles} terrain and map tiles...`);

  // 2 & 3. Tile Loading
  const elevations = new Map();
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = numTilesX * 256;
  mapCanvas.height = numTilesY * 256;
  const mapCtx = mapCanvas.getContext('2d');
  
  let loadedTiles = 0;
  
  const mapStyleObj = MAP_STYLES[config.mapStyle] || MAP_STYLES.satellite;

  const tilePromises = [];

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const px = (x - startX) * 256;
      const py = (y - startY) * 256;

      const p = (async () => {
        // Load Map Tile
        try {
          const mapUrl = mapStyleObj.tileUrl(zoom, x, y);
          const mapImg = await loadImage(mapUrl);
          mapCtx.drawImage(mapImg, px, py, 256, 256);
        } catch (e) {
          console.warn('Map tile failed:', e);
          mapCtx.fillStyle = '#333333';
          mapCtx.fillRect(px, py, 256, 256);
        }

        // Load DEM Tile
        try {
          const demUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
          const demImg = await loadImage(demUrl);
          const demCanvas = document.createElement('canvas');
          demCanvas.width = 256;
          demCanvas.height = 256;
          const demCtx = demCanvas.getContext('2d');
          demCtx.drawImage(demImg, 0, 0);
          const imgData = demCtx.getImageData(0, 0, 256, 256).data;
          
          const eleArray = new Float32Array(256 * 256);
          for (let i = 0; i < 256 * 256; i++) {
            const r = imgData[i * 4];
            const g = imgData[i * 4 + 1];
            const b = imgData[i * 4 + 2];
            eleArray[i] = (r * 256 + g + b / 256) - 32768;
          }
          elevations.set(`${x}/${y}`, eleArray);
        } catch (e) {
          console.warn('DEM tile failed:', e);
          elevations.set(`${x}/${y}`, new Float32Array(256 * 256));
        }

        loadedTiles++;
        onProgress(10 + Math.floor((loadedTiles / (totalTiles * 2)) * 40), `Loaded tiles ${loadedTiles}/${totalTiles*2}`);
      })();
      tilePromises.push(p);
    }
  }

  await Promise.all(tilePromises);
  
  onProgress(50, 'Building 3D terrain...');

  const texture = new THREE.CanvasTexture(mapCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // 4. Terrain Mesh Construction
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#87CEEB');
  scene.fog = new THREE.FogExp2('#c8d6e5', 0.0008);

  // Lighting
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(200, 300, -100);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambLight);

  const hemiLight = new THREE.HemisphereLight('#87CEEB', '#3d2b1f', 0.4);
  scene.add(hemiLight);

  // Exact bounds of the loaded tiles
  const tileMinLon = tile2lon(startX, zoom);
  const tileMaxLon = tile2lon(endX + 1, zoom);
  const tileMaxLat = tile2lat(startY, zoom); // smaller y -> larger lat
  const tileMinLat = tile2lat(endY + 1, zoom);

  const worldWidth = 1000;
  // Preserve aspect ratio
  const lonSpan = tileMaxLon - tileMinLon;
  const latSpan = tileMaxLat - tileMinLat;
  // Approximating degree to meters for aspect ratio:
  const aspect = (latSpan / lonSpan) / Math.cos(tileMinLat * Math.PI / 180);
  const worldHeight = worldWidth * aspect;

  const realWorldSpanMeters = getDistanceKm(tileMinLat, tileMinLon, tileMinLat, tileMaxLon) * 1000;
  const scale = worldWidth / realWorldSpanMeters;

  const segmentsX = numTilesX * 64;
  const segmentsY = numTilesY * 64;
  
  const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  let minElevation = Infinity;

  // Helper to sample elevation
  const getElevationAt = (lon, lat) => {
    if (lon < tileMinLon || lon > tileMaxLon || lat < tileMinLat || lat > tileMaxLat) return 0;
    
    const x = lon2tile(lon, zoom);
    const y = lat2tile(lat, zoom);
    const tileData = elevations.get(`${x}/${y}`);
    if (!tileData) return 0;

    // Pixel within tile
    const tileLon1 = tile2lon(x, zoom);
    const tileLon2 = tile2lon(x + 1, zoom);
    const tileLat1 = tile2lat(y, zoom);
    const tileLat2 = tile2lat(y + 1, zoom);

    const px = Math.floor(((lon - tileLon1) / (tileLon2 - tileLon1)) * 255);
    const py = Math.floor(((tileLat1 - lat) / (tileLat1 - tileLat2)) * 255);
    
    const ppx = Math.max(0, Math.min(255, px));
    const ppy = Math.max(0, Math.min(255, py));
    
    return tileData[ppy * 256 + ppx] || 0;
  };

  // Pre-calculate minimum elevation for base offset
  for (let i = 0; i < posAttr.count; i++) {
    // Map vertex to lat/lon
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const nx = (vx / worldWidth) + 0.5;
    const ny = (vz / worldHeight) + 0.5;
    
    const vLon = tileMinLon + nx * (tileMaxLon - tileMinLon);
    const vLat = tileMaxLat - ny * (tileMaxLat - tileMinLat);
    
    const ele = getElevationAt(vLon, vLat);
    if (ele < minElevation) minElevation = ele;
  }

  // Apply elevation
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const nx = (vx / worldWidth) + 0.5;
    const ny = (vz / worldHeight) + 0.5;
    
    const vLon = tileMinLon + nx * (tileMaxLon - tileMinLon);
    const vLat = tileMaxLat - ny * (tileMaxLat - tileMinLat);
    
    let ele = getElevationAt(vLon, vLat);
    ele = Math.max(minElevation, Math.min(8848, ele)); // clamp outliers
    
    const vy = (ele - minElevation) * scale * config.heightExaggeration;
    posAttr.setY(i, vy);
  }

  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0.05,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  onProgress(75, 'Building track path...');

  // 5. Track 3D Path
  const track3dPoints = [];
  let lastPt = null;

  trackPoints.forEach((p) => {
    // map to plane coords
    const nx = (p.lon - tileMinLon) / (tileMaxLon - tileMinLon);
    const ny = (tileMaxLat - p.lat) / (tileMaxLat - tileMinLat);
    
    const vx = (nx - 0.5) * worldWidth;
    const vz = (ny - 0.5) * worldHeight;
    
    const ele = getElevationAt(p.lon, p.lat);
    const vy = (ele - minElevation) * scale * config.heightExaggeration + (config.trackWidth * 0.5);
    
    const pt = new THREE.Vector3(vx, vy, vz);
    
    if (!lastPt || lastPt.distanceTo(pt) > 0.5) {
      track3dPoints.push(pt);
      lastPt = pt;
    }
  });

  if (track3dPoints.length < 2) {
    track3dPoints.push(new THREE.Vector3(0, 0, 0));
  }

  const trackCurve = new THREE.CatmullRomCurve3(track3dPoints, false, 'centripetal', 0.3);
  const trackTubeGeom = new THREE.TubeGeometry(
    trackCurve,
    Math.max(200, track3dPoints.length * 2),
    config.trackWidth,
    8,
    false
  );
  
  const trackMat = new THREE.MeshStandardMaterial({
    color: config.trackColor,
    emissive: config.trackColor,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.5
  });

  const trackMesh = new THREE.Mesh(trackTubeGeom, trackMat);
  trackMesh.castShadow = true;
  scene.add(trackMesh);

  const totalIndexCount = trackTubeGeom.index ? trackTubeGeom.index.count : trackTubeGeom.attributes.position.count;
  
  // 6. Animated Marker
  const markerGeom = new THREE.SphereGeometry(config.trackWidth * 2.5, 16, 16);
  const markerMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: config.trackColor,
    emissiveIntensity: 0.8
  });
  const markerMesh = new THREE.Mesh(markerGeom, markerMat);
  
  if (track3dPoints.length > 0) {
    markerMesh.position.copy(track3dPoints[0]);
  }
  scene.add(markerMesh);

  // 8. Camera
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 5000);
  camera.position.set(0, worldWidth * 0.5, worldWidth * 0.5);
  camera.lookAt(0, 0, 0);

  // 9. updateProgress function
  const updateProgress = (t) => {
    t = Math.max(0, Math.min(1, t));
    
    if (trackTubeGeom.index) {
      const drawCount = Math.floor(totalIndexCount * t);
      trackTubeGeom.setDrawRange(0, drawCount);
    } else {
      trackTubeGeom.setDrawRange(0, Math.floor(totalIndexCount * t));
    }

    const pos = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    
    markerMesh.position.copy(pos);
    
    return { position: pos, tangent };
  };

  // Initialize
  updateProgress(0);

  // 10. Dispose function
  const dispose = () => {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    trackTubeGeom.dispose();
    trackMat.dispose();
    markerGeom.dispose();
    markerMat.dispose();
  };

  onProgress(100, 'Done');

  return {
    scene,
    camera,
    trackCurve,
    trackLength: trackCurve.getLength(),
    worldBounds: {
      minLat: bMinLat, maxLat: bMaxLat,
      minLon: bMinLon, maxLon: bMaxLon,
      centerLat: (bMinLat + bMaxLat) / 2,
      centerLon: (bMinLon + bMaxLon) / 2,
      spanKm
    },
    updateProgress,
    dispose
  };
}
