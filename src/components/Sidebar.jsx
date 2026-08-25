import React, { useState } from 'react';
import {
  Upload,
  MapPin,
  Palette,
  Type,
  Layers,
  Plus,
  Trash2,
  Sliders,
  Check,
  Search,
  Loader2,
  Sparkles,
  TrendingUp,
  Compass,
  Grid as GridIcon,
} from 'lucide-react';
import { geocodeAndSnapToTrack } from '../lib/geocoding';
import { PRESET_THEMES } from '../lib/presetThemes';

/**
 * Reusable Slider with Double-Click Reset to Default
 */
function SliderControl({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  unit = '',
  displayMultiplier = 1,
  formatValue,
  onChange,
  colorClass = 'text-teal-400',
}) {
  const handleDoubleClick = () => {
    onChange(defaultValue);
  };

  const formattedVal = formatValue
    ? formatValue(value)
    : `${typeof value === 'number' && step < 1 && step > 0 ? value.toFixed(1) : Math.round(value * displayMultiplier)}${unit}`;

  return (
    <div className="space-y-1">
      <div
        className="flex justify-between items-center text-xs select-none cursor-pointer group"
        onDoubleClick={handleDoubleClick}
        title="Fai doppio clic per ripristinare il valore predefinito"
      >
        <span className="text-neutral-400 group-hover:text-neutral-200 transition-colors">
          {label}
        </span>
        <span className={`${colorClass} font-mono text-[11px] group-hover:underline`}>
          {formattedVal}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        onDoubleClick={handleDoubleClick}
        title="Fai doppio clic per ripristinare il valore predefinito"
        className="w-full cursor-pointer"
      />
    </div>
  );
}

export function Sidebar({
  trackData,
  config,
  setConfig,
  onGpxUpload,
}) {
  const [activeTab, setActiveTab] = useState('gpx'); // 'gpx' | 'track' | 'waypoints' | 'text' | 'bg'
  const [dragOver, setDragOver] = useState(false);

  // Automatic Geocoding Waypoint state
  const [searchPlace, setSearchPlace] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState('');
  const [geocodingSuccess, setGeocodingSuccess] = useState('');

  const handleAutoGeocodeWaypoint = async (e) => {
    if (e) e.preventDefault();
    if (!searchPlace.trim()) return;
    setIsGeocoding(true);
    setGeocodingError('');
    setGeocodingSuccess('');

    try {
      const result = await geocodeAndSnapToTrack(searchPlace, trackData?.points || []);
      if (result) {
        const newWpt = {
          id: `wpt-${Date.now()}`,
          name: result.name,
          percent: result.percent,
          markerStyle: 'solid',
          textOffset: 'top',
        };
        setConfig((prev) => ({
          ...prev,
          waypoints: [...(prev.waypoints || []), newWpt],
        }));
        setGeocodingSuccess(`"${result.name}" inserita al ${result.percent}% del percorso!`);
        setSearchPlace('');
      }
    } catch (err) {
      setGeocodingError(err.message || 'Impossibile trovare il luogo sul percorso.');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Handle Drag and Drop for GPX file
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.gpx')) {
      onGpxUpload(file);
    } else {
      alert('Per favore carica un file con estensione .gpx');
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onGpxUpload(file);
    }
  };

  // Waypoint helpers
  const handleAddWaypoint = () => {
    const newWpt = {
      id: `wpt-${Date.now()}`,
      name: `Tappa ${(config.waypoints?.length || 0) + 1}`,
      percent: 50,
      markerStyle: 'solid',
      textOffset: 'top',
    };
    setConfig((prev) => ({
      ...prev,
      waypoints: [...(prev.waypoints || []), newWpt],
    }));
  };

  const handleUpdateWaypoint = (id, key, value) => {
    setConfig((prev) => ({
      ...prev,
      waypoints: prev.waypoints.map((w) => (w.id === id ? { ...w, [key]: value } : w)),
    }));
  };

  const handleDeleteWaypoint = (id) => {
    setConfig((prev) => ({
      ...prev,
      waypoints: prev.waypoints.filter((w) => w.id !== id),
    }));
  };

  // Color Presets
  const trackColorPresets = [
    { label: 'Teal', hex: '#14b8a6' },
    { label: 'Crimson', hex: '#e11d48' },
    { label: 'Amber', hex: '#f59e0b' },
    { label: 'Sky', hex: '#38bdf8' },
    { label: 'Lime', hex: '#84cc16' },
    { label: 'White', hex: '#ffffff' },
    { label: 'Violet', hex: '#8b5cf6' },
  ];

  const bgColorPresets = [
    { label: 'Charcoal Dark', hex: '#16181e' },
    { label: 'Graphite', hex: '#232733' },
    { label: 'Pure Dark', hex: '#121316' },
    { label: 'Alpine Forest', hex: '#0a231c' },
    { label: 'Warm Espresso', hex: '#1e1b18' },
    { label: 'Vintage Beige', hex: '#f4ebd0' },
  ];

  const gradientPresets = [
    { label: 'Charcoal Minimal', value: 'linear-gradient(135deg, #16181e 0%, #282d3b 100%)' },
    { label: 'Dark Graphite', value: 'linear-gradient(135deg, #101114 0%, #1e222c 100%)' },
    { label: 'Obsidian Abyss', value: 'linear-gradient(135deg, #07080a 0%, #16181f 100%)' },
    { label: 'Alpine Forest', value: 'linear-gradient(135deg, #081a14 0%, #132a21 100%)' },
    { label: 'Nordic Slate', value: 'linear-gradient(135deg, #171d26 0%, #232d3d 100%)' },
    { label: 'Deep Twilight', value: 'linear-gradient(135deg, #13121d 0%, #211c33 100%)' },
    { label: 'Warm Espresso', value: 'linear-gradient(135deg, #1c1815 0%, #332a24 100%)' },
    { label: 'Alpine Gold Stone', value: 'linear-gradient(135deg, #1c1914 0%, #2e261a 100%)' },
    { label: 'Crimson Night', value: 'linear-gradient(135deg, #170d10 0%, #2b1419 100%)' },
    { label: 'Aurora Borealis', value: 'linear-gradient(135deg, #081820 0%, #0d2c26 100%)' },
    { label: 'Dolomite Mist', value: 'linear-gradient(135deg, #1e2430 0%, #2d3748 100%)' },
    { label: 'Sunset Peak', value: 'linear-gradient(135deg, #1e131d 0%, #301724 100%)' },
  ];

  return (
    <aside className="w-full lg:w-96 glass-panel rounded-2xl p-5 flex flex-col h-full overflow-hidden shadow-2xl border border-white/10 bg-[#16181e]/90">
      {/* Navigation Tab Bar */}
      <div className="grid grid-cols-5 gap-1 p-1 bg-neutral-950/70 rounded-xl mb-4 border border-white/5">
        <button
          onClick={() => setActiveTab('gpx')}
          className={`flex flex-col items-center justify-center py-2.5 rounded-lg text-[11px] font-medium transition-all ${activeTab === 'gpx'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          title="Upload GPX"
        >
          <Upload className="w-4 h-4 mb-1" />
          GPX
        </button>

        <button
          onClick={() => setActiveTab('track')}
          className={`flex flex-col items-center justify-center py-2.5 rounded-lg text-[11px] font-medium transition-all ${activeTab === 'track'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          title="Stile Traccia"
        >
          <Sliders className="w-4 h-4 mb-1" />
          Traccia
        </button>

        <button
          onClick={() => setActiveTab('waypoints')}
          className={`flex flex-col items-center justify-center py-2.5 rounded-lg text-[11px] font-medium transition-all ${activeTab === 'waypoints'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          title="Tappe & Waypoints"
        >
          <MapPin className="w-4 h-4 mb-1" />
          Tappe
        </button>

        <button
          onClick={() => setActiveTab('text')}
          className={`flex flex-col items-center justify-center py-2.5 rounded-lg text-[11px] font-medium transition-all ${activeTab === 'text'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          title="Tipografia"
        >
          <Type className="w-4 h-4 mb-1" />
          Testo
        </button>

        <button
          onClick={() => setActiveTab('bg')}
          className={`flex flex-col items-center justify-center py-2.5 rounded-lg text-[11px] font-medium transition-all ${activeTab === 'bg'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          title="Sfondo & Layout"
        >
          <Palette className="w-4 h-4 mb-1" />
          Layout
        </button>
      </div>

      {/* Tab Panels Container */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        {/* 1. UPLOAD GPX TAB */}
        {activeTab === 'gpx' && (
          <div className="space-y-4 animate-fadeIn">
            {/* File Dropzone */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                Carica Traccia GPX
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${dragOver
                    ? 'border-teal-400 bg-teal-500/10 scale-[1.01]'
                    : 'border-neutral-700 hover:border-teal-500/50 bg-neutral-900/50'
                  }`}
              >
                <input
                  type="file"
                  accept=".gpx"
                  onChange={handleFileChange}
                  className="hidden"
                  id="gpx-file-input"
                />
                <label htmlFor="gpx-file-input" className="cursor-pointer flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center mb-3 text-teal-400">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="text-sm font-semibold text-neutral-200">
                    Trascina qui il file .gpx
                  </span>
                  <span className="text-xs text-neutral-400 mt-1">
                    oppure clicca per selezionarlo dal computer
                  </span>
                </label>
              </div>
            </div>

            {/* Quick Track Stats Summary */}
            {trackData && trackData.stats && (
              <div className="glass-panel-subtle p-3.5 rounded-xl space-y-2.5 border border-white/5 bg-[#1e222b]/60">
                <p className="text-xs font-bold uppercase tracking-wider text-teal-400">
                  Dettagli Percorso
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-neutral-900/80 p-2 rounded-lg">
                    <span className="text-neutral-400 text-[10px] uppercase">Distanza</span>
                    <p className="text-sm font-bold text-neutral-100">{trackData.stats.totalDistanceKm} km</p>
                  </div>
                  <div className="bg-neutral-900/80 p-2 rounded-lg">
                    <span className="text-neutral-400 text-[10px] uppercase">Dislivello +</span>
                    <p className="text-sm font-bold text-neutral-100">+{trackData.stats.elevationGainM} m</p>
                  </div>
                  <div className="bg-neutral-900/80 p-2 rounded-lg">
                    <span className="text-neutral-400 text-[10px] uppercase">Quota Max</span>
                    <p className="text-sm font-bold text-neutral-100">{trackData.stats.maxEleM} m</p>
                  </div>
                  <div className="bg-neutral-900/80 p-2 rounded-lg">
                    <span className="text-neutral-400 text-[10px] uppercase">Punti GPS</span>
                    <p className="text-sm font-bold text-neutral-100">{trackData.stats.pointCount}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. TRACK STYLING TAB */}
        {activeTab === 'track' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Track Color */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                Colore Tracciato
              </label>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="color"
                  value={config.trackColor}
                  onChange={(e) => setConfig({ ...config, trackColor: e.target.value })}
                  className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-0 p-0"
                />
                <input
                  type="text"
                  value={config.trackColor}
                  onChange={(e) => setConfig({ ...config, trackColor: e.target.value })}
                  className="glass-input flex-1 px-3 py-1.5 rounded-lg text-xs font-mono"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {trackColorPresets.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => setConfig({ ...config, trackColor: c.hex })}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${config.trackColor === c.hex ? 'scale-110 border-white shadow-md' : 'border-transparent opacity-80'}`}
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Track Width & Zoom Sliders (Double-click resets to default) */}
            <div className="space-y-3">
              <SliderControl
                label="Spessore Linea"
                value={config.trackWidth}
                defaultValue={5.0}
                min={1}
                max={12}
                step={0.5}
                unit="px"
                onChange={(val) => setConfig({ ...config, trackWidth: val })}
              />

              <SliderControl
                label="Zoom / Dimensione Traccia"
                value={config.mapZoom || 1.0}
                defaultValue={1.0}
                min={0.5}
                max={2.0}
                step={0.05}
                formatValue={(v) => `${Math.round(v * 100)}%`}
                onChange={(val) => setConfig({ ...config, mapZoom: val })}
              />

              {/* Offset X & Y Panning Sliders */}
              <div className="grid grid-cols-2 gap-2">
                <SliderControl
                  label="Sposta Orizzontale"
                  value={config.mapOffsetX || 0}
                  defaultValue={0}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  onChange={(val) => setConfig({ ...config, mapOffsetX: val })}
                />
                <SliderControl
                  label="Sposta Verticale"
                  value={config.mapOffsetY || 0}
                  defaultValue={0}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  onChange={(val) => setConfig({ ...config, mapOffsetY: val })}
                />
              </div>
            </div>

            {/* Track Glow Effect Toggle */}
            <div className="glass-panel-subtle p-3 rounded-xl flex items-center justify-between bg-[#1e222b]/60">
              <div>
                <span className="text-xs font-semibold text-neutral-200">Effetto Bagliore / Glow Traccia</span>
                <p className="text-[10px] text-neutral-400">Aggiunge un'aura luminosa attorno al percorso</p>
              </div>
              <input
                type="checkbox"
                checked={config.trackGlow}
                onChange={(e) => setConfig({ ...config, trackGlow: e.target.checked })}
                className="w-4 h-4 accent-teal-500 rounded cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* 3. WAYPOINTS & STAGES TAB */}
        {activeTab === 'waypoints' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Auto Search Place & Geocode */}
            <form onSubmit={handleAutoGeocodeWaypoint} className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Aggiungi Luogo per Nome
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchPlace}
                  onChange={(e) => setSearchPlace(e.target.value)}
                  placeholder="Es. Rifugio, Passo, Paese..."
                  className="glass-input flex-1 px-3 py-1.5 rounded-lg text-xs"
                />
                <button
                  type="submit"
                  disabled={isGeocoding}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                >
                  {isGeocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Cerca
                </button>
              </div>
              {geocodingSuccess && <p className="text-[11px] text-emerald-400">{geocodingSuccess}</p>}
              {geocodingError && <p className="text-[11px] text-rose-400">{geocodingError}</p>}
            </form>

            {/* Global Waypoint Styling Options */}
            <div className="glass-panel-subtle p-3 rounded-xl space-y-3 border border-white/10 bg-[#1e222b]/60">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                Stile & Tipografia Tappe
              </p>

              {/* Waypoint Font Size Slider */}
              <SliderControl
                label="Dimensione Testo"
                value={config.waypointFontSize || 15}
                defaultValue={15}
                min={11}
                max={24}
                step={1}
                unit="px"
                onChange={(val) => setConfig({ ...config, waypointFontSize: val })}
              />

              {/* Waypoint Font Family */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                  Font Nomi Tappe
                </label>
                <select
                  value={config.waypointFont || 'inherit'}
                  onChange={(e) => setConfig({ ...config, waypointFont: e.target.value })}
                  className="glass-input w-full px-2.5 py-1.5 rounded-lg text-xs bg-neutral-900 text-teal-200"
                >
                  <option value="inherit">Stesso font del poster ({config.fontFamily})</option>
                  <option value="Outfit">Modern Sans (Outfit)</option>
                  <option value="Inter">Clean Sans (Inter)</option>
                  <option value="Cinzel">Luxury Serif (Cinzel)</option>
                  <option value="Playfair Display">Elegant Serif (Playfair)</option>
                  <option value="Space Grotesk">Tech Display (Space Grotesk)</option>
                  <option value="JetBrains Mono">Technical Monospace (JetBrains)</option>
                </select>
              </div>

              {/* Show Waypoint KM */}
              <div className="flex items-center justify-between pt-1 border-t border-neutral-700/50">
                <span className="text-xs text-neutral-300">Mostra chilometraggio (KM) sotto al nome</span>
                <input
                  type="checkbox"
                  checked={config.showWaypointKm}
                  onChange={(e) => setConfig({ ...config, showWaypointKm: e.target.checked })}
                  className="w-4 h-4 accent-teal-500 rounded cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Elenco Tappe ({config.waypoints?.length || 0})
              </span>
              <button
                type="button"
                onClick={handleAddWaypoint}
                className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Aggiungi Tappa
              </button>
            </div>

            {/* Waypoints List */}
            {config.waypoints && config.waypoints.length > 0 && (
              <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                {config.waypoints.map((wpt, idx) => (
                  <div key={wpt.id || idx} className="bg-[#1e222b]/80 p-3 rounded-xl border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={wpt.name}
                        onChange={(e) => handleUpdateWaypoint(wpt.id, 'name', e.target.value)}
                        className="glass-input flex-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
                        placeholder="Nome tappa..."
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteWaypoint(wpt.id)}
                        className="text-neutral-400 hover:text-rose-400 p-1 transition-colors"
                        title="Elimina tappa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Waypoint Marker Style Selector */}
                    <div>
                      <span className="text-[10px] text-neutral-400 uppercase block mb-1">Stile Pallino / Segnaposto</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { id: 'solid', label: '● Pieno' },
                          { id: 'circle', label: '○ Cerchio' },
                          { id: 'ring', label: '◎ Anello' },
                          { id: 'pin', label: '📍 Spillo' },
                          { id: 'diamond', label: '◆ Rombo' },
                          { id: 'number', label: `#${idx + 1} Numero` },
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => handleUpdateWaypoint(wpt.id, 'markerStyle', m.id)}
                            className={`py-1 px-1.5 rounded text-[10px] font-medium transition-all ${
                              (wpt.markerStyle || 'solid') === m.id
                                ? 'bg-teal-600 text-white shadow-sm font-bold'
                                : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <SliderControl
                      label="Posizione sul percorso"
                      value={wpt.percent}
                      defaultValue={50}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      onChange={(val) => handleUpdateWaypoint(wpt.id, 'percent', val)}
                    />

                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Posizione Scritta</span>
                      <div className="flex gap-1">
                        {[
                          { id: 'top', label: 'Sopra' },
                          { id: 'bottom', label: 'Sotto' },
                          { id: 'left', label: 'Sx' },
                          { id: 'right', label: 'Dx' },
                        ].map((pos) => (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() => handleUpdateWaypoint(wpt.id, 'textOffset', pos.id)}
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono transition-all ${
                              (wpt.textOffset || wpt.textPosition || 'top') === pos.id
                                ? 'bg-teal-600 text-white font-bold'
                                : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
                            }`}
                          >
                            {pos.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. TYPOGRAPHY & TEXT TAB */}
        {activeTab === 'text' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Title Position Layout Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Posizione & Layout Titolo
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'bottom', label: 'In Basso (Classico)', desc: 'Titolo e dettagli sotto al tracciato' },
                  { id: 'top', label: 'In Alto (Moderno)', desc: 'Titolo grande in testata' },
                  { id: 'split', label: 'Split (Sopra / Sotto)', desc: 'Titolo sopra, quote sotto' },
                  { id: 'minimal', label: 'Minimale Compatto', desc: 'Badge discreto e moderno' },
                ].map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setConfig({ ...config, textLayout: l.id })}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      (config.textLayout || 'bottom') === l.id
                        ? 'border-teal-400 bg-teal-500/20 text-white shadow-sm'
                        : 'border-white/10 bg-[#1e222b]/50 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <p className="text-xs font-bold">{l.label}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">{l.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Decorative Divider Icon Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Separatore Decorativo
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'mountain', label: '▲ Vetta' },
                  { id: 'compass', label: '✦ Bussola' },
                  { id: 'diamond', label: '◆ Diamante' },
                  { id: 'dots', label: '• • • Puntini' },
                  { id: 'line', label: '— Linea' },
                  { id: 'none', label: 'Nessuno' },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setConfig({ ...config, dividerIcon: d.id })}
                    className={`py-1.5 px-2 rounded-lg border text-center text-xs font-medium transition-all ${
                      (config.dividerIcon || 'mountain') === d.id
                        ? 'border-teal-400 bg-teal-500/20 text-teal-200'
                        : 'border-white/10 bg-[#1e222b]/50 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Titolo Poster
              </label>
              <input
                type="text"
                value={config.title}
                onChange={(e) => setConfig({ ...config, title: e.target.value })}
                placeholder="Es. LECHWEG"
                className="glass-input w-full px-3 py-2 rounded-lg text-sm uppercase font-bold"
              />
            </div>

            {/* Subtitle */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Sottotitolo
              </label>
              <input
                type="text"
                value={config.subtitle}
                onChange={(e) => setConfig({ ...config, subtitle: e.target.value })}
                placeholder="Es. 17-22 Agosto 2026"
                className="glass-input w-full px-3 py-2 rounded-lg text-sm"
              />
            </div>

            {/* Details */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Dettagli / Statistiche
              </label>
              <input
                type="text"
                value={config.details}
                onChange={(e) => setConfig({ ...config, details: e.target.value })}
                placeholder="Es. 125 km • +2944m D+"
                className="glass-input w-full px-3 py-2 rounded-lg text-sm font-mono"
              />
            </div>

            {/* Font Family */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Famiglia Font
              </label>
              <select
                value={config.fontFamily}
                onChange={(e) => setConfig({ ...config, fontFamily: e.target.value })}
                className="glass-input w-full px-2 rounded-lg text-sm bg-neutral-900 text-teal-200"
              >
                <option value="Outfit">Modern Sans (Outfit)</option>
                <option value="Inter">Clean Sans (Inter)</option>
                <option value="Cinzel">Luxury Serif (Cinzel)</option>
                <option value="Playfair Display">Elegant Serif (Playfair)</option>
                <option value="Space Grotesk">Tech Display (Space Grotesk)</option>
                <option value="JetBrains Mono">Technical Monospace (JetBrains)</option>
              </select>
            </div>

            {/* Font Size & Spacing Sliders */}
            <div className="grid grid-cols-2 gap-3">
              <SliderControl
                label="Dimensione Titolo"
                value={config.titleFontSize}
                defaultValue={34}
                min={18}
                max={44}
                step={1}
                unit="px"
                onChange={(val) => setConfig({ ...config, titleFontSize: val })}
              />

              <SliderControl
                label="Spaziatura Lettere"
                value={config.letterSpacing}
                defaultValue={6}
                min={1}
                max={14}
                step={1}
                unit="px"
                onChange={(val) => setConfig({ ...config, letterSpacing: val })}
              />
            </div>

            {/* Text Color */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                Colore Testo & Grafica
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.textColor}
                  onChange={(e) => setConfig({ ...config, textColor: e.target.value })}
                  className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-0 p-0"
                />
                <input
                  type="text"
                  value={config.textColor}
                  onChange={(e) => setConfig({ ...config, textColor: e.target.value })}
                  className="glass-input flex-1 px-3 py-1.5 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            {/* GPS Coordinates Toggle */}
            <div className="glass-panel-subtle p-3 rounded-xl flex items-center justify-between bg-[#1e222b]/60">
              <div>
                <span className="text-xs font-medium text-neutral-200">Coordinate GPS Inizio/Fine</span>
                <p className="text-[10px] text-neutral-400">Mostra lat/lon esatte alla base del poster</p>
              </div>
              <input
                type="checkbox"
                checked={config.showCoordinates}
                onChange={(e) => setConfig({ ...config, showCoordinates: e.target.checked })}
                className="w-4 h-4 accent-teal-500 rounded cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* 5. BACKGROUND, ORIENTATION & EMBELLISHMENTS TAB */}
        {activeTab === 'bg' && (
          <div className="space-y-2.5 animate-fadeIn">
            {/* 0. TEMI & PRESET GRAFICI PRONTI */}
            <div className="glass-panel-subtle p-2.5 rounded-xl space-y-2 border border-teal-500/30 bg-[#1e222b]/70">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Temi & Preset Grafici Pronti
                </span>
                {config.activePreset && (
                  <span className="text-[9px] text-teal-400 font-mono uppercase">Attivo</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-[175px] overflow-y-auto pr-1 custom-scrollbar">
                {PRESET_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setConfig((prev) => ({ ...prev, ...theme.config, activePreset: theme.id }))}
                    className={`p-2 rounded-lg border text-left transition-all hover:scale-[1.02] flex items-center justify-between gap-1.5 ${
                      config.activePreset === theme.id ? 'border-teal-400 bg-teal-500/25 shadow-sm ring-1 ring-teal-400/40' : 'border-white/10 bg-[#16181e]/80 hover:bg-[#1f232d]'
                    }`}
                    title={theme.description}
                  >
                    <span className="text-[11px] font-bold text-neutral-100 truncate">{theme.name}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {theme.config.bgColor === 'transparent' ? (
                        <span className="w-3 h-3 rounded-full border border-dashed border-teal-400 flex items-center justify-center text-[7px] font-mono text-teal-300">
                          Ø
                        </span>
                      ) : (
                        <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: theme.config.bgColor }} />
                      )}
                      <span className="w-2 h-2 rounded-full border border-black/20" style={{ backgroundColor: theme.config.trackColor }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 1. FORMATO & SFONDO CARD */}
            <div className="glass-panel-subtle p-3 rounded-xl border border-white/10 space-y-2.5 bg-[#1e222b]/60">
              {/* Orientamento Segmented Bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
                    Orientamento Poster
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono">
                    {config.orientation === 'landscape' ? '70 × 50 cm' : '50 × 70 cm'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-neutral-950/70 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, orientation: 'portrait' })}
                    className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      (config.orientation || 'portrait') === 'portrait'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <div className="w-2.5 h-3.5 border border-current rounded-[1px]" />
                    <span>Verticale (2:3)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, orientation: 'landscape' })}
                    className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      config.orientation === 'landscape'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <div className="w-3.5 h-2.5 border border-current rounded-[1px]" />
                    <span>Orizzontale (3:2)</span>
                  </button>
                </div>
              </div>

              {/* Tipo Sfondo Segmented Bar */}
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-300 mb-1.5">
                  Tipo Sfondo
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-neutral-950/70 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, bgType: 'solid', bgColor: config.bgColor === 'transparent' ? '#16181e' : config.bgColor })}
                    className={`py-1.5 rounded-md text-xs font-medium transition-all ${
                      config.bgType === 'solid' && config.bgColor !== 'transparent' ? 'bg-teal-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Tinta Unita
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, bgType: 'gradient' })}
                    className={`py-1.5 rounded-md text-xs font-medium transition-all ${
                      config.bgType === 'gradient' ? 'bg-teal-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Gradiente
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, bgType: 'transparent', bgColor: 'transparent' })}
                    className={`py-1.5 rounded-md text-xs font-medium transition-all ${
                      config.bgType === 'transparent' || config.bgColor === 'transparent' ? 'bg-teal-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Trasparente
                  </button>
                </div>
              </div>

              {/* Solid Color Palette & Picker */}
              {config.bgType === 'solid' && config.bgColor !== 'transparent' && (
                <div className="pt-1.5 space-y-2 border-t border-neutral-700/40">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bgColor}
                      onChange={(e) => setConfig({ ...config, bgColor: e.target.value })}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 p-0"
                    />
                    <input
                      type="text"
                      value={config.bgColor}
                      onChange={(e) => setConfig({ ...config, bgColor: e.target.value })}
                      className="glass-input flex-1 px-2.5 py-1 rounded-lg text-xs font-mono"
                      placeholder="#16181e"
                    />
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {bgColorPresets.map((b) => (
                      <button
                        key={b.hex}
                        onClick={() => setConfig({ ...config, bgColor: b.hex })}
                        className={`h-7 rounded-lg border text-center transition-all hover:scale-105 flex items-center justify-center ${
                          config.bgColor === b.hex ? 'border-teal-400 ring-2 ring-teal-400/40 scale-105' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: b.hex }}
                        title={b.label}
                      >
                        {config.bgColor === b.hex && (
                          <Check className={`w-3.5 h-3.5 ${b.hex === '#f4ebd0' ? 'text-black' : 'text-white'}`} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Gradients */}
              {config.bgType === 'gradient' && (
                <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-neutral-700/40 max-h-[175px] overflow-y-auto pr-1 custom-scrollbar">
                  {gradientPresets.map((g) => (
                    <button
                      key={g.label}
                      onClick={() => setConfig({ ...config, bgGradient: g.value })}
                      className={`p-2 rounded-lg border text-left text-[11px] font-medium text-white transition-all hover:scale-[1.02] flex items-center justify-between shadow-sm ${
                        config.bgGradient === g.value ? 'border-teal-400 ring-1 ring-teal-400/50' : 'border-white/10'
                      }`}
                      style={{ background: g.value }}
                    >
                      <span className="truncate">{g.label}</span>
                      {config.bgGradient === g.value && <Check className="w-3.5 h-3.5 text-teal-300 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}

              {/* Transparent info */}
              {(config.bgType === 'transparent' || config.bgColor === 'transparent') && (
                <div className="p-2 rounded-lg border border-teal-500/20 bg-teal-500/10 flex items-center justify-between text-xs">
                  <span className="text-teal-300 font-medium">Alpha 100% Trasparente</span>
                  <span className="text-[10px] text-teal-400/80 font-mono">PNG 32-bit</span>
                </div>
              )}
            </div>

            {/* 2. CURVE DI LIVELLO DEM (TOPOGRAFIA) */}
            <div className="glass-panel-subtle p-3 rounded-xl space-y-2.5 border border-emerald-500/30 bg-[#1e222b]/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Curve di Livello Reali
                </span>
                <input
                  type="checkbox"
                  checked={config.showTopo}
                  onChange={(e) => setConfig({ ...config, showTopo: e.target.checked })}
                  className="w-4 h-4 accent-teal-500 rounded cursor-pointer"
                />
              </div>

              {config.showTopo && (
                <div className="space-y-2 pt-1 border-t border-neutral-700/50">
                  {/* Sfumatura verso il Titolo */}
                  <SliderControl
                    label="Sfumatura verso il Titolo"
                    value={typeof config.contourFade === 'number' ? config.contourFade : 28}
                    defaultValue={28}
                    min={0}
                    max={50}
                    step={1}
                    unit="%"
                    colorClass="text-emerald-400"
                    formatValue={(v) => v === 0 ? 'Nessuna (0%)' : `${v}%`}
                    onChange={(val) => setConfig({ ...config, contourFade: val })}
                  />

                  {/* Sfumatura Bordi Perimetrali */}
                  <SliderControl
                    label="Sfumatura Bordi Mappa"
                    value={typeof config.contourEdgeFade === 'number' ? config.contourEdgeFade : 12}
                    defaultValue={12}
                    min={0}
                    max={35}
                    step={1}
                    unit="%"
                    colorClass="text-emerald-400"
                    formatValue={(v) => v === 0 ? 'Netta (0%)' : `${v}%`}
                    onChange={(val) => setConfig({ ...config, contourEdgeFade: val })}
                  />

                  {/* Compact Row: Spessore & Intervallo */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                        Spessore
                      </label>
                      <div className="flex gap-0.5 bg-neutral-900/80 p-0.5 rounded-lg border border-neutral-700/50">
                        {['thin', 'medium', 'bold'].map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => setConfig({ ...config, contourStyle: style })}
                            className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                              (config.contourStyle || 'medium') === style
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                          >
                            {style === 'thin' ? 'Fine' : style === 'medium' ? 'Medio' : 'Marcato'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
                        Intervallo
                      </label>
                      <select
                        value={config.contourInterval || 'auto'}
                        onChange={(e) => setConfig({ ...config, contourInterval: e.target.value })}
                        className="glass-input w-full px-2 py-1 rounded-lg text-[11px] bg-neutral-900 font-medium text-emerald-200"
                      >
                        <option value="auto">Auto (Dinamico)</option>
                        <option value="25">25 metri</option>
                        <option value="50">50 metri</option>
                        <option value="100">100 metri</option>
                        <option value="200">200 metri</option>
                      </select>
                    </div>
                  </div>

                  {/* Opacità Curve */}
                  <SliderControl
                    label="Opacità Curve"
                    value={config.topoOpacity}
                    defaultValue={0.15}
                    min={0.02}
                    max={0.45}
                    step={0.01}
                    colorClass="text-emerald-400"
                    formatValue={(v) => `${Math.round(v * 100)}%`}
                    onChange={(val) => setConfig({ ...config, topoOpacity: val })}
                  />

                  {/* Quote Numeriche Switch */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-neutral-300 font-medium">Quote numeriche (m)</span>
                    <input
                      type="checkbox"
                      checked={config.showContourLabels}
                      onChange={(e) => setConfig({ ...config, showContourLabels: e.target.checked })}
                      className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 3. STILE CORNICE POSTER */}
            <div className="glass-panel-subtle p-3 rounded-xl space-y-2 border border-white/10 bg-[#1e222b]/60">
              <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Cornice Poster
              </span>
              <div className="grid grid-cols-5 gap-1 p-0.5 bg-neutral-950/70 rounded-lg">
                {[
                  { id: 'classic', label: 'Classica' },
                  { id: 'double', label: 'Doppia' },
                  { id: 'corners', label: 'Angoli' },
                  { id: 'vintage', label: 'Vintage' },
                  { id: 'none', label: 'Nessuna' },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setConfig({ ...config, borderStyle: b.id, showBorder: b.id !== 'none' })}
                    className={`py-1 rounded-md text-center text-[10px] font-medium transition-all ${
                      (config.borderStyle || (config.showBorder ? 'classic' : 'none')) === b.id
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {config.borderStyle !== 'none' && (
                <SliderControl
                  label="Opacità Cornice"
                  value={config.borderOpacity || 0.15}
                  defaultValue={0.15}
                  min={0.05}
                  max={0.6}
                  step={0.05}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  onChange={(val) => setConfig({ ...config, borderOpacity: val })}
                />
              )}
            </div>

            {/* 4. PROFILO ALTIMETRICO */}
            <div className="glass-panel-subtle p-3 rounded-xl space-y-2 bg-[#1e222b]/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
                  Profilo Altimetrico
                </span>
                <input
                  type="checkbox"
                  checked={config.showElevationChart}
                  onChange={(e) => setConfig({ ...config, showElevationChart: e.target.checked })}
                  className="w-4 h-4 accent-teal-500 rounded cursor-pointer"
                />
              </div>

              {config.showElevationChart && (
                <div className="space-y-2 pt-1.5 border-t border-neutral-700/50 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400 text-[11px]">Posizione</span>
                    <div className="flex gap-1 bg-neutral-900/80 p-0.5 rounded-lg border border-neutral-700/50">
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, elevationPosition: 'above_text' })}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${config.elevationPosition === 'above_text' ? 'bg-teal-500 text-white' : 'text-neutral-400'}`}
                      >
                        Sopra al Titolo
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, elevationPosition: 'below_text' })}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${(config.elevationPosition || 'below_text') === 'below_text' ? 'bg-teal-500 text-white' : 'text-neutral-400'}`}
                      >
                        Sotto al Titolo
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300 text-[11px]">Pallini delle tappe sul grafico</span>
                    <input
                      type="checkbox"
                      checked={config.showElevationWaypoints ?? true}
                      onChange={(e) => setConfig({ ...config, showElevationWaypoints: e.target.checked })}
                      className="w-3.5 h-3.5 accent-teal-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 5. ABBELLIMENTI CARTOGRAFICI (2-Column Grid) */}
            <div className="grid grid-cols-2 gap-2">
              <div className="glass-panel-subtle p-2.5 rounded-xl border border-white/10 bg-[#1e222b]/60 flex items-center justify-between">
                <span className="text-xs text-neutral-300 font-medium flex items-center gap-1.5">
                  <GridIcon className="w-3.5 h-3.5 text-teal-400" />
                  Reticolo (+)
                </span>
                <input
                  type="checkbox"
                  checked={config.showGrid}
                  onChange={(e) => setConfig({ ...config, showGrid: e.target.checked })}
                  className="w-3.5 h-3.5 accent-teal-500 rounded cursor-pointer"
                />
              </div>

              <div className="glass-panel-subtle p-2.5 rounded-xl border border-white/10 bg-[#1e222b]/60 flex items-center justify-between">
                <span className="text-xs text-neutral-300 font-medium flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-amber-400" />
                  Bussola (N)
                </span>
                <input
                  type="checkbox"
                  checked={config.showCompass}
                  onChange={(e) => setConfig({ ...config, showCompass: e.target.checked })}
                  className="w-3.5 h-3.5 accent-teal-500 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
