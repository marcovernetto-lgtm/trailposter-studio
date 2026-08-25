import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getPointAtPercent } from '../lib/gpxParser';

/**
 * Custom Leaflet TileLayer that renders tiles to Canvas elements
 * and makes background pixels transparent based on brightness threshold.
 * This is the ONLY reliable way to get truly transparent tile backgrounds
 * since CSS mix-blend-mode doesn't work through Leaflet's stacking contexts.
 */
function createTransparentTileLayer(url, options = {}) {
  const { isDark = false, threshold = 0.85, ...tileOptions } = options;

  const TransparentTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const tileSize = this.getTileSize();
      canvas.width = tileSize.x;
      canvas.height = tileSize.y;

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, tileSize.x, tileSize.y);

        try {
          const imageData = ctx.getImageData(0, 0, tileSize.x, tileSize.y);
          const data = imageData.data;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r + g + b) / (3 * 255); // 0.0 to 1.0

            if (isDark) {
              // Dark tiles: make dark/black pixels transparent
              if (brightness < (1 - threshold)) {
                data[i + 3] = 0;
              } else if (brightness < (1 - threshold + 0.12)) {
                const t = (brightness - (1 - threshold)) / 0.12;
                data[i + 3] = Math.round(t * 255);
              }
            } else {
              // Light tiles: make white/light pixels transparent
              if (brightness > threshold) {
                data[i + 3] = 0;
              } else if (brightness > threshold - 0.10) {
                const t = (threshold - brightness) / 0.10;
                data[i + 3] = Math.round(t * 255);
              }
            }
          }

          ctx.putImageData(imageData, 0, 0);
        } catch (e) {
          // CORS error — clear canvas to prevent tainting the DOM
          console.warn('Tile CORS error, rendering blank to prevent canvas tainting:', e.message);
          ctx.clearRect(0, 0, tileSize.x, tileSize.y);
        }

        done(null, canvas);
      };

      img.onerror = (e) => {
        done(e, canvas);
      };

      img.src = this.getTileUrl(coords);
      return canvas;
    },
  });

  return new TransparentTileLayer(url, tileOptions);
}

export function MapLayer({
  points,
  mapStyle = 'ultra_light',
  opacity = 0.6,
  trackColor = '#111111',
  trackWidth = 5,
  trackOpacity = 1.0,
  trackGlow = false,
  trackPadding = 25,
  waypoints = [],
  textColor = '#111111',
  textLayout = 'bottom',
  showElevationChart = false,
  elevationPosition = 'below_text',
  mapZoom = 1.0,
  mapOffsetX = 0,
  mapOffsetY = 0,
  onMapUpdated,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const polylineRef = useRef(null);
  const glowPolylineRef = useRef(null);

  // 1. Initialize Map instance ONCE with fractional zoom
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomSnap: 0.05,
        zoomDelta: 0.1,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });

      mapInstanceRef.current = map;
    }
  }, []);

  // 2. Manage Tile Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    let tileUrl = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
    let subdomains = 'abcd';
    let isDark = false;
    let threshold = 0.88;
    let useTransparency = true; // Canvas-based bg removal — only for grayscale tiles

    if (mapStyle === 'light' || mapStyle === 'ultra_light') {
      tileUrl = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
      isDark = false;
      threshold = 0.88;
      useTransparency = true;
    } else if (mapStyle === 'dark' || mapStyle === 'ultra_dark') {
      tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
      isDark = true;
      threshold = 0.85;
      useTransparency = true;
    } else if (mapStyle === 'voyager') {
      // Voyager has colored features (lakes, parks) — DON'T strip pixels, just use opacity
      tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';
      useTransparency = false;
    } else if (mapStyle === 'toner') {
      tileUrl = 'https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}{r}.png';
      subdomains = '';
      isDark = false;
      threshold = 0.92;
      useTransparency = true;
    }

    let tileLayer;
    if (useTransparency) {
      tileLayer = createTransparentTileLayer(tileUrl, {
        subdomains,
        maxZoom: 19,
        opacity: opacity,
        isDark,
        threshold,
      });
    } else {
      // Standard Leaflet tile layer — no pixel processing
      tileLayer = L.tileLayer(tileUrl, {
        subdomains,
        maxZoom: 19,
        opacity: opacity,
        crossOrigin: 'anonymous',
      });
    }

    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;
  }, [mapStyle, opacity]);

  // 3. Update Polylines, Fit Bounds & Waypoint positions
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !points || points.length === 0) return;

    const latLngs = points.map((p) => [p.lat, p.lon]);

    // Force Leaflet to recalculate container size
    map.invalidateSize();

    // Remove existing polylines
    if (glowPolylineRef.current) {
      map.removeLayer(glowPolylineRef.current);
      glowPolylineRef.current = null;
    }
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    // Glow backdrop polyline
    if (trackGlow) {
      glowPolylineRef.current = L.polyline(latLngs, {
        color: trackColor,
        weight: trackWidth * 2.5,
        opacity: trackOpacity * 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
    }

    // Main GPX Track Polyline
    const polyline = L.polyline(latLngs, {
      color: trackColor,
      weight: trackWidth,
      opacity: trackOpacity,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    polylineRef.current = polyline;

    // Calculate target bounds scaled by mapZoom and shifted by mapOffsetX / mapOffsetY
    const origBounds = polyline.getBounds();
    const sw = origBounds.getSouthWest();
    const ne = origBounds.getNorthEast();

    const centerLat = (sw.lat + ne.lat) / 2;
    const centerLon = (sw.lng + ne.lng) / 2;

    const origLatSpan = Math.abs(ne.lat - sw.lat) || 0.01;
    const origLonSpan = Math.abs(ne.lng - sw.lng) || 0.01;

    // Allow zoom factor < 1.0 (zoom out) and > 1.0 (zoom in)
    const zoomFactor = Math.max(0.3, mapZoom || 1.0);
    const targetLatSpan = origLatSpan / zoomFactor;
    const targetLonSpan = origLonSpan / zoomFactor;

    // Offsets (-80 to +80 % of original span)
    const shiftX = ((mapOffsetX || 0) / 100) * origLonSpan * 0.7;
    const shiftY = ((-(mapOffsetY || 0)) / 100) * origLatSpan * 0.7;

    const targetCenterLat = centerLat + shiftY;
    const targetCenterLon = centerLon + shiftX;

    const targetSw = L.latLng(targetCenterLat - targetLatSpan / 2, targetCenterLon - targetLonSpan / 2);
    const targetNe = L.latLng(targetCenterLat + targetLatSpan / 2, targetCenterLon + targetLonSpan / 2);
    const fitBoundsTarget = L.latLngBounds(targetSw, targetNe);

    // Generous padding so the track doesn't touch poster edges at 1.0x
    const padBase = Math.max(10, trackPadding * 2.5);
    let padTop = padBase + (textLayout === 'top' ? 110 : 40);
    if (textLayout === 'top' && showElevationChart) {
      padTop += 50;
    }

    let padBottom = padBase + (textLayout === 'top' ? 40 : 160);
    if (textLayout !== 'top' && showElevationChart) {
      padBottom += 50;
    }

    let padLeft = padBase + 30;
    let padRight = padBase + 30;

    map.fitBounds(fitBoundsTarget, {
      paddingTopLeft: [padLeft, padTop],
      paddingBottomRight: [padRight, padBottom],
      animate: false,
    });

    const updateWaypointPositions = () => {
      if (!onMapUpdated) return;
      const size = map.getSize();
      const posMap = {};

      if (waypoints && points) {
        waypoints.forEach((wpt) => {
          const pt = getPointAtPercent(points, wpt.percent);
          if (pt && pt.lat != null && pt.lon != null) {
            const cp = map.latLngToContainerPoint([pt.lat, pt.lon]);
            posMap[wpt.id] = { x: cp.x, y: cp.y };
          }
        });
      }

      onMapUpdated({
        positions: posMap,
        size: { width: size.x, height: size.y },
      });
    };

    updateWaypointPositions();

    map.off('moveend zoomend resize', updateWaypointPositions);
    map.on('moveend zoomend resize', updateWaypointPositions);

    return () => {
      map.off('moveend zoomend resize', updateWaypointPositions);
    };
  }, [points, trackColor, trackWidth, trackOpacity, trackGlow, trackPadding, waypoints, textLayout, showElevationChart, elevationPosition, mapZoom, mapOffsetX, mapOffsetY, onMapUpdated]);

  if (!points || points.length === 0) return null;

  // Mask gradient style so the map fades out smoothly at top & bottom
  const getMaskStyle = () => {
    if (textLayout === 'top') {
      return {
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 65%, transparent 90%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 65%, transparent 90%)',
      };
    }
    return {
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 6%, black 58%, transparent 84%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 6%, black 58%, transparent 84%)',
    };
  };

  return (
    <div
      ref={mapContainerRef}
      className="absolute inset-4 sm:inset-6 pointer-events-none z-0 rounded-lg overflow-hidden transition-all duration-300"
      style={getMaskStyle()}
    />
  );
}
