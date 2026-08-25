import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Layers,
  Box,
  Sliders,
  Download,
  RotateCcw,
  Sparkles,
  Printer,
  Palette,
  Loader2,
  Check,
  Upload,
} from 'lucide-react';
import { fetchElevationGrid } from '../lib/elevationContours';
import {
  createTerrainSolidGeometry,
  createTrackTubeGeometry,
  createWaypointMarkers,
} from '../lib/elevation3D';
import {
  exportSingleSTL,
  exportMultiMaterialSTLs,
  exportOBJ,
} from '../lib/stlExporter';

export function ThreeCanvas({ trackData, config, onGpxUpload }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const terrainMeshRef = useRef(null);
  const trackMeshRef = useRef(null);
  const waypointsGroupRef = useRef(null);
  const fileInputRef = useRef(null);

  // 3D Parameters State
  const [elevGrid, setElevGrid] = useState(null);
  const [isLoadingDEM, setIsLoadingDEM] = useState(false);
  const [demProgress, setDemProgress] = useState(0);

  const [heightScale, setHeightScale] = useState(2.0); // 1.0 to 3.5
  const [baseThickness, setBaseThickness] = useState(4.0); // 2 to 12 mm
  const [tubeRadius, setTubeRadius] = useState(1.4); // 0.6 to 3.5 mm
  const [trackLift, setTrackLift] = useState(1.0); // 0.4 to 2.5 mm

  const [terrainColor, setTerrainColor] = useState('#262a34');
  const [track3DColor, setTrack3DColor] = useState(config?.trackColor || '#14b8a6');
  const [viewStyle, setViewStyle] = useState('shaded'); // 'shaded' | 'wireframe' | 'filament'
  const [autoRotate, setAutoRotate] = useState(false);

  const [isExporting3D, setIsExporting3D] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState('');

  const points = trackData?.points || [];

  // 1. Fetch Elevation Grid for 3D relief
  useEffect(() => {
    if (!points || points.length === 0) {
      setElevGrid(null);
      return;
    }

    let isMounted = true;
    setIsLoadingDEM(true);
    setDemProgress(20);

    fetchElevationGrid(
      points,
      { trackPadding: config?.trackPadding ?? 25 },
      (pct) => {
        if (isMounted) setDemProgress(pct);
      }
    )
      .then((grid) => {
        if (isMounted && grid) {
          setElevGrid(grid);
          setIsLoadingDEM(false);
        }
      })
      .catch((err) => {
        console.error('3D DEM fetch error:', err);
        if (isMounted) setIsLoadingDEM(false);
      });

    return () => {
      isMounted = false;
    };
  }, [points, config?.trackPadding]);

  // 2. Initialize Three.js Scene and Viewport
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#12141a');
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 2000);
    camera.position.set(0, -180, 160);
    camera.lookAt(0, 0, 15);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    sunLight.position.set(120, -100, 200);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    fillLight.position.set(-120, 100, 80);
    scene.add(fillLight);

    // Groups
    const waypointsGroup = new THREE.Group();
    scene.add(waypointsGroup);
    waypointsGroupRef.current = waypointsGroup;

    // Mouse Interaction (Orbit Controls logic)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let spherical = { radius: 240, theta: -Math.PI / 2, phi: Math.PI / 3 };

    const updateCameraFromSpherical = () => {
      const x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      const y = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      const z = spherical.radius * Math.cos(spherical.phi);
      camera.position.set(x, y, Math.max(10, z));
      camera.lookAt(0, 0, 15);
    };

    updateCameraFromSpherical();

    const onMouseDown = (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      spherical.theta -= deltaX * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.phi - deltaY * 0.01));

      updateCameraFromSpherical();
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      spherical.radius = Math.max(80, Math.min(600, spherical.radius + e.deltaY * 0.2));
      updateCameraFromSpherical();
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    // Touch Support
    let touchStartDist = 0;
    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 1 && isDragging) {
        const deltaX = e.touches[0].clientX - previousMousePosition.x;
        const deltaY = e.touches[0].clientY - previousMousePosition.y;
        spherical.theta -= deltaX * 0.01;
        spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.phi - deltaY * 0.01));
        updateCameraFromSpherical();
        previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = touchStartDist - dist;
        spherical.radius = Math.max(80, Math.min(600, spherical.radius + delta * 0.5));
        updateCameraFromSpherical();
        touchStartDist = dist;
      }
    };

    const onTouchEnd = () => {
      isDragging = false;
    };

    domElement.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);

    // Animation Loop
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (autoRotate) {
        spherical.theta += 0.005;
        updateCameraFromSpherical();
      }
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      renderer.dispose();
    };
  }, [autoRotate]);

  // 3. Update 3D Meshes when parameters or DEM change
  useEffect(() => {
    if (!sceneRef.current || !elevGrid) return;
    const scene = sceneRef.current;

    try {
      // Clean old meshes safely
      if (terrainMeshRef.current) {
        scene.remove(terrainMeshRef.current);
        if (terrainMeshRef.current.geometry) terrainMeshRef.current.geometry.dispose();
        if (terrainMeshRef.current.material) terrainMeshRef.current.material.dispose();
        terrainMeshRef.current = null;
      }
      if (trackMeshRef.current) {
        scene.remove(trackMeshRef.current);
        if (trackMeshRef.current.geometry) trackMeshRef.current.geometry.dispose();
        if (trackMeshRef.current.material) trackMeshRef.current.material.dispose();
        trackMeshRef.current = null;
      }
      if (waypointsGroupRef.current) {
        while (waypointsGroupRef.current.children.length > 0) {
          const obj = waypointsGroupRef.current.children[0];
          waypointsGroupRef.current.remove(obj);
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        }
      }

      const geomOptions = {
        modelWidth: 140,
        modelHeight: 140,
        baseThickness,
        heightScale,
        maxElevationHeight: 28,
        tubeRadius,
        trackLift,
        trackPadding: config?.trackPadding ?? 25,
      };

      // 1. Create Terrain Solid Mesh
      const terrainGeom = createTerrainSolidGeometry(elevGrid, geomOptions);
      if (terrainGeom) {
        let terrainMat;
        if (viewStyle === 'wireframe') {
          terrainMat = new THREE.MeshBasicMaterial({
            color: terrainColor,
            wireframe: true,
          });
        } else if (viewStyle === 'filament') {
          terrainMat = new THREE.MeshLambertMaterial({
            color: terrainColor,
            flatShading: true,
          });
        } else {
          // Shaded Fine-Art
          terrainMat = new THREE.MeshStandardMaterial({
            color: terrainColor,
            roughness: 0.75,
            metalness: 0.1,
            flatShading: false,
          });
        }

        const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
        terrainMesh.receiveShadow = true;
        terrainMesh.castShadow = true;
        scene.add(terrainMesh);
        terrainMeshRef.current = terrainMesh;
      }

      // 2. Create GPX Track Tube Mesh
      if (points && points.length > 1) {
        const trackGeom = createTrackTubeGeometry(points, elevGrid, geomOptions);
        if (trackGeom) {
          const trackMat = new THREE.MeshStandardMaterial({
            color: track3DColor,
            roughness: 0.3,
            metalness: 0.4,
            emissive: track3DColor,
            emissiveIntensity: 0.25,
          });
          const trackMesh = new THREE.Mesh(trackGeom, trackMat);
          trackMesh.castShadow = true;
          scene.add(trackMesh);
          trackMeshRef.current = trackMesh;
        }
      }

      // 3. Create Waypoint Pin Markers
      if (config?.waypoints && config.waypoints.length > 0) {
        const markers = createWaypointMarkers(config.waypoints, elevGrid, geomOptions);
        markers.forEach((m) => {
          const sphereGeom = new THREE.SphereGeometry(2.0, 16, 16);
          const sphereMat = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            emissive: '#f59e0b',
            emissiveIntensity: 0.5,
          });
          const mesh = new THREE.Mesh(sphereGeom, sphereMat);
          mesh.position.copy(m.position);
          mesh.castShadow = true;
          waypointsGroupRef.current.add(mesh);
        });
      }
    } catch (meshErr) {
      console.error('Error generating 3D meshes:', meshErr);
    }
  }, [
    elevGrid,
    heightScale,
    baseThickness,
    tubeRadius,
    trackLift,
    terrainColor,
    track3DColor,
    viewStyle,
    points,
    config?.waypoints,
    config?.trackPadding,
  ]);

  // Export 3D Handlers
  const handleExportSingleSTL = () => {
    if (!terrainMeshRef.current) return;
    setIsExporting3D(true);
    const title = config?.title || 'trail-3d-model';
    const success = exportSingleSTL(
      terrainMeshRef.current.geometry,
      trackMeshRef.current?.geometry,
      `${title}-modello-stampa-3d.stl`
    );
    if (success) {
      setExportSuccessMsg('STL Monolitico scaricato con successo!');
      setTimeout(() => setExportSuccessMsg(''), 3500);
    }
    setIsExporting3D(false);
  };

  const handleExportMultiMaterial = () => {
    if (!terrainMeshRef.current) return;
    setIsExporting3D(true);
    const title = config?.title || 'trail-3d-model';
    exportMultiMaterialSTLs(
      terrainMeshRef.current.geometry,
      trackMeshRef.current?.geometry,
      title
    );
    setExportSuccessMsg('2 STL Separati scaricati per Bambu AMS / Prusa MMU!');
    setTimeout(() => setExportSuccessMsg(''), 4000);
    setIsExporting3D(false);
  };

  const handleExportOBJ = () => {
    if (!terrainMeshRef.current) return;
    setIsExporting3D(true);
    const title = config?.title || 'trail-3d-model';
    exportOBJ(terrainMeshRef.current.geometry, trackMeshRef.current?.geometry, {
      filename: `${title}-3d-color`,
      terrainColor,
      trackColor: track3DColor,
    });
    setExportSuccessMsg('File OBJ + Materiali scaricati!');
    setTimeout(() => setExportSuccessMsg(''), 3500);
    setIsExporting3D(false);
  };

  const TERRAIN_PRESET_COLORS = [
    { label: 'Ardesia Fine-Art', hex: '#262a34' },
    { label: 'Pietra Dolomite', hex: '#475569' },
    { label: 'Grafite Scura', hex: '#16181e' },
    { label: 'Terracotta Alpina', hex: '#78350f' },
    { label: 'Bianco Neve', hex: '#e2e8f0' },
  ];

  const TRACK_PRESET_COLORS = [
    { label: 'Ciano Neon', hex: '#14b8a6' },
    { label: 'Oro Solare', hex: '#f59e0b' },
    { label: 'Rosso Corallo', hex: '#f43f5e' },
    { label: 'Viola Cyber', hex: '#8b5cf6' },
    { label: 'Verde Smeraldo', hex: '#10b981' },
    { label: 'Bianco Luce', hex: '#ffffff' },
  ];

  return (
    <div className="w-full flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Hidden file input for GPX upload */}
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

      {/* 3D Sidebar Controls (4 Cols on LG) */}
      <div className="lg:col-span-4 h-[calc(100vh-100px)] sticky top-20 flex flex-col space-y-4 overflow-y-auto custom-scrollbar pr-1">
        {/* Card 1: Altimetria & Esagerazione Vette */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-4 bg-[#181a20]/90">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                Rilievo Montuoso (DEM 3D)
              </h3>
            </div>
            {isLoadingDEM && (
              <span className="text-[10px] text-teal-300 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {demProgress}%
              </span>
            )}
          </div>

          {/* Height Scale Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Esagerazione Vette</span>
              <span className="font-mono text-teal-300 font-bold">{heightScale.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="3.5"
              step="0.1"
              value={heightScale}
              onChange={(e) => setHeightScale(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
            <p className="text-[10px] text-neutral-500">
              Aumenta l'esagerazione per rendere le vette più ripide e spettacolari.
            </p>
          </div>

          {/* Base Thickness Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Spessore Base Solida</span>
              <span className="font-mono text-teal-300 font-bold">{baseThickness} mm</span>
            </div>
            <input
              type="range"
              min="2"
              max="12"
              step="1"
              value={baseThickness}
              onChange={(e) => setBaseThickness(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>
        </div>

        {/* Card 2: Personalizzazione Tracciato GPX */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-4 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Sliders className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Tracciato in Rilievo 3D
            </h3>
          </div>

          {/* Tube Radius Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Spessore Traccia</span>
              <span className="font-mono text-teal-300 font-bold">{tubeRadius.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min="0.6"
              max="3.5"
              step="0.1"
              value={tubeRadius}
              onChange={(e) => setTubeRadius(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>

          {/* Track Lift Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Rialzo sul Terreno</span>
              <span className="font-mono text-teal-300 font-bold">{trackLift.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="2.5"
              step="0.1"
              value={trackLift}
              onChange={(e) => setTrackLift(parseFloat(e.target.value))}
              className="w-full accent-teal-500 bg-neutral-800 rounded-lg h-1.5 cursor-pointer"
            />
          </div>
        </div>

        {/* Card 3: Colori & Materiali a Contrasto */}
        <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-4 bg-[#181a20]/90">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Palette className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              Colori e Materiali
            </h3>
          </div>

          {/* Terrain Color */}
          <div className="space-y-2">
            <span className="text-xs text-neutral-400 font-medium block">Colore Paesaggio / Montagne</span>
            <div className="flex items-center gap-2 flex-wrap">
              {TERRAIN_PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setTerrainColor(c.hex)}
                  className={`w-6 h-6 rounded-full border transition-all ${
                    terrainColor === c.hex
                      ? 'border-teal-400 scale-110 ring-2 ring-teal-400/40'
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
              <input
                type="color"
                value={terrainColor}
                onChange={(e) => setTerrainColor(e.target.value)}
                className="w-6 h-6 rounded-full border border-white/20 cursor-pointer bg-transparent"
                title="Colore personalizzato paesaggio"
              />
            </div>
          </div>

          {/* Track Color */}
          <div className="space-y-2">
            <span className="text-xs text-neutral-400 font-medium block">Colore Percorso a Contrasto</span>
            <div className="flex items-center gap-2 flex-wrap">
              {TRACK_PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setTrack3DColor(c.hex)}
                  className={`w-6 h-6 rounded-full border transition-all ${
                    track3DColor === c.hex
                      ? 'border-white scale-110 ring-2 ring-teal-400/40'
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
              <input
                type="color"
                value={track3DColor}
                onChange={(e) => setTrack3DColor(e.target.value)}
                className="w-6 h-6 rounded-full border border-white/20 cursor-pointer bg-transparent"
                title="Colore personalizzato traccia"
              />
            </div>
          </div>

          {/* View Style Segmented Control */}
          <div className="space-y-1.5 pt-1">
            <span className="text-xs text-neutral-400 font-medium block">Stile Visualizzazione 3D</span>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/5 text-[11px]">
              <button
                onClick={() => setViewStyle('shaded')}
                className={`py-1.5 rounded-lg font-semibold transition-all ${
                  viewStyle === 'shaded'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Fine-Art
              </button>
              <button
                onClick={() => setViewStyle('filament')}
                className={`py-1.5 rounded-lg font-semibold transition-all ${
                  viewStyle === 'filament'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Stampa 3D
              </button>
              <button
                onClick={() => setViewStyle('wireframe')}
                className={`py-1.5 rounded-lg font-semibold transition-all ${
                  viewStyle === 'wireframe'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Reticolo
              </button>
            </div>
          </div>
        </div>

        {/* Card 4: Esportazione Stampa 3D (STL / OBJ) */}
        <div className="glass-card p-4 rounded-2xl border border-teal-500/30 space-y-3 bg-[#181a20]/95 shadow-xl">
          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
            <Printer className="w-4 h-4 text-teal-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-200">
              Esporta Modello 3D (.STL / .OBJ)
            </h3>
          </div>

          {exportSuccessMsg && (
            <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl flex items-center gap-2 animate-fadeIn">
              <Check className="w-4 h-4" />
              <span>{exportSuccessMsg}</span>
            </div>
          )}

          <div className="space-y-2">
            {/* Multi-Material STL Button (Recommended) */}
            <button
              onClick={handleExportMultiMaterial}
              disabled={isExporting3D || !elevGrid}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white text-xs font-bold shadow-lg shadow-teal-500/20 transition-all hover:scale-[1.01] active:scale-98 disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-300" />
                <div className="text-left">
                  <p>Doppio STL Multi-Colore</p>
                  <p className="text-[10px] font-normal text-teal-100 opacity-80">
                    Per Bambu AMS / Prusa MMU (2 file separati)
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4" />
            </button>

            {/* Single STL Monolithic */}
            <button
              onClick={handleExportSingleSTL}
              disabled={isExporting3D || !elevGrid}
              className="w-full flex items-center justify-between p-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold transition-all active:scale-98 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-neutral-400" />
                <span>STL Singolo Monolitico</span>
              </div>
              <Download className="w-3.5 h-3.5 text-neutral-400" />
            </button>

            {/* OBJ + MTL */}
            <button
              onClick={handleExportOBJ}
              disabled={isExporting3D || !elevGrid}
              className="w-full flex items-center justify-between p-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold transition-all active:scale-98 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-neutral-400" />
                <span>Modello OBJ + Texture Colore</span>
              </div>
              <Download className="w-3.5 h-3.5 text-neutral-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Central 3D Interactive Viewport (8 Cols on LG) */}
      <div className="lg:col-span-8 flex flex-col items-center justify-center glass-panel rounded-2xl min-h-[calc(100vh-100px)] border border-white/10 relative overflow-hidden bg-[#12141a]">
        {/* Floating 3D Controls Bar Top */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="glass-panel-subtle px-3.5 py-1.5 rounded-full border border-white/10 pointer-events-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs font-mono tracking-wider text-neutral-300 uppercase">
              3D Relief Studio • Watertight Mesh
            </span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`p-2 rounded-xl border text-xs font-semibold transition-all shadow-md ${
                autoRotate
                  ? 'border-teal-500 bg-teal-500/20 text-teal-300 ring-2 ring-teal-500/30'
                  : 'border-white/10 bg-black/60 text-neutral-300 hover:bg-black/80'
              }`}
              title="Attiva/Disattiva Rotazione Automatica"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* If no track loaded yet, show prompt */}
        {(!points || points.length === 0) ? (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 z-10">
            <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Box className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Nessuna traccia caricata</h3>
              <p className="text-xs text-neutral-400 max-w-md">
                Carica una traccia GPX per generare il rilievo 3D con montagne e sentiero estruso.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-teal-500/20 transition-all active:scale-95"
            >
              <Upload className="w-4 h-4" />
              <span>Carica File GPX</span>
            </button>
          </div>
        ) : (
          /* 3D Canvas WebGL Container */
          <div
            ref={containerRef}
            className="w-full h-[calc(100vh-130px)] min-h-[550px] cursor-grab active:cursor-grabbing flex items-center justify-center"
          />
        )}

        {/* Floating Instructions Bottom */}
        {points && points.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
            <span className="text-[11px] font-mono text-neutral-400 bg-neutral-950/80 px-4 py-1.5 rounded-full border border-white/10 shadow-lg backdrop-blur-md">
              🖱️ Trascina per ruotare a 360° • Rotella per Zoom • Shift + Trascina per Pan
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
