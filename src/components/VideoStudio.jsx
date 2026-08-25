import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Video,
  Camera,
  Mountain,
  Download,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  Check,
  AlertTriangle,
  Monitor,
  Smartphone,
  Upload,
  Sparkles,
  RefreshCw,
  Compass,
  Plus,
  Trash2,
  Key,
  Activity,
  TrendingUp,
  Award,
  MapPin,
  Sliders,
  Layers,
  Search,
  Wand2,
} from 'lucide-react';
import { buildTerrainScene } from '../lib/terrainEngine';
import { createCameraController, CAMERA_MODES, resetCameraState } from '../lib/cameraSystem';
import { exportVideo, downloadVideo, isVideoExportSupported } from '../lib/videoExporter';
import { findTownsAlongTrack, geocodeAndSnapToTrack } from '../lib/geocoding';

const OUTRO_SEC = 4.0; // 4 seconds final epic zoom-out reveal

export function VideoStudio({ trackData, config, setConfig, onGpxUpload }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneDataRef = useRef(null);
  const cameraCtrlRef = useRef(null);
  const orbitControlsRef = useRef(null);
  const animIdRef = useRef(null);
  const fileInputRef = useRef(null);

  // Scene & Building State
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildMessage, setBuildMessage] = useState('');
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState(null);

  // Visual & Quality Settings
  const [satelliteQuality, setSatelliteQuality] = useState('ultra'); // 'ultra' | 'high' | 'standard'
  const [heightExaggeration, setHeightExaggeration] = useState(1.6);
  const [trackColor, setTrackColor] = useState(config?.trackColor || '#14b8a6');
  const [trackWidth, setTrackWidth] = useState(1.4); // Wide flat ribbon width
  const [duration, setDuration] = useState(30); // Flyover duration in seconds
  const [aspectRatio, setAspectRatio] = useState('16:9');

  // Waypoints (Tappe sul percorso) synced with config
  const waypoints = config?.waypoints || [];
  const [newWaypointName, setNewWaypointName] = useState('');
  const [newWaypointPercent, setNewWaypointPercent] = useState(50);
  const [isAutoFindingTowns, setIsAutoFindingTowns] = useState(false);
  const [isSearchingTown, setIsSearchingTown] = useState(false);

  // Total video duration including 4-second grand outro reveal
  const totalDuration = duration + OUTRO_SEC;

  // HUD & Liquid Glass Telemetry Settings
  const [showHud, setShowHud] = useState(true);
  const [hudPosition, setHudPosition] = useState('bottom_left'); // 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right'

  // Camera & Director Mode
  const [directorType, setDirectorType] = useState('auto'); // 'auto' | 'keyframe'
  const [cameraMode, setCameraMode] = useState('drone');
  const [keyframes, setKeyframes] = useState([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState(null);

  // Preview & Timeline State
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewStartTimeRef = useRef(null);
  const isOrbitInteractingRef = useRef(false);

  // Video Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [exportedUrl, setExportedUrl] = useState(null);
  const [exportError, setExportError] = useState(null);

  const rawPoints = trackData?.points || [];
  const rawStats = trackData?.stats || {};

  // Process points with cumulative distance and cumulative elevation gain
  const { points, totalDistanceM, totalDistanceKm, minElevation, maxElevation, totalElevationGain } = useMemo(() => {
    if (!rawPoints || rawPoints.length < 2) {
      return {
        points: [],
        totalDistanceM: 1,
        totalDistanceKm: '0.0',
        minElevation: 0,
        maxElevation: 1000,
        totalElevationGain: 0,
      };
    }

    let cumGain = 0;
    let minEle = Infinity;
    let maxEle = -Infinity;

    const processed = rawPoints.map((p, idx) => {
      const ele = p.ele != null ? Number(p.ele) : 0;
      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;

      if (idx > 0) {
        const prevEle = rawPoints[idx - 1].ele != null ? Number(rawPoints[idx - 1].ele) : 0;
        const diff = ele - prevEle;
        if (diff > 0) cumGain += diff;
      }

      return {
        ...p,
        ele,
        cumGain,
      };
    });

    const lastPt = processed[processed.length - 1];
    const totalDistM = lastPt?.cumDistance || parseFloat(rawStats.totalDistanceKm || 0) * 1000 || 1;
    const totalDistKm = (totalDistM / 1000).toFixed(1);

    if (minEle === Infinity) minEle = 0;
    if (maxEle === -Infinity) maxEle = minEle + 100;

    return {
      points: processed,
      totalDistanceM: totalDistM,
      totalDistanceKm: totalDistKm,
      minElevation: Math.round(minEle),
      maxElevation: Math.round(maxEle),
      totalElevationGain: Math.round(rawStats.elevationGainM || cumGain),
    };
  }, [rawPoints, rawStats]);

  // Calculate trail progress vs outro progress
  const timeProgress = useMemo(() => {
    const elapsedSec = previewProgress * totalDuration;
    if (elapsedSec <= duration) {
      const tp = duration > 0 ? elapsedSec / duration : 1.0;
      return { trailProgress: Math.min(1.0, tp), outroProgress: 0.0, isOutro: false };
    } else {
      const op = (elapsedSec - duration) / OUTRO_SEC;
      return { trailProgress: 1.0, outroProgress: Math.min(1.0, op), isOutro: true };
    }
  }, [previewProgress, duration, totalDuration]);

  // Calculate live dynamic telemetry based on current trail progress
  const currentTelemetry = useMemo(() => {
    if (!points || points.length < 2) {
      return { distKm: '0.0', eleM: 0, gainM: 0, ptIndex: 0, isOutro: false };
    }

    const { trailProgress, isOutro } = timeProgress;
    const targetDistM = trailProgress * totalDistanceM;

    let low = 0;
    let high = points.length - 1;
    let ptIndex = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].cumDistance <= targetDistM) {
        ptIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const currentPt = points[ptIndex] || points[0];
    const currentDistKm = (targetDistM / 1000).toFixed(1);

    return {
      distKm: currentDistKm,
      eleM: Math.round(currentPt.ele || 0),
      gainM: Math.round(isOutro ? totalElevationGain : currentPt.cumGain || 0),
      ptIndex,
      isOutro,
    };
  }, [points, totalDistanceM, totalElevationGain, timeProgress]);

  // Build 3D Terrain, Track, and 3D Waypoint Placards Scene
  const buildScene = useCallback(async () => {
    if (!points || points.length < 2) return;

    setIsBuilding(true);
    setBuildProgress(0);
    setBuildMessage('Scaricamento immagini satellitari 4K...');
    setSceneReady(false);
    setSceneError(null);

    // Clean up previous scene
    if (sceneDataRef.current) {
      sceneDataRef.current.dispose();
      sceneDataRef.current = null;
    }
    if (animIdRef.current) {
      cancelAnimationFrame(animIdRef.current);
      animIdRef.current = null;
    }
    if (orbitControlsRef.current) {
      orbitControlsRef.current.dispose();
      orbitControlsRef.current = null;
    }

    try {
      const sceneData = await buildTerrainScene(
        points,
        {
          quality: satelliteQuality,
          heightExaggeration,
          trackColor,
          trackWidth,
          waypoints,
          padding: 0.2,
        },
        (pct, msg) => {
          setBuildProgress(pct);
          setBuildMessage(msg);
        }
      );

      sceneDataRef.current = sceneData;

      // Initialize Camera Controller
      const ctrl = createCameraController(sceneData.trackCurve, sceneData.worldBounds);
      cameraCtrlRef.current = ctrl;

      // Set initial auto keyframes if empty
      if (keyframes.length === 0) {
        setKeyframes(ctrl.generateAutoKeyframes());
      }

      // Initialize WebGL Renderer
      const container = containerRef.current;
      if (!rendererRef.current && container) {
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        rendererRef.current = renderer;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);
      }

      // Setup OrbitControls for Smooth Mouse Navigation
      if (rendererRef.current && container) {
        const controls = new OrbitControls(sceneData.camera, rendererRef.current.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.screenSpacePanning = true;
        controls.minDistance = 15;
        controls.maxDistance = 3500;
        controls.maxPolarAngle = Math.PI / 2 - 0.05;

        controls.addEventListener('start', () => {
          isOrbitInteractingRef.current = true;
        });
        controls.addEventListener('end', () => {
          setTimeout(() => {
            isOrbitInteractingRef.current = false;
          }, 300);
        });

        orbitControlsRef.current = controls;
      }

      // Resize renderer to container dimensions
      if (rendererRef.current && container) {
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 500;
        rendererRef.current.setSize(width, height);
        sceneData.camera.aspect = width / height;
        sceneData.camera.updateProjectionMatrix();
      }

      // Position camera at start
      const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;
      ctrl.updateCamera(sceneData.camera, 0, activeMode, keyframes, 0);

      if (orbitControlsRef.current) {
        const startTarget = sceneData.trackCurve.getPointAt(0);
        orbitControlsRef.current.target.copy(startTarget);
        orbitControlsRef.current.update();
      }

      setSceneReady(true);
      setPreviewProgress(0);
      setIsPreviewPlaying(false);

      // Start continuous animation loop
      const animate = () => {
        animIdRef.current = requestAnimationFrame(animate);
        if (orbitControlsRef.current && isOrbitInteractingRef.current) {
          orbitControlsRef.current.update();
        }
        if (rendererRef.current && sceneDataRef.current) {
          rendererRef.current.render(sceneDataRef.current.scene, sceneDataRef.current.camera);
        }
      };
      animate();
    } catch (err) {
      console.error('Terrain Scene Error:', err);
      setSceneError(err.message || 'Errore durante la creazione del terreno 3D');
    } finally {
      setIsBuilding(false);
    }
  }, [points, satelliteQuality, heightExaggeration, trackColor, trackWidth, waypoints]);

  // Initial load & trigger build on point/elevation/waypoints changes
  useEffect(() => {
    if (points.length >= 2) {
      buildScene();
    }
    return () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      if (orbitControlsRef.current) orbitControlsRef.current.dispose();
    };
  }, [points, satelliteQuality, heightExaggeration, trackColor, trackWidth, waypoints]);

  // Responsive Canvas Resize Observer
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const resizeObserver = new ResizeObserver(() => {
      if (!rendererRef.current || !sceneDataRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        rendererRef.current.setSize(w, h);
        sceneDataRef.current.camera.aspect = w / h;
        sceneDataRef.current.camera.updateProjectionMatrix();
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Preview Animation Playback Loop
  useEffect(() => {
    if (!isPreviewPlaying || !sceneDataRef.current || !cameraCtrlRef.current) return;

    let localAnimId;
    previewStartTimeRef.current = Date.now() - previewProgress * totalDuration * 1000;

    const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;

    const loop = () => {
      const elapsed = (Date.now() - previewStartTimeRef.current) / 1000;
      const overallProgress = Math.min(elapsed / totalDuration, 1.0);

      let tp = 1.0;
      let op = 0.0;
      if (elapsed <= duration) {
        tp = Math.min(1.0, elapsed / duration);
        op = 0.0;
      } else {
        tp = 1.0;
        op = Math.min(1.0, (elapsed - duration) / OUTRO_SEC);
      }

      setPreviewProgress(overallProgress);
      sceneDataRef.current.updateProgress(tp);
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, tp, activeMode, keyframes, op);

      if (orbitControlsRef.current && op === 0) {
        const currentTarget = sceneDataRef.current.trackCurve.getPointAt(Math.min(0.999, tp));
        orbitControlsRef.current.target.lerp(currentTarget, 0.05);
      }

      if (overallProgress >= 1.0) {
        setIsPreviewPlaying(false);
        return;
      }

      localAnimId = requestAnimationFrame(loop);
    };

    localAnimId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(localAnimId);
  }, [isPreviewPlaying, cameraMode, directorType, keyframes, duration, totalDuration]);

  // Scrubbing Timeline Slider
  const handleScrub = (val) => {
    setIsPreviewPlaying(false);
    setPreviewProgress(val);

    const elapsed = val * totalDuration;
    let tp = 1.0;
    let op = 0.0;
    if (elapsed <= duration) {
      tp = Math.min(1.0, elapsed / duration);
      op = 0.0;
    } else {
      tp = 1.0;
      op = Math.min(1.0, (elapsed - duration) / OUTRO_SEC);
    }

    if (sceneDataRef.current && cameraCtrlRef.current) {
      sceneDataRef.current.updateProgress(tp);
      const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, tp, activeMode, keyframes, op);

      if (orbitControlsRef.current && op === 0) {
        const currentTarget = sceneDataRef.current.trackCurve.getPointAt(Math.min(0.999, tp));
        orbitControlsRef.current.target.copy(currentTarget);
        orbitControlsRef.current.update();
      }
    }
  };

  // Switch Camera Preset
  const handleCameraModeChange = (mode) => {
    setDirectorType('auto');
    setCameraMode(mode);
    if (cameraCtrlRef.current) {
      resetCameraState(cameraCtrlRef.current);
      if (sceneDataRef.current) {
        cameraCtrlRef.current.updateCamera(
          sceneDataRef.current.camera,
          timeProgress.trailProgress,
          mode,
          keyframes,
          timeProgress.outroProgress
        );
      }
    }
  };

  // Add Keyframe at Current Scrubber Position with Current 3D Camera View
  const handleAddKeyframe = () => {
    if (!sceneDataRef.current) return;

    const camera = sceneDataRef.current.camera;
    const lookTarget = orbitControlsRef.current?.target
      ? orbitControlsRef.current.target.clone()
      : sceneDataRef.current.trackCurve.getPointAt(Math.min(0.999, timeProgress.trailProgress));

    const newKf = {
      id: `kf-${Date.now()}`,
      t: parseFloat(timeProgress.trailProgress.toFixed(3)),
      name: `Inquadratura a ${(previewProgress * totalDuration).toFixed(0)}s`,
      position: camera.position.clone(),
      lookAt: lookTarget,
    };

    const updated = [
      ...keyframes.filter((k) => Math.abs(k.t - timeProgress.trailProgress) > 0.02),
      newKf,
    ].sort((a, b) => a.t - b.t);

    setKeyframes(updated);
    setDirectorType('keyframe');
    setSelectedKeyframeId(newKf.id);
  };

  // Remove Selected Keyframe
  const handleRemoveKeyframe = (id) => {
    const updated = keyframes.filter((k) => k.id !== id);
    setKeyframes(updated);
    if (selectedKeyframeId === id) setSelectedKeyframeId(null);
  };

  // Go to Keyframe Position
  const handleJumpToKeyframe = (kf) => {
    const overallT = (kf.t * duration) / totalDuration;
    handleScrub(overallT);
    setSelectedKeyframeId(kf.id);
    if (sceneDataRef.current) {
      sceneDataRef.current.camera.position.copy(kf.position);
      sceneDataRef.current.camera.lookAt(kf.lookAt);
      if (orbitControlsRef.current) {
        orbitControlsRef.current.target.copy(kf.lookAt);
        orbitControlsRef.current.update();
      }
    }
  };

  // Reset to Auto Generated Keyframes
  const handleResetToAutoKeyframes = () => {
    if (cameraCtrlRef.current) {
      const generated = cameraCtrlRef.current.generateAutoKeyframes();
      setKeyframes(generated);
      setDirectorType('keyframe');
    }
  };

  // Waypoints Management (Tappe & Paesi)
  const handleAddWaypoint = () => {
    if (!newWaypointName.trim()) return;
    const newWpt = {
      id: `wpt-${Date.now()}`,
      name: newWaypointName.trim(),
      percent: newWaypointPercent,
    };
    const updated = [...waypoints, newWpt].sort((a, b) => a.percent - b.percent);
    if (setConfig) {
      setConfig((prev) => ({ ...prev, waypoints: updated }));
    }
    setNewWaypointName('');
  };

  const handleRemoveWaypoint = (id) => {
    const updated = waypoints.filter((w) => w.id !== id);
    if (setConfig) {
      setConfig((prev) => ({ ...prev, waypoints: updated }));
    }
  };

  const handleClearAllWaypoints = () => {
    if (setConfig) {
      setConfig((prev) => ({ ...prev, waypoints: [] }));
    }
  };

  // Automatic Discovery of Towns & Villages along the route
  const handleAutoFindTowns = async () => {
    if (!points || points.length < 2) return;
    setIsAutoFindingTowns(true);
    try {
      const found = await findTownsAlongTrack(points, 8);
      if (found && found.length > 0) {
        if (setConfig) {
          setConfig((prev) => ({
            ...prev,
            waypoints: found,
          }));
        }
      } else {
        alert('Nessun paese o tappa rilevato nelle immediate vicinanze del percorso.');
      }
    } catch (err) {
      console.error('Error finding towns:', err);
      alert(`Errore nella ricerca automatica dei paesi: ${err.message}`);
    } finally {
      setIsAutoFindingTowns(false);
    }
  };

  // Search single place via OpenStreetMap Geocoding
  const handleSearchPlace = async () => {
    if (!newWaypointName.trim() || !points || points.length < 2) return;
    setIsSearchingTown(true);
    try {
      const matched = await geocodeAndSnapToTrack(newWaypointName.trim(), points);
      if (matched) {
        const newWpt = {
          id: `wpt-${Date.now()}`,
          name: matched.name,
          percent: matched.percent,
          lat: matched.lat,
          lon: matched.lon,
        };
        const updated = [...waypoints.filter((w) => w.name !== matched.name), newWpt].sort(
          (a, b) => a.percent - b.percent
        );
        if (setConfig) {
          setConfig((prev) => ({ ...prev, waypoints: updated }));
        }
        setNewWaypointName('');
      }
    } catch (err) {
      alert(err.message || 'Luogo non trovato.');
    } finally {
      setIsSearchingTown(false);
    }
  };

  // Play / Pause Toggle
  const togglePlay = () => {
    if (isPreviewPlaying) {
      setIsPreviewPlaying(false);
    } else {
      if (previewProgress >= 0.99) {
        setPreviewProgress(0);
        if (cameraCtrlRef.current) resetCameraState(cameraCtrlRef.current);
      }
      setIsPreviewPlaying(true);
    }
  };

  // Reset to Start
  const handleReset = () => {
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
    if (cameraCtrlRef.current) resetCameraState(cameraCtrlRef.current);
    if (sceneDataRef.current && cameraCtrlRef.current) {
      sceneDataRef.current.updateProgress(0);
      const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, 0, activeMode, keyframes, 0);
      if (orbitControlsRef.current) {
        orbitControlsRef.current.target.copy(sceneDataRef.current.trackCurve.getPointAt(0));
        orbitControlsRef.current.update();
      }
    }
  };

  // Draw Minimal Progressive Liquid Glass Telemetry HUD on Exported Video Frame
  const drawHudOnVideo = useCallback(
    (ctx, width, height, progress) => {
      if (!showHud || !points || points.length < 2) return;

      const scale = width / 1920;
      const cardW = 320 * scale;
      const cardH = 110 * scale;
      const margin = 32 * scale;

      let cardX = margin;
      let cardY = height - cardH - margin;

      if (hudPosition === 'bottom_right') {
        cardX = width - cardW - margin;
      } else if (hudPosition === 'top_left') {
        cardY = margin + 20 * scale;
      } else if (hudPosition === 'top_right') {
        cardX = width - cardW - margin;
        cardY = margin + 20 * scale;
      }

      const elapsed = progress * totalDuration;
      const tp = elapsed <= duration ? elapsed / duration : 1.0;
      const isOutro = elapsed > duration;

      const targetDistM = tp * totalDistanceM;
      let ptIndex = 0;
      while (ptIndex < points.length - 1 && points[ptIndex + 1].cumDistance <= targetDistM) {
        ptIndex++;
      }
      const curPt = points[ptIndex] || points[0];
      const curDistKm = (targetDistM / 1000).toFixed(1);
      const curEle = Math.round(curPt.ele || 0);
      const curGain = Math.round(isOutro ? totalElevationGain : curPt.cumGain || 0);

      // 1. Draw Minimal Frosted Glass Card Background
      ctx.save();
      ctx.fillStyle = 'rgba(10, 14, 20, 0.65)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1.2 * scale;

      const r = 14 * scale;
      ctx.beginPath();
      ctx.moveTo(cardX + r, cardY);
      ctx.lineTo(cardX + cardW - r, cardY);
      ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r);
      ctx.lineTo(cardX + cardW, cardY + cardH - r);
      ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH);
      ctx.lineTo(cardX + r, cardY + cardH);
      ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r);
      ctx.lineTo(cardX, cardY + r);
      ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Top Glass Highlight
      const grad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 20 * scale);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // 2. Draw Distance & Elevation Gain Stats
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${15 * scale}px "Outfit", sans-serif`;
      ctx.fillText(`${curDistKm} km`, cardX + 14 * scale, cardY + 22 * scale);

      ctx.fillStyle = '#94a3b8';
      ctx.font = `${10 * scale}px sans-serif`;
      ctx.fillText(`/ ${totalDistanceKm} km`, cardX + 75 * scale, cardY + 22 * scale);

      // Altitude & D+
      if (isOutro) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = `bold ${11 * scale}px sans-serif`;
        ctx.fillText(`TRAGUARDO`, cardX + cardW - 85 * scale, cardY + 22 * scale);
      } else {
        ctx.fillStyle = '#14b8a6';
        ctx.font = `bold ${14 * scale}px "JetBrains Mono", monospace`;
        ctx.fillText(`${curEle} m`, cardX + cardW - 65 * scale, cardY + 22 * scale);
      }

      ctx.fillStyle = '#f59e0b';
      ctx.font = `${10 * scale}px sans-serif`;
      ctx.fillText(`+${curGain}m D+`, cardX + 14 * scale, cardY + 38 * scale);

      // 3. Draw Progressive Elevation Profile Curve
      const chartX = cardX + 14 * scale;
      const chartY = cardY + 46 * scale;
      const chartW = cardW - 28 * scale;
      const chartH = 50 * scale;

      const spanE = Math.max(30, maxElevation - minElevation);

      // Upcoming Ghost Track
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = chartX + (p.cumDistance / totalDistanceM) * chartW;
        const py = chartY + chartH - ((p.ele - minElevation) / spanE) * chartH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.0 * scale;
      ctx.stroke();

      // Progressive Active Filled Area
      const activeMarkerX = chartX + tp * chartW;
      const activeMarkerY = chartY + chartH - ((curEle - minElevation) / spanE) * chartH;

      ctx.beginPath();
      ctx.moveTo(chartX, chartY + chartH);
      for (let i = 0; i <= ptIndex; i++) {
        const p = points[i];
        const px = chartX + (p.cumDistance / totalDistanceM) * chartW;
        const py = chartY + chartH - ((p.ele - minElevation) / spanE) * chartH;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(activeMarkerX, activeMarkerY);
      ctx.lineTo(activeMarkerX, chartY + chartH);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(chartX, chartY, chartX, chartY + chartH);
      areaGrad.addColorStop(0, 'rgba(20, 184, 166, 0.35)');
      areaGrad.addColorStop(1, 'rgba(20, 184, 166, 0.02)');
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Progressive Active Stroke Line
      ctx.beginPath();
      for (let i = 0; i <= ptIndex; i++) {
        const p = points[i];
        const px = chartX + (p.cumDistance / totalDistanceM) * chartW;
        const py = chartY + chartH - ((p.ele - minElevation) / spanE) * chartH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineTo(activeMarkerX, activeMarkerY);
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();

      // Glowing Leading Dot
      ctx.beginPath();
      ctx.arc(activeMarkerX, activeMarkerY, 3.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();

      ctx.restore();
    },
    [showHud, points, totalDistanceM, totalDistanceKm, minElevation, maxElevation, totalElevationGain, hudPosition, duration, totalDuration]
  );

  // Video Export Handler (WebCodecs MP4 1080p with 4s Outro Zoom-out)
  const handleExport = async () => {
    if (!sceneDataRef.current || !rendererRef.current) return;

    if (!isVideoExportSupported()) {
      setExportError(
        'Il tuo browser non supporta la codifica video WebCodecs. Usa Chrome, Edge o Opera per generare il video MP4.'
      );
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportMessage('Inizializzazione rendering 1080p...');
    setExportError(null);
    setExportedUrl(null);
    setIsPreviewPlaying(false);

    if (cameraCtrlRef.current) resetCameraState(cameraCtrlRef.current);

    const [w, h] = aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080];
    const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;

    try {
      const blobUrl = await exportVideo({
        renderer: rendererRef.current,
        scene: sceneDataRef.current.scene,
        camera: sceneDataRef.current.camera,
        updateFrame: (overallProgress) => {
          const elapsed = overallProgress * totalDuration;
          let tp = 1.0;
          let op = 0.0;
          if (elapsed <= duration) {
            tp = Math.min(1.0, elapsed / duration);
            op = 0.0;
          } else {
            tp = 1.0;
            op = Math.min(1.0, (elapsed - duration) / OUTRO_SEC);
          }

          sceneDataRef.current.updateProgress(tp);
          cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, tp, activeMode, keyframes, op);
        },
        drawOverlay: showHud ? (ctx, vw, vh, p) => drawHudOnVideo(ctx, vw, vh, p) : null,
        options: {
          width: w,
          height: h,
          fps: 30,
          durationSec: totalDuration,
          bitrate: 8_000_000,
        },
        onProgress: (pct, msg) => {
          setExportProgress(pct);
          setExportMessage(msg);
        },
      });

      setExportedUrl(blobUrl);
      setExportMessage('Video generato con successo!');
    } catch (err) {
      console.error('Video Export Error:', err);
      setExportError(err.message || 'Errore durante la generazione del video');
    } finally {
      setIsExporting(false);
      // Restore renderer viewport
      if (rendererRef.current && containerRef.current) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        rendererRef.current.setSize(cw, ch);
        if (sceneDataRef.current) {
          sceneDataRef.current.camera.aspect = cw / ch;
          sceneDataRef.current.camera.updateProjectionMatrix();
        }
      }
    }
  };

  const handleDownload = () => {
    if (exportedUrl) {
      const name = config?.title || trackData?.name || 'trail-flyover';
      downloadVideo(exportedUrl, `${name}-flyover-3d.mp4`);
    }
  };

  const TRACK_PRESET_COLORS = [
    { label: 'Ciano', hex: '#14b8a6' },
    { label: 'Ambra', hex: '#f59e0b' },
    { label: 'Corallo', hex: '#f43f5e' },
    { label: 'Viola', hex: '#8b5cf6' },
    { label: 'Smeraldo', hex: '#10b981' },
    { label: 'Bianco', hex: '#ffffff' },
  ];

  return (
    <div className="w-full flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Hidden GPX file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onGpxUpload) onGpxUpload(file);
        }}
        className="hidden"
      />

      {/* Sidebar Controls (Left - 4 Cols on LG) - Minimal & Clean */}
      <div className="lg:col-span-4 h-[calc(100vh-100px)] sticky top-20 flex flex-col space-y-3 overflow-y-auto custom-scrollbar pr-1">
        {/* Card 1: Satellite Resolution */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 bg-[#181a20]/95 shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-400" />
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Dettaglio Satellite
                </h3>
                <p className="text-[10px] text-neutral-400">Esri World Imagery Fotografico</p>
              </div>
            </div>
            <button
              onClick={buildScene}
              disabled={isBuilding}
              className="text-neutral-400 hover:text-teal-300 transition-colors p-1 rounded-lg hover:bg-white/5"
              title="Ricarica Terreno 3D"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isBuilding ? 'animate-spin text-teal-400' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5 text-[11px]">
            <button
              onClick={() => setSatelliteQuality('ultra')}
              className={`py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center gap-0.5 ${
                satelliteQuality === 'ultra'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <span>Ultra 4K</span>
              <span className="text-[9px] opacity-75 font-mono">Zoom 16-17</span>
            </button>
            <button
              onClick={() => setSatelliteQuality('high')}
              className={`py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center gap-0.5 ${
                satelliteQuality === 'high'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <span>Super HD</span>
              <span className="text-[9px] opacity-75 font-mono">Zoom 15-16</span>
            </button>
            <button
              onClick={() => setSatelliteQuality('standard')}
              className={`py-1 px-2 rounded-lg font-bold transition-all flex flex-col items-center gap-0.5 ${
                satelliteQuality === 'standard'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <span>Veloce</span>
              <span className="text-[9px] opacity-75 font-mono">Zoom 14</span>
            </button>
          </div>
        </div>

        {/* Card 2: Tappe sul Percorso (Cartelli 3D & Ricerca Automatica Paesi) */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 bg-[#181a20]/95 shadow-md space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Tappe & Cartelli 3D ({waypoints.length})
              </h3>
            </div>
            {waypoints.length > 0 && (
              <button
                onClick={handleClearAllWaypoints}
                className="text-[10px] text-neutral-400 hover:text-rose-400 transition-colors"
                title="Rimuovi tutte le tappe"
              >
                Cancella tutte
              </button>
            )}
          </div>

          {/* Automatic Discovery Button */}
          <button
            onClick={handleAutoFindTowns}
            disabled={isAutoFindingTowns || !points || points.length < 2}
            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-gradient-to-r from-teal-700/80 to-emerald-600/80 hover:from-teal-600 hover:to-emerald-500 text-white text-xs font-bold shadow transition-all border border-teal-400/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
          >
            {isAutoFindingTowns ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-200" />
                <span>Rilevamento paesi in corso...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5 text-teal-200" />
                <span>Trova Paesi & Tappe Automaticamente</span>
              </>
            )}
          </button>

          {/* Add / Search New Waypoint */}
          <div className="space-y-2 pt-1 border-t border-white/5">
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Cerca o inserisci nome (es. Rifugio, Passo)..."
                value={newWaypointName}
                onChange={(e) => setNewWaypointName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchPlace();
                }}
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-teal-400"
              />
              <button
                onClick={handleSearchPlace}
                disabled={!newWaypointName.trim() || isSearchingTown}
                className="p-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-teal-300 rounded-xl transition-all"
                title="Cerca luogo esatto su mappa"
              >
                {isSearchingTown ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={handleAddWaypoint}
                disabled={!newWaypointName.trim()}
                className="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                title="Aggiungi con percentuale manuale"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Posizione sul tracciato</span>
                <span className="font-mono text-teal-300 font-bold">{newWaypointPercent}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={newWaypointPercent}
                onChange={(e) => setNewWaypointPercent(parseInt(e.target.value))}
                className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
              />
            </div>
          </div>

          {/* Waypoints List */}
          {waypoints.length > 0 ? (
            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {waypoints.map((wpt, idx) => (
                <div
                  key={wpt.id || idx}
                  className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5 text-xs group"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-teal-500/20 text-teal-300 flex items-center justify-center font-mono font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-white truncate max-w-[140px]">
                      {wpt.name}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {wpt.percent}%
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveWaypoint(wpt.id)}
                    className="text-neutral-500 hover:text-red-400 p-1 transition-colors"
                    title="Elimina tappa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-neutral-500 italic">
              Nessuna tappa inserita. Clicca sul pulsante sopra per rilevarle automaticamente dal percorso.
            </p>
          )}
        </div>

        {/* Card 3: Regia Telecamera (Automatica vs Keyframe) */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/95 shadow-md">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Regia Telecamera
              </h3>
            </div>

            <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/10 text-[10px] font-bold">
              <button
                onClick={() => setDirectorType('auto')}
                className={`px-2 py-1 rounded-md transition-all ${
                  directorType === 'auto'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Auto Preset
              </button>
              <button
                onClick={() => setDirectorType('keyframe')}
                className={`px-2 py-1 rounded-md transition-all ${
                  directorType === 'keyframe'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Keyframe
              </button>
            </div>
          </div>

          {directorType === 'auto' ? (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CAMERA_MODES)
                .filter(([k]) => k !== 'keyframe')
                .map(([key, mode]) => (
                  <button
                    key={key}
                    onClick={() => handleCameraModeChange(key)}
                    className={`p-2 rounded-xl text-left transition-all border ${
                      cameraMode === key
                        ? 'border-teal-500 bg-teal-500/20 text-teal-200 ring-1 ring-teal-500/30'
                        : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">{mode.name}</p>
                    <p className="text-[9px] text-neutral-400 leading-tight mt-0.5">{mode.description}</p>
                  </button>
                ))}
            </div>
          ) : (
            <div className="space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-300 font-semibold flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  Punti Regia ({keyframes.length})
                </span>
                <button
                  onClick={handleResetToAutoKeyframes}
                  className="text-[10px] text-teal-300 hover:underline"
                >
                  Genera 5 Punti Base
                </button>
              </div>

              <button
                onClick={handleAddKeyframe}
                className="w-full flex items-center justify-center gap-1.5 p-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-white text-xs font-bold shadow transition-all active:scale-98"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Salva Inquadratura a {(previewProgress * totalDuration).toFixed(0)}s</span>
              </button>

              <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                {keyframes.map((kf, idx) => (
                  <div
                    key={kf.id}
                    onClick={() => handleJumpToKeyframe(kf)}
                    className={`flex items-center justify-between p-1.5 rounded-xl border text-xs cursor-pointer transition-all ${
                      selectedKeyframeId === kf.id
                        ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                        : 'border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center font-mono font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-white text-[11px]">{kf.name}</span>
                      <span className="text-[9px] text-neutral-400 font-mono">
                        ({(kf.t * duration).toFixed(1)}s)
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveKeyframe(kf.id);
                      }}
                      className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Elimina keyframe"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Card 4: Rilievo Altimetrico & Nastro GPX */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/95 shadow-md">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Mountain className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Rilievo & Traccia GPX
            </h3>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Esagerazione Montagne</span>
              <span className="font-mono text-teal-300 font-bold">{heightExaggeration.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={heightExaggeration}
              onChange={(e) => setHeightExaggeration(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Larghezza Nastro Piatto</span>
              <span className="font-mono text-teal-300 font-bold">{trackWidth.toFixed(1)} m</span>
            </div>
            <input
              type="range"
              min="0.4"
              max="4.0"
              step="0.2"
              value={trackWidth}
              onChange={(e) => setTrackWidth(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400 font-medium block">Colore Traccia Neon</span>
            <div className="flex items-center gap-2 flex-wrap">
              {TRACK_PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setTrackColor(c.hex)}
                  className={`w-5 h-5 rounded-full border transition-all ${
                    trackColor === c.hex
                      ? 'border-white scale-110 ring-2 ring-teal-400/50'
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
              <input
                type="color"
                value={trackColor}
                onChange={(e) => setTrackColor(e.target.value)}
                className="w-5 h-5 rounded-full border border-white/20 cursor-pointer bg-transparent"
                title="Colore personalizzato"
              />
            </div>
          </div>
        </div>

        {/* Card 5: Formato Video & Durata */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/95 shadow-md">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Video className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Formato & Durata
            </h3>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Volo + Outro Panoramico</span>
              <span className="font-mono text-teal-300 font-bold">
                {duration}s + 4s ({totalDuration}s)
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5 text-xs">
              {[15, 30, 45, 60].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`py-1 rounded-lg font-semibold transition-all ${
                    duration === d
                      ? 'bg-teal-600 text-white shadow'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setAspectRatio('16:9')}
              className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold transition-all border ${
                aspectRatio === '16:9'
                  ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                  : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              16:9 Orizzontale
            </button>
            <button
              onClick={() => setAspectRatio('9:16')}
              className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-semibold transition-all border ${
                aspectRatio === '9:16'
                  ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                  : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              9:16 Reels / TikTok
            </button>
          </div>
        </div>

        {/* Card 6: Telemetria HUD Switch & Position */}
        <div className="glass-card p-3.5 rounded-2xl border border-white/10 space-y-2 bg-[#181a20]/95 shadow-md">
          <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Overlay Telemetria HUD
              </h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showHud}
                onChange={(e) => setShowHud(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
          </div>

          {showHud && (
            <div className="grid grid-cols-2 gap-1 text-[11px] pt-1">
              <button
                onClick={() => setHudPosition('bottom_left')}
                className={`py-1 px-2 rounded-lg border font-medium transition-all ${
                  hudPosition === 'bottom_left'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-400 hover:text-white'
                }`}
              >
                In Basso a Sx
              </button>
              <button
                onClick={() => setHudPosition('bottom_right')}
                className={`py-1 px-2 rounded-lg border font-medium transition-all ${
                  hudPosition === 'bottom_right'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-400 hover:text-white'
                }`}
              >
                In Basso a Dx
              </button>
              <button
                onClick={() => setHudPosition('top_left')}
                className={`py-1 px-2 rounded-lg border font-medium transition-all ${
                  hudPosition === 'top_left'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-400 hover:text-white'
                }`}
              >
                In Alto a Sx
              </button>
              <button
                onClick={() => setHudPosition('top_right')}
                className={`py-1 px-2 rounded-lg border font-medium transition-all ${
                  hudPosition === 'top_right'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-400 hover:text-white'
                }`}
              >
                In Alto a Dx
              </button>
            </div>
          )}
        </div>

        {/* Card 7: Generazione & Esportazione MP4 */}
        <div className="glass-card p-3.5 rounded-2xl border border-teal-500/40 space-y-2.5 bg-[#181a20]/95 shadow-xl">
          <div className="flex items-center gap-2 border-b border-white/5 pb-1.5">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-200">
              Esporta Video MP4 Full HD
            </h3>
          </div>

          {!isVideoExportSupported() && (
            <div className="p-2 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>WebCodecs non supportato. Usa Chrome o Edge per esportare in MP4.</span>
            </div>
          )}

          {exportError && (
            <div className="p-2 bg-red-500/15 border border-red-500/30 text-red-300 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {isExporting && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400 flex items-center gap-1.5 truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  {exportMessage}
                </span>
                <span className="font-mono text-teal-300 font-bold">{exportProgress}%</span>
              </div>
              <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-200"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          )}

          {exportedUrl && !isExporting && (
            <div className="space-y-2">
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white text-xs font-bold shadow transition-all hover:scale-[1.01] active:scale-95"
              >
                <Download className="w-4 h-4" />
                Scarica Video MP4 (1080p)
              </button>
            </div>
          )}

          {!isExporting && !exportedUrl && (
            <button
              onClick={handleExport}
              disabled={!sceneReady || !isVideoExportSupported()}
              className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 text-white text-xs font-bold shadow shadow-teal-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Video className="w-4 h-4" />
              <span>Genera Video 1080p ({totalDuration}s)</span>
            </button>
          )}
        </div>
      </div>

      {/* Central 3D Interactive Viewport (Right - 8 Cols on LG) */}
      <div className="lg:col-span-8 flex flex-col items-center justify-center glass-panel rounded-2xl min-h-[calc(100vh-100px)] border border-white/10 relative overflow-hidden bg-[#0c1017]">
        {/* Top Floating Status Bar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="glass-panel-subtle px-3 py-1 rounded-full border border-white/10 pointer-events-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs font-mono tracking-wider text-neutral-200 uppercase">
              {timeProgress.isOutro
                ? 'Outro Finale Panoramico (4s)'
                : directorType === 'keyframe'
                ? `Regia Keyframe (${keyframes.length} scene)`
                : `Regia • ${CAMERA_MODES[cameraMode]?.name}`}
            </span>
          </div>

          {sceneReady && (
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={handleReset}
                className="p-2 rounded-xl border border-white/10 bg-black/60 text-neutral-300 hover:bg-black/80 hover:text-white transition-all shadow-md"
                title="Riavvia percorso dall'inizio"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Minimal & Light Progressive Telemetry HUD Card Overlay */}
        {showHud && sceneReady && !isBuilding && points.length > 1 && (
          <div
            className={`absolute z-20 pointer-events-none transition-all duration-300 ${
              hudPosition === 'bottom_left'
                ? 'bottom-20 left-4'
                : hudPosition === 'bottom_right'
                ? 'bottom-20 right-4'
                : hudPosition === 'top_left'
                ? 'top-14 left-4'
                : 'top-14 right-4'
            }`}
          >
            <div className="w-72 backdrop-blur-xl bg-black/45 border border-white/15 rounded-2xl shadow-2xl p-3 space-y-1.5 pointer-events-auto relative overflow-hidden">
              {/* Subtle Glass Specular Highlight */}
              <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white/10 to-transparent pointer-events-none rounded-t-2xl" />

              {/* Row 1: Realtime Live Metrics (Clean & Minimal) */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-base font-extrabold text-white font-mono tracking-tight">
                      {currentTelemetry.distKm}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-medium">/ {totalDistanceKm} km</span>
                  </div>
                  <p className="text-[10px] text-amber-300 font-medium flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-amber-400" />
                    +{currentTelemetry.gainM}m D+
                  </p>
                </div>

                <div className="text-right">
                  {timeProgress.isOutro ? (
                    <div className="flex items-center gap-1 text-amber-300 font-bold text-xs">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      <span>Arrivo</span>
                    </div>
                  ) : (
                    <span className="text-sm font-bold text-teal-300 font-mono">
                      {currentTelemetry.eleM} m
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: Progressive Dynamic Elevation Profile Chart */}
              <div className="relative h-10 w-full overflow-hidden pt-1">
                <svg className="w-full h-full" viewBox="0 0 100 36" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="hudActiveAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {(() => {
                    const spanE = Math.max(30, maxElevation - minElevation);

                    // A. Full Ghost Trail Line
                    const fullPoints = points.map((p) => {
                      const x = (p.cumDistance / totalDistanceM) * 100;
                      const y = 32 - ((p.ele - minElevation) / spanE) * 26;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    });
                    const ghostLineD = `M ${fullPoints.join(' L ')}`;

                    // B. Progressive Active Section
                    const ptIdx = currentTelemetry.ptIndex;
                    const curX = timeProgress.trailProgress * 100;
                    const curY = 32 - ((currentTelemetry.eleM - minElevation) / spanE) * 26;

                    const activePoints = [];
                    for (let i = 0; i <= ptIdx; i++) {
                      const p = points[i];
                      const px = (p.cumDistance / totalDistanceM) * 100;
                      const py = 32 - ((p.ele - minElevation) / spanE) * 26;
                      activePoints.push(`${px.toFixed(1)},${py.toFixed(1)}`);
                    }
                    activePoints.push(`${curX.toFixed(1)},${curY.toFixed(1)}`);

                    const activeAreaD = `M 0,34 L ${activePoints.join(' L ')} L ${curX.toFixed(1)},34 Z`;
                    const activeLineD = `M ${activePoints.join(' L ')}`;

                    return (
                      <>
                        <path d={ghostLineD} fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="1.0" />
                        <path d={activeAreaD} fill="url(#hudActiveAreaGrad)" />
                        <path d={activeLineD} fill="none" stroke="#14b8a6" strokeWidth="1.4" />
                        <circle cx={curX} cy={curY} r="2.2" fill="#ffffff" stroke="#14b8a6" strokeWidth="1.2" />
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {isBuilding && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0c1017]/90 backdrop-blur-md">
            <div className="flex flex-col items-center gap-4 max-w-sm text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shadow-xl">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-bold text-white mb-1">Caricamento 3D</p>
                <p className="text-xs text-neutral-400">{buildMessage}</p>
              </div>
              <div className="w-48 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-300"
                  style={{ width: `${buildProgress}%` }}
                />
              </div>
              <span className="text-xs font-mono text-teal-300 font-bold">{buildProgress}%</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {sceneError && !isBuilding && (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-20">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Errore nel caricamento del Terreno</h3>
              <p className="text-xs text-neutral-400 max-w-md">{sceneError}</p>
            </div>
            <button
              onClick={buildScene}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Riprova Caricamento
            </button>
          </div>
        )}

        {/* Prompt if no track is loaded */}
        {(!points || points.length < 2) && !isBuilding && (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-20">
            <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Compass className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Nessuna traccia GPX caricata</h3>
              <p className="text-xs text-neutral-400 max-w-md">
                Carica una traccia GPX per generare il rilievo 3D fotorealistico e il video flyover.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow transition-all active:scale-95"
            >
              <Upload className="w-4 h-4" />
              Carica File GPX
            </button>
          </div>
        )}

        {/* 3D WebGL Canvas Container */}
        <div
          ref={containerRef}
          className="w-full h-[calc(100vh-140px)] min-h-[500px] cursor-grab active:cursor-grabbing flex items-center justify-center"
        />

        {/* Bottom Playback & Scrubber Controls */}
        {sceneReady && !isBuilding && (
          <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-[#0c1017]/95 via-[#0c1017]/70 to-transparent backdrop-blur-sm">
            <div className="flex flex-col gap-2 max-w-3xl mx-auto bg-black/75 p-3 rounded-2xl border border-white/10 shadow-2xl">
              {/* Timeline with Keyframe Visual Markers & Outro Section */}
              <div className="relative w-full flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={previewProgress}
                  onChange={(e) => handleScrub(parseFloat(e.target.value))}
                  className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-2 cursor-pointer z-10"
                />

                {/* Keyframe Visual Pins on Timeline */}
                {directorType === 'keyframe' && (
                  <div className="absolute inset-x-0 top-0 bottom-0 pointer-events-none flex items-center">
                    {keyframes.map((kf) => {
                      const pinLeft = ((kf.t * duration) / totalDuration) * 100;
                      return (
                        <div
                          key={kf.id}
                          style={{ left: `${pinLeft}%` }}
                          className={`absolute w-3.5 h-3.5 -ml-1.5 rounded-full border-2 transform transition-transform ${
                            selectedKeyframeId === kf.id
                              ? 'bg-amber-400 border-white scale-125 z-20 shadow-md shadow-amber-500/50'
                              : 'bg-amber-500 border-black/80 scale-100 z-10'
                          }`}
                          title={`${kf.name} (${(kf.t * duration).toFixed(0)}s)`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Playback Buttons, Outro Badge & Time Display */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center shadow transition-all active:scale-90 flex-shrink-0"
                    title={isPreviewPlaying ? 'Metti in pausa' : 'Riproduci anteprima'}
                  >
                    {isPreviewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                  </button>

                  <span className="text-xs font-mono text-neutral-300 font-bold">
                    {Math.floor(previewProgress * totalDuration)}s / {totalDuration}s
                  </span>

                  {timeProgress.isOutro && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-bold">
                      Zoom Out Finale (4s)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-400 hidden sm:inline">
                    Sinistro: Ruota 360° • Destro: Sposta • Rotella: Zoom
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
