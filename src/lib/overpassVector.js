/**
 * Overpass Vector Data Service
 * Fetches real geographic vector features (regional boundaries, nearby towns, mountain peaks)
 * for a GPX bounding box via OpenStreetMap Overpass API, with fallback data for sample tracks.
 */

// Memory cache to prevent redundant Overpass API requests
const vectorCache = new Map();

/**
 * Pre-cached fallback vector data for popular sample tracks (e.g. Via degli Dei)
 */
const SAMPLE_VECTOR_DATA = {
  via_degli_dei: {
    boundaries: [
      // Emilia-Romagna / Toscana regional border polyline approximation
      {
        id: 'border-er-tos',
        name: 'Emilia-Romagna / Toscana',
        points: [
          { lat: 44.25, lon: 11.0 },
          { lat: 44.20, lon: 11.15 },
          { lat: 44.17, lon: 11.22 },
          { lat: 44.15, lon: 11.28 },
          { lat: 44.12, lon: 11.35 },
          { lat: 44.05, lon: 11.45 },
        ],
      },
    ],
    places: [
      { id: 'p1', name: 'Bologna', lat: 44.4949, lon: 11.3426, type: 'city' },
      { id: 'p2', name: 'Casalecchio di Reno', lat: 44.4752, lon: 11.2764, type: 'town' },
      { id: 'p3', name: 'Sasso Marconi', lat: 44.3982, lon: 11.2482, type: 'town' },
      { id: 'p4', name: 'Monzuno', lat: 44.2798, lon: 11.2704, type: 'town' },
      { id: 'p5', name: 'Madonna dei Fornelli', lat: 44.1953, lon: 11.2384, type: 'village' },
      { id: 'p6', name: 'Passo della Futa', lat: 44.0955, lon: 11.2772, type: 'village' },
      { id: 'p7', name: 'San Piero a Sieve', lat: 43.9592, lon: 11.3238, type: 'town' },
      { id: 'p8', name: 'Fiesole', lat: 43.8067, lon: 11.2928, type: 'town' },
      { id: 'p9', name: 'Firenze', lat: 43.7696, lon: 11.2558, type: 'city' },
    ],
    peaks: [
      { id: 'k1', name: 'Monte Adone', ele: 654, lat: 44.3312, lon: 11.3105 },
      { id: 'k2', name: 'Monte Venere', ele: 940, lat: 44.2415, lon: 11.2294 },
      { id: 'k3', name: 'Monte dei Cucchi', ele: 1136, lat: 44.1702, lon: 11.2488 },
      { id: 'k4', name: 'Monte Senario', ele: 820, lat: 43.8965, lon: 11.3361 },
    ],
    regions: [
      { id: 'r1', name: 'Emilia-Romagna', lat: 44.35, lon: 11.15 },
      { id: 'r2', name: 'Tuscany', lat: 44.00, lon: 11.12 },
    ],
  },
};

/**
 * Fetch vector features for a given GPX points array
 */
export async function fetchVectorFeatures(points) {
  if (!points || points.length === 0) {
    return { boundaries: [], places: [], peaks: [], regions: [] };
  }

  // Calculate bounding box
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  points.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });

  // Add 30% padding margin around track
  const latSpan = maxLat - minLat || 0.05;
  const lonSpan = maxLon - minLon || 0.05;
  const padLat = latSpan * 0.35;
  const padLon = lonSpan * 0.35;

  const bbox = {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
  };

  const cacheKey = `${bbox.minLat.toFixed(2)},${bbox.minLon.toFixed(2)},${bbox.maxLat.toFixed(2)},${bbox.maxLon.toFixed(2)}`;
  if (vectorCache.has(cacheKey)) {
    return vectorCache.get(cacheKey);
  }

  // Check if track matches Via degli Dei area
  if (minLat > 43.6 && maxLat < 44.6 && minLon > 11.1 && maxLon < 11.5) {
    const sample = SAMPLE_VECTOR_DATA.via_degli_dei;
    vectorCache.set(cacheKey, sample);
    // Proceed to fetch live Overpass data in background to merge
  }

  try {
    const query = `[out:json][timeout:12];
(
  node["place"~"city|town|village"](${bbox.minLat.toFixed(3)},${bbox.minLon.toFixed(3)},${bbox.maxLat.toFixed(3)},${bbox.maxLon.toFixed(3)});
  node["natural"="peak"](${bbox.minLat.toFixed(3)},${bbox.minLon.toFixed(3)},${bbox.maxLat.toFixed(3)},${bbox.maxLon.toFixed(3)});
  relation["admin_level"~"4|6"](${bbox.minLat.toFixed(3)},${bbox.minLon.toFixed(3)},${bbox.maxLat.toFixed(3)},${bbox.maxLon.toFixed(3)});
);
out body center 60;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) {
      throw new Error(`Overpass API returned ${response.status}`);
    }

    const data = await response.json();
    const result = parseOverpassElements(data.elements, bbox);

    // Merge with sample data if available
    if (minLat > 43.6 && maxLat < 44.6 && minLon > 11.1 && maxLon < 11.5) {
      result.regions = SAMPLE_VECTOR_DATA.via_degli_dei.regions;
      if (result.boundaries.length === 0) {
        result.boundaries = SAMPLE_VECTOR_DATA.via_degli_dei.boundaries;
      }
    }

    vectorCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('Overpass fetch failed, using fallback vector features:', err.message);
    const fallback = SAMPLE_VECTOR_DATA.via_degli_dei;
    vectorCache.set(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Parse raw Overpass API response elements into clean vector features
 */
function parseOverpassElements(elements, bbox) {
  const places = [];
  const peaks = [];
  const boundaries = [];
  const regions = [];

  if (!elements || !Array.isArray(elements)) {
    return { places, peaks, boundaries, regions };
  }

  elements.forEach((el) => {
    if (!el.tags) return;

    // Towns / Cities
    if (el.type === 'node' && el.tags.place && el.tags.name) {
      places.push({
        id: `place-${el.id}`,
        name: el.tags.name,
        type: el.tags.place,
        lat: el.lat,
        lon: el.lon,
      });
    }

    // Mountain Peaks
    if (el.type === 'node' && el.tags.natural === 'peak' && el.tags.name) {
      const ele = el.tags.ele ? parseInt(el.tags.ele, 10) : null;
      peaks.push({
        id: `peak-${el.id}`,
        name: el.tags.name,
        ele: ele,
        lat: el.lat,
        lon: el.lon,
      });
    }

    // Regional Boundaries
    if (el.type === 'relation' && el.tags.admin_level === '4' && el.tags.name) {
      regions.push({
        id: `reg-${el.id}`,
        name: el.tags.name,
        lat: el.center ? el.center.lat : (bbox.minLat + bbox.maxLat) / 2,
        lon: el.center ? el.center.lon : (bbox.minLon + bbox.maxLon) / 2,
      });
    }
  });

  // Filter & limit counts so the map stays clean and minimal (max 7 towns, max 4 peaks)
  const sortedPlaces = places
    .filter((p) => p.type === 'city' || p.type === 'town')
    .slice(0, 7);

  const sortedPeaks = peaks
    .filter((p) => p.ele && p.ele > 400)
    .sort((a, b) => (b.ele || 0) - (a.ele || 0))
    .slice(0, 4);

  return {
    places: sortedPlaces,
    peaks: sortedPeaks,
    boundaries,
    regions,
  };
}
