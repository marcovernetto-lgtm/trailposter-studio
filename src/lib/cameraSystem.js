import * as THREE from 'three';

/**
 * Camera mode definitions (clean, minimal, professional)
 */
export const CAMERA_MODES = {
  drone: {
    id: 'drone',
    name: 'Drone Cinematico',
    description: 'Volo morbido che segue il percorso con inclinazione cinematografica',
    iconType: 'drone',
  },
  eagle: {
    id: 'eagle',
    name: 'Volo d\'Aquila',
    description: 'Ampia panoramica aerea ad alta quota con vista a 45°',
    iconType: 'eagle',
  },
  orbit: {
    id: 'orbit',
    name: 'Orbita Panoramica',
    description: 'Rotazione continua a 360° attorno all\'intero massiccio',
    iconType: 'orbit',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Regia Multi-Angolo',
    description: 'Alterna inquadrature aeree ampie e scorci ravvicinati',
    iconType: 'cinematic',
  },
  overview: {
    id: 'overview',
    name: 'Intro & Outro Totale',
    description: 'Zoom dall\'alto verso la partenza, segue e panoramica finale',
    iconType: 'overview',
  },
  keyframe: {
    id: 'keyframe',
    name: 'Regia Manuale',
    description: 'Controllata dai tuoi punti chiave personalizzati sulla timeline',
    iconType: 'keyframe',
  },
};

/**
 * Pre-computes a heavily smoothed guide curve for camera tracking.
 * This filters out sudden micro-turns and mountain hairpin jitter.
 */
function createSmoothedGuideCurve(trackCurve, samples = 150) {
  const rawPoints = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    rawPoints.push(trackCurve.getPointAt(Math.min(0.999, t)));
  }

  // Apply Gaussian/Moving average filter (window size = 9)
  const smoothedPoints = [];
  const halfWin = 4;

  for (let i = 0; i <= samples; i++) {
    let sum = new THREE.Vector3();
    let weightSum = 0;

    for (let w = -halfWin; w <= halfWin; w++) {
      const idx = Math.max(0, Math.min(samples, i + w));
      const dist = Math.abs(w);
      const weight = Math.exp(-(dist * dist) / (2 * 2.0 * 2.0));
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
  const guideCurve = createSmoothedGuideCurve(trackCurve, 180);

  const state = {
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    initialized: false,
  };

  const getTrackPoint = (t) => trackCurve.getPointAt(Math.max(0, Math.min(t, 0.999)));
  const getGuidePoint = (t) => guideCurve.getPointAt(Math.max(0, Math.min(t, 0.999)));
  const getGuideTangent = (t) => guideCurve.getTangentAt(Math.max(0, Math.min(t, 0.999))).normalize();

  // Track centroid for orbit, overview and outro shots
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
   * Main camera update function called per frame.
   * Supports optional outroProgress (0 to 1) for the final 4-second zoom-out reveal!
   */
  const updateCamera = (
    camera,
    progress,
    mode = 'drone',
    customKeyframes = [],
    outroProgress = 0.0
  ) => {
    const t = Math.max(0, Math.min(progress, 1.0));

    let desiredPosition = new THREE.Vector3();
    let desiredLookAt = new THREE.Vector3();
    let lerpFactor = 0.04;

    const currentTrackPt = getTrackPoint(t);
    const guidePt = getGuidePoint(t);
    const guideTangent = getGuideTangent(t);

    // 1. DRONE CINEMATICO
    if (mode === 'drone') {
      const followDist = 140;
      const heightOffset = 65;

      const lookAheadT = Math.min(t + 0.06, 0.999);
      const lookAheadPt = getTrackPoint(lookAheadT);

      desiredPosition
        .copy(guidePt)
        .sub(guideTangent.clone().multiplyScalar(followDist))
        .add(new THREE.Vector3(0, heightOffset, 0));

      desiredPosition.y = Math.max(currentTrackPt.y + 40, desiredPosition.y);
      desiredLookAt.copy(lookAheadPt).add(new THREE.Vector3(0, 8, 0));
      lerpFactor = 0.035;
    }

    // 2. VOLO D'AQUILA
    else if (mode === 'eagle') {
      const eagleHeight = 220;
      const swayOffset = Math.sin(t * Math.PI * 2) * 90;
      const perp = new THREE.Vector3(-guideTangent.z, 0, guideTangent.x).normalize();

      desiredPosition
        .copy(guidePt)
        .sub(guideTangent.clone().multiplyScalar(60))
        .add(perp.multiplyScalar(swayOffset))
        .add(new THREE.Vector3(0, eagleHeight, 0));

      desiredLookAt.copy(currentTrackPt);
      lerpFactor = 0.025;
    }

    // 3. ORBITA PANORAMICA
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

    // 4. REGIA MULTI-ANGOLO
    else if (mode === 'cinematic') {
      if (t < 0.25) {
        desiredPosition.copy(guidePt).add(new THREE.Vector3(120, 160, 80));
        desiredLookAt.copy(currentTrackPt);
      } else if (t < 0.5) {
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(80))
          .add(new THREE.Vector3(0, 35, 0));
        desiredLookAt.copy(getTrackPoint(Math.min(t + 0.05, 0.999)));
      } else if (t < 0.75) {
        const angle = t * Math.PI * 2;
        desiredPosition.set(
          guidePt.x + 160 * Math.cos(angle),
          guidePt.y + 110,
          guidePt.z + 160 * Math.sin(angle)
        );
        desiredLookAt.copy(currentTrackPt);
      } else {
        const pullProgress = (t - 0.75) / 0.25;
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(100 + pullProgress * 200))
          .add(new THREE.Vector3(0, 70 + pullProgress * 200, 0));
        desiredLookAt.copy(centroid);
      }
      lerpFactor = 0.025;
    }

    // 5. INTRO & OUTRO TOTALE
    else if (mode === 'overview') {
      if (t < 0.15) {
        const introT = t / 0.15;
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 550, centroid.z + 200);
        const lowChase = guidePt.clone().sub(guideTangent.clone().multiplyScalar(130)).add(new THREE.Vector3(0, 65, 0));
        desiredPosition.lerpVectors(highOverview, lowChase, introT * introT);
        desiredLookAt.lerpVectors(centroid, currentTrackPt, introT);
      } else if (t < 0.85) {
        desiredPosition
          .copy(guidePt)
          .sub(guideTangent.clone().multiplyScalar(130))
          .add(new THREE.Vector3(0, 65, 0));
        desiredLookAt.copy(getTrackPoint(Math.min(t + 0.05, 0.999)));
      } else {
        const outroT = (t - 0.85) / 0.15;
        const lowChase = guidePt.clone().sub(guideTangent.clone().multiplyScalar(130)).add(new THREE.Vector3(0, 65, 0));
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 600, centroid.z + 250);
        desiredPosition.lerpVectors(lowChase, highOverview, outroT * outroT);
        desiredLookAt.lerpVectors(currentTrackPt, centroid, outroT);
      }
      lerpFactor = 0.03;
    }

    // 6. REGIA MANUALE CON KEYFRAME
    else if (mode === 'keyframe') {
      const kfResult = evaluateKeyframes(t, customKeyframes);
      desiredPosition.copy(kfResult.position);
      desiredLookAt.copy(kfResult.lookAt);
      lerpFactor = 0.05;
    }

    // 7. FINAL 7-SECOND CINEMATIC OUTRO ZOOM OUT (GRAND REVEAL)
    if (outroProgress > 0) {
      const p = Math.max(0, Math.min(outroProgress, 1.0));
      const smoothP = p * p * (3 - 2 * p);

      const finishPos = desiredPosition.clone();
      const finishLook = desiredLookAt.clone();

      const outroAngle = Math.PI / 4 + p * 0.30;
      const outroHeight = 720;
      const outroDist = 520;

      const grandOverviewPos = new THREE.Vector3(
        centroid.x + outroDist * Math.cos(outroAngle),
        centroid.y + outroHeight,
        centroid.z + outroDist * Math.sin(outroAngle)
      );

      desiredPosition.lerpVectors(finishPos, grandOverviewPos, smoothP);
      desiredLookAt.lerpVectors(finishLook, centroid, smoothP);
      lerpFactor = 0.05;
    }

    // Apply smooth exponential damping
    if (!state.initialized || (t === 0 && outroProgress === 0)) {
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
