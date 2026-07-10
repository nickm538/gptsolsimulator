import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import type {
  AircraftSpec,
  AircraftSystems,
  FlightControls,
  Livery,
  QualityId,
} from "../types";
import { damp } from "../sim/math";

export class AircraftView {
  readonly root = new Group();
  readonly cockpitAnchor = new Object3D();
  readonly leftWingAnchor = new Object3D();
  private readonly fans: Object3D[] = [];
  private readonly flapSurfaces: Object3D[] = [];
  private readonly retractableGear: Group[] = [];
  private readonly navLightMeshes: Mesh[] = [];
  private readonly exteriorObjects: Object3D[] = [];
  private readonly landingLight: PointLight;
  private gearExtension = 1;
  private flapAngle = 0;
  private cockpitMode = false;

  constructor(
    scene: Scene,
    private readonly spec: AircraftSpec,
    livery: Livery,
    callsign: string,
    quality: QualityId,
  ) {
    this.root.name = spec.fullName;
    scene.add(this.root);
    this.build(livery, callsign);

    this.cockpitAnchor.position.set(...spec.cockpitPosition);
    this.root.add(this.cockpitAnchor);

    this.leftWingAnchor.position.set(-spec.spanM * 0.42, 0.2, 0);
    this.root.add(this.leftWingAnchor);

    this.landingLight = new PointLight(0xf4f5dc, 0, spec.id === "max9" ? 145 : 80, 2);
    this.landingLight.position.set(0, -0.15, -spec.lengthM * 0.42);
    this.root.add(this.landingLight);

    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = quality !== "mobile";
        object.receiveShadow = true;
      }
    });
  }

  setCockpitMode(enabled: boolean): void {
    this.cockpitMode = enabled;
    for (const object of this.exteriorObjects) object.visible = !enabled;
  }

  update(
    dt: number,
    position: Vector3,
    orientation: Quaternion,
    controls: FlightControls,
    systems: AircraftSystems,
  ): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(orientation);

    const fanRate =
      systems.engineSpool *
      (this.spec.engineKind === "piston" ? 46 : 24);
    for (const fan of this.fans) fan.rotation.z -= fanRate * dt;

    const gearTarget =
      this.spec.id === "cessna" || controls.gearDown ? 1 : 0;
    this.gearExtension = damp(this.gearExtension, gearTarget, 1.7, dt);
    for (const gear of this.retractableGear) {
      gear.scale.y = Math.max(0.02, this.gearExtension);
      gear.visible = this.gearExtension > 0.025;
    }

    this.flapAngle = damp(this.flapAngle, controls.flaps * 8.5, 2.4, dt);
    for (const surface of this.flapSurfaces) {
      surface.rotation.x = (this.flapAngle * Math.PI) / 180;
    }

    const showNav = systems.navLights && systems.battery;
    for (const light of this.navLightMeshes) {
      light.visible = showNav && !this.cockpitMode;
    }
    this.landingLight.intensity =
      systems.landingLights && systems.battery
        ? this.spec.id === "max9"
          ? 18
          : 9
        : 0;
  }

  dispose(scene: Scene): void {
    scene.remove(this.root);
    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => {
          if ("map" in material && material.map) material.map.dispose();
          material.dispose();
        });
      }
    });
  }

  private build(livery: Livery, callsign: string): void {
    const shell = new MeshPhysicalMaterial({
      color: new Color(livery.primary),
      roughness: 0.26,
      metalness: livery.metallic,
      clearcoat: 0.72,
      clearcoatRoughness: 0.2,
    });
    const accent = new MeshPhysicalMaterial({
      color: new Color(livery.accent),
      roughness: 0.3,
      metalness: Math.min(1, livery.metallic + 0.08),
      clearcoat: 0.8,
      clearcoatRoughness: 0.17,
    });
    const dark = new MeshStandardMaterial({
      color: 0x11171d,
      roughness: 0.24,
      metalness: 0.66,
    });
    const glass = new MeshPhysicalMaterial({
      color: 0x203d4d,
      roughness: 0.08,
      metalness: 0.35,
      transparent: true,
      opacity: 0.82,
      clearcoat: 1,
    });

    if (this.spec.id === "cessna") {
      this.buildCessna(shell, accent, dark, glass);
    } else {
      this.buildJet(shell, accent, dark, glass);
    }
    this.addRegistration(callsign, livery);
    this.addNavigationLights();
    this.exteriorObjects.push(...this.root.children);
    this.addCockpitInterior(dark);
  }

  private buildCessna(
    shell: MeshPhysicalMaterial,
    accent: MeshPhysicalMaterial,
    dark: MeshStandardMaterial,
    glass: MeshPhysicalMaterial,
  ): void {
    const fuselage = new Mesh(new CapsuleGeometry(0.7, 5.5, 8, 18), shell);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.scale.set(1, 0.9, 1);
    this.root.add(fuselage);

    const nose = new Mesh(new SphereGeometry(0.78, 20, 12), shell);
    nose.scale.set(1, 0.86, 1.3);
    nose.position.z = -3.15;
    this.root.add(nose);

    const wing = new Mesh(
      makeWingGeometry(this.spec.spanM, 1.55, 0.9, 0.14, 0),
      shell,
    );
    wing.position.set(0, 0.82, -0.15);
    this.root.add(wing);

    const stripe = new Mesh(new BoxGeometry(1.43, 0.17, 5.2), accent);
    stripe.position.set(0, 0.02, -0.15);
    this.root.add(stripe);

    this.addTail(shell, accent, 1.9, 2.8, 3.15, false);

    const windshield = new Mesh(new BoxGeometry(1.35, 0.72, 0.035), glass);
    windshield.position.set(0, 0.36, -2.18);
    windshield.rotation.x = -0.2;
    this.root.add(windshield);
    const sideWindowGeometry = new BoxGeometry(0.03, 0.65, 1.42);
    for (const side of [-1, 1]) {
      const sideWindow = new Mesh(sideWindowGeometry, glass);
      sideWindow.position.set(side * 0.705, 0.36, -1.25);
      this.root.add(sideWindow);
    }

    const propHub = new Mesh(new ConeGeometry(0.22, 0.62, 16), shell);
    propHub.rotation.x = -Math.PI / 2;
    propHub.position.z = -4.05;
    this.root.add(propHub);
    const propeller = new Group();
    const blade = new Mesh(new BoxGeometry(0.14, 2.65, 0.08), dark);
    propeller.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.z = Math.PI / 2;
    propeller.add(blade2);
    propeller.position.z = -4.35;
    this.root.add(propeller);
    this.fans.push(propeller);

    const flapMaterial = accent;
    for (const side of [-1, 1]) {
      const flap = new Mesh(new BoxGeometry(3.1, 0.09, 0.42), flapMaterial);
      flap.position.set(side * 2.28, 0.76, 0.68);
      this.root.add(flap);
      this.flapSurfaces.push(flap);

      const strut = new Mesh(new CylinderGeometry(0.035, 0.05, 2.3, 7), shell);
      strut.position.set(side * 1.25, -0.05, -0.05);
      strut.rotation.z = side * -0.58;
      this.root.add(strut);
    }

    this.addGear(new Vector3(0, -0.28, -2.15), true, dark);
    this.addGear(new Vector3(-1.25, -0.12, 0.25), false, dark);
    this.addGear(new Vector3(1.25, -0.12, 0.25), false, dark);
  }

  private buildJet(
    shell: MeshPhysicalMaterial,
    accent: MeshPhysicalMaterial,
    dark: MeshStandardMaterial,
    glass: MeshPhysicalMaterial,
  ): void {
    const isMax = this.spec.id === "max9";
    const radius = isMax ? 1.85 : 1.03;
    const bodyLength = this.spec.lengthM - radius * 2;
    const fuselage = new Mesh(
      new CapsuleGeometry(radius, bodyLength, isMax ? 12 : 9, isMax ? 28 : 20),
      shell,
    );
    fuselage.rotation.x = Math.PI / 2;
    fuselage.scale.y = isMax ? 0.98 : 0.94;
    this.root.add(fuselage);

    const stripe = new Mesh(
      new BoxGeometry(radius * 2.015, isMax ? 0.25 : 0.16, bodyLength * 0.82),
      accent,
    );
    stripe.position.set(0, -0.07, 0.25);
    this.root.add(stripe);

    const wing = new Mesh(
      makeWingGeometry(
        this.spec.spanM,
        isMax ? 6.4 : 3.2,
        isMax ? 1.8 : 1.15,
        isMax ? 0.34 : 0.22,
        isMax ? 4.8 : 2.2,
      ),
      shell,
    );
    wing.position.set(0, isMax ? -0.35 : -0.08, isMax ? 1.15 : 0.2);
    this.root.add(wing);

    this.addTail(
      shell,
      accent,
      isMax ? 6.4 : 3.35,
      isMax ? 10.5 : 5.7,
      this.spec.lengthM * 0.41,
      !isMax,
    );

    const cockpitWidth = radius * 1.74;
    const cockpit = new Mesh(
      new BoxGeometry(cockpitWidth, radius * 0.48, 0.08),
      glass,
    );
    cockpit.position.set(0, radius * 0.45, -this.spec.lengthM * 0.438);
    cockpit.rotation.x = -0.25;
    this.root.add(cockpit);

    this.addPassengerWindows(glass, isMax ? 34 : 9, radius);

    if (isMax) {
      this.addTurbofan(-6.2, -1.25, -2.25, 1.25, shell, dark);
      this.addTurbofan(6.2, -1.25, -2.25, 1.25, shell, dark);
      this.addWinglet(-this.spec.spanM * 0.49, 0.3, 5.3, accent, -1);
      this.addWinglet(this.spec.spanM * 0.49, 0.3, 5.3, accent, 1);
      this.addGear(new Vector3(0, -1.5, -13.9), true, dark);
      this.addGear(new Vector3(-3.75, -1.35, 1.6), false, dark, true);
      this.addGear(new Vector3(3.75, -1.35, 1.6), false, dark, true);
    } else {
      this.addTurbofan(-1.25, 0.15, 5.3, 0.67, shell, dark);
      this.addTurbofan(1.25, 0.15, 5.3, 0.67, shell, dark);
      this.addWinglet(-this.spec.spanM * 0.49, 0.15, 2.4, accent, -1);
      this.addWinglet(this.spec.spanM * 0.49, 0.15, 2.4, accent, 1);
      this.addGear(new Vector3(0, -0.7, -5.2), true, dark);
      this.addGear(new Vector3(-2.05, -0.62, 1.15), false, dark);
      this.addGear(new Vector3(2.05, -0.62, 1.15), false, dark);
    }

    const flapSpan = isMax ? 5.1 : 2.8;
    for (const side of [-1, 1]) {
      const flap = new Mesh(
        new BoxGeometry(flapSpan, isMax ? 0.16 : 0.1, isMax ? 1.18 : 0.6),
        accent,
      );
      flap.position.set(
        side * (isMax ? 7.7 : 3.7),
        isMax ? -0.48 : -0.16,
        isMax ? 4.1 : 1.75,
      );
      this.root.add(flap);
      this.flapSurfaces.push(flap);
    }
  }

  private addTail(
    shell: MeshPhysicalMaterial,
    accent: MeshPhysicalMaterial,
    height: number,
    horizontalSpan: number,
    z: number,
    tTail: boolean,
  ): void {
    const vertical = new Mesh(
      makeFinGeometry(height, height * 0.72, 0.16),
      accent,
    );
    vertical.position.set(0, 0.45, z);
    this.root.add(vertical);

    const horizontal = new Mesh(
      makeWingGeometry(horizontalSpan, height * 0.5, height * 0.25, 0.12, height * 0.25),
      shell,
    );
    horizontal.position.set(0, tTail ? height * 0.82 : 0.32, z + height * 0.08);
    this.root.add(horizontal);
  }

  private addPassengerWindows(
    glass: MeshPhysicalMaterial,
    count: number,
    radius: number,
  ): void {
    const spacing =
      (this.spec.lengthM * (this.spec.id === "max9" ? 0.69 : 0.52)) / count;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i += 1) {
        const window = new Mesh(
          new PlaneGeometry(
            this.spec.id === "max9" ? 0.38 : 0.3,
            this.spec.id === "max9" ? 0.52 : 0.38,
          ),
          glass,
        );
        window.position.set(
          side * (radius + 0.012),
          radius * 0.34,
          -this.spec.lengthM * 0.3 + i * spacing,
        );
        window.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.root.add(window);
      }
    }
  }

  private addTurbofan(
    x: number,
    y: number,
    z: number,
    radius: number,
    shell: MeshPhysicalMaterial,
    dark: MeshStandardMaterial,
  ): void {
    const nacelle = new Mesh(
      new CylinderGeometry(radius * 0.88, radius, radius * 2.7, 24, 1, true),
      shell,
    );
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(x, y, z);
    this.root.add(nacelle);
    const intake = new Mesh(
      new CylinderGeometry(radius * 0.76, radius * 0.76, 0.08, 24),
      dark,
    );
    intake.rotation.x = Math.PI / 2;
    intake.position.set(x, y, z - radius * 1.36);
    this.root.add(intake);
    const fan = new Group();
    for (let bladeIndex = 0; bladeIndex < 10; bladeIndex += 1) {
      const blade = new Mesh(
        new BoxGeometry(radius * 0.1, radius * 1.3, 0.035),
        new MeshStandardMaterial({
          color: 0x77848b,
          roughness: 0.25,
          metalness: 0.9,
        }),
      );
      blade.rotation.z = (bladeIndex / 10) * Math.PI;
      fan.add(blade);
    }
    fan.position.set(x, y, z - radius * 1.42);
    this.root.add(fan);
    this.fans.push(fan);
  }

  private addWinglet(
    x: number,
    y: number,
    z: number,
    material: MeshPhysicalMaterial,
    side: number,
  ): void {
    const winglet = new Mesh(new BoxGeometry(0.18, this.spec.id === "max9" ? 2.8 : 1.25, 0.65), material);
    winglet.position.set(x, y + (this.spec.id === "max9" ? 1.1 : 0.5), z);
    winglet.rotation.z = side * -0.18;
    this.root.add(winglet);
  }

  private addGear(
    position: Vector3,
    nose: boolean,
    dark: MeshStandardMaterial,
    dual = false,
  ): void {
    const gear = new Group();
    const strutLength = this.spec.gearHeightM * (nose ? 0.76 : 0.82);
    const strut = new Mesh(
      new CylinderGeometry(
        this.spec.id === "max9" ? 0.12 : 0.055,
        this.spec.id === "max9" ? 0.16 : 0.075,
        strutLength,
        9,
      ),
      new MeshStandardMaterial({ color: 0xaeb5b3, roughness: 0.3, metalness: 0.92 }),
    );
    strut.position.y = -strutLength / 2;
    gear.add(strut);
    const wheelCount = dual ? 2 : 1;
    for (let i = 0; i < wheelCount; i += 1) {
      const tire = new Mesh(
        new CylinderGeometry(
          this.spec.id === "max9" ? 0.54 : this.spec.id === "learjet" ? 0.31 : 0.22,
          this.spec.id === "max9" ? 0.54 : this.spec.id === "learjet" ? 0.31 : 0.22,
          this.spec.id === "max9" ? 0.28 : 0.18,
          14,
        ),
        dark,
      );
      tire.rotation.z = Math.PI / 2;
      tire.position.set(
        dual ? (i === 0 ? -0.22 : 0.22) : 0,
        -strutLength,
        dual ? (i === 0 ? -0.42 : 0.42) : 0,
      );
      gear.add(tire);
    }
    gear.position.copy(position);
    this.root.add(gear);
    if (this.spec.id !== "cessna") this.retractableGear.push(gear);
  }

  private addCockpitInterior(dark: MeshStandardMaterial): void {
    const [x, y, z] = this.spec.cockpitPosition;
    const panelDistance = this.spec.id === "max9" ? 1.75 : 0.85;
    const panelZ = z - panelDistance;
    const panel = new Mesh(
      new BoxGeometry(
        this.spec.id === "max9" ? 2.55 : this.spec.id === "learjet" ? 1.35 : 1.05,
        this.spec.id === "max9" ? 0.74 : 0.48,
        0.4,
      ),
      dark,
    );
    panel.position.set(x, y - 0.64, panelZ);
    panel.rotation.x = -0.12;
    this.root.add(panel);

    const screenMaterial = new MeshBasicMaterial({ color: 0x1ad1bd });
    for (const side of [-1, 1]) {
      const screen = new Mesh(
        new PlaneGeometry(
          this.spec.id === "max9" ? 0.74 : 0.42,
          this.spec.id === "max9" ? 0.5 : 0.3,
        ),
        screenMaterial,
      );
      screen.position.set(
        side * (this.spec.id === "max9" ? 0.55 : 0.31),
        0.12,
        0.205,
      );
      panel.add(screen);
    }

    const yoke = new Group();
    const column = new Mesh(new CylinderGeometry(0.04, 0.05, 0.48, 8), dark);
    column.rotation.x = Math.PI / 2;
    yoke.add(column);
    const grip = new Mesh(new BoxGeometry(0.48, 0.07, 0.07), dark);
    grip.position.z = -0.24;
    yoke.add(grip);
    yoke.position.set(x, y - 0.43, z - 0.43);
    this.root.add(yoke);
  }

  private addRegistration(callsign: string, livery: Livery): void {
    const texture = registrationTexture(callsign, livery.accent);
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      toneMapped: false,
    });
    for (const side of [-1, 1]) {
      const panel = new Mesh(
        new PlaneGeometry(
          this.spec.id === "max9" ? 4.2 : this.spec.id === "learjet" ? 2.4 : 1.65,
          this.spec.id === "max9" ? 0.72 : 0.48,
        ),
        material,
      );
      panel.position.set(
        side * (this.spec.id === "max9" ? 1.86 : this.spec.id === "learjet" ? 1.04 : 0.72),
        this.spec.id === "max9" ? 0.08 : 0.02,
        this.spec.lengthM * 0.3,
      );
      panel.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(panel);
    }
  }

  private addNavigationLights(): void {
    const positions: Array<[number, number, number, number]> = [
      [-this.spec.spanM * 0.5, 0.2, 0.5, 0xff2436],
      [this.spec.spanM * 0.5, 0.2, 0.5, 0x35ff83],
      [0, 0.35, this.spec.lengthM * 0.5, 0xffffff],
    ];
    for (const [x, y, z, color] of positions) {
      const light = new Mesh(
        new SphereGeometry(this.spec.id === "max9" ? 0.18 : 0.1, 8, 6),
        new MeshBasicMaterial({ color, toneMapped: false }),
      );
      light.position.set(x, y, z);
      light.visible = false;
      this.root.add(light);
      this.navLightMeshes.push(light);
    }
  }
}

function makeWingGeometry(
  span: number,
  rootChord: number,
  tipChord: number,
  thickness: number,
  sweep: number,
): BufferGeometry {
  const half = span / 2;
  const yTop = thickness / 2;
  const yBottom = -thickness / 2;
  const outline: Array<[number, number]> = [
    [-half, -tipChord * 0.45 + sweep],
    [0, -rootChord * 0.45],
    [half, -tipChord * 0.45 + sweep],
    [half, tipChord * 0.55 + sweep],
    [0, rootChord * 0.55],
    [-half, tipChord * 0.55 + sweep],
  ];
  const vertices: number[] = [];
  outline.forEach(([x, z]) => vertices.push(x, yTop, z));
  outline.forEach(([x, z]) => vertices.push(x, yBottom, z));
  const indices: number[] = [];
  indices.push(0, 1, 5, 1, 4, 5, 1, 2, 4, 2, 3, 4);
  indices.push(6, 11, 7, 7, 11, 10, 7, 10, 8, 8, 10, 9);
  for (let i = 0; i < outline.length; i += 1) {
    const next = (i + 1) % outline.length;
    indices.push(i, i + 6, next, next, i + 6, next + 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(vertices), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeFinGeometry(
  height: number,
  chord: number,
  thickness: number,
): BufferGeometry {
  const vertices = new Float32Array([
    -thickness, 0, -chord * 0.35,
    -thickness, 0, chord * 0.55,
    -thickness, height, chord * 0.32,
    thickness, 0, -chord * 0.35,
    thickness, 0, chord * 0.55,
    thickness, height, chord * 0.32,
  ]);
  const indices = [
    0, 1, 2,
    3, 5, 4,
    0, 3, 1,
    1, 3, 4,
    1, 4, 2,
    2, 4, 5,
    2, 5, 0,
    0, 5, 3,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function registrationTexture(callsign: string, accent: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1_024;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(9,17,24,.82)";
  context.roundRect(6, 12, 1_012, 168, 26);
  context.fill();
  context.fillStyle = accent;
  context.fillRect(36, 39, 14, 114);
  context.fillStyle = "#f2f7f6";
  context.font = "700 92px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(callsign.toUpperCase().slice(0, 12), 535, 99);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  return texture;
}
