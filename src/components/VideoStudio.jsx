import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  Video,
  Camera,
  Mountain,
  Map,
  Palette,
  Timer,
  Sliders,
  Download,
  Play,
  Square,
  RotateCcw,
  Loader2,
  Check,
  AlertTriangle,
  Monitor,
  Smartphone,
  Upload,
  Sparkles,
  Sun,
  Eye,
} from 'lucide-react';
import { buildTerrainScene, MAP_STYLES } from '../lib/terrainEngine';
import { createCameraController, CAMERA_MODES, resetCameraState } from '../lib/cameraSystem';
import { exportVideo, downloadVideo, isVideoExportSupported } from '../lib/videoExporter';

export function VideoStudio({ trackData, config, onGpxUpload }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneDataRef = useRef(null);
  const cameraCtrlRef = useRef(null);
  const animIdRef = useRef(null);
  const fileInputRef = useRef(null);

  // Scene State
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildMessage, setBuildMessage] = useState('');
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState(null);

  // Controls State
  const [mapStyle, setMapStyle] = useState('satellite');
  const [cameraMode, setCameraMode] = useState('drone');
  const [heightExaggeration, setHeightExaggeration] = useState(1.5);
  const [trackColor, setTrackColor] = useState(config?.trackColor || '#14b8a6');
  const [trackWidth, setTrackWidth] = useState(2.0);
  const [duration, setDuration] = useState(30);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [sunIntensity, setSunIntensity] = useState(1.5);

  // Preview State
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewStartRef = useRef(null);

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [exportedUrl, setExportedUrl] = useState(null);
  const [exportError, setExportError] = useState(null);

  const points = trackData?.points || [];

  // Build 3D scene when track or settings change
  const buildScene = useCallback(async () => {
    if (!points || points.length < 2) return;

    setIsBuilding(true);
    setBuildProgress(0);
    setBuildMessage('Inizializzazione...');
    setSceneReady(false);
    setSceneError(null);

    // Dispose previous scene
    if (sceneDataRef.current) {
      sceneDataRef.current.dispose();
      sceneDataRef.current = null;
    }
    if (animIdRef.current) {
      cancelAnimationFrame(animIdRef.current);
      animIdRef.current = null;
    }

    try {
      const sceneData = await buildTerrainScene(points, {
        mapStyle,
        heightExaggeration,
        trackColor,
        trackWidth,
        padding: 0.3,
      }, (pct, msg) => {
        setBuildProgress(pct);
        setBuildMessage(msg);
      });

      sceneDataRef.current = sceneData;

      // Create camera controller
      const ctrl = createCameraController(sceneData.trackCurve, sceneData.worldBounds);
      cameraCtrlRef.current = ctrl;

      // Initialize renderer if needed
      if (!rendererRef.current && containerRef.current) {
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        rendererRef.current = renderer;
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(renderer.domElement);
      }

      // Set renderer size
      if (rendererRef.current && containerRef.current) {
        const w = containerRef.current.clientWidth || 800;
        const h = containerRef.current.clientHeight || 450;
        rendererRef.current.setSize(w, h);
        sceneData.camera.aspect = w / h;
        sceneData.camera.updateProjectionMatrix();
      }

      // Initial camera position
      ctrl.updateCamera(sceneData.camera, 0, cameraMode);

      setSceneReady(true);
      setPreviewProgress(0);

      // Start render loop
      const animate = () => {
        animIdRef.current = requestAnimationFrame(animate);
        if (rendererRef.current && sceneDataRef.current) {
          rendererRef.current.render(sceneDataRef.current.scene, sceneDataRef.current.camera);
        }
      };
      animate();

    } catch (err) {
      console.error('Error building terrain scene:', err);
      setSceneError(err.message || 'Errore nella costruzione della scena 3D');
    } finally {
      setIsBuilding(false);
    }
  }, [points, mapStyle, heightExaggeration, trackColor, trackWidth, cameraMode]);

  // Build scene when track loads or key settings change
  useEffect(() => {
    if (points.length >= 2) {
      buildScene();
    }
    return () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
    };
  }, [points, mapStyle, heightExaggeration, trackColor, trackWidth]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (!rendererRef.current || !containerRef.current || !sceneDataRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
      sceneDataRef.current.camera.aspect = w / h;
      sceneDataRef.current.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Preview animation loop
  useEffect(() => {
    if (!isPreviewPlaying || !sceneDataRef.current || !cameraCtrlRef.current) return;

    previewStartRef.current = Date.now() - (previewProgress * duration * 1000);

    const previewLoop = () => {
      const elapsed = (Date.now() - previewStartRef.current) / 1000;
      const t = Math.min(elapsed / duration, 1.0);

      setPreviewProgress(t);
      sceneDataRef.current.updateProgress(t);
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, t, cameraMode);

      if (t >= 1.0) {
        setIsPreviewPlaying(false);
        return;
      }

      requestAnimationFrame(previewLoop);
    };

    requestAnimationFrame(previewLoop);
  }, [isPreviewPlaying, cameraMode, duration]);

  // Update preview when scrubbing
  useEffect(() => {
    if (isPreviewPlaying || !sceneDataRef.current || !cameraCtrlRef.current) return;
    sceneDataRef.current.updateProgress(previewProgress);
    cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, previewProgress, cameraMode);
  }, [previewProgress, cameraMode]);

  // Reset camera state when mode changes
  useEffect(() => {
    if (cameraCtrlRef.current) {
      resetCameraState(cameraCtrlRef.current);
      if (sceneDataRef.current) {
        cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, previewProgress, cameraMode);
      }
    }
  }, [cameraMode]);

  // Handle preview controls
  const togglePreview = () => {
    if (isPreviewPlaying) {
      setIsPreviewPlaying(false);
    } else {
      if (previewProgress >= 1.0) {
        setPreviewProgress(0);
        if (cameraCtrlRef.current) resetCameraState(cameraCtrlRef.current);
      }
      setIsPreviewPlaying(true);
    }
  };

  const resetPreview = () => {
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
    if (cameraCtrlRef.current) {
      resetCameraState(cameraCtrlRef.current);
    }
    if (sceneDataRef.current) {
      sceneDataRef.current.updateProgress(0);
      if (cameraCtrlRef.current) {
        cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, 0, cameraMode);
      }
    }
  };

  // Handle video export
  const handleExport = async () => {
    if (!sceneDataRef.current || !rendererRef.current) return;

    if (!isVideoExportSupported()) {
      setExportError('Il tuo browser non supporta WebCodecs. Usa Chrome, Edge o Opera per esportare video.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportMessage('Preparazione...');
    setExportError(null);
    setExportedUrl(null);
    setIsPreviewPlaying(false);

    // Reset camera for clean export
    if (cameraCtrlRef.current) resetCameraState(cameraCtrlRef.current);

    const [w, h] = aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080];

    try {
      const blobUrl = await exportVideo({
        renderer: rendererRef.current,
        scene: sceneDataRef.current.scene,
        camera: sceneDataRef.current.camera,
        updateFrame: (progress) => {
          sceneDataRef.current.updateProgress(progress);
          cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, progress, cameraMode);
        },
        options: {
          width: w,
          height: h,
          fps: 30,
          durationSec: duration,
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
      console.error('Video export error:', err);
      setExportError(err.message || 'Errore durante la generazione del video');
    } finally {
      setIsExporting(false);
      // Restore preview
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

  // Preset colors
  const TRACK_COLORS = [
    { label: 'Ciano Neon', hex: '#14b8a6' },
    { label: 'Oro Solare', hex: '#f59e0b' },
    { label: 'Rosso Corallo', hex: '#f43f5e' },
    { label: 'Viola Cyber', hex: '#8b5cf6' },
    { label: 'Verde Smeraldo', hex: '#10b981' },
    { label: 'Bianco Luce', hex: '#ffffff' },
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

      {/* Sidebar Controls */}
      <div className="lg:col-span-4 h-[calc(100vh-100px)] sticky top-20 flex flex-col space-y-3 overflow-y-auto custom-scrollbar pr-1">

        {/* Card 1: Map Style */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Map className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Stile Mappa
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(MAP_STYLES).map(([key, style]) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={`p-2.5 rounded-xl text-xs font-semibold text-left transition-all border ${
                  mapStyle === key
                    ? 'border-teal-500 bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <span className="text-base mr-1.5">
                  {key === 'satellite' ? '🛰️' : key === 'topo' ? '🗻' : key === 'osm' ? '🗺️' : '🌿'}
                </span>
                {style.name}
              </button>
            ))}
          </div>
        </div>

        {/* Card 2: Camera Mode */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Camera className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Modalità Camera
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CAMERA_MODES).map(([key, mode]) => (
              <button
                key={key}
                onClick={() => setCameraMode(key)}
                className={`p-2 rounded-xl text-left transition-all border ${
                  cameraMode === key
                    ? 'border-teal-500 bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <div className="text-base mb-0.5">{mode.icon}</div>
                <p className="text-[11px] font-bold">{mode.name}</p>
                <p className="text-[9px] text-neutral-500 leading-tight">{mode.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Card 3: Terrain & Track Settings */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-4 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Mountain className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Terreno e Traccia
            </h3>
          </div>

          {/* Height Exaggeration */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Esagerazione Rilievo</span>
              <span className="font-mono text-teal-300 font-bold">{heightExaggeration.toFixed(1)}×</span>
            </div>
            <input
              type="range" min="0.5" max="3.0" step="0.1"
              value={heightExaggeration}
              onChange={(e) => setHeightExaggeration(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          {/* Track Width */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Spessore Traccia</span>
              <span className="font-mono text-teal-300 font-bold">{trackWidth.toFixed(1)}</span>
            </div>
            <input
              type="range" min="1.0" max="5.0" step="0.5"
              value={trackWidth}
              onChange={(e) => setTrackWidth(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          {/* Track Color */}
          <div className="space-y-2">
            <span className="text-xs text-neutral-400 font-medium block">Colore Traccia</span>
            <div className="flex items-center gap-2 flex-wrap">
              {TRACK_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setTrackColor(c.hex)}
                  className={`w-6 h-6 rounded-full border transition-all ${
                    trackColor === c.hex
                      ? 'border-teal-400 scale-110 ring-2 ring-teal-400/40'
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
              <input
                type="color" value={trackColor}
                onChange={(e) => setTrackColor(e.target.value)}
                className="w-6 h-6 rounded-full border border-white/20 cursor-pointer bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* Card 4: Video Settings */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-4 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Video className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Impostazioni Video
            </h3>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400 font-medium block">Durata Video</span>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5 text-[11px]">
              {[15, 30, 45, 60].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`py-1.5 rounded-lg font-semibold transition-all ${
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

          {/* Aspect Ratio */}
          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400 font-medium block">Formato</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  aspectRatio === '16:9'
                    ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <Monitor className="w-4 h-4" />
                16:9 Orizzontale
              </button>
              <button
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  aspectRatio === '9:16'
                    ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                9:16 Reels
              </button>
            </div>
          </div>
        </div>

        {/* Card 5: Export */}
        <div className="glass-card p-4 rounded-2xl border border-teal-500/30 space-y-3 bg-[#181a20]/95 shadow-xl">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-200">
              Genera Video MP4
            </h3>
          </div>

          {!isVideoExportSupported() && (
            <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>WebCodecs non supportato. Usa Chrome, Edge o Opera.</span>
            </div>
          )}

          {exportError && (
            <div className="p-2.5 bg-red-500/15 border border-red-500/30 text-red-300 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {isExporting && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {exportMessage}
                </span>
                <span className="font-mono text-teal-300 font-bold">{exportProgress}%</span>
              </div>
              <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          )}

          {exportedUrl && !isExporting && (
            <div className="space-y-2">
              <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>Video MP4 generato con successo!</span>
              </div>
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white text-xs font-bold shadow-lg transition-all hover:scale-[1.01] active:scale-95"
              >
                <Download className="w-4 h-4" />
                Scarica Video MP4
              </button>
            </div>
          )}

          {!isExporting && !exportedUrl && (
            <button
              onClick={handleExport}
              disabled={!sceneReady || !isVideoExportSupported()}
              className="w-full flex items-center justify-center gap-2.5 p-3 rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white text-xs font-bold shadow-lg shadow-teal-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Video className="w-4 h-4" />
              <span>Genera Video {aspectRatio === '9:16' ? '1080×1920' : '1920×1080'} • {duration}s • 30fps</span>
            </button>
          )}

          <p className="text-[9px] text-neutral-500 text-center">
            MP4 H.264 • {duration * 30} frame • ~{Math.round(duration * 8 / 8)}MB stimati
          </p>
        </div>
      </div>

      {/* Central 3D Viewport */}
      <div className="lg:col-span-8 flex flex-col items-center justify-center glass-panel rounded-2xl min-h-[calc(100vh-100px)] border border-white/10 relative overflow-hidden bg-[#12141a]">

        {/* Top Bar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="glass-panel-subtle px-3.5 py-1.5 rounded-full border border-white/10 pointer-events-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono tracking-wider text-neutral-300 uppercase">
              Video Studio • {CAMERA_MODES[cameraMode]?.name || 'Drone'}
            </span>
          </div>

          {sceneReady && (
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={resetPreview}
                className="p-2 rounded-xl border border-white/10 bg-black/60 text-neutral-300 hover:bg-black/80 transition-all"
                title="Riavvia dall'inizio"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Loading overlay */}
        {isBuilding && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#12141a]/95 backdrop-blur-md">
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white mb-1">Costruzione Scena 3D</p>
                <p className="text-xs text-neutral-400">{buildMessage}</p>
              </div>
              <div className="w-48 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-300"
                  style={{ width: `${buildProgress}%` }}
                />
              </div>
              <span className="text-xs font-mono text-teal-300">{buildProgress}%</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {sceneError && !isBuilding && (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-10">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Errore nella Scena 3D</h3>
              <p className="text-xs text-neutral-400 max-w-md">{sceneError}</p>
            </div>
            <button
              onClick={buildScene}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Riprova
            </button>
          </div>
        )}

        {/* No track prompt */}
        {(!points || points.length < 2) && !isBuilding && (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-10">
            <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Video className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Nessuna traccia caricata</h3>
              <p className="text-xs text-neutral-400 max-w-md">
                Carica una traccia GPX per generare il video flyover 3D con terreno reale e camera cinematografica.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow-lg transition-all active:scale-95"
            >
              <Upload className="w-4 h-4" />
              Carica File GPX
            </button>
          </div>
        )}

        {/* 3D Canvas */}
        <div
          ref={containerRef}
          className="w-full h-[calc(100vh-190px)] min-h-[400px]"
          style={{ display: sceneReady && !isBuilding ? 'block' : 'none' }}
        />

        {/* Bottom Playback Controls */}
        {sceneReady && !isBuilding && (
          <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-[#12141a] to-transparent">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={togglePreview}
                className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center shadow-lg transition-all active:scale-90"
              >
                {isPreviewPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>

              {/* Timeline Scrubber */}
              <div className="flex-1 space-y-1">
                <input
                  type="range"
                  min="0" max="1" step="0.001"
                  value={previewProgress}
                  onChange={(e) => {
                    setIsPreviewPlaying(false);
                    setPreviewProgress(parseFloat(e.target.value));
                  }}
                  className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
                />
              </div>

              {/* Time Display */}
              <span className="text-xs font-mono text-neutral-400 w-20 text-right">
                {Math.floor(previewProgress * duration)}s / {duration}s
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
