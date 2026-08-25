/**
 * TrailPoster Studio - Project & Progress Persistence Engine
 * Manages active draft auto-saving, named project archives, and .trailposter JSON backups.
 */

const STORAGE_KEYS = {
  ACTIVE_DRAFT: 'trailposter_active_draft_v1',
  PROJECTS_LIST: 'trailposter_saved_projects_v1',
  LAST_PROJECT_ID: 'trailposter_last_project_id',
};

/**
 * Saves the current draft automatically (debounced from App.jsx)
 */
export function autoSaveDraft(trackData, config) {
  try {
    const payload = {
      version: '1.0',
      timestamp: Date.now(),
      trackData: trackData || null,
      config: config || {},
    };
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DRAFT, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('Auto-save draft warning:', err);
    return false;
  }
}

/**
 * Loads the active draft if available
 */
export function loadAutoSaveDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading draft from storage:', err);
    return null;
  }
}

/**
 * Retrieves all saved projects sorted by last modified descending
 */
export function getSavedProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROJECTS_LIST);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch (err) {
    console.error('Error reading saved projects list:', err);
    return [];
  }
}

/**
 * Saves or updates a named project document
 */
export function saveProject({ id, name, trackData, config, thumbnail = null }) {
  try {
    const projects = getSavedProjects();
    const now = Date.now();
    const projectId = id || `project-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const projectName = (name || config?.title || trackData?.name || 'Poster Senza Titolo').trim();

    const projectDoc = {
      id: projectId,
      name: projectName,
      trackData: trackData || null,
      config: config || {},
      thumbnail: thumbnail || null,
      stats: trackData?.stats || { totalDistanceKm: 0, elevationGainM: 0, pointCount: 0 },
      createdAt: now,
      updatedAt: now,
    };

    const existingIndex = projects.findIndex((p) => p.id === projectId);
    if (existingIndex >= 0) {
      projectDoc.createdAt = projects[existingIndex].createdAt || now;
      projects[existingIndex] = projectDoc;
    } else {
      projects.unshift(projectDoc);
    }

    localStorage.setItem(STORAGE_KEYS.PROJECTS_LIST, JSON.stringify(projects));
    localStorage.setItem(STORAGE_KEYS.LAST_PROJECT_ID, projectId);
    return projectDoc;
  } catch (err) {
    console.error('Error saving project:', err);
    throw new Error('Impossibile salvare il progetto nella memoria locale.');
  }
}

/**
 * Deletes a project by ID
 */
export function deleteProject(id) {
  try {
    const projects = getSavedProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEYS.PROJECTS_LIST, JSON.stringify(projects));
    return true;
  } catch (err) {
    console.error('Error deleting project:', err);
    return false;
  }
}

/**
 * Duplicates an existing project
 */
export function duplicateProject(id) {
  try {
    const projects = getSavedProjects();
    const source = projects.find((p) => p.id === id);
    if (!source) throw new Error('Progetto sorgente non trovato.');

    const newId = `project-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const copyDoc = {
      ...source,
      id: newId,
      name: `Copia di ${source.name}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    projects.unshift(copyDoc);
    localStorage.setItem(STORAGE_KEYS.PROJECTS_LIST, JSON.stringify(projects));
    return copyDoc;
  } catch (err) {
    console.error('Error duplicating project:', err);
    throw err;
  }
}

/**
 * Exports a project as a downloadable .trailposter JSON file
 */
export function exportProjectToJson(project) {
  try {
    const exportData = {
      app: 'TrailPoster Studio',
      formatVersion: '1.0',
      exportedAt: new Date().toISOString(),
      project: {
        name: project.name,
        trackData: project.trackData,
        config: project.config,
        stats: project.stats,
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanName = (project.name || 'trailposter-project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = `${cleanName}.trailposter`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Error exporting project to JSON:', err);
    throw err;
  }
}

/**
 * Parses and validates an imported .trailposter JSON file
 */
export async function importProjectFromJson(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.project || !parsed.project.config) {
            throw new Error('File di progetto non valido o corrotto.');
          }

          const importedDoc = saveProject({
            name: parsed.project.name || file.name.replace(/\.trailposter$/i, ''),
            trackData: parsed.project.trackData,
            config: parsed.project.config,
          });

          resolve(importedDoc);
        } catch (parseErr) {
          reject(new Error(`Formato file non valido: ${parseErr.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Errore di lettura del file'));
      reader.readAsText(file);
    } catch (err) {
      reject(err);
    }
  });
}
