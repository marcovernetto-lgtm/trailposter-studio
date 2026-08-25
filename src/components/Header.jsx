import React, { useState } from 'react';
import {
  Compass,
  Download,
  FileImage,
  FileText,
  Loader2,
  FolderOpen,
  Save,
  Check,
  Smartphone,
  Sparkles,
  Box,
  Layout,
} from 'lucide-react';

export function Header({
  trackName,
  onExport,
  isExporting,
  savedProjectsCount = 0,
  onOpenProjects,
  onQuickSave,
  isInstallable = false,
  onInstallPwa,
  viewMode = 'poster',
  onViewModeChange,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const handleExportClick = (format) => {
    setDropdownOpen(false);
    onExport(format);
  };

  const handleSaveClick = () => {
    if (onQuickSave) {
      onQuickSave();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } else if (onOpenProjects) {
      onOpenProjects();
    }
  };

  return (
    <header className="w-full bg-[#16181e]/90 border-b border-white/10 px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between z-30 sticky top-0 backdrop-blur-xl gap-2">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-teal-400 flex items-center justify-center shadow-lg shadow-teal-500/20 text-neutral-950 font-bold flex-shrink-0">
          <Compass className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
        </div>
        <div>
          <h1 className="font-extrabold text-base sm:text-lg text-white tracking-wide flex items-center gap-1.5 sm:gap-2">
            TrailPoster <span className="text-teal-400 font-light">Studio</span>
          </h1>
          <p className="text-[10px] sm:text-[11px] text-neutral-400 hidden md:block">
            Poster GPX 50×70 & Modelli 3D per la Stampa
          </p>
        </div>
      </div>

      {/* Center: Mode Switcher (Poster 2D vs Modello 3D) */}
      <div className="flex items-center bg-[#111318] p-1 rounded-xl border border-white/10 shadow-inner">
        <button
          onClick={() => onViewModeChange('poster')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            viewMode === 'poster'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Layout className="w-3.5 h-3.5" />
          <span>Poster 2D</span>
        </button>

        <button
          onClick={() => onViewModeChange('3d')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative ${
            viewMode === '3d'
              ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Box className="w-3.5 h-3.5 text-amber-300" />
          <span>Modello 3D</span>
          <span className="text-[9px] bg-amber-400/20 text-amber-300 px-1.5 py-0.2 rounded-full border border-amber-400/30 uppercase font-mono font-bold hidden sm:inline">
            3D Print
          </span>
        </button>
      </div>

      {/* Right Controls: Projects, Save, PWA Install, Export */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* PWA Install Button (Shown when ready to install) */}
        {isInstallable && (
          <button
            onClick={onInstallPwa}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95"
            title="Installa TrailPoster Studio come Web App"
          >
            <Smartphone className="w-4 h-4" />
            <span className="hidden xl:inline">Installa App</span>
          </button>
        )}

        {/* Saved Projects Gallery Button */}
        <button
          onClick={onOpenProjects}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/15 bg-[#1e222b] hover:bg-[#252a36] text-neutral-200 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 shadow-sm"
          title="Apri galleria poster salvati"
        >
          <FolderOpen className="w-4 h-4 text-teal-400" />
          <span className="hidden sm:inline">I Miei Poster</span>
          {savedProjectsCount > 0 && (
            <span className="text-[10px] bg-teal-500/20 text-teal-300 px-1.5 py-0.2 rounded-full border border-teal-500/30 font-mono font-bold">
              {savedProjectsCount}
            </span>
          )}
        </button>

        {/* Quick Save Button */}
        <button
          onClick={handleSaveClick}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 shadow-sm ${
            justSaved
              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
              : 'border-white/15 bg-[#1e222b] hover:bg-[#252a36] text-neutral-200'
          }`}
          title="Salva modifiche correnti nel progetto"
        >
          {justSaved ? (
            <>
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Salvato!</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4 text-teal-400" />
              <span className="hidden sm:inline">Salva</span>
            </>
          )}
        </button>

        {/* Export Button (In 2D view shows PNG/PDF dropdown) */}
        {viewMode === 'poster' && (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              disabled={isExporting}
              className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-semibold px-3.5 sm:px-4 py-2 rounded-xl shadow-lg shadow-teal-500/25 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 text-xs sm:text-sm"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden sm:inline">Generazione...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Esporta</span>
                </>
              )}
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && !isExporting && (
              <div className="absolute right-0 mt-2 w-64 glass-panel rounded-xl shadow-2xl border border-white/10 overflow-hidden z-50 p-1.5 animate-fadeIn bg-[#181a20]">
                <button
                  onClick={() => handleExportClick('png')}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-teal-500/15 text-left text-xs font-medium text-slate-200 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center">
                    <FileImage className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-white">Esporta PNG HD</p>
                    <p className="text-[10px] text-slate-400">Risoluzione 3500×4900px master</p>
                  </div>
                </button>

                <button
                  onClick={() => handleExportClick('pdf')}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-teal-500/15 text-left text-xs font-medium text-slate-200 transition-colors mt-1"
                >
                  <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-white">Esporta PDF Vettoriale</p>
                    <p className="text-[10px] text-slate-400">Formato poster standard 50×70 cm</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
