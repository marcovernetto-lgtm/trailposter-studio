// TrailMap Main Application Logic

const sampleTrails = [
  {
    id: 'tre-cime',
    name: 'Giro delle Tre Cime di Lavaredo',
    region: 'Dolomiti, Italia',
    difficulty: 'medio',
    distanceKm: 10.2,
    eleGainM: 480,
    maxEleM: 2454,
    coords: [
      [46.6124, 12.3015, 1850],
      [46.6185, 12.3080, 2010],
      [46.6234, 12.3150, 2170],
      [46.6288, 12.3110, 2454],
      [46.6240, 12.2980, 2320],
      [46.6124, 12.3015, 1850]
    ]
  },
  {
    id: 'sentiero-dei',
    name: 'Sentiero degli Dei',
    region: 'Costiera Amalfitana, Italia',
    difficulty: 'facile',
    distanceKm: 7.8,
    eleGainM: 340,
    maxEleM: 630,
    coords: [
      [40.6272, 14.5076, 630],
      [40.6260, 14.4980, 580],
      [40.6251, 14.4890, 510],
      [40.6280, 14.4820, 420],
      [40.6285, 14.4856, 350]
    ]
  },
  {
    id: 'mont-blanc-t1',
    name: 'Tour du Mont Blanc - Tappa Val Ferret',
    region: 'Val d\'Aosta, Italia',
    difficulty: 'difficile',
    distanceKm: 15.2,
    eleGainM: 1100,
    maxEleM: 2537,
    coords: [
      [45.8234, 6.9543, 1770],
      [45.8340, 6.9720, 2050],
      [45.8450, 6.9890, 2310],
      [45.8560, 7.0010, 2537],
      [45.8620, 7.0150, 2040]
    ]
  }
];

let map = null;
let currentPolyline = null;
let currentMarkers = [];
let chart = null;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderTrailList(sampleTrails);
  setupEventListeners();

  if (sampleTrails.length > 0) {
    selectTrail(sampleTrails[0]);
  }
});

function initMap() {
  // Initialize Leaflet Map
  map = L.map('map', {
    zoomControl: false
  }).setView([46.6124, 12.3015], 13);

  // Add OpenStreetMap Topo Layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
}

function renderTrailList(trails) {
  const container = document.getElementById('trail-list');
  container.innerHTML = '';

  trails.forEach(trail => {
    const card = document.createElement('div');
    card.className = 'trail-card';
    card.dataset.id = trail.id;
    card.innerHTML = `
      <div class="trail-card-title">${trail.name}</div>
      <div class="trail-card-meta">
        <span class="badge-difficulty badge-${trail.difficulty}">${trail.difficulty}</span>
        <span>${trail.distanceKm} km</span>
        <span>D+ ${trail.eleGainM} m</span>
      </div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.trail-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectTrail(trail);
    });

    container.appendChild(card);
  });
}

function selectTrail(trail) {
  if (!map) return;

  // Clear previous layers
  if (currentPolyline) map.removeLayer(currentPolyline);
  currentMarkers.forEach(m => map.removeLayer(m));
  currentMarkers = [];

  const latLngs = trail.coords.map(c => [c[0], c[1]]);

  // Draw Trail Polyline
  currentPolyline = L.polyline(latLngs, {
    color: '#10b981',
    weight: 5,
    opacity: 0.9,
    lineJoin: 'round'
  }).addTo(map);

  // Add Start & End Markers
  const startPoint = latLngs[0];
  const endPoint = latLngs[latLngs.length - 1];

  const startMarker = L.circleMarker(startPoint, {
    radius: 8,
    fillColor: '#10b981',
    color: '#ffffff',
    weight: 2,
    fillOpacity: 1
  }).bindPopup(`<b>Inizio:</b> ${trail.name}`).addTo(map);

  const endMarker = L.circleMarker(endPoint, {
    radius: 8,
    fillColor: '#f59e0b',
    color: '#ffffff',
    weight: 2,
    fillOpacity: 1
  }).bindPopup(`<b>Fine:</b> ${trail.name}`).addTo(map);

  currentMarkers.push(startMarker, endMarker);

  // Fit Map Bounds
  map.fitBounds(currentPolyline.getBounds(), { padding: [40, 40] });

  // Update Stats & Elevation Chart
  document.getElementById('stat-dist').innerText = `${trail.distanceKm} km`;
  document.getElementById('stat-ele-gain').innerText = `${trail.eleGainM} m`;
  document.getElementById('stat-max-ele').innerText = `${trail.maxEleM} m`;

  updateChart(trail);
}

function updateChart(trail) {
  const ctx = document.getElementById('elevation-chart').getContext('2d');
  
  const labels = trail.coords.map((_, i) => `${((i / (trail.coords.length - 1)) * trail.distanceKm).toFixed(1)} km`);
  const elevations = trail.coords.map(c => c[2]);

  if (chart) {
    chart.destroy();
  }

  if (typeof Chart !== 'undefined') {
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Altitudiene (m)',
          data: elevations,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.4,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
        }
      }
    });
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById('trail-search');
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = sampleTrails.filter(t => t.name.toLowerCase().includes(q) || t.region.toLowerCase().includes(q));
    renderTrailList(filtered);
  });

  const filterChips = document.querySelectorAll('#difficulty-filter .chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const val = chip.dataset.val;
      const filtered = val === 'all' ? sampleTrails : sampleTrails.filter(t => t.difficulty === val);
      renderTrailList(filtered);
    });
  });
}
