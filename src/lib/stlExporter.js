import * as THREE from 'three';

/**
 * Converts one or more THREE.BufferGeometry objects into a Binary STL ArrayBuffer
 */
export function geometriesToBinarySTL(geometries) {
  const geoms = Array.isArray(geometries) ? geometries.filter(Boolean) : [geometries].filter(Boolean);
  if (geoms.length === 0) return null;

  let totalTriangles = 0;

  // Count total triangles
  geoms.forEach((geom) => {
    if (geom.index) {
      totalTriangles += geom.index.count / 3;
    } else if (geom.attributes.position) {
      totalTriangles += geom.attributes.position.count / 3;
    }
  });

  const bufferLength = 84 + 50 * totalTriangles;
  const buffer = new ArrayBuffer(bufferLength);
  const dataView = new DataView(buffer);

  // 80 bytes header
  const headerStr = 'TrailPoster Studio 3D Relief & Trail Print Model';
  for (let i = 0; i < 80; i++) {
    dataView.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 0);
  }

  // 4 bytes triangle count
  dataView.setUint32(80, totalTriangles, true);

  let offset = 84;
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const normal = new THREE.Vector3();

  geoms.forEach((geom) => {
    const pos = geom.attributes.position;
    const index = geom.index;

    const writeTriangle = (a, b, c) => {
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);

      // Compute normal
      cb.set(cx - bx, cy - by, cz - bz);
      ab.set(ax - bx, ay - by, az - bz);
      cb.cross(ab).normalize();

      // Normal
      dataView.setFloat32(offset, cb.x, true);
      dataView.setFloat32(offset + 4, cb.y, true);
      dataView.setFloat32(offset + 8, cb.z, true);

      // Vertex 1
      dataView.setFloat32(offset + 12, ax, true);
      dataView.setFloat32(offset + 16, ay, true);
      dataView.setFloat32(offset + 20, az, true);

      // Vertex 2
      dataView.setFloat32(offset + 24, bx, true);
      dataView.setFloat32(offset + 28, by, true);
      dataView.setFloat32(offset + 32, bz, true);

      // Vertex 3
      dataView.setFloat32(offset + 36, cx, true);
      dataView.setFloat32(offset + 40, cy, true);
      dataView.setFloat32(offset + 44, cz, true);

      // Attribute byte count
      dataView.setUint16(offset + 48, 0, true);

      offset += 50;
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        writeTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        writeTriangle(i, i + 1, i + 2);
      }
    }
  });

  return buffer;
}

/**
 * Triggers browser download of a binary file Blob
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports a single unified STL file containing terrain + route
 */
export function exportSingleSTL(terrainGeom, trackGeom, filename = 'trail-3d-model.stl') {
  const geoms = [terrainGeom, trackGeom].filter(Boolean);
  const buffer = geometriesToBinarySTL(geoms);
  if (!buffer) return false;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  downloadBlob(blob, filename.endsWith('.stl') ? filename : `${filename}.stl`);
  return true;
}

/**
 * Exports two aligned STL files for Multi-Color / Multi-Material printing (Bambu AMS / Prusa MMU)
 */
export function exportMultiMaterialSTLs(terrainGeom, trackGeom, baseName = 'trail-3d') {
  const clean = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'trail-3d';

  if (terrainGeom) {
    const tBuf = geometriesToBinarySTL([terrainGeom]);
    if (tBuf) {
      const blob = new Blob([tBuf], { type: 'application/octet-stream' });
      downloadBlob(blob, `${clean}-montagne-paesaggio.stl`);
    }
  }

  if (trackGeom) {
    setTimeout(() => {
      const pBuf = geometriesToBinarySTL([trackGeom]);
      if (pBuf) {
        const blob = new Blob([pBuf], { type: 'application/octet-stream' });
        downloadBlob(blob, `${clean}-percorso-traccia.stl`);
      }
    }, 400);
  }

  return true;
}

/**
 * Exports a multi-material OBJ file with colors
 */
export function exportOBJ(terrainGeom, trackGeom, options = {}) {
  const {
    filename = 'trail-3d-model',
    terrainColor = '#2d3748',
    trackColor = '#14b8a6',
  } = options;

  let obj = `# TrailPoster Studio 3D Multi-Color Export\nmtllib ${filename}.mtl\n\n`;
  let vertexOffset = 1;

  const appendGeom = (geom, groupName, matName) => {
    if (!geom) return;
    const pos = geom.attributes.position;
    const index = geom.index;

    obj += `g ${groupName}\nusemtl ${matName}\n`;

    for (let i = 0; i < pos.count; i++) {
      obj += `v ${pos.getX(i).toFixed(3)} ${pos.getY(i).toFixed(3)} ${pos.getZ(i).toFixed(3)}\n`;
    }

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        obj += `f ${index.getX(i) + vertexOffset} ${index.getX(i + 1) + vertexOffset} ${index.getX(i + 2) + vertexOffset}\n`;
      }
      vertexOffset += pos.count;
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        obj += `f ${i + vertexOffset} ${i + 1 + vertexOffset} ${i + 2 + vertexOffset}\n`;
      }
      vertexOffset += pos.count;
    }
    obj += '\n';
  };

  if (terrainGeom) appendGeom(terrainGeom, 'Terrain', 'mat_terrain');
  if (trackGeom) appendGeom(trackGeom, 'Track', 'mat_track');

  // Convert hex colors to RGB floats
  const hexToRgb = (hex) => {
    const c = new THREE.Color(hex);
    return `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}`;
  };

  let mtl = `# Material definitions\n`;
  mtl += `newmtl mat_terrain\nKd ${hexToRgb(terrainColor)}\nKa 0.1 0.1 0.1\nKs 0.2 0.2 0.2\nNs 10.0\n\n`;
  mtl += `newmtl mat_track\nKd ${hexToRgb(trackColor)}\nKa 0.2 0.2 0.2\nKs 0.5 0.5 0.5\nNs 30.0\n`;

  // Download OBJ
  const objBlob = new Blob([obj], { type: 'text/plain' });
  downloadBlob(objBlob, `${filename}.obj`);

  // Download MTL
  setTimeout(() => {
    const mtlBlob = new Blob([mtl], { type: 'text/plain' });
    downloadBlob(mtlBlob, `${filename}.mtl`);
  }, 300);

  return true;
}
