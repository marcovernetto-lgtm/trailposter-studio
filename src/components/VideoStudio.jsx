import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
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
  Layers,
  Sliders,
  Maximize2,
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

  // Scene & Building State
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildMessage, setBuildMessage] = useState('');
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState(null);

  // Visual & Quality Settings
  const [heightExaggeration, setHeightExaggeration] = useState(1.6);
  const [trackColor, setTrackColor] = useState(config?.trackColor || '#14b8a6');
  const [trackWidth, setTrackWidth] = useState(2.2);
  const [duration, setDuration] = useState(30);
  const [aspectRatio, setAspectRatio] = useState('16:9');

  // Camera & Director Mode
  const [directorType, setDirectorType] = useState('auto'); // 'auto' | 'keyframe'
  const [cameraMode, setCameraMode] = useState('drone'); // 'drone', 'eagle', 'cinematic', etc.
  const [keyframes, setKeyframes] = useState([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState(null);

  // Preview & Timeline State
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewStartTimeRef = useRef(null);
  const isUserOrbitingRef = useRef(false);

  // Video Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [exportedUrl, setExportedUrl] = useState(null);
  const [exportError, setExportError] = useState(null);

  const points = trackData?.points || [];

  // Build 3D Terrain & Track Scene
  const buildScene = useCallback(async () => {
    if (!points || points.length < 2) return;

    setIsBuilding(true);
    setBuildProgress(0);
    setBuildMessage('Inizializzazione satellite HD...');
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

    try {
      const sceneData = await buildTerrainScene(
        points,
        {
          heightExaggeration,
          trackColor,
          trackWidth,
          padding: 0.35,
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
        rendererRef.current = renderer;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);
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
      ctrl.updateCamera(sceneData.camera, 0, activeMode, keyframes);

      setSceneReady(true);
      setPreviewProgress(0);
      setIsPreviewPlaying(false);

      // Start continuous animation loop
      const animate = () => {
        animIdRef.current = requestAnimationFrame(animate);
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
  }, [points, heightExaggeration, trackColor, trackWidth]);

  // Initial load & trigger build on point/elevation changes
  useEffect(() => {
    if (points.length >= 2) {
      buildScene();
    }
    return () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
    };
  }, [points, heightExaggeration, trackColor, trackWidth]);

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

  // Interactive 3D Orbit, Pan & Zoom Controls for Manual Camera Framing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDragging = false;
    let dragButton = 0; // 0 = left (orbit), 2 = right (pan)
    let prevMouse = { x: 0, y: 0 };

    const onMouseDown = (e) => {
      if (e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'input') return;
      isDragging = true;
      dragButton = e.button;
      isUserOrbitingRef.current = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (!isDragging || !sceneDataRef.current) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };

      const camera = sceneDataRef.current.camera;

      if (dragButton === 0) {
        // Left Drag: Orbit around track target
        const rotSpeed = 0.005;
        const currentPos = camera.position.clone();
        camera.position.x = currentPos.x * Math.cos(dx * rotSpeed) - currentPos.z * Math.sin(dx * rotSpeed);
        camera.position.z = currentPos.x * Math.sin(dx * rotSpeed) + currentPos.z * Math.cos(dx * rotSpeed);
        camera.position.y = Math.max(10, currentPos.y + dy * 0.8);
      } else {
        // Right Drag / Pan: Lateral move
        camera.position.x -= dx * 0.6;
        camera.position.z -= dy * 0.6;
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e) => {
      if (!sceneDataRef.current) return;
      e.preventDefault();
      const camera = sceneDataRef.current.camera;
      const zoomFactor = e.deltaY * 0.3;
      camera.position.y = Math.max(8, camera.position.y + zoomFactor);
    };

    const onContextMenu = (e) => e.preventDefault();

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('contextmenu', onContextMenu);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Preview Animation Playback Loop
  useEffect(() => {
    if (!isPreviewPlaying || !sceneDataRef.current || !cameraCtrlRef.current) return;

    let localAnimId;
    previewStartTimeRef.current = Date.now() - previewProgress * duration * 1000;

    const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;

    const loop = () => {
      const elapsed = (Date.now() - previewStartTimeRef.current) / 1000;
      const t = Math.min(elapsed / duration, 1.0);

      setPreviewProgress(t);
      sceneDataRef.current.updateProgress(t);
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, t, activeMode, keyframes);

      if (t >= 1.0) {
        setIsPreviewPlaying(false);
        return;
      }

      localAnimId = requestAnimationFrame(loop);
    };

    localAnimId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(localAnimId);
  }, [isPreviewPlaying, cameraMode, directorType, keyframes, duration]);

  // Scrubbing Timeline Slider
  const handleScrub = (val) => {
    setIsPreviewPlaying(false);
    setPreviewProgress(val);
    if (sceneDataRef.current && cameraCtrlRef.current) {
      sceneDataRef.current.updateProgress(val);
      const activeMode = directorType === 'keyframe' ? 'keyframe' : cameraMode;
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, val, activeMode, keyframes);
    }
  };

  // Switch Camera Preset
  const handleCameraModeChange = (mode) => {
    setDirectorType('auto');
    setCameraMode(mode);
    if (cameraCtrlRef.current) {
      resetCameraState(cameraCtrlRef.current);
      if (sceneDataRef.current) {
        cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, previewProgress, mode, keyframes);
      }
    }
  };

  // Add Keyframe at Current Scrubber Position with Current 3D Camera View
  const handleAddKeyframe = () => {
    if (!sceneDataRef.current) return;

    const camera = sceneDataRef.current.camera;
    const currentTrackPt = sceneDataRef.current.trackCurve.getPointAt(Math.min(0.999, previewProgress));

    const newKf = {
      id: `kf-${Date.now()}`,
      t: parseFloat(previewProgress.toFixed(3)),
      name: `Scena a ${(previewProgress * duration).toFixed(0)}s`,
      position: camera.position.clone(),
      lookAt: currentTrackPt.clone(),
    };

    const updated = [...keyframes.filter((k) => Math.abs(k.t - previewProgress) > 0.02), newKf].sort(
      (a, b) => a.t - b.t
    );

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
    handleScrub(kf.t);
    setSelectedKeyframeId(kf.id);
    if (sceneDataRef.current) {
      sceneDataRef.current.camera.position.copy(kf.position);
      sceneDataRef.current.camera.lookAt(kf.lookAt);
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
      cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, 0, activeMode, keyframes);
    }
  };

  // Video Export Handler (WebCodecs MP4 1080p)
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
        updateFrame: (progress) => {
          sceneDataRef.current.updateProgress(progress);
          cameraCtrlRef.current.updateCamera(sceneDataRef.current.camera, progress, activeMode, keyframes);
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
    { label: 'Ciano Neon', hex: '#14b8a6' },
    { label: 'Oro Solare', hex: '#f59e0b' },
    { label: 'Rosso Corallo', hex: '#f43f5e' },
    { label: 'Viola Cyber', hex: '#8b5cf6' },
    { label: 'Verde Smeraldo', hex: '#10b981' },
    { label: 'Bianco Puro', hex: '#ffffff' },
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

      {/* Sidebar Controls (Left - 4 Cols on LG) */}
      <div className="lg:col-span-4 h-[calc(100vh-100px)] sticky top-20 flex flex-col space-y-3.5 overflow-y-auto custom-scrollbar pr-1">
        {/* Card 1: Satellite HD Badge & Reload */}
        <div className="glass-card p-3.5 rounded-2xl border border-teal-500/30 bg-[#181a20]/95 shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🛰️</span>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                Satellite HD Max Resolution
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </h3>
              <p className="text-[10px] text-teal-300">Texture fotorealistica con filtro anisotropico 16×</p>
            </div>
          </div>
          <button
            onClick={buildScene}
            disabled={isBuilding}
            className="text-neutral-400 hover:text-teal-300 transition-colors p-1.5 rounded-lg hover:bg-white/5"
            title="Ricarica Terreno 3D"
          >
            <RefreshCw className={`w-4 h-4 ${isBuilding ? 'animate-spin text-teal-400' : ''}`} />
          </button>
        </div>

        {/* Card 2: Regia Telecamera (Automatica vs Keyframe Manuale) */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3 bg-[#181a20]/95 shadow-lg">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Regia Telecamera
              </h3>
            </div>

            {/* Switcher Automatica vs Manuale */}
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
                Keyframe 🎬
              </button>
            </div>
          </div>

          {directorType === 'auto' ? (
            /* Modalità Automatiche Fluidissime */
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CAMERA_MODES)
                .filter(([k]) => k !== 'keyframe')
                .map(([key, mode]) => (
                  <button
                    key={key}
                    onClick={() => handleCameraModeChange(key)}
                    className={`p-2.5 rounded-xl text-left transition-all border ${
                      cameraMode === key
                        ? 'border-teal-500 bg-teal-500/20 text-teal-200 ring-1 ring-teal-500/30'
                        : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{mode.icon}</div>
                    <p className="text-xs font-bold text-white">{mode.name}</p>
                    <p className="text-[9px] text-neutral-400 leading-tight mt-0.5">{mode.description}</p>
                  </button>
                ))}
            </div>
          ) : (
            /* Modalità Regia Manuale con Keyframe */
            <div className="space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-300 font-semibold flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  Keyframe sulla Timeline ({keyframes.length})
                </span>
                <button
                  onClick={handleResetToAutoKeyframes}
                  className="text-[10px] text-teal-300 hover:underline"
                >
                  Genera 5 Punti Base
                </button>
              </div>

              {/* Add Keyframe Button */}
              <button
                onClick={handleAddKeyframe}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white text-xs font-bold shadow-lg transition-all active:scale-98"
              >
                <Plus className="w-4 h-4" />
                <span>Salva Inquadratura Corrente a {(previewProgress * duration).toFixed(0)}s</span>
              </button>

              {/* Keyframe List */}
              <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                {keyframes.map((kf, idx) => (
                  <div
                    key={kf.id}
                    onClick={() => handleJumpToKeyframe(kf)}
                    className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all ${
                      selectedKeyframeId === kf.id
                        ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                        : 'border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center font-mono font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-white text-[11px]">{kf.name}</p>
                        <p className="text-[9px] text-neutral-400 font-mono">
                          Tempo: {(kf.t * duration).toFixed(1)}s ({(kf.t * 100).toFixed(0)}%)
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveKeyframe(kf.id);
                      }}
                      className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Elimina keyframe"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <p className="text-[9px] text-neutral-400 italic">
                💡 Muovi la visuale con il mouse nella finestra 3D per inquadrare, sposta la timeline e premi "Salva Inquadratura".
              </p>
            </div>
          )}
        </div>

        {/* Card 3: Rilievo Altimetrico & Traccia 3D */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3.5 bg-[#181a20]/95 shadow-lg">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Mountain className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Rilievo Montuoso & Tracciato
            </h3>
          </div>

          {/* Height Exaggeration */}
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
            <p className="text-[9px] text-neutral-500">
              1.0× = Proporzioni naturali reali • 1.6×-2.5× = Rilievo montuoso cinematografico
            </p>
          </div>

          {/* Track Width */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Spessore Traccia 3D</span>
              <span className="font-mono text-teal-300 font-bold">{trackWidth.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="4.5"
              step="0.2"
              value={trackWidth}
              onChange={(e) => setTrackWidth(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          {/* Track Color */}
          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400 font-medium block">Colore Traccia Neon</span>
            <div className="flex items-center gap-2 flex-wrap">
              {TRACK_PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setTrackColor(c.hex)}
                  className={`w-6 h-6 rounded-full border transition-all ${
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
                className="w-6 h-6 rounded-full border border-white/20 cursor-pointer bg-transparent"
                title="Colore personalizzato traccia"
              />
            </div>
          </div>
        </div>

        {/* Card 4: Formato Video & Durata */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3.5 bg-[#181a20]/95 shadow-lg">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Video className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Formato & Durata Video
            </h3>
          </div>

          {/* Duration Buttons */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Durata Video</span>
              <span className="font-mono text-teal-300 font-bold">{duration} Secondi</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5 text-xs">
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

          {/* Aspect Ratio Buttons */}
          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400 font-medium block">Proporzioni Video</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  aspectRatio === '16:9'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <Monitor className="w-4 h-4" />
                16:9 Orizzontale
              </button>
              <button
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  aspectRatio === '9:16'
                    ? 'border-teal-500 bg-teal-500/20 text-teal-300'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                9:16 Reels / TikTok
              </button>
            </div>
          </div>
        </div>

        {/* Card 5: Generazione & Esportazione MP4 */}
        <div className="glass-card p-4 rounded-2xl border border-teal-500/40 space-y-3 bg-[#181a20]/95 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-200">
              Esporta Video MP4 Full HD (1080p)
            </h3>
          </div>

          {!isVideoExportSupported() && (
            <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>WebCodecs non supportato. Usa Chrome, Edge o Opera per esportare video MP4.</span>
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
                <span className="text-neutral-400 flex items-center gap-1.5 truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  {exportMessage}
                </span>
                <span className="font-mono text-teal-300 font-bold">{exportProgress}%</span>
              </div>
              <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-200"
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
                Scarica Video MP4 (1080p)
              </button>
            </div>
          )}

          {!isExporting && !exportedUrl && (
            <button
              onClick={handleExport}
              disabled={!sceneReady || !isVideoExportSupported()}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white text-xs font-bold shadow-lg shadow-teal-500/20 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Video className="w-4 h-4" />
              <span>Genera Video {aspectRatio === '9:16' ? '1080×1920' : '1920×1080'} • {duration}s</span>
            </button>
          )}

          <p className="text-[10px] text-neutral-500 text-center">
            MP4 H.264 • {duration * 30} fotogrammi renderizzati a 30fps
          </p>
        </div>
      </div>

      {/* Central 3D Interactive Viewport (Right - 8 Cols on LG) */}
      <div className="lg:col-span-8 flex flex-col items-center justify-center glass-panel rounded-2xl min-h-[calc(100vh-100px)] border border-white/10 relative overflow-hidden bg-[#10141d]">
        {/* Top Floating Status Bar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="glass-panel-subtle px-3.5 py-1.5 rounded-full border border-white/10 pointer-events-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono tracking-wider text-neutral-200 uppercase">
              {directorType === 'keyframe'
                ? `Regia Keyframe (${keyframes.length} scene)`
                : `Regia Auto • ${CAMERA_MODES[cameraMode]?.name}`}
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

        {/* Loading Overlay */}
        {isBuilding && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#10141d]/90 backdrop-blur-md">
            <div className="flex flex-col items-center gap-4 max-w-sm text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shadow-xl">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-bold text-white mb-1">Caricamento Satellite HD</p>
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
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-8 h-8" />
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
            <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Compass className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Nessuna traccia GPX caricata</h3>
              <p className="text-xs text-neutral-400 max-w-md">
                Carica una traccia GPX per generare il rilievo 3D fotorealistico e il video flyover cinematografico.
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

        {/* 3D WebGL Canvas Container */}
        <div
          ref={containerRef}
          className="w-full h-[calc(100vh-140px)] min-h-[500px] cursor-grab active:cursor-grabbing flex items-center justify-center"
        />

        {/* Bottom Playback & Scrubber Controls */}
        {sceneReady && !isBuilding && (
          <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-[#10141d]/95 via-[#10141d]/70 to-transparent backdrop-blur-sm">
            <div className="flex flex-col gap-2 max-w-3xl mx-auto bg-black/70 p-3 rounded-2xl border border-white/10 shadow-2xl">
              {/* Timeline with Keyframe Visual Markers */}
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
                    {keyframes.map((kf) => (
                      <div
                        key={kf.id}
                        style={{ left: `${kf.t * 100}%` }}
                        className={`absolute w-3 h-3 -ml-1.5 rounded-full border-2 transform transition-transform ${
                          selectedKeyframeId === kf.id
                            ? 'bg-amber-400 border-white scale-125 z-20'
                            : 'bg-amber-500 border-black/80 scale-100 z-10'
                        }`}
                        title={`${kf.name} (${(kf.t * duration).toFixed(0)}s)`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Playback Buttons & Time Display */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  {/* Play / Pause Button */}
                  <button
                    onClick={togglePlay}
                    className="w-9 h-9 rounded-xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center shadow-lg transition-all active:scale-90 flex-shrink-0"
                    title={isPreviewPlaying ? 'Metti in pausa' : 'Riproduci anteprima'}
                  >
                    {isPreviewPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  <span className="text-xs font-mono text-neutral-300 font-bold">
                    {Math.floor(previewProgress * duration)}s / {duration}s
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-400 hidden sm:inline">
                    🖱️ Tasto Sinistro: Ruota 3D • Tasto Destro: Sposta • Rotella: Zoom
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
