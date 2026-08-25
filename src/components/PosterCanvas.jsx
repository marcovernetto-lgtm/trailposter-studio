import React, { useState, useEffect, useRef } from 'react';
import { getPointAtPercent, latLonToMercator } from '../lib/gpxParser';
import { MapLayer } from './MapLayer';
import { fetchVectorFeatures } from '../lib/overpassVector';
import { fetchElevationGrid, generateContours } from '../lib/elevationContours';

export function PosterCanvas({ trackData, config, canvasRef }) {
  const [realMapInfo, setRealMapInfo] = useState(null);
  const [vectorFeatures, setVectorFeatures] = useState(null);
  const [elevGrid, setElevGrid] = useState(null);
  const [contourPaths, setContourPaths] = useState(null);
  const [contourProgress, setContourProgress] = useState(0);
  const [contourLoading, setContourLoading] = useState(false);

  // Track identity to detect when a new GPX file is loaded
  const lastTrackRef = useRef(null);

  useEffect(() => {
    if (trackData && trackData.points && trackData.points.length > 0) {
      fetchVectorFeatures(trackData.points).then((data) => {
        setVectorFeatures(data);
      });
    }
  }, [trackData]);

  // Single consolidated effect for elevation data fetching
  useEffect(() => {
    // No track loaded → nothing to do
    if (!trackData || !trackData.points || trackData.points.length === 0) {
      setElevGrid(null);
      setContourPaths(null);
      setContourLoading(false);
      lastTrackRef.current = null;
      return;
    }

    // Topo disabled → clear contour visual but keep grid cached
    if (!config.showTopo) {
      setContourLoading(false);
      return;
    }

    // Detect if track or padding changed
    const trackId = `${trackData.points.length}_${trackData.points[0].lat.toFixed(4)}_${trackData.points[0].lon.toFixed(4)}_${config.trackPadding ?? 25}`;

    if (lastTrackRef.current !== trackId) {
      lastTrackRef.current = trackId;
      setElevGrid(null);
      setContourPaths(null);
    }

    let cancelled = false;
    setContourLoading(true);
    setContourProgress(0);

    fetchElevationGrid(trackData.points, { trackPadding: config.trackPadding }, (pct) => {
      if (!cancelled) setContourProgress(pct);
    })
      .then((grid) => {
        if (!cancelled && grid) {
          setElevGrid(grid);
        }
        if (!cancelled) setContourLoading(false);
      })
      .catch((err) => {
        console.warn('Elevation grid fetch failed:', err.message);
        if (!cancelled) setContourLoading(false);
      });

    return () => { cancelled = true; };
  }, [trackData, config.showTopo, config.trackPadding]);

  // Regenerate contour paths when grid or interval changes
  useEffect(() => {
    if (!elevGrid) {
      setContourPaths(null);
      return;
    }
    const contours = generateContours(elevGrid, {
      interval: config.contourInterval || 'auto',
      majorEvery: 5,
    });
    setContourPaths(contours);
  }, [elevGrid, config.contourInterval]);

  if (!trackData || !trackData.points || trackData.points.length === 0) {
    return (
      <div className="w-full aspect-[2/3] max-w-[560px] bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col items-center justify-center p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 rounded-full bg-teal-500/10 border border-teal-500/30 flex items-center justify-center mb-4 text-teal-400">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <p className="text-slate-300 font-medium text-lg mb-1">Nessun tracciato GPX caricato</p>
        <p className="text-slate-500 text-sm max-w-xs">Carica un file .gpx per generare il tuo poster personalizzato.</p>
      </div>
    );
  }

  const { points, stats } = trackData;

  // SVG viewBox dimensions (1000x1000 for track map area)
  const SVG_SIZE = 1000;
  const MARGIN = Math.max(15, Math.min(250, (config.trackPadding ?? 25) * 2.5));
  const DRAW_AREA = SVG_SIZE - MARGIN * 2;

  // Compute Bounding Box in Mercator coordinates to match track projection 1:1!
  let minMx = Infinity, maxMx = -Infinity;
  let minMy = Infinity, maxMy = -Infinity;
  points.forEach((p) => {
    const mx = p.mx != null ? p.mx : latLonToMercator(p.lat, p.lon).x;
    const my = p.my != null ? p.my : latLonToMercator(p.lat, p.lon).y;
    if (mx < minMx) minMx = mx;
    if (mx > maxMx) maxMx = mx;
    if (my < minMy) minMy = my;
    if (my > maxMy) maxMy = my;
  });

  const widthMx = maxMx - minMx || 1;
  const heightMy = maxMy - minMy || 1;
  const maxDim = Math.max(widthMx, heightMy);

  const offsetX = (maxDim - widthMx) / 2;
  const offsetY = (maxDim - heightMy) / 2;

  // 1:1 Mercator geographical projection matching track points
  const projectLatLonToSvg = (lat, lon) => {
    const m = latLonToMercator(lat, lon);
    const normX = (m.x - minMx + offsetX) / maxDim;
    const normY = 1 - (m.y - minMy + offsetY) / maxDim;
    return {
      x: MARGIN + normX * DRAW_AREA,
      y: MARGIN + normY * DRAW_AREA,
    };
  };

  // Convert normalized [0, 1] points to SVG coordinates
  const svgPoints = points.map((p) => ({
    x: MARGIN + p.nx * DRAW_AREA,
    y: MARGIN + p.ny * DRAW_AREA,
    ele: p.ele,
  }));

  // Build SVG Path 'd' string
  const pathD = svgPoints.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, '');

  // Render Minimalist Vector Geographical Map Layer (Boundaries, Towns, Peaks with Elevation)
  const renderVectorMapFeatures = () => {
    if (!config.showVectorMap || !vectorFeatures) return null;
    const { boundaries = [], places = [], peaks = [], regions = [] } = vectorFeatures;
    const baseFontSize = config.vectorTextSize || 15;

    const occupiedLabels = [];

    const isColliding = (y, height = 28) => {
      return occupiedLabels.some((box) => Math.abs(box.y - y) < height);
    };

    const findNonCollidingY = (initialY, height = 28) => {
      let y = initialY;
      let step = 0;
      while (isColliding(y, height) && step < 6) {
        step++;
        y = initialY + (step % 2 === 1 ? step * 18 : -step * 18);
      }
      return y;
    };

    const getTrackXAtY = (targetY) => {
      if (!svgPoints || svgPoints.length === 0) return 500;
      let closestPt = svgPoints[0];
      let minDiff = Math.abs(svgPoints[0].y - targetY);
      for (let i = 1; i < svgPoints.length; i++) {
        const diff = Math.abs(svgPoints[i].y - targetY);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = svgPoints[i];
        }
      }
      return closestPt.x;
    };

    return (
      <g className="vector-minimal-map-layer">
        {/* 1. Regional / State Labels */}
        {config.showVectorRegions && regions.map((reg) => {
          const pt = projectLatLonToSvg(reg.lat, reg.lon);
          const safeY = Math.max(180, Math.min(760, pt.y));
          return (
            <text
              key={reg.id}
              x={pt.x}
              y={safeY}
              fill={config.textColor}
              opacity={0.3}
              fontSize={baseFontSize * 1.8}
              fontWeight="300"
              letterSpacing="6"
              fontFamily={currentFontFamily}
              textAnchor="middle"
              className="uppercase select-none pointer-events-none"
            >
              {reg.name}
            </text>
          );
        })}

        {/* 2. Administrative Boundary Lines */}
        {config.showVectorBoundaries && boundaries.map((bnd) => {
          if (!bnd.points || bnd.points.length < 2) return null;
          const bndPath = bnd.points.map((p, idx) => {
            const pt = projectLatLonToSvg(p.lat, p.lon);
            return idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
          }).join(' ');

          return (
            <path
              key={bnd.id}
              d={bnd.path || bndPath}
              fill="none"
              stroke={config.textColor}
              strokeWidth="1.2"
              strokeDasharray="4 4"
              opacity="0.4"
            />
          );
        })}

        {/* 3. Nearby Towns / Cities */}
        {config.showVectorPlaces && places.map((place) => {
          const pt = projectLatLonToSvg(place.lat, place.lon);
          if (pt.y < 120 || pt.y > 800) return null;

          const trackX = getTrackXAtY(pt.y);
          const isLeftOfTrack = pt.x < trackX;
          const labelY = findNonCollidingY(pt.y, 28);
          occupiedLabels.push({ y: labelY });

          const textAnchor = isLeftOfTrack ? 'end' : 'start';
          const textX = isLeftOfTrack ? pt.x - 10 : pt.x + 10;

          return (
            <g key={place.id} className="place-item">
              <circle
                cx={pt.x}
                cy={pt.y}
                r="3.5"
                fill={config.textColor}
                opacity="0.85"
              />
              <text
                x={textX}
                y={labelY + 4}
                textAnchor={textAnchor}
                fill={config.textColor}
                fontSize={baseFontSize}
                fontWeight="500"
                fontFamily={currentFontFamily}
                opacity="0.85"
              >
                {place.name}
              </text>
            </g>
          );
        })}

        {/* 4. Mountain Peaks with Elevation */}
        {config.showVectorPeaks && peaks.map((peak) => {
          const pt = projectLatLonToSvg(peak.lat, peak.lon);
          if (pt.y < 130 || pt.y > 790) return null;

          const trackX = getTrackXAtY(pt.y);
          const isLeftOfTrack = pt.x < trackX;
          const labelY = findNonCollidingY(pt.y, 34);
          occupiedLabels.push({ y: labelY });

          const textAnchor = isLeftOfTrack ? 'end' : 'start';
          const textX = isLeftOfTrack ? pt.x - 12 : pt.x + 12;
          const nameSize = baseFontSize * 0.95;
          const eleSize = baseFontSize * 0.8;

          return (
            <g key={peak.id} className="peak-item">
              <polygon
                points={`${pt.x},${pt.y - 7} ${pt.x - 5},${pt.y + 2} ${pt.x + 5},${pt.y + 2}`}
                fill="none"
                stroke={config.textColor}
                strokeWidth="1.4"
                opacity="0.9"
              />
              <text
                x={textX}
                y={labelY}
                textAnchor={textAnchor}
                fill={config.textColor}
                fontSize={nameSize}
                fontWeight="600"
                fontFamily={currentFontFamily}
                opacity="0.9"
              >
                {peak.name}
              </text>
              {peak.ele && (
                <text
                  x={textX}
                  y={labelY + eleSize + 2}
                  textAnchor={textAnchor}
                  fill={config.textColor}
                  fontSize={eleSize}
                  fontFamily="monospace"
                  opacity="0.75"
                >
                  {peak.ele}m
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Font family CSS map
  const fontMap = {
    'Outfit': "'Outfit', sans-serif",
    'Inter': "'Inter', sans-serif",
    'Cinzel': "'Cinzel', serif",
    'Playfair Display': "'Playfair Display', serif",
    'Space Grotesk': "'Space Grotesk', sans-serif",
    'JetBrains Mono': "'JetBrains Mono', monospace",
  };

  const currentFontFamily = fontMap[config.fontFamily] || fontMap['Outfit'];

  // Background style (Solid or Preset Gradient)
  const getBgStyle = () => {
    if (config.bgType === 'gradient') {
      return { background: config.bgGradient };
    }
    return { backgroundColor: config.bgColor };
  };

  // Real Topographic Contour Layer — rendered from DEM elevation data
  const renderTopographicLayer = () => {
    if (!config.showTopo) return null;

    // Show loading indicator while fetching elevation data
    if (contourLoading) {
      return (
        <g className="topo-layer">
          <text
            x="500"
            y="500"
            textAnchor="middle"
            fill={config.textColor}
            fontSize="14"
            fontFamily="monospace"
            opacity="0.5"
          >
            Caricamento dati altimetrici... {contourProgress}%
          </text>
        </g>
      );
    }

    // No contour data yet — return nothing
    if (!contourPaths || contourPaths.length === 0 || !elevGrid) return null;

    const opacity = config.topoOpacity || 0.15;
    const style = config.contourStyle || 'medium';
    const strokeWidthMinor = style === 'bold' ? 1.0 : style === 'medium' ? 0.7 : 0.4;
    const strokeWidthMajor = style === 'bold' ? 2.0 : style === 'medium' ? 1.4 : 0.9;

    const contourStrokeColor =
      config.contourColorMode === 'track'
        ? config.trackColor
        : config.contourColorMode === 'custom'
        ? config.contourCustomColor || config.textColor
        : config.textColor;

    return (
      <g
        className="topo-layer real-contours"
        mask="url(#topo-gradient-fade-mask)"
      >
        <g mask="url(#topo-horizontal-fade-mask)">
          {contourPaths.map((c, idx) => (
          <g key={`contour-${idx}`}>
            <path
              d={c.pathD}
              fill="none"
              stroke={contourStrokeColor}
              strokeWidth={c.isMajor ? strokeWidthMajor : strokeWidthMinor}
              opacity={c.isMajor ? Math.min(1, opacity * 1.8) : opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Elevation label on major contours */}
            {c.isMajor && config.showContourLabels && (() => {
              const pathStr = c.pathD;
              const matches = pathStr.match(/[\d.-]+\s+[\d.-]+/g);
              if (!matches || matches.length < 2) return null;
              const midIdx = Math.floor(matches.length / 2);
              const parts = matches[midIdx].trim().split(/\s+/).map(Number);
              const mx = parts[0];
              const my = parts[1];
              if (isNaN(mx) || isNaN(my) || mx < 50 || mx > 950 || my < 50 || my > 950) return null;
              return (
                <text
                  x={mx}
                  y={my - 3}
                  fill={contourStrokeColor}
                  fontSize="9"
                  fontFamily="monospace"
                  opacity={Math.min(1, opacity * 3.0)}
                  textAnchor="middle"
                >
                  {c.elevation}m
                </text>
              );
            })()}
          </g>
        ))}
        </g>
      </g>
    );
  };

  // Topographic Coordinate Reticolo / UTM crosshair markers (+)
  const renderCoordinateGrid = () => {
    if (!config.showGrid) return null;
    return (
      <g className="topo-reticolo pointer-events-none" opacity="0.35">
        {[250, 500, 750].map((gx) =>
          [250, 500, 750].map((gy) => (
            <g key={`grid-cross-${gx}-${gy}`}>
              <line x1={gx - 7} y1={gy} x2={gx + 7} y2={gy} stroke={config.textColor} strokeWidth="0.8" />
              <line x1={gx} y1={gy - 7} x2={gx} y2={gy + 7} stroke={config.textColor} strokeWidth="0.8" />
            </g>
          ))
        )}
      </g>
    );
  };

  // Helper to render track line (single color OR multi-color by stage segments)
  const renderTrackSegments = () => {
    if (!config.multiColorStages || !config.waypoints || config.waypoints.length === 0) {
      return (
        <g key="single-track">
          {config.trackGlow && (
            <path
              d={pathD}
              fill="none"
              stroke={config.trackColor}
              strokeWidth={config.trackWidth * 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={config.trackOpacity * 0.45}
              filter="url(#track-glow)"
            />
          )}
          <path
            d={pathD}
            fill="none"
            stroke={config.trackColor}
            strokeWidth={config.trackWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={config.trackOpacity}
          />
        </g>
      );
    }

    const sortedWpts = [...config.waypoints].sort((a, b) => a.percent - b.percent);
    const breakIndices = [0];
    sortedWpts.forEach((w) => {
      const idx = Math.min(svgPoints.length - 1, Math.max(0, Math.floor(w.percent * (svgPoints.length - 1))));
      if (idx > breakIndices[breakIndices.length - 1]) {
        breakIndices.push(idx);
      }
    });
    if (breakIndices[breakIndices.length - 1] < svgPoints.length - 1) {
      breakIndices.push(svgPoints.length - 1);
    }

    const defaultColors = ['#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#ef4444', '#06b6d4'];
    const colors = config.stageColors && config.stageColors.length > 0 ? config.stageColors : defaultColors;

    const segments = [];
    for (let i = 0; i < breakIndices.length - 1; i++) {
      const startIdx = breakIndices[i];
      const endIdx = breakIndices[i + 1];
      const segPoints = svgPoints.slice(startIdx, endIdx + 1);

      if (segPoints.length < 2) continue;

      const segPathD = segPoints.reduce((acc, p, idx) => {
        return idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }, '');

      const segColor = colors[i % colors.length] || config.trackColor;

      segments.push(
        <g key={`stage-seg-${i}`}>
          {config.trackGlow && (
            <path
              d={segPathD}
              fill="none"
              stroke={segColor}
              strokeWidth={config.trackWidth * 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={config.trackOpacity * 0.45}
            />
          )}
          <path
            d={segPathD}
            fill="none"
            stroke={segColor}
            strokeWidth={config.trackWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={config.trackOpacity}
          />
        </g>
      );
    }

    return <g key="multi-stage-track">{segments}</g>;
  };

  // Render Elevation Profile Mini Chart with Waypoint Dots
  const renderElevationProfile = () => {
    if (!config.showElevationChart) return null;
    const chartHeight = 45;
    const chartWidth = 750;
    const minE = stats.minEleM || 0;
    const maxE = stats.maxEleM || 1;
    const rangeE = maxE - minE || 1;

    const step = Math.max(1, Math.floor(points.length / 80));
    const sampled = points.filter((_, i) => i % step === 0);

    const chartPoints = sampled.map((p, idx) => {
      const cx = (idx / (sampled.length - 1)) * chartWidth;
      const cy = chartHeight - ((p.ele - minE) / rangeE) * chartHeight;
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    });

    const chartD = `M 0,${chartHeight} L ${chartPoints.join(' L ')} L ${chartWidth},${chartHeight} Z`;
    const style = config.elevationStyle || 'gradient';
    const eleColor = config.elevationColor || config.trackColor;

    return (
      <div className="w-full max-w-[80%] mx-auto mt-3 mb-1.5 opacity-80">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full overflow-visible">
          <defs>
            <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={eleColor} stopOpacity="0.45" />
              <stop offset="100%" stopColor={eleColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {style === 'fill' && <path d={chartD} fill={eleColor} opacity="0.3" />}
          {style === 'gradient' && <path d={chartD} fill="url(#eleGrad)" />}
          <path
            d={`M ${chartPoints.join(' L ')}`}
            fill="none"
            stroke={eleColor}
            strokeWidth={style === 'line' ? '2.0' : '1.5'}
            opacity="0.95"
          />

          {/* Plotted Waypoint Dots on Elevation Profile (only glowing dots, no text labels) */}
          {config.showElevationWaypoints && config.waypoints && config.waypoints.map((wpt, wIdx) => {
            const pt = getPointAtPercent(points, wpt.percent);
            if (!pt) return null;
            const cx = (wpt.percent / 100) * chartWidth;
            const cy = chartHeight - ((pt.ele - minE) / rangeE) * chartHeight;

            return (
              <g key={`ele-wpt-${wpt.id || wIdx}`}>
                <circle cx={cx} cy={cy} r="4" fill={config.trackColor} stroke={config.textColor} strokeWidth="1.5" />
                <circle cx={cx} cy={cy} r="1.5" fill="#ffffff" />
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Render Decorative Header/Footer Divider
  const renderDivider = () => {
    const icon = config.dividerIcon || 'mountain';
    if (icon === 'none') return null;

    return (
      <div className="flex items-center justify-center gap-4 max-w-[60%] mx-auto opacity-40 my-1">
        <span className="h-[1px] flex-1 bg-current" />
        {icon === 'mountain' && (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        )}
        {icon === 'compass' && (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9" />
          </svg>
        )}
        {icon === 'diamond' && (
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="12,2 22,12 12,22 2,12" />
          </svg>
        )}
        {icon === 'dots' && (
          <div className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-current" />
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span className="w-1 h-1 rounded-full bg-current" />
          </div>
        )}
        {icon === 'line' && null}
        <span className="h-[1px] flex-1 bg-current" />
      </div>
    );
  };

  // Render Decorative Border Frame
  const renderFrameBorder = () => {
    const style = config.borderStyle ?? (config.showBorder ? 'classic' : 'none');
    if (style === 'none') return null;

    const bColor = config.textColor;
    const bOpacity = config.borderOpacity || 0.15;

    if (style === 'classic') {
      return (
        <div
          className="absolute inset-4 sm:inset-6 rounded-lg pointer-events-none z-20 transition-colors"
          style={{ border: `1px solid ${bColor}`, opacity: bOpacity }}
        />
      );
    }

    if (style === 'double') {
      return (
        <>
          <div
            className="absolute inset-4 sm:inset-6 rounded-lg pointer-events-none z-20"
            style={{ border: `1.5px solid ${bColor}`, opacity: bOpacity }}
          />
          <div
            className="absolute inset-6 sm:inset-8 rounded-md pointer-events-none z-20"
            style={{ border: `0.75px solid ${bColor}`, opacity: bOpacity * 0.7 }}
          />
        </>
      );
    }

    if (style === 'corners') {
      const cSize = 24;
      return (
        <div className="absolute inset-4 sm:inset-6 pointer-events-none z-20" style={{ opacity: bOpacity * 1.8 }}>
          <svg className="absolute top-0 left-0" width={cSize} height={cSize}>
            <path d={`M 0 ${cSize} L 0 0 L ${cSize} 0`} fill="none" stroke={bColor} strokeWidth="1.75" />
          </svg>
          <svg className="absolute top-0 right-0" width={cSize} height={cSize}>
            <path d={`M 0 0 L ${cSize} 0 L ${cSize} ${cSize}`} fill="none" stroke={bColor} strokeWidth="1.75" />
          </svg>
          <svg className="absolute bottom-0 left-0" width={cSize} height={cSize}>
            <path d={`M 0 0 L 0 ${cSize} L ${cSize} ${cSize}`} fill="none" stroke={bColor} strokeWidth="1.75" />
          </svg>
          <svg className="absolute bottom-0 right-0" width={cSize} height={cSize}>
            <path d={`M 0 ${cSize} L ${cSize} ${cSize} L ${cSize} 0`} fill="none" stroke={bColor} strokeWidth="1.75" />
          </svg>
        </div>
      );
    }

    if (style === 'vintage') {
      return (
        <div
          className="absolute inset-4 sm:inset-6 rounded-none pointer-events-none z-20"
          style={{ border: `1px solid ${bColor}`, opacity: bOpacity }}
        >
          <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full" style={{ backgroundColor: bColor, opacity: bOpacity * 2 }} />
          <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ backgroundColor: bColor, opacity: bOpacity * 2 }} />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full" style={{ backgroundColor: bColor, opacity: bOpacity * 2 }} />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full" style={{ backgroundColor: bColor, opacity: bOpacity * 2 }} />
        </div>
      );
    }

    return null;
  };

  // Render Compass Rose Minimalist Icon Overlay
  const renderCompass = () => {
    if (!config.showCompass) return null;
    const pos = config.compassPosition || 'top_right';
    let posClass = 'top-10 right-10';
    if (pos === 'top_left') posClass = 'top-10 left-10';
    if (pos === 'bottom_left') posClass = 'bottom-28 left-10';
    if (pos === 'bottom_right') posClass = 'bottom-28 right-10';

    return (
      <div className={`absolute ${posClass} z-20 pointer-events-none opacity-60 transition-all duration-300`}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="18" stroke={config.textColor} strokeWidth="1" strokeDasharray="2 2" />
          <polygon points="20,6 24,19 20,16 16,19" fill={config.textColor} />
          <polygon points="20,34 24,21 20,24 16,21" fill={config.textColor} opacity="0.4" />
          <text x="20" y="4" textAnchor="middle" fill={config.textColor} fontSize="8" fontWeight="bold" fontFamily="sans-serif">N</text>
        </svg>
      </div>
    );
  };

  // Render Waypoints markers & text
  const renderWaypoints = (isRealMap) => {
    if (!config.waypoints || config.waypoints.length === 0) return null;
    const totalDistKm = parseFloat(stats.totalDistanceKm) || (points[points.length - 1]?.cumDistance ? points[points.length - 1].cumDistance / 1000 : 0);

    const wptFont = config.waypointFont && config.waypointFont !== 'inherit'
      ? fontMap[config.waypointFont] || currentFontFamily
      : currentFontFamily;

    const fontSize = config.waypointFontSize || 15;

    return config.waypoints.map((wpt, idx) => {
      let wx, wy;

      if (isRealMap && realMapInfo && realMapInfo.positions && realMapInfo.positions[wpt.id]) {
        const pos = realMapInfo.positions[wpt.id];
        const mW = realMapInfo.size.width;
        wx = (pos.x / mW) * 1000;
        wy = (pos.y / mW) * 1000;
      } else {
        const pt = getPointAtPercent(points, wpt.percent);
        wx = MARGIN + pt.nx * DRAW_AREA;
        wy = MARGIN + pt.ny * DRAW_AREA;
      }

      const pos = wpt.textOffset || wpt.textPosition || 'top';
      let tx = wx;
      let ty = wy;
      let textAnchor = 'middle';
      const offsetPx = 25;

      if (pos === 'top') {
        ty = wy - offsetPx;
      } else if (pos === 'bottom') {
        ty = wy + offsetPx + 6;
      } else if (pos === 'left') {
        tx = wx - offsetPx;
        ty = wy + 5;
        textAnchor = 'end';
      } else if (pos === 'right') {
        tx = wx + offsetPx;
        ty = wy + 5;
        textAnchor = 'start';
      }

      const nameLength = wpt.name ? wpt.name.length : 8;
      const approxTextWidth = nameLength * (fontSize * 0.65);

      if (textAnchor === 'end' && (tx - approxTextWidth) < 45) {
        tx = wx + offsetPx;
        textAnchor = 'start';
      } else if (textAnchor === 'start' && (tx + approxTextWidth) > 955) {
        tx = wx - offsetPx;
        textAnchor = 'end';
      } else if (textAnchor === 'middle') {
        if (tx - approxTextWidth / 2 < 45) {
          tx = 45 + approxTextWidth / 2;
        } else if (tx + approxTextWidth / 2 > 955) {
          tx = 955 - approxTextWidth / 2;
        }
      }

      const wptKm = (wpt.percent * totalDistKm).toFixed(1);
      const markerStyle = wpt.markerStyle || 'solid';

      return (
        <g key={wpt.id || idx} className="waypoint-marker-group">
          {/* 1. SOLID (Glowing dot with outer halo) */}
          {markerStyle === 'solid' && (
            <>
              <circle cx={wx} cy={wy} r="10" fill={config.textColor} opacity="0.25" />
              <circle cx={wx} cy={wy} r="6" fill={config.trackColor} stroke={config.textColor} strokeWidth="1.5" />
            </>
          )}

          {/* 2. CIRCLE (Minimal ring) */}
          {markerStyle === 'circle' && (
            <circle
              cx={wx}
              cy={wy}
              r="8"
              fill={config.bgColor || '#0f172a'}
              stroke={config.trackColor}
              strokeWidth="3"
            />
          )}

          {/* 3. RING (Dashed outer ring + central dot) */}
          {markerStyle === 'ring' && (
            <g>
              <circle cx={wx} cy={wy} r="13" fill="none" stroke={config.trackColor} strokeWidth="2" strokeDasharray="3 2.5" />
              <circle cx={wx} cy={wy} r="4.5" fill={config.textColor} />
            </g>
          )}

          {/* 4. PIN (Map pin marker) */}
          {markerStyle === 'pin' && (
            <g transform={`translate(${wx - 10}, ${wy - 22})`}>
              <path
                d="M10 2C6.69 2 4 4.69 4 8c0 4.5 6 11 6 11s6-6.5 6-11c0-3.31-2.69-6-6-6zm0 8.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z"
                fill={config.trackColor}
                stroke={config.textColor}
                strokeWidth="1"
              />
            </g>
          )}

          {/* 5. DIAMOND (Sleek cartographic diamond) */}
          {markerStyle === 'diamond' && (
            <polygon
              points={`${wx},${wy - 9} ${wx + 7},${wy} ${wx},${wy + 9} ${wx - 7},${wy}`}
              fill={config.trackColor}
              stroke={config.textColor}
              strokeWidth="1.5"
            />
          )}

          {/* 6. NUMBER (Numbered badge 1, 2, 3...) */}
          {markerStyle === 'number' && (
            <g>
              <circle cx={wx} cy={wy} r="10" fill={config.trackColor} stroke={config.textColor} strokeWidth="1.5" />
              <text
                x={wx}
                y={wy + 3.5}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="10"
                fontWeight="bold"
                fontFamily="sans-serif"
              >
                {idx + 1}
              </text>
            </g>
          )}

          {/* Waypoint Text Label */}
          {wpt.name && (
            <g>
              {/* Subtle background glow/plate for supreme legibility */}
              <text
                x={tx}
                y={ty}
                textAnchor={textAnchor}
                fill={config.bgColor || '#0f172a'}
                stroke={config.bgColor || '#0f172a'}
                strokeWidth="4"
                strokeLinejoin="round"
                fontSize={fontSize}
                fontWeight="600"
                fontFamily={wptFont}
                letterSpacing="1"
                opacity="0.9"
              >
                {wpt.name}
              </text>

              <text
                x={tx}
                y={ty}
                textAnchor={textAnchor}
                fill={config.textColor}
                fontSize={fontSize}
                fontWeight="600"
                fontFamily={wptFont}
                letterSpacing="1"
                opacity="0.95"
              >
                {wpt.name}
              </text>

              {config.showWaypointKm && (
                <text
                  x={tx}
                  y={ty + 14}
                  textAnchor={textAnchor}
                  fill={config.textColor}
                  fontSize={Math.max(10, fontSize * 0.75)}
                  fontFamily="monospace"
                  opacity="0.75"
                >
                  KM {wptKm}
                </text>
              )}
            </g>
          )}
        </g>
      );
    });
  };

  const realMapSvgHeight = realMapInfo && realMapInfo.size
    ? (realMapInfo.size.height / realMapInfo.size.width) * 1000
    : 1500;

  const isLandscape = config.orientation === 'landscape';
  const isTransparent = config.bgType === 'transparent' || config.bgColor === 'transparent';
  const backgroundStyle = isTransparent
    ? 'transparent'
    : config.bgType === 'gradient'
    ? config.bgGradient
    : (config.bgColor || '#16181e');

  // Returns exact CSS classes to match the innermost boundary of the selected frame
  const getInnermostFrameClasses = () => {
    const style = config.borderStyle ?? (config.showBorder ? 'classic' : 'none');
    if (style === 'none') return 'inset-0 rounded-xl';
    if (style === 'double') return 'inset-6 sm:inset-8 rounded-md';
    if (style === 'vintage') return 'inset-4 sm:inset-6 rounded-none';
    if (style === 'corners') return 'inset-4 sm:inset-6 rounded-none';
    return 'inset-4 sm:inset-6 rounded-lg'; // 'classic'
  };

  return (
    <div
      ref={canvasRef}
      id="poster-canvas-element"
      style={{
        background: backgroundStyle,
        fontFamily: currentFontFamily,
        color: config.textColor,
        borderColor: isTransparent ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
      }}
      className={`w-full ${
        isLandscape ? 'aspect-[7/5] max-w-[880px] p-6 sm:p-10' : 'aspect-[5/7] max-w-[580px] p-8 sm:p-12'
      } shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] rounded-xl relative overflow-hidden flex flex-col justify-between transition-all duration-300 select-none ${
        isTransparent ? 'border border-dashed border-white/20' : ''
      }`}
    >
      {/* FRAME-BOUNDED MAP & TOPO LAYER (Clipped exactly to selected frame's innermost line) */}
      <div className={`absolute ${getInnermostFrameClasses()} overflow-hidden pointer-events-none z-0 flex items-center justify-center`}>
        {/* Real Minimalist Map Background Layer */}
        {config.showRealMap && (
          <MapLayer
            points={points}
            mapStyle={config.realMapStyle || 'voyager'}
            opacity={config.realMapOpacity || 0.6}
            trackColor={config.trackColor}
            trackWidth={config.trackWidth}
            trackOpacity={config.trackOpacity}
            trackGlow={config.trackGlow}
            trackPadding={config.trackPadding ?? 25}
            waypoints={config.waypoints}
            textColor={config.textColor}
            textLayout={config.textLayout}
            showElevationChart={config.showElevationChart}
            elevationPosition={config.elevationPosition}
            mapZoom={config.mapZoom || 1.0}
            mapOffsetX={config.mapOffsetX || 0}
            mapOffsetY={config.mapOffsetY || 0}
            onMapUpdated={setRealMapInfo}
          />
        )}

        {/* Real Map Full-Bleed Waypoint SVG Overlay */}
        {config.showRealMap && (
          <div className="absolute inset-0 w-full h-full pointer-events-none z-10">
            <svg
              viewBox={`0 0 1000 ${realMapSvgHeight}`}
              className="w-full h-full overflow-visible"
            >
              {renderWaypoints(true)}
            </svg>
          </div>
        )}

        {/* Vector Topo DEM & Track Layer */}
        {!config.showRealMap && (() => {
          const zF = Math.max(0.3, config.mapZoom || 1.0);
          const svgBoxW = SVG_SIZE / zF;
          const svgBoxH = SVG_SIZE / zF;
          const svgBoxX = (SVG_SIZE - svgBoxW) / 2 + ((config.mapOffsetX || 0) / 100) * (SVG_SIZE * 0.4);
          const svgBoxY = (SVG_SIZE - svgBoxH) / 2 + ((config.mapOffsetY || 0) / 100) * (SVG_SIZE * 0.4);

          const edgeFadeVal = typeof config.contourEdgeFade === 'number'
            ? config.contourEdgeFade
            : config.contourEdgeFade === 'strong' ? 18 : config.contourEdgeFade === 'light' ? 6 : config.contourEdgeFade === 'none' ? 0 : 12;

          const titleFadeVal = typeof config.contourFade === 'number'
            ? config.contourFade
            : config.contourFade === 'strong' ? 35 : config.contourFade === 'light' ? 15 : config.contourFade === 'none' ? 0 : 25;

          return (
            <svg
              viewBox={`${svgBoxX} ${svgBoxY} ${svgBoxW} ${svgBoxH}`}
              className="w-full h-full overflow-visible pointer-events-auto"
            >
              <defs>
                {/* Horizontal Edge Feathering */}
                <linearGradient id="topo-fade-h" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
                  {edgeFadeVal <= 0 ? (
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                  ) : (() => {
                    const lMid = (edgeFadeVal * 0.5).toFixed(1);
                    const rMid = (100 - edgeFadeVal * 0.5).toFixed(1);
                    return (
                      <>
                        <stop offset="0%" stopColor="white" stopOpacity="0" />
                        <stop offset={`${lMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset={`${edgeFadeVal}%`} stopColor="white" stopOpacity="1" />
                        <stop offset={`${100 - edgeFadeVal}%`} stopColor="white" stopOpacity="1" />
                        <stop offset={`${rMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                      </>
                    );
                  })()}
                </linearGradient>

                <mask id="topo-horizontal-fade-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
                  <rect x="0" y="0" width="1000" height="1000" fill={edgeFadeVal <= 0 ? 'white' : 'url(#topo-fade-h)'} />
                </mask>

                {/* Vertical Edge & Title Avoidance Feathering (Truly proportional & smooth) */}
                <linearGradient id="topo-fade-grad" x1="0" y1="0" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
                  {config.textLayout === 'top' && (() => {
                    if (titleFadeVal <= 0) {
                      return <stop offset="0%" stopColor="white" stopOpacity="1" />;
                    }
                    const fStart = Math.max(0, titleFadeVal * 0.1);
                    const fEnd = Math.min(60, titleFadeVal * 0.75);
                    const fMid = ((fStart + fEnd) / 2).toFixed(1);
                    return (
                      <>
                        <stop offset="0%" stopColor="white" stopOpacity="0" />
                        <stop offset={`${fStart.toFixed(1)}%`} stopColor="white" stopOpacity="0" />
                        <stop offset={`${fMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset={`${fEnd.toFixed(1)}%`} stopColor="white" stopOpacity="1" />
                        <stop offset="100%" stopColor="white" stopOpacity="1" />
                      </>
                    );
                  })()}
                  {config.textLayout === 'split' && (() => {
                    if (titleFadeVal <= 0) {
                      return <stop offset="0%" stopColor="white" stopOpacity="1" />;
                    }
                    const tEnd = Math.min(30, titleFadeVal * 0.4);
                    const tMid = (tEnd * 0.5).toFixed(1);
                    const bStart = Math.max(70, 100 - titleFadeVal * 0.4);
                    const bMid = (bStart + (100 - bStart) * 0.5).toFixed(1);
                    return (
                      <>
                        <stop offset="0%" stopColor="white" stopOpacity="0" />
                        <stop offset={`${tMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset={`${tEnd.toFixed(1)}%`} stopColor="white" stopOpacity="1" />
                        <stop offset={`${bStart.toFixed(1)}%`} stopColor="white" stopOpacity="1" />
                        <stop offset={`${bMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                      </>
                    );
                  })()}
                  {config.textLayout === 'minimal' && (
                    <>
                      <stop offset="0%" stopColor="white" stopOpacity="1" />
                      <stop offset="100%" stopColor="white" stopOpacity="1" />
                    </>
                  )}
                  {(config.textLayout === 'bottom' || !config.textLayout) && (() => {
                    if (titleFadeVal <= 0) {
                      return <stop offset="100%" stopColor="white" stopOpacity="1" />;
                    }
                    const fStart = Math.max(40, 100 - titleFadeVal * 0.75);
                    const fEnd = Math.min(100, 100 - titleFadeVal * 0.1);
                    const fMid = ((fStart + fEnd) / 2).toFixed(1);
                    return (
                      <>
                        <stop offset="0%" stopColor="white" stopOpacity="1" />
                        <stop offset={`${fStart.toFixed(1)}%`} stopColor="white" stopOpacity="1" />
                        <stop offset={`${fMid}%`} stopColor="white" stopOpacity="0.5" />
                        <stop offset={`${fEnd.toFixed(1)}%`} stopColor="white" stopOpacity="0" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                      </>
                    );
                  })()}
                </linearGradient>

                <mask id="topo-gradient-fade-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
                  <rect x="0" y="0" width="1000" height="1000" fill={titleFadeVal <= 0 ? 'white' : 'url(#topo-fade-grad)'} />
                </mask>

                {/* Track Glow Filter */}
                <filter id="track-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation={config.trackGlow ? config.trackWidth * 1.8 : 0} result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {renderTopographicLayer()}
              {renderCoordinateGrid()}
              {renderVectorMapFeatures()}
              {renderTrackSegments()}
              {renderWaypoints(false)}
            </svg>
          );
        })()}
      </div>

      {renderCompass()}
      {renderFrameBorder()}

      {/* TOP HEADER SECTION (When layout is 'top' or 'split') */}
      {(config.textLayout === 'top' || config.textLayout === 'split') && (
        <div className="text-center z-10 space-y-2.5 pt-2 pb-3">
          {renderDivider()}
          <h1
            className="font-extrabold uppercase tracking-[0.2em] leading-tight drop-shadow-md"
            style={{
              fontSize: `${config.titleFontSize}px`,
              letterSpacing: `${config.letterSpacing}px`,
            }}
          >
            {config.title || stats.name}
          </h1>
          <p className="text-xs sm:text-sm uppercase tracking-[0.25em] font-medium opacity-80">
            {config.subtitle}
          </p>
          {config.textLayout === 'top' && config.details && (
            <div className="flex items-center justify-center space-x-3 text-[11px] font-mono tracking-widest opacity-60">
              <span className="h-[1px] w-6 bg-current opacity-30" />
              <p>{config.details}</p>
              <span className="h-[1px] w-6 bg-current opacity-30" />
            </div>
          )}
          {config.textLayout === 'top' && config.elevationPosition === 'above_text' && renderElevationProfile()}
        </div>
      )}

      {/* MINIMAL TOP BADGE (When layout is 'minimal') */}
      {config.textLayout === 'minimal' && (
        <div className="z-10 flex items-center justify-between pt-1">
          <div className="text-left">
            <h1
              className="font-extrabold uppercase tracking-wider leading-tight drop-shadow-sm"
              style={{
                fontSize: `${Math.max(18, config.titleFontSize * 0.75)}px`,
                letterSpacing: `${Math.max(2, config.letterSpacing * 0.6)}px`,
              }}
            >
              {config.title || stats.name}
            </h1>
            <p className="text-[11px] uppercase tracking-widest font-medium opacity-70">
              {config.subtitle}
            </p>
          </div>
          {stats.startLatLon && (
            <div className="text-right text-[9px] font-mono opacity-50 tracking-wider">
              <p>{stats.totalDistanceKm} KM • +{stats.elevationGainM}M</p>
              <p>{stats.startLatLon}</p>
            </div>
          )}
        </div>
      )}

      {/* CENTRAL SPACER (Maintains vertical layout balance) */}
      <div className="relative flex-1 w-full my-auto pointer-events-none" />

      {/* BOTTOM FOOTER SECTION (When layout is 'bottom' or 'split') */}
      {config.textLayout !== 'top' && config.textLayout !== 'minimal' && (
        <div className="text-center z-10 space-y-2.5 pt-3 pb-2">
          {renderDivider()}

          {/* Render Elevation Profile ABOVE text if requested */}
          {config.elevationPosition === 'above_text' && renderElevationProfile()}

          {/* Main Title (if not in split mode where title is at top) */}
          {config.textLayout !== 'split' && config.title && (
            <h1
              className="font-extrabold tracking-widest leading-tight uppercase drop-shadow-sm"
              style={{
                fontSize: `${config.titleFontSize}px`,
                letterSpacing: `${config.letterSpacing}px`,
              }}
            >
              {config.title}
            </h1>
          )}

          {/* Subtitle */}
          {config.textLayout !== 'split' && config.subtitle && (
            <p className="text-xs sm:text-sm font-normal tracking-widest opacity-85 uppercase">
              {config.subtitle}
            </p>
          )}

          {/* Details / Stats */}
          {config.details && (
            <p className="text-[11px] sm:text-xs font-mono tracking-wider opacity-70">
              {config.details}
            </p>
          )}

          {/* Render Elevation Profile BELOW text by default */}
          {config.elevationPosition !== 'above_text' && renderElevationProfile()}

          {/* Start/End GPS Coordinates footer */}
          {config.showCoordinates && stats.startLatLon && (
            <div className="pt-1.5 text-[9px] font-mono tracking-widest opacity-40 uppercase flex items-center justify-center gap-3">
              <span>{stats.startLatLon}</span>
              {stats.endLatLon && <span>→</span>}
              {stats.endLatLon && <span>{stats.endLatLon}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
