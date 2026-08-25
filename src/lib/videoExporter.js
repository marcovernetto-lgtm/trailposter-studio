import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * Check if WebCodecs video encoding is supported in this browser.
 * @returns {boolean}
 */
export function isVideoExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Export a Three.js scene to MP4 video file.
 * 
 * Renders the scene frame-by-frame offline (deterministic, no frame drops)
 * and supports custom 2D HUD / liquid glass overlay rendering.
 * 
 * @param {Object} params
 * @param {THREE.WebGLRenderer} params.renderer - Three.js renderer
 * @param {THREE.Scene} params.scene - Three.js scene
 * @param {THREE.PerspectiveCamera} params.camera - Three.js camera
 * @param {Function} params.updateFrame - function(progress: 0-1) called before each frame to update scene state
 * @param {Function} [params.drawOverlay] - optional function(ctx, width, height, progress) for burning HUD into video
 * @param {Object} params.options - { width: 1920, height: 1080, fps: 30, durationSec: 30, bitrate: 8_000_000 }
 * @param {Function} params.onProgress - callback(percent: 0-100, message: string)
 * @returns {Promise<string>} Object URL of the generated MP4 blob
 */
export async function exportVideo({
  renderer,
  scene,
  camera,
  updateFrame,
  drawOverlay = null,
  options = {},
  onProgress = () => {},
}) {
  if (!isVideoExportSupported()) {
    throw new Error('WebCodecs API is not supported in this browser.');
  }

  const {
    width = 1920,
    height = 1080,
    fps = 30,
    durationSec = 30,
    bitrate = 8_000_000,
  } = options;

  const totalFrames = fps * durationSec;

  // Save current renderer state
  const originalWidth = renderer.domElement.clientWidth;
  const originalHeight = renderer.domElement.clientHeight;
  const originalAspect = camera.aspect;

  // Offscreen composite canvas if overlay is present
  let compositeCanvas = null;
  let compositeCtx = null;
  if (drawOverlay) {
    compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    compositeCtx = compositeCanvas.getContext('2d');
  }

  try {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encoderError = e;
      },
    });

    encoder.configure({
      codec: 'avc1.640028', // H.264 High Profile Level 4.0
      width,
      height,
      bitrate,
      framerate: fps,
    });

    for (let i = 0; i < totalFrames; i++) {
      if (encoderError) {
        throw encoderError;
      }

      const progress = totalFrames > 1 ? i / (totalFrames - 1) : 1;
      updateFrame(progress);
      renderer.render(scene, camera);

      let frameSource = renderer.domElement;

      // Composite HUD overlay if enabled
      if (drawOverlay && compositeCtx) {
        compositeCtx.drawImage(renderer.domElement, 0, 0, width, height);
        drawOverlay(compositeCtx, width, height, progress);
        frameSource = compositeCanvas;
      }

      const frame = new VideoFrame(frameSource, {
        timestamp: Math.floor((i * 1_000_000) / fps),
      });

      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      onProgress(Math.round((i / totalFrames) * 100), `Frame ${i + 1}/${totalFrames}`);

      // Yield to browser to prevent UI freeze
      if (i % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      while (encoder.encodeQueueSize > 10) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  } catch (error) {
    throw error;
  } finally {
    // Restore original renderer size and camera aspect
    renderer.setSize(originalWidth, originalHeight, false);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();
  }
}

/**
 * Trigger download of a blob URL as a file.
 * @param {string} blobUrl - Object URL from exportVideo
 * @param {string} filename - Desired filename
 */
export function downloadVideo(blobUrl, filename) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 100);
}
