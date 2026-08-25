import * as THREE from 'three';

/**
 * Camera mode definitions
 */
export const CAMERA_MODES = {
  drone: {
    id: 'drone',
    name: 'Drone Inseguitore',
    description: 'Segue il percorso da dietro e dall\'alto',
    icon: '🚁',
  },
  eagle: {
    id: 'eagle',
    name: 'Volo d\'Aquila',
    description: 'Vista dall\'alto con angolazione laterale',
    icon: '🦅',
  },
  orbit: {
    id: 'orbit',
    name: 'Orbita Panoramica',
    description: 'Ruota lentamente attorno al percorso',
    icon: '🌍',
  },
  firstPerson: {
    id: 'firstPerson',
    name: 'Prima Persona',
    description: 'Punto di vista dall\'atleta',
    icon: '👁️',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Cinematografica',
    description: 'Mix dinamico con cambi di angolazione',
    icon: '🎬',
  },
  overview: {
    id: 'overview',
    name: 'Panorama Totale',
    description: 'Zoom-in, segue, zoom-out finale',
    icon: '🗺️',
  },
};

/**
 * Create a camera controller for the given track curve.
 * 
 * @param {THREE.CatmullRomCurve3} trackCurve - The 3D track spline
 * @param {Object} worldBounds - { centerLat, centerLon, spanKm }
 * @returns {Object} { updateCamera(camera, progress, mode), getInitialPosition(mode) }
 */
export function createCameraController(trackCurve, worldBounds) {
  const state = {
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    initialized: false,
  };

  const getPointClamped = (t) => {
    return trackCurve.getPointAt(Math.max(0, Math.min(t, 0.999)));
  };

  const getTangentClamped = (t) => {
    return trackCurve.getTangentAt(Math.max(0, Math.min(t, 0.999))).normalize();
  };

  // Pre-calculate track centroid for orbit mode
  const startPt = getPointClamped(0);
  const midPt = getPointClamped(0.5);
  const endPt = getPointClamped(0.999);
  const centroid = new THREE.Vector3()
    .addVectors(startPt, midPt)
    .add(endPt)
    .divideScalar(3);

  const getInitialPosition = (mode) => {
    return startPt.clone().add(new THREE.Vector3(0, 100, 100)); // Fallback if needed
  };

  const updateCamera = (camera, progress, mode) => {
    const t = Math.max(0, Math.min(progress, 1.0));
    
    let desiredPosition = new THREE.Vector3();
    let desiredLookAt = new THREE.Vector3();
    let lerpFactor = 0.06;

    const currentPt = getPointClamped(t);
    
    if (mode === 'drone') {
      const tangent = getTangentClamped(t);
      // Calculate perpendicular vector for lateral sway
      const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const sway = perp.multiplyScalar(Math.sin(t * Math.PI * 4) * 15);
      
      desiredPosition.copy(currentPt)
        .sub(tangent.multiplyScalar(120))
        .add(new THREE.Vector3(0, 60, 0))
        .add(sway);
        
      desiredLookAt.copy(getPointClamped(t + 0.03));
      lerpFactor = 0.06;
    } 
    else if (mode === 'eagle') {
      const lateralOffset = 80 * Math.sin(t * Math.PI * 2);
      desiredPosition.copy(currentPt).add(new THREE.Vector3(lateralOffset, 200, 0));
      desiredLookAt.copy(currentPt);
      lerpFactor = 0.04;
    }
    else if (mode === 'orbit') {
      const radius = 300;
      const height = 150;
      const angle = t * 2 * Math.PI;
      
      desiredPosition.set(
        centroid.x + radius * Math.cos(angle),
        centroid.y + height,
        centroid.z + radius * Math.sin(angle)
      );
      desiredLookAt.copy(centroid);
      lerpFactor = 1.0; // Mathematically smooth, but lerp function will just snap if factor is 1
    }
    else if (mode === 'firstPerson') {
      const headBob = Math.sin(t * 40) * 0.5;
      desiredPosition.copy(currentPt).add(new THREE.Vector3(0, 8 + headBob, 0));
      desiredLookAt.copy(getPointClamped(t + 0.02)).add(new THREE.Vector3(0, 5, 0));
      lerpFactor = 0.12;
    }
    else if (mode === 'cinematic') {
      let segmentLerp = 0.04;
      
      const isTransition = (
        (t > 0.18 && t < 0.22) ||
        (t > 0.38 && t < 0.42) ||
        (t > 0.58 && t < 0.62) ||
        (t > 0.78 && t < 0.82)
      );
      if (isTransition) {
        segmentLerp = 0.02;
      }
      
      if (t < 0.2) {
        // High establishing side shot
        desiredPosition.copy(currentPt).add(new THREE.Vector3(150, 200, 50));
        desiredLookAt.copy(currentPt);
      } else if (t < 0.4) {
        // Close drone follow
        const tangent = getTangentClamped(t);
        desiredPosition.copy(currentPt).sub(tangent.multiplyScalar(60)).add(new THREE.Vector3(0, 30, 0));
        desiredLookAt.copy(getPointClamped(t + 0.02));
      } else if (t < 0.6) {
        // Low angle dramatic
        const tangent = getTangentClamped(t);
        desiredPosition.copy(currentPt).sub(tangent.multiplyScalar(30)).add(new THREE.Vector3(0, 3, 0));
        desiredLookAt.copy(getPointClamped(t + 0.05)).add(new THREE.Vector3(0, 15, 0));
      } else if (t < 0.8) {
        // Wide sweeping arc
        const radius = 200;
        const angle = t * Math.PI;
        desiredPosition.set(
          currentPt.x + radius * Math.cos(angle),
          currentPt.y + 100,
          currentPt.z + radius * Math.sin(angle)
        );
        desiredLookAt.copy(currentPt);
      } else {
        // Pull-back zoom out
        const pullBack = (t - 0.8) * 5; // Normalize 0.8-1.0 to 0-1
        desiredPosition.copy(currentPt).add(new THREE.Vector3(pullBack * 200, 100 + pullBack * 300, pullBack * 200));
        desiredLookAt.copy(centroid);
      }
      lerpFactor = segmentLerp;
    }
    else if (mode === 'overview') {
      if (t < 0.15) {
        const pt = t / 0.15; // 0 to 1
        const startPos = new THREE.Vector3(centroid.x, centroid.y + 500, centroid.z);
        const tangent = getTangentClamped(0.15);
        const endPos = getPointClamped(0.15).sub(tangent.multiplyScalar(120)).add(new THREE.Vector3(0, 60, 0));
        
        desiredPosition.copy(startPos).lerp(endPos, pt);
        desiredLookAt.copy(centroid).lerp(getPointClamped(0.15 + 0.03), pt);
      } else if (t < 0.85) {
        // Drone
        const tangent = getTangentClamped(t);
        const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const sway = perp.multiplyScalar(Math.sin(t * Math.PI * 4) * 15);
        
        desiredPosition.copy(currentPt)
          .sub(tangent.multiplyScalar(120))
          .add(new THREE.Vector3(0, 60, 0))
          .add(sway);
        desiredLookAt.copy(getPointClamped(t + 0.03));
      } else {
        const pt = (t - 0.85) / 0.15; // 0 to 1
        const tangent = getTangentClamped(0.85);
        const startPos = getPointClamped(0.85).sub(tangent.multiplyScalar(120)).add(new THREE.Vector3(0, 60, 0));
        const endPos = new THREE.Vector3(centroid.x, centroid.y + 600, centroid.z);
        
        desiredPosition.copy(startPos).lerp(endPos, pt);
        desiredLookAt.copy(getPointClamped(t)).lerp(centroid, pt);
      }
      lerpFactor = 0.04;
    }

    // Apply smoothing
    if (!state.initialized || t === 0) {
      state.currentPosition.copy(desiredPosition);
      state.currentLookAt.copy(desiredLookAt);
      state.initialized = true;
    } else {
      state.currentPosition.lerp(desiredPosition, lerpFactor);
      state.currentLookAt.lerp(desiredLookAt, lerpFactor * 1.5);
    }

    camera.position.copy(state.currentPosition);
    camera.lookAt(state.currentLookAt);
  };

  return {
    updateCamera,
    getInitialPosition,
    state
  };
}

/**
 * Reset the camera controller state (call when switching modes)
 */
export function resetCameraState(controller) {
  if (controller && controller.state) {
    controller.state.initialized = false;
  }
}
