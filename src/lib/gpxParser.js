/**
 * GPX Parser & Coordinate Converter for TrailPoster Studio
 */

// Haversine distance in meters between two lat/lon points
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Convert latitude/longitude to Web Mercator projection (X, Y in meters)
export function latLonToMercator(lat, lon) {
  const R = 6378137; // Earth radius WGS84
  const x = lon * (Math.PI / 180) * R;
  const latRad = lat * (Math.PI / 180);
  const y = R * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return { x, y };
}

// Reverse Mercator: convert (X, Y) in meters back to Lat/Lon
export function mercatorToLatLon(x, y) {
  const R = 6378137;
  const lon = (x / R) * (180 / Math.PI);
  const latRad = 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;
  const lat = latRad * (180 / Math.PI);
  return { lat, lon };
}

/**
 * Parses raw GPX XML string into structured track data, normalized coordinates, and stats
 */
export function parseGPX(gpxString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxString, 'text/xml');

  // Check for parse errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Impossibile parsare il file GPX. Assicurati che sia un file XML/GPX valido.');
  }

  // Extract track name
  let name = xmlDoc.querySelector('trk > name, metadata > name')?.textContent?.trim() || 'Percorso Trekking';

  // Extract all track points (<trkpt> or fallback to <rtept> or <wpt>)
  let ptNodes = Array.from(xmlDoc.querySelectorAll('trkpt'));
  if (ptNodes.length === 0) {
    ptNodes = Array.from(xmlDoc.querySelectorAll('rtept'));
  }
  if (ptNodes.length === 0) {
    ptNodes = Array.from(xmlDoc.querySelectorAll('wpt'));
  }

  if (ptNodes.length === 0) {
    throw new Error('Nessun punto traccia valido trovato nel file GPX.');
  }

  const rawPoints = [];
  let totalDistance = 0; // in meters
  let elevationGain = 0; // in meters
  let elevationLoss = 0; // in meters
  let minEle = Infinity;
  let maxEle = -Infinity;

  let prevPoint = null;

  ptNodes.forEach((node) => {
    const lat = parseFloat(node.getAttribute('lat'));
    const lon = parseFloat(node.getAttribute('lon'));
    const eleNode = node.querySelector('ele');
    const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

    if (isNaN(lat) || isNaN(lon)) return;

    const mercator = latLonToMercator(lat, lon);

    let distFromPrev = 0;
    if (prevPoint) {
      distFromPrev = haversineDistance(prevPoint.lat, prevPoint.lon, lat, lon);
      totalDistance += distFromPrev;

      const eleDiff = ele - prevPoint.ele;
      if (eleDiff > 0) {
        elevationGain += eleDiff;
      } else {
        elevationLoss += Math.abs(eleDiff);
      }
    }

    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;

    const pointObj = {
      lat,
      lon,
      ele,
      mx: mercator.x,
      my: mercator.y,
      cumDistance: totalDistance,
    };

    rawPoints.push(pointObj);
    prevPoint = pointObj;
  });

  if (rawPoints.length < 2) {
    throw new Error('La traccia GPX deve contenere almeno 2 punti.');
  }

  if (minEle === Infinity) minEle = 0;
  if (maxEle === -Infinity) maxEle = 0;

  // Compute Bounding Box in Mercator coordinates
  let minMx = Infinity, maxMx = -Infinity;
  let minMy = Infinity, maxMy = -Infinity;

  rawPoints.forEach((p) => {
    if (p.mx < minMx) minMx = p.mx;
    if (p.mx > maxMx) maxMx = p.mx;
    if (p.my < minMy) minMy = p.my;
    if (p.my > maxMy) maxMy = p.my;
  });

  const widthMx = maxMx - minMx || 1;
  const heightMy = maxMy - minMy || 1;

  // Center & Normalize points into [0, 1] relative box maintaining original aspect ratio
  const maxDim = Math.max(widthMx, heightMy);

  // Center offset to align track perfectly in [0, 1] x [0, 1] square
  const offsetX = (maxDim - widthMx) / 2;
  const offsetY = (maxDim - heightMy) / 2;

  const normalizedPoints = rawPoints.map((p) => {
    // Note: Y in SVG is inverted (top to bottom), Mercator Y goes bottom to top
    const normX = (p.mx - minMx + offsetX) / maxDim;
    const normY = 1 - (p.my - minMy + offsetY) / maxDim;
    return {
      ...p,
      nx: normX,
      ny: normY,
    };
  });

  // Calculate the EXACT geographic bounds corresponding to SVG viewBox [0, 0, 1000, 1000]
  // MARGIN in SVG is 100 (10%), so track spans from 10% to 90% (80% of width/height).
  // Therefore, outer margin expansion factor is 0.125 (10% / 80% = 0.125)
  const marginExp = 0.125 * maxDim;
  const outerMinMx = minMx - offsetX - marginExp;
  const outerMaxMx = maxMx + offsetX + marginExp;
  const outerMinMy = minMy - offsetY - marginExp;
  const outerMaxMy = maxMy + offsetY + marginExp;

  const southWest = mercatorToLatLon(outerMinMx, outerMinMy);
  const northEast = mercatorToLatLon(outerMaxMx, outerMaxMy);

  // Extract embedded GPX waypoints (<wpt>) as default highlights if present
  const gpxWaypoints = Array.from(xmlDoc.querySelectorAll('wpt')).map((wpt, index) => {
    const wLat = parseFloat(wpt.getAttribute('lat'));
    const wLon = parseFloat(wpt.getAttribute('lon'));
    const wName = wpt.querySelector('name')?.textContent?.trim() || `Tappa ${index + 1}`;
    
    // Find closest point on track to calculate percentage distance
    let closestIndex = 0;
    let minDist = Infinity;
    normalizedPoints.forEach((p, idx) => {
      const d = haversineDistance(wLat, wLon, p.lat, p.lon);
      if (d < minDist) {
        minDist = d;
        closestIndex = idx;
      }
    });

    const percent = totalDistance > 0 
      ? Math.round((normalizedPoints[closestIndex].cumDistance / totalDistance) * 100) 
      : 50;

    return {
      id: `wpt-${index}-${Date.now()}`,
      name: wName,
      percent,
      lat: wLat,
      lon: wLon,
      markerStyle: 'solid',
      textOffset: 'top',
    };
  });

  return {
    name,
    points: normalizedPoints,
    mapBounds: {
      southWest,
      northEast,
    },
    stats: {
      totalDistanceKm: (totalDistance / 1000).toFixed(1),
      elevationGainM: Math.round(elevationGain),
      elevationLossM: Math.round(elevationLoss),
      minEleM: Math.round(minEle),
      maxEleM: Math.round(maxEle),
      startLatLon: `${rawPoints[0].lat.toFixed(4)}° N, ${rawPoints[0].lon.toFixed(4)}° E`,
      endLatLon: `${rawPoints[rawPoints.length - 1].lat.toFixed(4)}° N, ${rawPoints[rawPoints.length - 1].lon.toFixed(4)}° E`,
      pointCount: rawPoints.length,
    },
    gpxWaypoints,
  };
}

/**
 * Given a track and a percentage (0-100), calculates the precise position along the path
 */
export function getPointAtPercent(points, percent) {
  if (!points || points.length === 0) return { nx: 0.5, ny: 0.5, ele: 0 };
  if (percent <= 0) return points[0];
  if (percent >= 100) return points[points.length - 1];

  const totalDist = points[points.length - 1].cumDistance;
  const targetDist = (percent / 100) * totalDist;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (p1.cumDistance <= targetDist && p2.cumDistance >= targetDist) {
      const segmentLen = p2.cumDistance - p1.cumDistance;
      const ratio = segmentLen > 0 ? (targetDist - p1.cumDistance) / segmentLen : 0;

      return {
        nx: p1.nx + (p2.nx - p1.nx) * ratio,
        ny: p1.ny + (p2.ny - p1.ny) * ratio,
        ele: Math.round(p1.ele + (p2.ele - p1.ele) * ratio),
        lat: p1.lat + (p2.lat - p1.lat) * ratio,
        lon: p1.lon + (p2.lon - p1.lon) * ratio,
      };
    }
  }

  return points[points.length - 1];
}
