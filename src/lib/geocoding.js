import { haversineDistance } from './gpxParser';

/**
 * Geocodes a place name using OpenStreetMap Nominatim API and finds the closest matching point on the GPX track.
 * @param {string} query - The place name to search (e.g. "Courmayeur", "Refuge du Bonhomme")
 * @param {Array} trackPoints - Normalized GPX track points list
 * @returns {Promise<{percent: number, lat: number, lon: number, name: string} | null>}
 */
export async function geocodeAndSnapToTrack(query, trackPoints) {
  if (!query || !query.trim()) return null;

  try {
    // 1. Search place via Nominatim OpenStreetMap API
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      {
        headers: {
          'User-Agent': 'TrailPosterStudio/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error('Errore durante la ricerca del luogo.');
    }

    const results = await response.json();
    if (!results || results.length === 0) {
      throw new Error(`Nessun luogo trovato per "${query}". Prova ad inserire un nome più specifico.`);
    }

    if (!trackPoints || trackPoints.length === 0) {
      return {
        name: results[0].display_name.split(',')[0],
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon),
        percent: 50,
      };
    }

    const totalDistance = trackPoints[trackPoints.length - 1].cumDistance || 1;

    // 2. Find which geocoded candidate is closest to the GPX track
    let bestCandidate = null;
    let minDistanceToTrack = Infinity;
    let bestTrackPointIndex = 0;

    results.forEach((candidate) => {
      const cLat = parseFloat(candidate.lat);
      const cLon = parseFloat(candidate.lon);

      trackPoints.forEach((pt, idx) => {
        const d = haversineDistance(cLat, cLon, pt.lat, pt.lon);
        if (d < minDistanceToTrack) {
          minDistanceToTrack = d;
          bestCandidate = candidate;
          bestTrackPointIndex = idx;
        }
      });
    });

    if (!bestCandidate) {
      throw new Error('Impossibile posizionare il luogo sulla traccia.');
    }

    const matchedPoint = trackPoints[bestTrackPointIndex];
    const rawPercent = (matchedPoint.cumDistance / totalDistance) * 100;
    const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));

    const cleanName = query.trim();

    return {
      name: cleanName,
      lat: matchedPoint.lat,
      lon: matchedPoint.lon,
      percent,
      distFromTrackKm: (minDistanceToTrack / 1000).toFixed(2),
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    throw error;
  }
}

/**
 * Automatically discovers real towns, villages, hamlets, mountain passes and peaks
 * along the GPX track using OpenStreetMap Overpass API and reverse geocoding fallback.
 * @param {Array} trackPoints - Normalized GPX points array
 * @param {number} maxResults - Maximum number of waypoints to return (default 8)
 * @returns {Promise<Array<{id: string, name: string, percent: number, lat: number, lon: number}>>}
 */
export async function findTownsAlongTrack(trackPoints, maxResults = 8) {
  if (!trackPoints || trackPoints.length < 2) return [];

  const totalDistance = trackPoints[trackPoints.length - 1].cumDistance || 1;

  // 1. Calculate Bounding Box with padding
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  trackPoints.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });

  const padLat = Math.max(0.04, (maxLat - minLat) * 0.15);
  const padLon = Math.max(0.04, (maxLon - minLon) * 0.15);

  const bbox = {
    minLat: (minLat - padLat).toFixed(4),
    maxLat: (maxLat + padLat).toFixed(4),
    minLon: (minLon - padLon).toFixed(4),
    maxLon: (maxLon + padLon).toFixed(4),
  };

  const discoveredPlaces = [];

  // 2. Fetch Places via Overpass API
  try {
    const overpassQuery = `[out:json][timeout:10];
(
  node["place"~"city|town|village|hamlet|isolated_dwelling"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
  node["natural"="peak"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
  node["mountain_pass"="yes"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
);
out body 80;`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.elements)) {
        data.elements.forEach((el) => {
          if (!el.tags || !el.tags.name) return;

          const pLat = el.lat;
          const pLon = el.lon;

          // Find closest point on track
          let minDist = Infinity;
          let closestIdx = 0;

          // Sample track points for efficiency if track is very dense
          const step = Math.max(1, Math.floor(trackPoints.length / 500));
          for (let i = 0; i < trackPoints.length; i += step) {
            const pt = trackPoints[i];
            const d = haversineDistance(pLat, pLon, pt.lat, pt.lon);
            if (d < minDist) {
              minDist = d;
              closestIdx = i;
            }
          }

          // Keep places within 3.5 km of the trail
          if (minDist <= 3500) {
            const matchedPt = trackPoints[closestIdx];
            const percent = Math.max(0, Math.min(100, Math.round((matchedPt.cumDistance / totalDistance) * 100)));

            const placeType = el.tags.place || (el.tags.natural === 'peak' ? 'peak' : 'pass');
            let priority = 3;
            if (placeType === 'city' || placeType === 'town') priority = 1;
            else if (placeType === 'village') priority = 2;
            else if (placeType === 'peak') priority = 3;

            discoveredPlaces.push({
              id: `auto-${el.id || Math.random().toString(36).substr(2, 6)}`,
              name: el.tags.name,
              percent,
              distM: minDist,
              priority,
              lat: matchedPt.lat,
              lon: matchedPt.lon,
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('Overpass auto-discovery failed, using fallback reverse-geocoding:', err.message);
  }

  // 3. Fallback: If Overpass returned few or no results, sample key points along the route via Nominatim
  if (discoveredPlaces.length < 2) {
    const samplePercents = [0, 25, 50, 75, 100];
    for (const targetPct of samplePercents) {
      const targetDist = (targetPct / 100) * totalDistance;
      let closestPt = trackPoints[0];
      let minDiff = Infinity;

      for (const pt of trackPoints) {
        const diff = Math.abs((pt.cumDistance || 0) - targetDist);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = pt;
        }
      }

      try {
        const revUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${closestPt.lat}&lon=${closestPt.lon}&zoom=14`;
        const res = await fetch(revUrl, {
          headers: { 'User-Agent': 'TrailPosterStudio/1.0' },
        });
        if (res.ok) {
          const json = await res.json();
          const addr = json.address || {};
          const name = addr.village || addr.town || addr.municipality || addr.city || addr.suburb || addr.hamlet || json.name;
          if (name) {
            discoveredPlaces.push({
              id: `rev-${targetPct}-${Date.now()}`,
              name,
              percent: targetPct,
              distM: 0,
              priority: 2,
              lat: closestPt.lat,
              lon: closestPt.lon,
            });
          }
        }
      } catch (e) {
        // Continue gracefully
      }
    }
  }

  // 4. Filter, Deduplicate, and Space Out Along the Route
  if (discoveredPlaces.length === 0) return [];

  // Sort by priority (towns first) then distance to track
  discoveredPlaces.sort((a, b) => a.priority - b.priority || a.distM - b.distM);

  const selected = [];
  const seenNames = new Set();

  // Spacing threshold: minimum 8% of distance between waypoints
  const minPercentGap = 8;

  for (const place of discoveredPlaces) {
    const normalizedName = place.name.trim().toLowerCase();
    if (seenNames.has(normalizedName)) continue;

    // Check if too close to an already selected waypoint
    const tooClose = selected.some((s) => Math.abs(s.percent - place.percent) < minPercentGap);
    if (!tooClose) {
      seenNames.add(normalizedName);
      selected.push({
        id: `wpt-${place.id}`,
        name: place.name.trim(),
        percent: place.percent,
        lat: place.lat,
        lon: place.lon,
      });
      if (selected.length >= maxResults) break;
    }
  }

  // Sort chronologically along the trail (0% -> 100%)
  return selected.sort((a, b) => a.percent - b.percent);
}
