import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { PosterCanvas } from './components/PosterCanvas';
import { VideoStudio } from './components/VideoStudio';
import { ProjectsModal } from './components/ProjectsModal';
import { parseGPX } from './lib/gpxParser';
import { exportPoster } from './lib/exportPoster';
import {
  autoSaveDraft,
  loadAutoSaveDraft,
  getSavedProjects,
  saveProject,
} from './lib/projectStorage';
import { usePwaInstall } from './hooks/usePwaInstall';

export const DEFAULT_CONFIG = {
  title: 'IL TUO PERCORSO',
  subtitle: 'Data o Sottotitolo',
  details: 'Distanza • Giorni • Dislivello',
  fontFamily: 'Outfit',
  titleFontSize: 34,
  letterSpacing: 6,
  textColor: '#ffffff',
  textLayout: 'bottom',
  showCoordinates: true,

  bgColor: '#16181e',
  bgType: 'solid',
  bgGradient: 'linear-gradient(135deg, #16181e 0%, #232733 100%)',
  showTopo: true,
  topoOpacity: 0.15,
  topoSeed: 12345,
  contourInterval: 'auto',
  showContourLabels: false,
  contourStyle: 'medium',
  contourEdgeFade: 12,
  contourFade: 28,
  contourColorMode: 'text',
  contourCustomColor: '#ffffff',

  showBorder: true,
  borderStyle: 'classic',
  borderOpacity: 0.15,
  orientation: 'portrait',
  dividerIcon: 'mountain',
  showGrid: false,

  showElevationChart: false,
  showElevationWaypoints: true,
  elevationPosition: 'below_text',
  elevationStyle: 'gradient',

  trackColor: '#ff5500',
  trackWidth: 5.0,
  trackPadding: 20,
  trackOpacity: 1.0,
  trackGlow: true,
  multiColorStages: false,
  stageColors: ['#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#ef4444', '#06b6d4'],

  mapZoom: 1.0,
  mapOffsetX: 0,
  mapOffsetY: 0,

  showCompass: false,
  compassPosition: 'top_right',
  showWaypointKm: false,
  waypointFontSize: 15,
  waypointFont: 'inherit',
  showWaypointBadge: true,

  waypoints: [],
};

export function App() {
  const [trackData, setTrackData] = useState(() => {
    const draft = loadAutoSaveDraft();
    return draft?.trackData || null;
  });

  const [config, setConfig] = useState(() => {
    const draft = loadAutoSaveDraft();
    return draft?.config ? { ...DEFAULT_CONFIG, ...draft.config } : DEFAULT_CONFIG;
  });

  const [viewMode, setViewMode] = useState('poster'); // 'poster' | 'video'
  const [isExporting, setIsExporting] = useState(false);
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [savedProjectsCount, setSavedProjectsCount] = useState(0);
  const canvasRef = useRef(null);

  const { isInstallable, installApp } = usePwaInstall();

  // Document Title
  useEffect(() => {
    document.title = config.title
      ? `${config.title} - TrailPoster Studio`
      : 'TrailPoster Studio - Poster GPX & Video Flyover 3D';
  }, [config.title]);

  // Sync Saved Projects count
  useEffect(() => {
    setSavedProjectsCount(getSavedProjects().length);
  }, [projectsModalOpen]);

  // Auto-Save active draft whenever trackData or config changes (debounced 600ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      autoSaveDraft(trackData, config);
    }, 600);
    return () => clearTimeout(timer);
  }, [trackData, config]);

  // Helper to parse and set custom user uploaded GPX file
  const handleGpxUpload = async (file) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const parsed = parseGPX(text);
        setTrackData(parsed);
        setConfig((prev) => ({
          ...prev,
          title: parsed.name.toUpperCase(),
          subtitle: `${parsed.stats.totalDistanceKm} KM • +${parsed.stats.elevationGainM}M D+`,
          details: `${parsed.stats.pointCount} Punti • WGS84`,
          waypoints: parsed.gpxWaypoints && parsed.gpxWaypoints.length > 0 ? parsed.gpxWaypoints : [],
        }));
      };
      reader.readAsText(file);
    } catch (error) {
      alert(`Errore nel caricamento del file GPX: ${error.message}`);
    }
  };

  // Load Saved Project
  const handleLoadProject = (project) => {
    if (!project) return;
    setTrackData(project.trackData || null);
    setConfig({ ...DEFAULT_CONFIG, ...(project.config || {}) });
  };

  // Create New Empty Project
  const handleNewProject = () => {
    setTrackData(null);
    setConfig(DEFAULT_CONFIG);
  };

  // Quick Save current design
  const handleQuickSave = () => {
    try {
      saveProject({
        name: config.title || trackData?.name || 'Mio Poster',
        trackData,
        config,
      });
      setSavedProjectsCount(getSavedProjects().length);
    } catch (err) {
      console.error('Quick save error:', err);
    }
  };

  // Export Trigger (2D Poster)
  const handleExport = async (format) => {
    if (!canvasRef.current) return;
    await exportPoster(canvasRef.current, config.title || 'trail-poster', format, setIsExporting);
  };

  return (
    <div className="min-h-screen bg-[#121316] text-neutral-100 flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* Top Header */}
      <Header
        trackName={config.title}
        onExport={handleExport}
        isExporting={isExporting}
        savedProjectsCount={savedProjectsCount}
        onOpenProjects={() => setProjectsModalOpen(true)}
        onQuickSave={handleQuickSave}
        isInstallable={isInstallable}
        onInstallPwa={installApp}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Main Studio Container */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto p-4 sm:p-6">
        {viewMode === 'poster' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Sidebar Controls (Left - 4 Cols on LG) */}
            <div className="lg:col-span-4 h-[calc(100vh-100px)] sticky top-20 flex flex-col">
              <Sidebar
                trackData={trackData}
                config={config}
                setConfig={setConfig}
                onGpxUpload={handleGpxUpload}
              />
            </div>

            {/* Central Live Preview Poster Canvas (Right - 8 Cols on LG) */}
            <div className="lg:col-span-8 flex flex-col items-center justify-center p-2 sm:p-6 glass-panel rounded-2xl min-h-[calc(100vh-100px)] border border-white/10 relative overflow-hidden bg-[#181a20]/80">
              {/* Subtle Ambient Background Lighting */}
              <div className="absolute -top-40 -right-40 w-96 h-96 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

              {/* Canvas Header Subtitle */}
              <div className="mb-4 text-center">
                <span className="text-xs font-mono tracking-widest text-neutral-400 uppercase bg-neutral-900/80 px-3 py-1 rounded-full border border-white/5">
                  Live Preview • {config.orientation === 'landscape' ? '7:5 (70×50 CM Orizzontale)' : '5:7 (50×70 CM Verticale)'}
                </span>
              </div>

              {/* Poster Component */}
              <PosterCanvas
                trackData={trackData}
                config={config}
                canvasRef={canvasRef}
              />
            </div>
          </div>
        ) : (
          /* Video Flyover 3D Studio */
          <VideoStudio
            trackData={trackData}
            config={config}
            setConfig={setConfig}
            onGpxUpload={handleGpxUpload}
          />
        )}
      </main>

      {/* Saved Projects Gallery Modal */}
      <ProjectsModal
        isOpen={projectsModalOpen}
        onClose={() => setProjectsModalOpen(false)}
        currentTrackData={trackData}
        currentConfig={config}
        onLoadProject={handleLoadProject}
        onNewProject={handleNewProject}
      />
    </div>
  );
}

export default App;
