import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { seededRandom } from "../sim/math";
import type { QualityId, TimeId, WeatherSpec } from "../types";

export class Environment {
  readonly sun: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  private readonly scene: Scene;
  private readonly weather: WeatherSpec;
  private readonly time: TimeId;
  private readonly sky: Mesh;
  private readonly clouds = new Group();
  private readonly rain: Points | null;
  private readonly rainPositions: Float32Array | null;
  private readonly stars: Points | null;
  private lightning = 0;

  constructor(
    scene: Scene,
    weather: WeatherSpec,
    time: TimeId,
    quality: QualityId,
  ) {
    this.scene = scene;
    this.weather = weather;
    this.time = time;
    this.sky = this.createSky();
    scene.add(this.sky);

    const daylight = time === "night" ? 0.12 : time === "sunset" ? 0.72 : 1;
    const skyColor =
      time === "night" ? 0x0a1730 : time === "sunset" ? 0x425d85 : 0xa8d8ef;
    const groundColor =
      time === "night" ? 0x0b1018 : time === "sunset" ? 0x604936 : 0x40522e;
    this.hemisphere = new HemisphereLight(skyColor, groundColor, 1.7 * daylight + 0.14);
    scene.add(this.hemisphere);

    this.sun = new DirectionalLight(
      time === "night" ? 0x9ab7df : time === "sunset" ? 0xffb06b : 0xfff6dd,
      time === "night" ? 0.36 : time === "sunset" ? 2.3 : 3.15,
    );
    this.sun.position.copy(
      time === "night"
        ? new Vector3(-2_800, 4_300, 2_200)
        : time === "sunset"
          ? new Vector3(-4_500, 1_350, 1_800)
          : new Vector3(-3_200, 5_800, 2_400),
    );
    this.sun.castShadow = quality !== "mobile";
    const shadowSize = quality === "high" || quality === "auto" ? 2_048 : 1_024;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 10_000;
    this.sun.shadow.camera.left = -1_500;
    this.sun.shadow.camera.right = 1_500;
    this.sun.shadow.camera.top = 1_500;
    this.sun.shadow.camera.bottom = -1_500;
    this.sun.shadow.bias = -0.00012;
    scene.add(this.sun);

    const fogScale = time === "night" ? 0.64 : 1;
    scene.fog = new Fog(
      weather.fogColor,
      Math.min(800, weather.visibilityM * 0.025),
      weather.visibilityM * fogScale,
    );

    this.createClouds(quality);
    scene.add(this.clouds);
    const rainResult = this.createRain(quality);
    this.rain = rainResult.points;
    this.rainPositions = rainResult.positions;
    if (this.rain) scene.add(this.rain);

    this.stars = time === "night" ? this.createStars() : null;
    if (this.stars) scene.add(this.stars);
  }

  update(
    dt: number,
    elapsed: number,
    camera: PerspectiveCamera,
    aircraftPosition: Vector3,
  ): void {
    this.sky.position.copy(camera.position);
    this.clouds.position.x = Math.sin(elapsed * 0.007) * 80;
    this.clouds.position.z = elapsed * 0.9;
    for (let i = 0; i < this.clouds.children.length; i += 1) {
      const cloud = this.clouds.children[i];
      if (cloud instanceof Sprite) {
        cloud.material.rotation = Math.sin(elapsed * 0.02 + i) * 0.035;
      }
    }

    if (this.rain && this.rainPositions) {
      this.rain.position.set(aircraftPosition.x, aircraftPosition.y + 35, aircraftPosition.z);
      for (let i = 0; i < this.rainPositions.length; i += 3) {
        const y = (this.rainPositions[i + 1] ?? 0) - dt * (62 + (i % 17));
        this.rainPositions[i + 1] = y < -55 ? 65 : y;
        this.rainPositions[i] = (this.rainPositions[i] ?? 0) - dt * 5.5;
        if ((this.rainPositions[i] ?? 0) < -100) this.rainPositions[i] = 100;
      }
      this.rain.geometry.attributes.position!.needsUpdate = true;
      this.rain.rotation.y = 0.25;
    }

    if (this.weather.id === "storm") {
      const pulse =
        Math.sin(elapsed * 0.43) > 0.997 || Math.sin(elapsed * 0.117 + 4.1) > 0.999
          ? 1
          : 0;
      this.lightning = Math.max(pulse, this.lightning - dt * 4.5);
      this.hemisphere.intensity = 0.42 + this.lightning * 3.8;
      this.sun.intensity = 0.7 + this.lightning * 5;
    }
  }

  dispose(): void {
    this.scene.remove(
      this.sky,
      this.clouds,
      this.sun,
      this.hemisphere,
    );
    if (this.rain) this.scene.remove(this.rain);
    if (this.stars) this.scene.remove(this.stars);
    this.sky.geometry.dispose();
    (this.sky.material as ShaderMaterial).dispose();
    this.clouds.traverse((object) => {
      if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    this.rain?.geometry.dispose();
    (this.rain?.material as PointsMaterial | undefined)?.dispose();
    this.stars?.geometry.dispose();
    (this.stars?.material as PointsMaterial | undefined)?.dispose();
  }

  private createSky(): Mesh {
    const top = new Color(this.weather.skyTop);
    const horizon = new Color(this.weather.skyHorizon);
    if (this.time === "night") {
      top.multiplyScalar(0.09);
      horizon.multiplyScalar(0.16);
    } else if (this.time === "sunset") {
      top.lerp(new Color(0x243c78), 0.35);
      horizon.lerp(new Color(0xff8e57), 0.6);
    }
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: top },
        bottomColor: { value: horizon },
        offset: { value: 100 },
        exponent: { value: 0.62 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float blend = max(pow(max(h, 0.0), exponent), 0.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, blend), 1.0);
        }
      `,
    });
    return new Mesh(new SphereGeometry(9_500, 32, 18), material);
  }

  private createClouds(quality: QualityId): void {
    const count =
      quality === "mobile" ? 18 : quality === "balanced" ? 30 : 48;
    const texture = this.makeCloudTexture();
    const random = seededRandom(7_404);
    for (let i = 0; i < count; i += 1) {
      const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.28 + this.weather.cloudCover * 0.48,
        color: this.weather.id === "storm" ? 0x68717a : 0xffffff,
      });
      const sprite = new Sprite(material);
      const angle = random() * Math.PI * 2;
      const radius = 1_200 + random() * 5_000;
      const height =
        this.weather.id === "storm"
          ? 450 + random() * 850
          : 850 + random() * 1_700;
      sprite.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius,
      );
      const scale = 450 + random() * 900;
      sprite.scale.set(scale, scale * (0.2 + random() * 0.14), 1);
      this.clouds.add(sprite);
    }
  }

  private makeCloudTexture(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required");
    const random = seededRandom(919);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 35; i += 1) {
      const x = 35 + random() * 440;
      const y = 72 + random() * 70;
      const radius = 28 + random() * 64;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,.7)");
      gradient.addColorStop(0.55, "rgba(246,250,252,.36)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    return texture;
  }

  private createRain(quality: QualityId): {
    points: Points | null;
    positions: Float32Array | null;
  } {
    if (this.weather.rain <= 0) return { points: null, positions: null };
    const base = quality === "mobile" ? 650 : quality === "balanced" ? 1_300 : 2_400;
    const count = Math.max(250, Math.round(base * this.weather.rain));
    const positions = new Float32Array(count * 3);
    const random = seededRandom(1_702);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (random() - 0.5) * 210;
      positions[i + 1] = (random() - 0.5) * 130;
      positions[i + 2] = (random() - 0.5) * 210;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: 0xbad8ec,
      size: quality === "mobile" ? 0.52 : 0.72,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return { points: new Points(geometry, material), positions };
  }

  private createStars(): Points {
    const random = seededRandom(8_011);
    const count = 1_000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const elevation = random() * Math.PI * 0.48 + 0.08;
      const radius = 8_500;
      positions[i * 3] = Math.cos(angle) * Math.cos(elevation) * radius;
      positions[i * 3 + 1] = Math.sin(elevation) * radius;
      positions[i * 3 + 2] = Math.sin(angle) * Math.cos(elevation) * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: 0xdde9ff,
      size: 6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    });
    return new Points(geometry, material);
  }
}
