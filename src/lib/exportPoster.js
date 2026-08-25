import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import confetti from 'canvas-confetti';

/**
 * Triggers celebratory confetti animation on export complete
 */
export function triggerConfetti() {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#0d9488', '#14b8a6', '#f59e0b', '#38bdf8', '#ffffff'],
  });
}

/**
 * Sanitizes any oklab/oklch/color(srgb) strings in a CSS text block
 */
function sanitizeCssString(cssText) {
  if (!cssText || typeof cssText !== 'string') return cssText;
  return cssText
    .replace(/oklch\([^)]*\)/gi, 'rgba(15, 23, 42, 0.8)')
    .replace(/oklab\([^)]*\)/gi, 'rgba(15, 23, 42, 0.8)')
    .replace(/color\(srgb[^)]*\)/gi, 'rgba(15, 23, 42, 0.8)');
}

/**
 * Purges modern oklab/oklch color functions from style elements without removing stylesheets.
 */
function purgeModernColorsFromDocument(doc) {
  if (!doc) return;

  const styleEls = doc.querySelectorAll('style');
  styleEls.forEach((styleEl) => {
    if (styleEl.textContent && (styleEl.textContent.includes('oklab') || styleEl.textContent.includes('oklch') || styleEl.textContent.includes('color('))) {
      styleEl.textContent = sanitizeCssString(styleEl.textContent);
    }
  });
}

/**
 * Exports the Poster Canvas element as a Master High-Res PNG or PDF (50×70 cm / 70×50 cm)
 * Both PNG and PDF share identical physical/pixel dimensions, aspect ratio (5:7), and visual characteristics.
 * @param {HTMLElement} element - The DOM element containing the poster
 * @param {string} filename - Base filename for the export
 * @param {'png' | 'pdf'} format - Export format ('png' or 'pdf')
 * @param {function} onProgress - Progress callback (boolean status)
 */
export async function exportPoster(element, filename = 'trail-poster', format = 'png', onProgress = null) {
  if (!element) {
    throw new Error('Elemento poster non trovato.');
  }

  try {
    if (onProgress) onProgress(true);

    if (document.fonts) {
      await document.fonts.ready;
    }

    // Determine orientation from on-screen aspect or data
    const isLandscape = element.offsetWidth > element.offsetHeight;
    const scale = 4;

    const canvas = await html2canvas(element, {
      scale: scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false,
      onclone: (clonedDoc) => {
        // 1. Intercept getComputedStyle to sanitize any oklab/oklch string returned to html2canvas
        if (clonedDoc.defaultView && clonedDoc.defaultView.getComputedStyle) {
          const origGetComputedStyle = clonedDoc.defaultView.getComputedStyle;
          clonedDoc.defaultView.getComputedStyle = function (el, pseudo) {
            const style = origGetComputedStyle.call(this, el, pseudo);
            return new Proxy(style, {
              get(target, prop) {
                const val = target[prop];
                if (typeof val === 'string' && (val.includes('oklab') || val.includes('oklch') || val.includes('color('))) {
                  return sanitizeCssString(val);
                }
                return typeof val === 'function' ? val.bind(target) : val;
              },
            });
          };
        }

        // 2. Sanitize style tags without removing any link elements
        purgeModernColorsFromDocument(clonedDoc);

        const clonedElement = clonedDoc.querySelector('#poster-canvas-element');
        if (clonedElement) {
          clonedElement.style.transform = 'none';
          clonedElement.style.boxShadow = 'none'; // Strip UI screen drop shadow
          clonedElement.style.borderRadius = '0px'; // Pure poster print edge
          clonedElement.style.border = 'none'; // Strip dashed preview helper border

          // Convert images in clonedDoc to Base64
          const imgs = Array.from(clonedElement.querySelectorAll('img'));
          imgs.forEach((img) => {
            if (img.src && !img.src.startsWith('data:')) {
              try {
                const c = clonedDoc.createElement('canvas');
                c.width = img.naturalWidth || img.width || 256;
                c.height = img.naturalHeight || img.height || 256;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                img.src = c.toDataURL('image/png');
              } catch (e) {
                img.crossOrigin = 'anonymous';
              }
            }
          });

          // Explicitly sanitize inline styles on all nodes
          const sanitizeNodeStyles = (node) => {
            if (node.nodeType !== 1) return;
            if (node.style && node.style.cssText) {
              node.style.cssText = sanitizeCssString(node.style.cssText);
            }
          };

          sanitizeNodeStyles(clonedElement);
          clonedElement.querySelectorAll('*').forEach(sanitizeNodeStyles);
        }
      },
    });

    if (!canvas) {
      throw new Error('Impossibile generare la tela del poster.');
    }

    const cleanFilename = filename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'trail-poster';
    const dimLabel = isLandscape ? '70x50cm' : '50x70cm';

    if (format === 'pdf') {
      // PDF in exact 500x700mm or 700x500mm physical standard matching PNG 5:7 ratio
      const pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: isLandscape ? [700, 500] : [500, 700],
        compress: true,
      });

      const imgData = canvas.toDataURL('image/png', 1.0);
      pdf.addImage(imgData, 'PNG', 0, 0, isLandscape ? 700 : 500, isLandscape ? 500 : 700, undefined, 'FAST');
      pdf.save(`${cleanFilename}-${dimLabel}.pdf`);
    } else {
      // PNG with identical 3500x4900px master resolution
      const link = document.createElement('a');
      link.download = `${cleanFilename}-${dimLabel}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    }

    triggerConfetti();
  } catch (error) {
    console.error('Export error:', error);
    alert(`Errore durante l'esportazione: ${error.message}`);
  } finally {
    if (onProgress) onProgress(false);
  }
}
