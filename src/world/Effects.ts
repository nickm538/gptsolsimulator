import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from "three";
import { seededRandom } from "../sim/math";

const MAX_PARTICLES = 420;

export class Effects {
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new BufferGeometry();
  private readonly particles: Points;
  private readonly random = seededRandom(82_193);
  private cursor = 0;

  constructor(private readonly scene: Scene) {
    this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new BufferAttribute(this.colors, 3));
    const material = new PointsMaterial({
      size: 2.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new Points(this.geometry, material);
    this.particles.frustumCulled = false;
    scene.add(this.particles);
  }

  crash(position: Vector3, scale: number): void {
    for (let i = 0; i < 300; i += 1) {
      const spark = i < 190;
      const speed = spark ? 12 + this.random() * 46 : 2 + this.random() * 10;
      const angle = this.random() * Math.PI * 2;
      const lift = spark ? 0.1 + this.random() * 0.9 : 0.3 + this.random() * 0.7;
      this.spawn(
        position,
        new Vector3(
          Math.cos(angle) * speed * (1 - lift),
          speed * lift,
          Math.sin(angle) * speed * (1 - lift),
        ),
        spark ? new Color(0xffb02e) : new Color(0x5d6266),
        (spark ? 0.45 + this.random() * 1.3 : 2 + this.random() * 5) * scale,
      );
    }
  }

  touchdown(position: Vector3, hard: boolean): void {
    const count = hard ? 85 : 36;
    for (let i = 0; i < count; i += 1) {
      const angle = this.random() * Math.PI * 2;
      this.spawn(
        position,
        new Vector3(
          Math.cos(angle) * (1 + this.random() * 4),
          0.7 + this.random() * 2.8,
          Math.sin(angle) * (1 + this.random() * 4),
        ),
        new Color(hard ? 0xb7b5ad : 0xd8d6cb),
        0.7 + this.random() * 1.8,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if ((this.life[i] ?? 0) <= 0) continue;
      this.life[i] = (this.life[i] ?? 0) - dt;
      const index = i * 3;
      this.velocities[index + 1] = (this.velocities[index + 1] ?? 0) - 4.5 * dt;
      this.positions[index] =
        (this.positions[index] ?? 0) + (this.velocities[index] ?? 0) * dt;
      this.positions[index + 1] =
        (this.positions[index + 1] ?? 0) +
        (this.velocities[index + 1] ?? 0) * dt;
      this.positions[index + 2] =
        (this.positions[index + 2] ?? 0) +
        (this.velocities[index + 2] ?? 0) * dt;
      if ((this.life[i] ?? 0) <= 0) {
        this.positions[index + 1] = -10_000;
      }
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.color!.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.particles);
    this.geometry.dispose();
    (this.particles.material as PointsMaterial).dispose();
  }

  private spawn(
    position: Vector3,
    velocity: Vector3,
    color: Color,
    duration: number,
  ): void {
    const particle = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    const index = particle * 3;
    this.positions[index] = position.x + (this.random() - 0.5) * 2;
    this.positions[index + 1] = position.y + this.random();
    this.positions[index + 2] = position.z + (this.random() - 0.5) * 2;
    this.velocities[index] = velocity.x;
    this.velocities[index + 1] = velocity.y;
    this.velocities[index + 2] = velocity.z;
    this.colors[index] = color.r;
    this.colors[index + 1] = color.g;
    this.colors[index + 2] = color.b;
    this.life[particle] = duration;
  }
}
