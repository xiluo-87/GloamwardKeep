import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';

export interface Voxel { x: number; y: number; z: number; w: number; h: number; d: number; color: string; leg?: number }

/** Shared model parts for both the density study and the authored tower sample. */
export class Painter {
  parts: Voxel[] = [];
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, leg?: number): void {
    this.parts.push({ x, y, z, w, h, d, color, leg });
  }
  mesh(dynamic = false): InstancedMesh {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), this.parts.length);
    const matrix = new Matrix4();
    this.parts.forEach((part, index) => {
      matrix.makeScale(part.w, part.h, part.d).setPosition(part.x, part.y, part.z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new Color(part.color));
    });
    if (dynamic) { mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; }
    return mesh;
  }
}
