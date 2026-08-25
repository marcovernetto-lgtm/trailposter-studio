import * as THREE from 'three';

/**
 * Camera mode definitions
 */
export const CAMERA_MODES = {
  drone: {
    id: 'drone',
    name: 'Drone Cinematico',
    description: 'Volo morbido che segue il percorso con inclinazione cinematografica',
    icon: '🚁',
  },
  eagle: {
    id: 'eagle',
    name: 'Volo d\'Aquila',
    description: 'Ampia panoramica aerea ad alta quota con vista a 45°',
    icon: '🦅',
  },
  orbit: {
    id: 'orbit',
    name: 'Orbita Panoramica',
    description: 'Rotazione continua a 360° attorno all\'intero massiccio',
    icon: '🌍',
  },
  firstPerson: {
    id: 'firstPerson',
    name: 'Prospettiva Atleta',
    description: 'Visuale ravvicinata e dinamica lungo la traccia',
    icon: '👁️',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Regia Multi-Angolo',
    description: 'Alterna inquadrature aeree ampie e scorci ravvicinati',
    icon: '🎬',
  },
  overview: {
    id: 'overview',
    name: 'Intro & Outro Totale',
    description: 'Zoom dall\'alto verso la partenza, segue e panoramica finale',
    icon: '🗺️',
  },
  keyframe: {
    id: 'keyframe',
    name: 'Regia Manuale (Keyframe)',
    description: 'Controllata dai tuoi punti chiave personalizzati sulla timeline',
    icon: '✨',
  },
};

/**
 * Pre-computes a heavily smoothed guide curve for camera tracking.
 * This filters out sudden micro-turns and mountain hairpin jitter.
 */
function createSmoothedGuideCurve(trackCurve, samples = 120) {
  const rawPoints = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    rawPoints.push(trackCurve.getPointAt(Math.min(0.999, t)));
  }

  // Apply Gaussian/Moving average filter (window size = 7)
  const smoothedPoints = [];
  const halfWin = 3;

  for (let i = 0; i <= samples; i++) {
    let sum = new THREE.Vector3();
    let weightSum = 0;

    for (let w = -halfWin; w <= halfWin; w++) {
      const idx = Math.max(0, Math.min(samples, i + w));
      const dist = Math.abs(w);
      const weight = Math.exp(-(dist * dist) / (2 * 1.5 * 1.5));
      sum.addScaledVector(rawPoints[idx], weight);
      weightSum += weight;
    }

    smoothedPoints.push(sum.divideScalar(weightSum));
  }

  return new THREE.CatmullRomCurve3(smoothedPoints, false, 'centripetal', 0.5);
}

/**
 * Create a camera controller for the given track curve and optional keyframe set.
 */
export function createCameraController(trackCurve, worldBounds, keyframes = []) {
  const guideCurve = createSmoothedGuideCurve(trackCurve, 150);

  const state = {
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    initialized: false,
  };

  const getTrackPoint = (t) => trackCurve.getPointAt(Math.max(0, Math.min(t, 0.999)));
  const getGuidePoint = (t) => guideCurve.getPointAt(Math.max(0, Math.min(t, 0.999)));
  const getGuideTangent = (t) => guideCurve.getTangentAt(Math.max(0, Math.min(t, 0.999))).normalize();

  // Track centroid for orbit and overview shots
  const startPt = getTrackPoint(0);
  const midPt = getTrackPoint(0.5);
  const endPt = getTrackPoint(0.999);
  const centroid = new THREE.Vector3()
    .addVectors(startPt, midPt)
    .add(endPt)
    .divideScalar(3);

  /**
   * Evaluates camera position and lookAt from user keyframes
   */
  const evaluateKeyframes = (t, userKeyframes) => {
    if (!userKeyframes || userKeyframes.length === 0) {
      return {
        position: startPt.clone().add(new THREE.Vector3(0, 150, 150)),
        lookAt: centroid.clone(),
      };
    }

    if (userKeyframes.length === 1) {
      return {
        position: userKeyframes[0].position.clone(),
        lookAt: userKeyframes[0].lookAt.clone(),
      };
    }

    // Sort keyframes by time t
    const sorted = [...userKeyframes].sort((a, b) => a.t - b.t);

    if (t <= sorted[0].t) {
      return { position: sorted[0].position.clone(), lookAt: sorted[0].lookAt.clone() };
    }
    if (t >= sorted[sorted.length - 1].t) {
      const last = sorted[sorted.length - 1];
      return { position: last.position.clone(), lookAt: last.lookAt.clone() };
    }

    // Find segment [i, i+1]
    let idx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].t && t <= sorted[i + 1].t) {
        idx = i;
        break;
      }
    }

    const k1 = sorted[idx];
    const k2 = sorted[idx + 1];
    const segT = (t - k1.t) / (k2.t - k1.t);

    // Smooth cubic Hermite interpolation (SmoothStep)
    const smoothT = segT * segT * (3 - 2 * segT);

    const pos = new THREE.Vector3().lerpVectors(k1.position, k2.position, smoothT);
    const look = new THREE.Vector3().lerpVectors(k1.lookAt, k2.lookAt, smoothT);

    return { position: pos, lookAt: look };
  };

  /**
   * Main camera update function called per frame
   */
  const updateCamera = (camera, progress, mode = 'drone', customKeyframes = []) => {
    const t = Math.max(0, Math.min(progress, 1.0));

    let desiredPosition = new THREE.Vector3();
    let desiredLookAt = new THREE.Vector3();
    let lerpFactor = 0.04; // Slower, ultra-smooth cinematic lerp

    const currentTrackPt = getTrackPoint(t);
    const guidePt = getGuidePoint(t);
    const guideTangent = getGuideTangent(t);

    // 1. DRONE CINEMATICO (Ultra-smooth chase with wide lookahead)
    if (mode === 'drone') {
      const followDist = 140;
      const heightOffset = 65;

      // Lookahead point 6% forward along the curve for natural panning
      const lookAheadT = Math.min(t + 0.06, 0.999);
      const lookAheadPt = getTrackPoint(lookAheadT);

      // Smooth camera position behind the smoothed guide point
      desiredPosition
        .copy(guidePt)
        .sub(guideTangent.clone().multiplyScalar(followDist))
        .add(new THREE.Vector3(0, heightOffset, 0));

      // Ensure camera is elevated above ground
      desiredPosition.y = Math.max(currentTrackPt.y + 40, desiredPosition.y);

      desiredLookAt.copy(lookAheadPt).add(new THREE.Vector3(0, 8, 0));
      lerpFactor = 0.035;
    }

    // 2. VOLO D'AQUILA (High-altitude sweeping vista)
    else if (mode === 'eagle') {
      const eagleHeight = 220;
      const swayOffset = Math.sin(t * Math.PI * 2) * 90;

      // Perpendicular lateral drift
      const perp = new THREE.Vector3(-guideTangent.z, 0, guideTangent.x).normalize();

      desiredPosition
        .copy(guidePt)
        .sub(guideTangent.clone().multiplyScalar(60))
        .add(perp.multiplyScalar(swayOffset))
        .add(new THREE.Vector3(0, eagleHeight, 0));

      desiredLookAt.copy(currentTrackPt);
      lerpFactor = 0.025;
    }

    // 3. ORBITA PANORAMICA (Smooth 360° rotation around massif)
    else if (mode === 'orbit') {
      const radius = 320;
      const height = 180;
      const angle = t * 2 * Math.PI - Math.PI / 2;

      desiredPosition.set(
        centroid.x + radius * Math.cos(angle),
        centroid.y + height,
        centroid.z + radius * Math.sin(angle)
      );

      desiredLookAt.copy(currentTrackPt).lerp(centroid, 0.5);
      lerpFactor = 0.04;
    }

    // 4. PROSPETTIVA ATLETA (Smooth first-person POV)
    else if (mode === 'firstPerson') {
      const lookAheadT = Math.min(t + 0.04, 0.999);
      const lookTarget = getTrackPoint(lookAheadT);

      desiredPosition.copy(currentTrackPt).add(new THREE.Vector3(0, 12, 0));
      desiredLookAt.copy(lookTarget).add(new THREE.Vector3(0, 10, 0));
      lerpFactor = 0.08;
    }

    // 5. REGIA MULTI-ANGOLO (Cinematic sequence with soft blended cuts)
    else if (mode === 'cinematic') {
      if (t < 0.25) {
        // Scene 1: High establishing lateral shot
        desiredPosition.copy(guidePt).add(new THREE.Vector3(120, 160, 80));
        desiredLookAt.copy(currentTrackPt);
      } else if (t < 0.5) {
        // Scene 2: Low-altitude chase
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(80))
          .add(new THREE.Vector3(0, 35, 0));
        desiredLookAt.copy(getTrackPoint(Math.min(t + 0.05, 0.999)));
      } else if (t < 0.75) {
        // Scene 3: Wide diagonal flyby
        const angle = t * Math.PI * 2;
        desiredPosition.set(
          guidePt.x + 160 * Math.cos(angle),
          guidePt.y + 110,
          guidePt.z + 160 * Math.sin(angle)
        );
        desiredLookAt.copy(currentTrackPt);
      } else {
        // Scene 4: Majestic pull-back rise
        const pullProgress = (t - 0.75) / 0.25;
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(100 + pullProgress * 200))
          .add(new THREE.Vector3(0, 70 + pullProgress * 200, 0));
        desiredLookAt.copy(centroid);
      }
      lerpFactor = 0.025;
    }

    // 6. INTRO & OUTRO TOTALE (Epic establishing zoom in & zoom out)
    else if (mode === 'overview') {
      if (t < 0.15) {
        // Intro: Descending zoom
        const introT = t / 0.15;
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 550, centroid.z + 200);
        const lowChase = guidePt.clone().sub(guideTangent.clone().multiplyScalar(130)).add(new THREE.Vector3(0, 65, 0));
        desiredPosition.lerpVectors(highOverview, lowChase, introT * introT);
        desiredLookAt.lerpVectors(centroid, currentTrackPt, introT);
      } else if (t < 0.85) {
        // Middle: Smooth drone
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(130))
          .add(new THREE.Vector3(0, 65, 0));
        desiredLookAt.copy(getTrackPoint(Math.min(t + 0.05, 0.999)));
      } else {
        // Outro: Ascent to full panorama
        const outroT = (t - 0.85) / 0.15;
        const lowChase = guidePt.clone().sub(guideTangent.clone().multiplyScalar(130)).add(new THREE.Vector3(0, 65, 0));
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 600, centroid.z + 250);
        desiredPosition.lerpVectors(lowChase, highOverview, outroT * outroT);
        desiredLookAt.lerpVectors(currentTrackPt, centroid, outroT);
      }
      lerpFactor = 0.03;
    }

    // 7. REGIA MANUALE CON KEYFRAME (User custom keyframes)
    else if (mode === 'keyframe') {
      const kfResult = evaluateKeyframes(t, customKeyframes);
      desiredPosition.copy(kfResult.position);
      desiredLookAt.copy(kfResult.lookAt);
      lerpFactor = 0.05;
    }

    // Apply smooth exponential damping to eliminate all jitter
    if (!state.initialized || t === 0) {
      state.currentPosition.copy(desiredPosition);
      state.currentLookAt.copy(desiredLookAt);
      state.initialized = true;
    } else {
      state.currentPosition.lerp(desiredPosition, lerpFactor);
      state.currentLookAt.lerp(desiredLookAt, lerpFactor * 1.3);
    }

    camera.position.copy(state.currentPosition);
    camera.lookAt(state.currentLookAt);
  };

  /**
   * Generates a starter set of 5 artistic keyframes across the track
   */
  const generateAutoKeyframes = () => {
    return [
      {
        id: 'kf-0',
        t: 0.0,
        name: 'Inizio Percorso',
        position: startPt.clone().add(new THREE.Vector3(-80, 70, 100)),
        lookAt: startPt.clone(),
      },
      {
        id: 'kf-1',
        t: 0.25,
        name: 'Salita Panoramica',
        position: getTrackPoint(0.25).clone().add(new THREE.Vector3(120, 110, -80)),
        lookAt: getTrackPoint(0.25).clone(),
      },
      {
        id: 'kf-2',
        t: 0.5,
        name: 'Vetta & Crinale',
        position: midPt.clone().add(new THREE.Vector3(0, 140, 140)),
        lookAt: midPt.clone(),
      },
      {
        id: 'kf-3',
        t: 0.75,
        name: 'Discesa Valle',
        position: getTrackPoint(0.75).clone().add(new THREE.Vector3(-100, 80, -60)),
        lookAt: getTrackPoint(0.75).clone(),
      },
      {
        id: 'kf-4',
        t: 1.0,
        name: 'Arrivo Finale',
        position: endPt.clone().add(new THREE.Vector3(100, 160, 150)),
        lookAt: endPt.clone(),
      },
    ];
  };

  return {
    updateCamera,
    generateAutoKeyframes,
    state,
  };
}

/**
 * Reset the camera controller state
 */
export function resetCameraState(controller) {
  if (controller && controller.state) {
    controller.state.initialized = false;
  }
}
