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
      // Return raw first result if no track is loaded
      return {
        name: results[0].display_name.split(',')[0],
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon),
        percent: 50,
      };
    }

    const totalDistance = trackPoints[trackPoints.length - 1].cumDistance;

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
    const percent = totalDistance > 0 ? Math.round((matchedPoint.cumDistance / totalDistance) * 100) : 50;

    // Extract short clean name (first part of display_name)
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
