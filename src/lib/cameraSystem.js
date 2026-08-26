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

  // Sample track curve points to compute true centroid, bounding span and principal direction
  const samplePts = [];
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let s = 0; s <= 60; s++) {
    const pt = trackCurve.getPointAt(s / 60);
    samplePts.push(pt);
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const centroid = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const trackSpanX = maxX - minX;
  const trackSpanZ = maxZ - minZ;
  const trackSpan = Math.max(300, Math.sqrt(trackSpanX * trackSpanX + trackSpanZ * trackSpanZ));

  const startPt = getTrackPoint(0);
  const midPt = getTrackPoint(0.5);
  const endPt = getTrackPoint(0.999);

  let startToFinishVec = new THREE.Vector3(endPt.x - startPt.x, 0, endPt.z - startPt.z);
  if (startToFinishVec.length() < 15) {
    let maxDist = 0;
    let furthestPt = midPt;
    samplePts.forEach((p) => {
      const d = startPt.distanceTo(p);
      if (d > maxDist) {
        maxDist = d;
        furthestPt = p;
      }
    });
    startToFinishVec = new THREE.Vector3(furthestPt.x - startPt.x, 0, furthestPt.z - startPt.z);
  }
  const dirFinish = startToFinishVec.clone().normalize();

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
    outroProgress = 0.0,
    isVertical = false
  ) => {
    const t = Math.max(0, Math.min(progress, 1.0));

    let desiredPosition = new THREE.Vector3();
    let desiredLookAt = new THREE.Vector3();
    let lerpFactor = 0.04;

    const currentTrackPt = getTrackPoint(t);
    const guidePt = getGuidePoint(t);
    const guideTangent = getGuideTangent(t);

    // 1. DRONE CINEMATICO
    // Progression: Inizia da dietro -> ruota gradualmente sul fianco illuminato -> si sposta in avanti ad anticipare
    if (mode === 'drone') {
      const sunDir = new THREE.Vector3(0.55, 0.75, 0.35).normalize();
      const leftPerp = new THREE.Vector3(-guideTangent.z, 0, guideTangent.x).normalize();
      const rightPerp = new THREE.Vector3(guideTangent.z, 0, -guideTangent.x).normalize();
      const bestFlank = leftPerp.dot(sunDir) >= rightPerp.dot(sunDir) ? leftPerp : rightPerp;

      const vDist = isVertical ? 1.35 : 1.0;
      const vH = isVertical ? 1.40 : 1.0;

      let forwardDist = -120 * vDist;
      let sideDist = 0;
      let heightOffset = 50 * vH;

      if (t < 0.20) {
        // Stage 1: Dietro all'atleta in inseguimento dinamico
        forwardDist = -120 * vDist;
        sideDist = 0;
        heightOffset = 50 * vH;
      } else if (t < 0.65) {
        // Stage 2: Rotazione graduale verso il fianco meglio esposto
        const p1 = (t - 0.20) / 0.45;
        const smoothP1 = p1 * p1 * (3 - 2 * p1);
        forwardDist = (-120 + smoothP1 * 65) * vDist;
        sideDist = smoothP1 * 105 * vDist;
        heightOffset = (50 + smoothP1 * 20) * vH;
      } else {
        // Stage 3: Verso la fine la telecamera vola in avanti ad anticipare l'arrivo
        const p2 = (t - 0.65) / 0.35;
        const smoothP2 = p2 * p2 * (3 - 2 * p2);
        forwardDist = (-55 + smoothP2 * 145) * vDist;
        sideDist = (105 - smoothP2 * 45) * vDist;
        heightOffset = (70 + smoothP2 * 15) * vH;
      }

      desiredPosition
        .copy(currentTrackPt)
        .add(guideTangent.clone().multiplyScalar(forwardDist))
        .add(bestFlank.clone().multiplyScalar(sideDist))
        .add(new THREE.Vector3(0, heightOffset, 0));

      desiredPosition.y = Math.max(currentTrackPt.y + 25 * vH, desiredPosition.y);
      desiredLookAt.copy(currentTrackPt).add(new THREE.Vector3(0, isVertical ? 5 : 8, 0));
      lerpFactor = 0.04;
    }

    // 2. VOLO D'AQUILA (High-Altitude Cinematic 45° Angle)
    else if (mode === 'eagle') {
      const vDist = isVertical ? 1.35 : 1.0;
      const vH = isVertical ? 1.40 : 1.0;
      const highDist = 260 * vDist;
      const highHeight = 150 * vH;

      desiredPosition
        .copy(currentTrackPt)
        .sub(guideTangent.clone().multiplyScalar(highDist))
        .add(new THREE.Vector3(0, highHeight, 0));

      desiredLookAt.copy(currentTrackPt).add(new THREE.Vector3(0, isVertical ? 4 : 8, 0));
      lerpFactor = 0.035;
    }

    // 3. ORBITA PANORAMICA (Smooth 360° rotation around massif)
    else if (mode === 'orbit') {
      const orbitAngle = t * Math.PI * 2.2;
      const orbitRadius = Math.max(380, trackSpan * (isVertical ? 0.9 : 0.7));
      const orbitHeight = Math.max(220, trackSpan * (isVertical ? 0.6 : 0.45));

      desiredPosition.set(
        centroid.x + orbitRadius * Math.cos(orbitAngle),
        centroid.y + orbitHeight,
        centroid.z + orbitRadius * Math.sin(orbitAngle)
      );

      desiredLookAt.copy(currentTrackPt).add(new THREE.Vector3(0, 8, 0));
      lerpFactor = 0.04;
    }

    // 4. REGIA MULTI-ANGOLO (Dynamic alternating focal lengths & angles)
    else if (mode === 'cinematic') {
      const shotIndex = Math.floor(t * 4);
      const vMul = isVertical ? 1.35 : 1.0;

      if (shotIndex === 0) {
        // High 3/4 front view
        desiredPosition.copy(currentTrackPt).add(new THREE.Vector3(100 * vMul, 90 * vMul, 100 * vMul));
      } else if (shotIndex === 1) {
        // Low lateral tracking shot
        const sidePerp = new THREE.Vector3(-guideTangent.z, 0, guideTangent.x).multiplyScalar(85 * vMul);
        desiredPosition.copy(currentTrackPt).add(sidePerp).add(new THREE.Vector3(0, 45 * vMul, 0));
      } else if (shotIndex === 2) {
        // Top-down bird's eye view
        desiredPosition.copy(currentTrackPt).add(new THREE.Vector3(0, 220 * vMul, 20));
      } else {
        // Grand valley chase view
        desiredPosition
          .copy(currentTrackPt)
          .sub(guideTangent.clone().multiplyScalar(160 * vMul))
          .add(new THREE.Vector3(0, 80 * vMul, 0));
      }
      desiredLookAt.copy(currentTrackPt).add(new THREE.Vector3(0, 6, 0));
      lerpFactor = 0.035;
    }

    // 5. INTRO & OUTRO TOTALE
    else if (mode === 'overview') {
      const vMul = isVertical ? 1.35 : 1.0;
      if (t < 0.15) {
        const introT = t / 0.15;
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 550 * vMul, centroid.z + 280 * vMul);
        const lowChase = currentTrackPt.clone().sub(guideTangent.clone().multiplyScalar(120 * vMul)).add(new THREE.Vector3(0, 60 * vMul, 0));
        desiredPosition.lerpVectors(highOverview, lowChase, introT * introT);
        desiredLookAt.lerpVectors(centroid, currentTrackPt, introT);
      } else if (t < 0.85) {
        desiredPosition
          .copy(currentTrackPt)
          .sub(guideTangent.clone().multiplyScalar(120 * vMul))
          .add(new THREE.Vector3(0, 60 * vMul, 0));
        desiredLookAt.copy(currentTrackPt).add(new THREE.Vector3(0, 6, 0));
      } else {
        const outroT = (t - 0.85) / 0.15;
        const lowChase = currentTrackPt.clone().sub(guideTangent.clone().multiplyScalar(120 * vMul)).add(new THREE.Vector3(0, 60 * vMul, 0));
        const highOverview = new THREE.Vector3(centroid.x, centroid.y + 550 * vMul, centroid.z + 240 * vMul);
        desiredPosition.lerpVectors(lowChase, highOverview, outroT * outroT);
        desiredLookAt.lerpVectors(currentTrackPt, centroid, outroT);
      }
      lerpFactor = 0.035;
    }

    // 6. REGIA MANUALE CON KEYFRAME
    else if (mode === 'keyframe') {
      const kfResult = evaluateKeyframes(t, customKeyframes);
      desiredPosition.copy(kfResult.position);
      desiredLookAt.copy(kfResult.lookAt);
      lerpFactor = 0.05;
    }

    // 7. FINAL 7-SECOND CINEMATIC OUTRO ZOOM OUT (START AT TOP, FINISH AT BOTTOM)
    if (outroProgress > 0) {
      const p = Math.max(0, Math.min(outroProgress, 1.0));
      const smoothP = p * p * (3 - 2 * p);

      const finishPos = desiredPosition.clone();
      const finishLook = desiredLookAt.clone();

      // Scale camera height and distance based on vertical vs horizontal format
      const hScale = isVertical ? 1.65 : 1.25;
      const dScale = isVertical ? 1.25 : 0.95;
      const camHeight = Math.max(isVertical ? 880 : 720, trackSpan * hScale);
      const camDist = Math.max(isVertical ? 650 : 520, trackSpan * dScale);

      // Rotate slightly during 7s outro for subtle cinematic drift
      const driftAngle = (p - 0.5) * (isVertical ? 0.06 : 0.12);
      const cosD = Math.cos(driftAngle);
      const sinD = Math.sin(driftAngle);

      // Rotated direction from Start towards Finish
      const driftedDir = new THREE.Vector3(
        dirFinish.x * cosD - dirFinish.z * sinD,
        0,
        dirFinish.x * sinD + dirFinish.z * cosD
      ).normalize();

      // Camera sits behind Finish looking towards Centroid/Start
      const grandOverviewPos = new THREE.Vector3(
        centroid.x + driftedDir.x * camDist,
        centroid.y + camHeight,
        centroid.z + driftedDir.z * camDist
      );

      const grandOverviewLook = centroid.clone();

      desiredPosition.lerpVectors(finishPos, grandOverviewPos, smoothP);
      desiredLookAt.lerpVectors(finishLook, grandOverviewLook, smoothP);
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
