import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FolderOpen,
  Plus,
  Save,
  Trash2,
  Copy,
  Download,
  Upload,
  Search,
  Check,
  Calendar,
  Layers,
  MapPin,
  TrendingUp,
  FileCode,
  Sparkles,
} from 'lucide-react';
import {
  getSavedProjects,
  saveProject,
  deleteProject,
  duplicateProject,
  exportProjectToJson,
  importProjectFromJson,
} from '../lib/projectStorage';

export function ProjectsModal({
  isOpen,
  onClose,
  currentTrackData,
  currentConfig,
  onLoadProject,
  onNewProject,
}) {
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  const refreshProjects = () => {
    setProjects(getSavedProjects());
  };

  useEffect(() => {
    if (isOpen) {
      refreshProjects();
      setNewProjectName(currentConfig?.title || currentTrackData?.name || '');
      setSaveSuccessMsg('');
      setErrorMsg('');
    }
  }, [isOpen, currentConfig, currentTrackData]);

  if (!isOpen) return null;

  const handleSaveCurrent = (e) => {
    if (e) e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      saveProject({
        name: newProjectName.trim(),
        trackData: currentTrackData,
        config: currentConfig,
      });
      refreshProjects();
      setSaveSuccessMsg(`"${newProjectName.trim()}" salvato con successo!`);
      setTimeout(() => setSaveSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const handleDelete = (id, name) => {
    if (window.confirm(`Sei sicuro di voler eliminare il poster "${name}"?`)) {
      deleteProject(id);
      refreshProjects();
    }
  };

  const handleDuplicate = (id) => {
    try {
      duplicateProject(id);
      refreshProjects();
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const handleExportJson = (project) => {
    try {
      exportProjectToJson(project);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imported = await importProjectFromJson(file);
      refreshProjects();
      setSaveSuccessMsg(`Progetto "${imported.name}" importato con successo!`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.trackData?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#16181e] border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-neutral-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#1b1e26]/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center border border-teal-500/30">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                I Miei Poster Salvati
                <span className="text-xs bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-full border border-teal-500/30 font-mono">
                  {projects.length}
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Gestisci i tuoi progetti, salva varianti grafiche o esporta backup
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications */}
        {saveSuccessMsg && (
          <div className="px-6 py-2 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="px-6 py-2 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg('')} className="text-rose-400 hover:text-rose-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Top Actions: Save Current & Import/New */}
        <div className="p-4 bg-[#14151b] border-b border-white/10 space-y-3">
          <form onSubmit={handleSaveCurrent} className="flex items-center gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Nome per salvare il poster attuale..."
              className="glass-input flex-1 px-3 py-2 rounded-xl text-xs bg-neutral-900/90 font-medium"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 flex-shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salva Poster Attuale</span>
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cerca poster salvati..."
                className="glass-input w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-neutral-900/60"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* Import JSON button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".trailposter,.json"
                onChange={handleImportFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-neutral-200 transition-colors"
                title="Importa file .trailposter"
              >
                <Upload className="w-3.5 h-3.5 text-teal-400" />
                <span>Importa Backup</span>
              </button>

              {/* New Poster reset */}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Vuoi iniziare un nuovo poster da zero?')) {
                    onNewProject();
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-neutral-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Nuovo Poster</span>
              </button>
            </div>
          </div>
        </div>

        {/* Project Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
          {filteredProjects.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-white/5 flex items-center justify-center text-neutral-500 border border-white/5">
                <FolderOpen className="w-7 h-7" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-300">Nessun poster trovato</h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                {searchQuery
                  ? 'Nessun risultato corrisponde alla ricerca.'
                  : 'Salva il tuo primo poster usando il campo in alto o carica un nuovo file GPX!'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredProjects.map((project) => {
                const pConfig = project.config || {};
                const pStats = project.stats || project.trackData?.stats || {};
                const isCurrent = currentConfig?.title === pConfig.title;

                return (
                  <div
                    key={project.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                      isCurrent
                        ? 'border-teal-500/40 bg-teal-500/10 shadow-md ring-1 ring-teal-500/30'
                        : 'border-white/10 bg-[#1e222b]/60 hover:bg-[#1e222b] hover:border-white/20'
                    }`}
                  >
                    <div>
                      {/* Title & Badge */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="text-sm font-bold text-white truncate" title={project.name}>
                          {project.name}
                        </h4>
                        {isCurrent && (
                          <span className="text-[9px] font-mono uppercase bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-full border border-teal-500/30 flex-shrink-0">
                            Aperto
                          </span>
                        )}
                      </div>

                      {/* Subtitle / Details */}
                      {pConfig.subtitle && (
                        <p className="text-xs text-neutral-400 truncate mb-2">{pConfig.subtitle}</p>
                      )}

                      {/* Stats & Metadata Chips */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300 font-mono">
                        {pStats.totalDistanceKm > 0 && (
                          <span className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-white/5">
                            <MapPin className="w-3 h-3 text-teal-400" />
                            {pStats.totalDistanceKm} KM
                          </span>
                        )}
                        {pStats.elevationGainM > 0 && (
                          <span className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-white/5">
                            <TrendingUp className="w-3 h-3 text-emerald-400" />
                            +{pStats.elevationGainM}m
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                          <Calendar className="w-3 h-3" />
                          {formatDate(project.updatedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons Toolbar */}
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <button
                        onClick={() => {
                          onLoadProject(project);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/90 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-95"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span>Carica</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDuplicate(project.id)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="Duplica Progetto"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleExportJson(project)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-teal-300 hover:bg-white/10 transition-colors"
                          title="Scarica Backup .trailposter"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(project.id, project.name)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Elimina"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
