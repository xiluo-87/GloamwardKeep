import {
  AlwaysStencilFunc, AnimationClip, AnimationMixer, BufferAttribute, BufferGeometry, Color, DataTexture,
  EqualStencilFunc, FloatType, GreaterDepth, Group, InstancedBufferAttribute, InstancedMesh, KeepStencilOp,
  LoopOnce, LoopRepeat, Matrix3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter,
  RGBAFormat, SkinnedMesh, Vector2, Vector3, ZeroStencilOp, ReplaceStencilOp,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { RUN } from '../data/balance';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const WIDTH = 1024;
const CLIPS = [
  { name: 'Idle', samples: 8, loop: true },
  { name: 'Walk', samples: 16, loop: true },
  { name: 'Run', samples: 16, loop: true },
  { name: 'Attack1', samples: 12, loop: false },
  { name: 'Hit', samples: 4, loop: false },
  { name: 'Death', samples: 12, loop: false },
] as const;

export interface BakedModelStats { vertices: number; triangles: number; poseBytes: number; frames: number }
interface MeshSource { mesh: Mesh; offset: number; count: number; index: BufferAttribute | null; baseColors: Float32Array }
interface ClipFrames { frames: number[]; duration: number; loop: boolean }

function colorOf(mesh: Mesh): Color {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material && 'color' in material ? (material as MeshStandardMaterial).color : new Color(1, 1, 1);
}

function floatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function bakeMaterial(material: MeshStandardMaterial | MeshBasicMaterial, positions: DataTexture, normals: DataTexture, vertexCount: number, opacity: boolean): void {
  const key = `gk-baked-model-v1-${material.type}-${opacity}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bakedPositionTexture = { value: positions };
    shader.uniforms.bakedNormalTexture = { value: normals };
    shader.uniforms.bakedVertexCount = { value: vertexCount };
    shader.uniforms.bakedTextureSize = { value: new Vector2(WIDTH, positions.image.height) };
    const attributes = `attribute float bakedVertex;\nattribute vec3 instancePose;\n${opacity ? 'attribute float instanceOpacity;\nvarying float vBakedOpacity;\n' : ''}
      uniform sampler2D bakedPositionTexture;\nuniform sampler2D bakedNormalTexture;\nuniform float bakedVertexCount;\nuniform vec2 bakedTextureSize;\n`;
    const readFn = `vec4 bakedPosition(float vertex, float frame) { float offset = frame * bakedVertexCount + vertex; vec2 uv = (vec2(mod(offset, bakedTextureSize.x), floor(offset / bakedTextureSize.x)) + 0.5) / bakedTextureSize; return texture2D(bakedPositionTexture, uv); }\nvec4 bakedNormal(float vertex, float frame) { float offset = frame * bakedVertexCount + vertex; vec2 uv = (vec2(mod(offset, bakedTextureSize.x), floor(offset / bakedTextureSize.x)) + 0.5) / bakedTextureSize; return texture2D(bakedNormalTexture, uv); }\n`;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${attributes}${readFn}`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `vec3 bakedN0 = bakedNormal(bakedVertex, instancePose.x).xyz;\nvec3 bakedN1 = bakedNormal(bakedVertex, instancePose.y).xyz;\nvec3 objectNormal = normalize(mix(bakedN0, bakedN1, instancePose.z));`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 bakedP0 = bakedPosition(bakedVertex, instancePose.x).xyz;\nvec3 bakedP1 = bakedPosition(bakedVertex, instancePose.y).xyz;\nvec3 transformed = mix(bakedP0, bakedP1, instancePose.z);\n${opacity ? 'vBakedOpacity = instanceOpacity;\n' : ''}`);
    if (opacity) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBakedOpacity;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vBakedOpacity;');
    }
  };
  material.userData.bakedPositionTexture = positions;
  material.userData.bakedNormalTexture = normals;
}

/** CPU-bakes sampled animation poses and draws a crowd with two instanced meshes. */
export class BakedModel {
  readonly root = new Group();
  readonly stats: BakedModelStats;
  /** Lowest normalized vertex across sampled Idle/Walk poses; used only to seat actor instances. */
  readonly locomotionFloor: number;
  readonly positionTexture: DataTexture;
  readonly normalTexture: DataTexture;
  readonly body: InstancedMesh;
  readonly silhouettes: InstancedMesh;
  private readonly clips = new Map<string, ClipFrames>();
  private readonly poses: InstancedBufferAttribute;
  private readonly capacity: number;
  private readonly mixer: AnimationMixer;
  private readonly poseRoot: Group;
  private readonly ownedGeometry: BufferGeometry;
  private readonly silhouetteGeometry: BufferGeometry;
  private readonly bodyMaterial: MeshStandardMaterial;
  private readonly silhouetteMaterial: MeshBasicMaterial;
  private readonly matrix = new Matrix4();
  private readonly normalMatrix = new Matrix3();
  private readonly vertex = new Vector3();
  private readonly endpoint = new Vector3();
  private readonly normal = new Vector3();
  private readonly temporaryColor = new Color();
  private readonly positionArray: Float32Array;
  private readonly normalArray: Float32Array;
  private readonly extraOwnedGeometry: BufferGeometry[] = [];
  private readonly silhouetteFrame: Uint32Array;
  private readonly silhouetteSlot: Int32Array;
  private count = 0;
  private silhouetteCount = 0;
  private frameId = 0;
  private disposed = false;

  constructor(template: GLTF, capacity = RUN.enemyCap) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.poseRoot = clone(template.scene) as Group;
    this.poseRoot.updateMatrixWorld(true);
    const sources: MeshSource[] = [];
    let vertexCount = 0;
    let triangleCount = 0;
    for (const object of this.poseRoot.children.length ? this.collectMeshes(this.poseRoot) : []) {
      let position = object.geometry.getAttribute('position');
      if (!position) continue;
      let normal = object.geometry.getAttribute('normal');
      if (!normal) {
        object.geometry = object.geometry.clone();
        this.extraOwnedGeometry.push(object.geometry);
        position = object.geometry.getAttribute('position');
        object.geometry.computeVertexNormals();
        normal = object.geometry.getAttribute('normal');
      }
      const index = object.geometry.getIndex();
      const count = position.count;
      const baseColors = new Float32Array(count * 3);
      const vertexColor = object.geometry.getAttribute('color');
      const materialColor = colorOf(object);
      for (let i = 0; i < count; i++) {
        const color = vertexColor
          ? this.temporaryColor.setRGB(vertexColor.getX(i), vertexColor.getY(i), vertexColor.getZ(i)).multiply(materialColor)
          : materialColor;
        baseColors[i * 3] = color.r; baseColors[i * 3 + 1] = color.g; baseColors[i * 3 + 2] = color.b;
      }
      sources.push({ mesh: object, offset: vertexCount, count, index, baseColors });
      vertexCount += count;
      triangleCount += (index?.count ?? count) / 3;
    }
    if (vertexCount === 0) throw new Error('BakedModel requires at least one mesh with positions.');

    const restPositions = new Float32Array(vertexCount * 3);
    const restNormals = new Float32Array(vertexCount * 3);
    this.collectPose(sources, restPositions, restNormals);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const x = restPositions[i * 3], y = restPositions[i * 3 + 1], z = restPositions[i * 3 + 2];
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    const heightScale = 1.02 / Math.max(1e-4, maxY - minY);
    const centerX = (minX + maxX) * 0.5, centerZ = (minZ + maxZ) * 0.5;
    for (let i = 0; i < vertexCount; i++) {
      restPositions[i * 3] = (restPositions[i * 3] - centerX) * heightScale;
      restPositions[i * 3 + 1] = (restPositions[i * 3 + 1] - minY) * heightScale;
      restPositions[i * 3 + 2] = (restPositions[i * 3 + 2] - centerZ) * heightScale;
      const nx = restNormals[i * 3], ny = restNormals[i * 3 + 1], nz = restNormals[i * 3 + 2];
      this.normal.set(nx / heightScale, ny / heightScale, nz / heightScale).normalize();
      restNormals[i * 3] = this.normal.x; restNormals[i * 3 + 1] = this.normal.y; restNormals[i * 3 + 2] = this.normal.z;
    }

    const indices: number[] = [];
    const colors = new Float32Array(vertexCount * 3);
    for (const source of sources) {
      colors.set(source.baseColors, source.offset * 3);
      if (source.index) {
        for (let i = 0; i < source.index.count; i++) indices.push(source.offset + source.index.getX(i));
      } else for (let i = 0; i < source.count; i++) indices.push(source.offset + i);
    }
    this.ownedGeometry = new BufferGeometry();
    this.ownedGeometry.setAttribute('position', new BufferAttribute(restPositions, 3));
    this.ownedGeometry.setAttribute('normal', new BufferAttribute(restNormals, 3));
    this.ownedGeometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.ownedGeometry.setAttribute('bakedVertex', new BufferAttribute(Float32Array.from({ length: vertexCount }, (_, i) => i), 1));
    this.ownedGeometry.setIndex(indices);

    const totalFrames = CLIPS.reduce((sum, clip) => sum + clip.samples, 0);
    const texHeight = Math.ceil(vertexCount * totalFrames / WIDTH);
    this.positionArray = new Float32Array(WIDTH * texHeight * 4);
    this.normalArray = new Float32Array(WIDTH * texHeight * 4);
    const fallbackClip = template.animations[0];
    this.mixer = new AnimationMixer(this.poseRoot);
    let frameOffset = 0;
    let locomotionMinimumY = Infinity;
    for (const spec of CLIPS) {
      const clip = AnimationClip.findByName(template.animations, spec.name) ?? fallbackClip;
      const duration = Math.max(1e-4, clip?.duration ?? 1);
      this.clips.set(spec.name, { frames: [], duration, loop: spec.loop });
      if (clip) {
        this.mixer.stopAllAction();
        const action = this.mixer.clipAction(clip);
        action.reset(); action.setLoop(spec.loop ? LoopRepeat : LoopOnce, 1); action.clampWhenFinished = !spec.loop; action.play();
      }
      const targetPositions = new Float32Array(vertexCount * 3);
      const targetNormals = new Float32Array(vertexCount * 3);
      for (let sample = 0; sample < spec.samples; sample++) {
        if (clip) this.mixer.setTime(duration * (spec.loop ? sample / spec.samples : sample / Math.max(1, spec.samples - 1)));
        this.collectPose(sources, targetPositions, targetNormals);
        if (spec.name === 'Idle' || spec.name === 'Walk') {
          for (let i = 0; i < vertexCount; i++) locomotionMinimumY = Math.min(locomotionMinimumY, targetPositions[i * 3 + 1]);
        }
        for (let i = 0; i < vertexCount; i++) {
          const at = (frameOffset + sample) * vertexCount + i;
          const out = at * 4;
          this.positionArray[out] = (targetPositions[i * 3] - centerX) * heightScale;
          this.positionArray[out + 1] = (targetPositions[i * 3 + 1] - minY) * heightScale;
          this.positionArray[out + 2] = (targetPositions[i * 3 + 2] - centerZ) * heightScale;
          this.positionArray[out + 3] = 1;
          this.normal.set(targetNormals[i * 3], targetNormals[i * 3 + 1], targetNormals[i * 3 + 2]).normalize();
          this.normalArray[out] = this.normal.x; this.normalArray[out + 1] = this.normal.y; this.normalArray[out + 2] = this.normal.z; this.normalArray[out + 3] = 1;
        }
        this.clips.get(spec.name)!.frames.push(frameOffset + sample);
      }
      frameOffset += spec.samples;
    }
    this.locomotionFloor = Number.isFinite(locomotionMinimumY)
      ? (locomotionMinimumY - minY) * heightScale : 0;
    this.positionTexture = floatTexture(this.positionArray, WIDTH, texHeight);
    this.normalTexture = floatTexture(this.normalArray, WIDTH, texHeight);
    this.stats = { vertices: vertexCount, triangles: triangleCount, poseBytes: this.positionArray.byteLength + this.normalArray.byteLength, frames: totalFrames };

    this.poses = new InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.silhouetteFrame = new Uint32Array(this.capacity);
    this.silhouetteSlot = new Int32Array(this.capacity);
    this.ownedGeometry.setAttribute('instancePose', this.poses);
    this.bodyMaterial = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.88, metalness: 0 });
    this.bodyMaterial.stencilWrite = true; this.bodyMaterial.stencilRef = 0;
    this.bodyMaterial.stencilFunc = AlwaysStencilFunc; this.bodyMaterial.stencilZPass = ReplaceStencilOp;
    bakeMaterial(this.bodyMaterial, this.positionTexture, this.normalTexture, vertexCount, false);
    this.silhouetteGeometry = new BufferGeometry();
    this.silhouetteGeometry.setAttribute('position', this.ownedGeometry.getAttribute('position').clone());
    this.silhouetteGeometry.setAttribute('normal', this.ownedGeometry.getAttribute('normal').clone());
    this.silhouetteGeometry.setAttribute('bakedVertex', this.ownedGeometry.getAttribute('bakedVertex').clone());
    this.silhouetteGeometry.setIndex(this.ownedGeometry.getIndex()!.clone());
    this.silhouetteGeometry.setAttribute('instancePose', new InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3));
    this.silhouetteGeometry.setAttribute('instanceOpacity', new InstancedBufferAttribute(new Float32Array(this.capacity), 1));
    this.silhouetteMaterial = new MeshBasicMaterial({ color: '#eadfba', transparent: true, opacity: 1, depthWrite: false, depthFunc: GreaterDepth, toneMapped: false });
    this.silhouetteMaterial.stencilWrite = true; this.silhouetteMaterial.stencilRef = 1;
    this.silhouetteMaterial.stencilFunc = EqualStencilFunc; this.silhouetteMaterial.stencilFail = KeepStencilOp;
    this.silhouetteMaterial.stencilZFail = KeepStencilOp; this.silhouetteMaterial.stencilZPass = ZeroStencilOp;
    bakeMaterial(this.silhouetteMaterial, this.positionTexture, this.normalTexture, vertexCount, true);
    this.body = new InstancedMesh(this.ownedGeometry, this.bodyMaterial, this.capacity);
    this.body.name = 'Baked animated enemy crowd'; this.body.count = 0; this.body.frustumCulled = false;
    this.body.castShadow = false; this.body.receiveShadow = false;
    this.silhouettes = new InstancedMesh(this.silhouetteGeometry, this.silhouetteMaterial, this.capacity);
    this.silhouettes.name = 'Baked enemy occlusion silhouettes'; this.silhouettes.count = 0; this.silhouettes.frustumCulled = false;
    this.silhouettes.renderOrder = 20; this.silhouettes.castShadow = false; this.silhouettes.receiveShadow = false;
    this.root.add(this.body, this.silhouettes);
  }

  private collectMeshes(root: Group): Mesh[] {
    const meshes: Mesh[] = [];
    root.traverse(object => { if (object instanceof Mesh && !(object instanceof InstancedMesh)) meshes.push(object); });
    return meshes;
  }

  private collectPose(sources: MeshSource[], positions: Float32Array, normals: Float32Array): void {
    this.poseRoot.updateMatrixWorld(true);
    for (const source of sources) {
      const mesh = source.mesh;
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      this.normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < source.count; i++) {
        this.vertex.fromBufferAttribute(position, i);
        this.normal.fromBufferAttribute(normal, i);
        if (mesh instanceof SkinnedMesh && mesh.skeleton) {
          this.endpoint.copy(this.vertex).add(this.normal);
          mesh.applyBoneTransform(i, this.vertex);
          mesh.applyBoneTransform(i, this.endpoint);
          this.normal.copy(this.endpoint).sub(this.vertex);
        }
        this.vertex.applyMatrix4(mesh.matrixWorld);
        this.normal.applyMatrix3(this.normalMatrix).normalize();
        const output = (source.offset + i) * 3;
        positions[output] = this.vertex.x; positions[output + 1] = this.vertex.y; positions[output + 2] = this.vertex.z;
        normals[output] = this.normal.x; normals[output + 1] = this.normal.y; normals[output + 2] = this.normal.z;
      }
    }
  }

  beginFrame(): void {
    if (this.disposed) return;
    this.count = 0; this.silhouetteCount = 0;
    this.body.count = this.silhouettes.count = 0;
    this.frameId = (this.frameId + 1) >>> 0;
    if (this.frameId === 0) { this.silhouetteFrame.fill(0); this.frameId = 1; }
  }

  clipDuration(name: string): number { return this.clips.get(name)?.duration ?? 1; }

  append(position: Vector3, yaw: number, scale: Vector3, time: number, clipName = 'Walk', phase = 0): number {
    if (this.disposed || this.count >= this.capacity) return -1;
    const slot = this.count++;
    this.matrix.makeRotationY(yaw + Math.PI);
    this.matrix.scale(scale);
    this.matrix.setPosition(position);
    this.body.setMatrixAt(slot, this.matrix);
    const clip = this.clips.get(clipName) ?? this.clips.get('Walk')!;
    const total = clip.frames.length;
    const seconds = time + phase;
    let frame: number;
    let blend: number;
    if (clip.loop) {
      const p = (((seconds % clip.duration) + clip.duration) % clip.duration) / clip.duration * total;
      const local = Math.floor(p);
      frame = clip.frames[local % total];
      const next = clip.frames[(local + 1) % total];
      this.poses.array[slot * 3] = frame; this.poses.array[slot * 3 + 1] = next; blend = p - local;
    } else {
      const p = Math.max(0, Math.min(total - 1, seconds / clip.duration * Math.max(0, total - 1)));
      const local = Math.floor(p);
      frame = clip.frames[local];
      const next = clip.frames[Math.min(total - 1, local + 1)];
      this.poses.array[slot * 3] = frame; this.poses.array[slot * 3 + 1] = next; blend = p - local;
    }
    this.poses.array[slot * 3 + 2] = blend;
    return slot;
  }

  setHidden(slot: number, opacity: number): void {
    if (slot < 0 || slot >= this.count || !Number.isFinite(opacity) || opacity <= 0.003) return;
    let hiddenSlot = this.silhouetteSlot[slot];
    if (this.silhouetteFrame[slot] !== this.frameId) {
      hiddenSlot = this.silhouetteCount++;
      this.silhouetteFrame[slot] = this.frameId;
      this.silhouetteSlot[slot] = hiddenSlot;
      const bodyMatrix = this.body.instanceMatrix.array as Float32Array;
      const outlineMatrix = this.silhouettes.instanceMatrix.array as Float32Array;
      for (let i = 0; i < 16; i++) outlineMatrix[hiddenSlot * 16 + i] = bodyMatrix[slot * 16 + i];
      const bodyPose = this.poses.array as Float32Array;
      const silhouettePose = this.silhouetteGeometry.getAttribute('instancePose').array as Float32Array;
      for (let i = 0; i < 3; i++) silhouettePose[hiddenSlot * 3 + i] = bodyPose[slot * 3 + i];
    }
    const value = Math.max(0, Math.min(0.22, opacity * 0.22));
    (this.silhouetteGeometry.getAttribute('instanceOpacity').array as Float32Array)[hiddenSlot] = value;
    this.silhouettes.count = this.silhouetteCount;
    this.silhouettes.instanceMatrix.needsUpdate = true;
    this.silhouetteGeometry.getAttribute('instancePose').needsUpdate = true;
    this.silhouetteGeometry.getAttribute('instanceOpacity').needsUpdate = true;
  }

  endFrame(): void {
    if (this.disposed) return;
    this.body.count = this.count;
    this.body.instanceMatrix.needsUpdate = true;
    this.poses.needsUpdate = true;
    this.silhouettes.count = this.silhouetteCount;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.poseRoot);
    this.root.removeFromParent();
    this.body.dispose(); this.silhouettes.dispose();
    this.ownedGeometry.dispose(); this.silhouetteGeometry.dispose(); this.bodyMaterial.dispose(); this.silhouetteMaterial.dispose();
    this.positionTexture.dispose(); this.normalTexture.dispose();
    for (const geometry of this.extraOwnedGeometry) geometry.dispose();
    this.poseRoot.clear();
  }
}
