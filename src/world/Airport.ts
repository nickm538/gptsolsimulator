import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { AIRPORT } from "../data";
import { seededRandom, terrainHeight } from "../sim/math";
import type { QualityId, TimeId } from "../types";

interface Vehicle {
  root: Group;
  offset: number;
  lane: number;
  speed: number;
}

export interface AirportWorld {
  root: Group;
  update(elapsed: number, aircraftPosition: Vector3): void;
  dispose(): void;
}

const asphalt = new MeshStandardMaterial({
  color: 0x22282b,
  roughness: 0.89,
  metalness: 0.03,
});
const taxiAsphalt = new MeshStandardMaterial({
  color: 0x303638,
  roughness: 0.92,
  metalness: 0.02,
});
const concrete = new MeshStandardMaterial({
  color: 0x72787a,
  roughness: 0.94,
  metalness: 0,
});
const runwayWhite = new MeshStandardMaterial({
  color: 0xf1f1e8,
  roughness: 0.72,
});
const taxiYellow = new MeshStandardMaterial({
  color: 0xf7bd36,
  emissive: 0x211300,
  emissiveIntensity: 0.25,
  roughness: 0.68,
});

export function buildAirport(
  scene: Scene,
  quality: QualityId,
  time: TimeId,
): AirportWorld {
  const root = new Group();
  root.name = "Aurelia International Airport";
  scene.add(root);

  createTerrain(root, quality);
  createAirfield(root, time);
  createTerminal(root, time);
  createAirportBuildings(root);
  createPerimeter(root);
  createCity(root, quality, time);
  const vehicles = createVehicles(root);
  const papi = createPapi(root);
  const windsock = createWindsock(root);

  const serviceLoop = [
    new Vector3(-770, 0.6, -1_500),
    new Vector3(-315, 0.6, -1_500),
    new Vector3(-315, 0.6, 1_530),
    new Vector3(-770, 0.6, 1_530),
  ];

  return {
    root,
    update(elapsed: number, aircraftPosition: Vector3): void {
      for (const vehicle of vehicles) {
        const distance = (elapsed * vehicle.speed + vehicle.offset) % 7_000;
        const segment = Math.floor(distance / 1_750) % 4;
        const t = (distance % 1_750) / 1_750;
        const a = serviceLoop[segment] ?? serviceLoop[0]!;
        const b = serviceLoop[(segment + 1) % serviceLoop.length] ?? serviceLoop[0]!;
        vehicle.root.position.lerpVectors(a, b, t);
        vehicle.root.position.x += vehicle.lane;
        vehicle.root.lookAt(b.x, vehicle.root.position.y, b.z);
      }

      const thresholdZ = 1_800;
      const horizontalDistance = Math.max(1, aircraftPosition.z - thresholdZ);
      const glideAngle = Math.atan2(aircraftPosition.y, horizontalDistance) * (180 / Math.PI);
      papi.forEach((light, index) => {
        const threshold = 2.7 + index * 0.2;
        const material = light.material as MeshBasicMaterial;
        material.color.setHex(glideAngle < threshold ? 0xff2d2d : 0xf5f1df);
      });

      windsock.rotation.z = Math.sin(elapsed * 2.8) * 0.07;
      windsock.rotation.y = -Math.PI * 0.45;
    },
    dispose(): void {
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof Mesh || object instanceof InstancedMesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  };
}

function createTerrain(root: Group, quality: QualityId): void {
  const segments = quality === "high" || quality === "auto" ? 96 : 54;
  const geometry = new PlaneGeometry(22_000, 22_000, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const low = new Color(0x385a33);
  const high = new Color(0x6b7654);
  const temp = new Color();

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = terrainHeight(x, z);
    positions.setY(i, height - 0.42);
    const mix = Math.min(1, Math.max(0, (height + 20) / 230));
    temp.copy(low).lerp(high, mix);
    const variation = Math.sin(x * 0.019 + z * 0.013) * 0.025;
    colors.push(
      Math.max(0, temp.r + variation),
      Math.max(0, temp.g + variation),
      Math.max(0, temp.b + variation),
    );
  }
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const terrain = new Mesh(geometry, material);
  terrain.receiveShadow = true;
  root.add(terrain);

  const airportGrass = new Mesh(
    new PlaneGeometry(5_600, 5_200),
    new MeshStandardMaterial({
      color: 0x426a3b,
      roughness: 1,
      metalness: 0,
    }),
  );
  airportGrass.rotation.x = -Math.PI / 2;
  airportGrass.position.y = -0.15;
  airportGrass.receiveShadow = true;
  root.add(airportGrass);

  const bay = new Mesh(
    new CircleGeometry(4_800, 64),
    new MeshStandardMaterial({
      color: 0x276886,
      roughness: 0.36,
      metalness: 0.18,
      transparent: true,
      opacity: 0.93,
    }),
  );
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(1_600, -7, -6_900);
  root.add(bay);
}

function createAirfield(root: Group, time: TimeId): void {
  createRunway(root, 0, "36L", "18R", time);
  createRunway(root, 760, "36R", "18L", time);

  addSurface(root, -120, 0, 30, 3_460, taxiAsphalt, 0.04);
  addLine(root, -120, 0, 0.34, 3_400, taxiYellow, 0.12);

  for (const z of [-1_350, -650, 80, 720, 1_350]) {
    addSurface(root, -60, z, 120, 24, taxiAsphalt, 0.055);
    addLine(root, -60, z, 120, 0.28, taxiYellow, 0.13);
  }

  addSurface(root, 380, -1_150, 700, 25, taxiAsphalt, 0.05);
  addLine(root, 380, -1_150, 700, 0.28, taxiYellow, 0.13);
  addSurface(root, 380, 1_350, 700, 25, taxiAsphalt, 0.05);
  addLine(root, 380, 1_350, 700, 0.28, taxiYellow, 0.13);

  const apron = new Mesh(new BoxGeometry(760, 0.12, 3_180), concrete);
  apron.position.set(-570, -0.02, 20);
  apron.receiveShadow = true;
  root.add(apron);

  addSurface(root, -215, 1_310, 205, 25, taxiAsphalt, 0.095);
  addLine(root, -215, 1_310, 205, 0.3, taxiYellow, 0.18);
  addSurface(root, -60, 1_530, 120, 26, taxiAsphalt, 0.07);
  addLine(root, -60, 1_530, 120, 0.3, taxiYellow, 0.18);

  for (let z = -1_380; z <= 1_430; z += 190) {
    addLine(root, -395, z, 245, 0.22, taxiYellow, 0.15);
    addStandMarking(root, -325, z);
  }

  createHoldShort(root, -45, 1_530);
  createHoldShort(root, -45, -1_350);
  createTaxiSign(root, -105, 1_485, "A  ←   36L →");
  createTaxiSign(root, -155, 1_255, "C12   A");
  createTaxiSign(root, -110, 680, "A   CARGO →");

  const helipad = new Mesh(
    new CircleGeometry(38, 48),
    new MeshStandardMaterial({ color: 0x3a4144, roughness: 0.9 }),
  );
  helipad.rotation.x = -Math.PI / 2;
  helipad.position.set(-880, 0.1, -1_470);
  root.add(helipad);
  root.add(makeGroundLabel("H", 0xffffff, 55, 55, -880, 0.15, -1_470, 0));
}

function createRunway(
  root: Group,
  x: number,
  southNumber: string,
  northNumber: string,
  time: TimeId,
): void {
  const runway = new Mesh(
    new BoxGeometry(AIRPORT.runwayWidthM, 0.18, AIRPORT.runwayLengthM),
    asphalt,
  );
  runway.position.set(x, 0, 0);
  runway.receiveShadow = true;
  root.add(runway);

  for (let z = -1_560; z <= 1_560; z += 60) {
    const center = new Mesh(new BoxGeometry(0.9, 0.04, 30), runwayWhite);
    center.position.set(x, 0.12, z);
    root.add(center);
  }

  for (const side of [-1, 1]) {
    const edge = new Mesh(
      new BoxGeometry(0.5, 0.035, AIRPORT.runwayLengthM - 60),
      runwayWhite,
    );
    edge.position.set(x + side * (AIRPORT.runwayWidthM / 2 - 1.4), 0.11, 0);
    root.add(edge);
  }

  for (const end of [-1, 1]) {
    for (let stripe = -4; stripe <= 4; stripe += 1) {
      if (stripe === 0) continue;
      const threshold = new Mesh(new BoxGeometry(3.6, 0.04, 42), runwayWhite);
      threshold.position.set(x + stripe * 5.4, 0.13, end * 1_635);
      root.add(threshold);
    }
  }

  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const aiming = new Mesh(new BoxGeometry(7.5, 0.04, 48), runwayWhite);
      aiming.position.set(x + side * 12, 0.13, end * 1_120);
      root.add(aiming);
    }
  }

  root.add(
    makeGroundLabel(southNumber, 0xf5f4e9, 72, 84, x, 0.15, 1_500, 0),
    makeGroundLabel(northNumber, 0xf5f4e9, 72, 84, x, 0.15, -1_500, Math.PI),
  );

  const lightColor = time === "day" ? 0xcde8ff : 0xffffff;
  const emissive = time === "day" ? 0.8 : 2.8;
  const lightMaterial = new MeshBasicMaterial({ color: lightColor });
  const lightsPerSide = 61;
  const geometry = new SphereGeometry(0.34, 7, 5);
  const lights = new InstancedMesh(geometry, lightMaterial, lightsPerSide * 2);
  const dummy = new Object3D();
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < lightsPerSide; i += 1) {
      const z = -1_770 + (i / (lightsPerSide - 1)) * 3_540;
      dummy.position.set(x + side * 32, 0.31, z);
      dummy.scale.setScalar(emissive > 1 ? 1.25 : 1);
      dummy.updateMatrix();
      lights.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  root.add(lights);

  const approachMaterial = new MeshBasicMaterial({ color: 0xf4f7ff });
  for (const end of [-1, 1]) {
    for (let row = 0; row < 14; row += 1) {
      const z = end * (1_825 + row * 28);
      const width = row % 3 === 0 ? 5 : 1;
      for (let column = -width; column <= width; column += 1) {
        const lamp = new Mesh(new SphereGeometry(0.43, 6, 5), approachMaterial);
        lamp.position.set(x + column * 4.5, 0.55, z);
        root.add(lamp);
      }
    }
  }
}

function createTerminal(root: Group, time: TimeId): void {
  const terminalMaterial = new MeshStandardMaterial({
    color: 0xb9c1c3,
    roughness: 0.48,
    metalness: 0.52,
  });
  const glassMaterial = new MeshStandardMaterial({
    color: time === "night" ? 0xf0b96a : 0x5e8b9d,
    emissive: time === "night" ? 0x7b3f0d : 0x132934,
    emissiveIntensity: time === "night" ? 1.4 : 0.35,
    roughness: 0.18,
    metalness: 0.74,
  });

  const main = new Mesh(new BoxGeometry(170, 34, 920), terminalMaterial);
  main.position.set(-760, 17, 120);
  main.castShadow = true;
  main.receiveShadow = true;
  root.add(main);

  const roof = new Mesh(
    new BoxGeometry(184, 5, 936),
    new MeshStandardMaterial({
      color: 0xe1e5e4,
      roughness: 0.35,
      metalness: 0.62,
    }),
  );
  roof.position.set(-760, 36, 120);
  roof.castShadow = true;
  root.add(roof);

  const windowGeometry = new BoxGeometry(2, 14, 19);
  const windows = new InstancedMesh(windowGeometry, glassMaterial, 92);
  const matrix = new Matrix4();
  let windowIndex = 0;
  for (const side of [-1, 1]) {
    for (let z = -325; z <= 565; z += 40) {
      matrix.makeTranslation(-760 + side * 86.2, 19, z);
      windows.setMatrixAt(windowIndex, matrix);
      windowIndex += 1;
    }
  }
  root.add(windows);

  const concourse = new Mesh(new BoxGeometry(190, 23, 1_350), terminalMaterial);
  concourse.position.set(-530, 12, 95);
  concourse.castShadow = true;
  concourse.receiveShadow = true;
  root.add(concourse);

  const concourseGlass = new InstancedMesh(
    new BoxGeometry(1.5, 10, 22),
    glassMaterial,
    30,
  );
  let glassIndex = 0;
  for (let z = -560; z <= 750; z += 92) {
    matrix.makeTranslation(-434.4, 13, z);
    concourseGlass.setMatrixAt(glassIndex, matrix);
    glassIndex += 1;
    matrix.makeTranslation(-625.6, 13, z);
    concourseGlass.setMatrixAt(glassIndex, matrix);
    glassIndex += 1;
  }
  root.add(concourseGlass);

  const gateZ = [-470, -280, -90, 100, 290, 480, 670, 860, 1_050, 1_240, 1_310];
  gateZ.forEach((z, index) => {
    const bridge = new Group();
    const corridor = new Mesh(
      new BoxGeometry(85, 7.5, 8),
      new MeshStandardMaterial({
        color: 0xc6cccb,
        roughness: 0.54,
        metalness: 0.45,
      }),
    );
    corridor.position.x = 40;
    corridor.castShadow = true;
    bridge.add(corridor);
    const end = new Mesh(new BoxGeometry(11, 10, 13), terminalMaterial);
    end.position.x = 82;
    end.castShadow = true;
    bridge.add(end);
    bridge.position.set(-430, 8, z);
    root.add(bridge);

    const gateName = index === gateZ.length - 1 ? AIRPORT.gate : `C${index + 2}`;
    const label = makeSign(gateName, "#ffffff", "#176c7c", 11, 6);
    label.position.set(-428, 17.2, z + 7);
    label.rotation.y = Math.PI / 2;
    root.add(label);
  });

  const sign = makeSign(
    "AURELIA  INTERNATIONAL",
    "#ecfaf9",
    "#123942",
    116,
    12,
  );
  sign.position.set(-673.7, 31, 120);
  sign.rotation.y = Math.PI / 2;
  root.add(sign);

  createControlTower(root, glassMaterial);
}

function createControlTower(root: Group, glassMaterial: MeshStandardMaterial): void {
  const stem = new Mesh(
    new CylinderGeometry(12, 17, 82, 10),
    new MeshStandardMaterial({ color: 0x9ca5a5, roughness: 0.7, metalness: 0.35 }),
  );
  stem.position.set(-850, 41, 790);
  stem.castShadow = true;
  root.add(stem);

  const cab = new Mesh(new CylinderGeometry(28, 22, 16, 10), glassMaterial);
  cab.position.set(-850, 89, 790);
  cab.castShadow = true;
  root.add(cab);

  const roof = new Mesh(
    new CylinderGeometry(31, 31, 3, 10),
    new MeshStandardMaterial({ color: 0xe7e8e2, roughness: 0.36, metalness: 0.65 }),
  );
  roof.position.set(-850, 98, 790);
  root.add(roof);

  const radar = new Mesh(
    new BoxGeometry(1.3, 8, 22),
    new MeshStandardMaterial({ color: 0xe7ece9, roughness: 0.46 }),
  );
  radar.position.set(-850, 105, 790);
  radar.rotation.y = 0.45;
  root.add(radar);
}

function createAirportBuildings(root: Group): void {
  const hangarMaterial = new MeshStandardMaterial({
    color: 0xc4c8c5,
    roughness: 0.72,
    metalness: 0.38,
  });
  const doorMaterial = new MeshStandardMaterial({
    color: 0x4c565a,
    roughness: 0.61,
    metalness: 0.49,
  });
  for (let i = 0; i < 4; i += 1) {
    const z = -1_180 + i * 240;
    const hangar = new Mesh(new BoxGeometry(145, 42, 180), hangarMaterial);
    hangar.position.set(-980, 21, z);
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    root.add(hangar);
    const door = new Mesh(new BoxGeometry(1.5, 30, 132), doorMaterial);
    door.position.set(-906.8, 16, z);
    root.add(door);
  }

  const cargo = new Mesh(
    new BoxGeometry(210, 29, 520),
    new MeshStandardMaterial({ color: 0x9b9f9c, roughness: 0.8, metalness: 0.25 }),
  );
  cargo.position.set(-1_020, 14.5, 1_210);
  cargo.castShadow = true;
  root.add(cargo);

  const tanks = new InstancedMesh(
    new CylinderGeometry(17, 17, 25, 18),
    new MeshStandardMaterial({
      color: 0xd9ddda,
      roughness: 0.36,
      metalness: 0.7,
    }),
    8,
  );
  const dummy = new Object3D();
  for (let i = 0; i < 8; i += 1) {
    dummy.position.set(-1_220 + (i % 4) * 48, 12.5, -1_450 + Math.floor(i / 4) * 55);
    dummy.updateMatrix();
    tanks.setMatrixAt(i, dummy.matrix);
  }
  root.add(tanks);
}

function createPerimeter(root: Group): void {
  const roadMaterial = new MeshStandardMaterial({
    color: 0x292d2f,
    roughness: 0.96,
  });
  addSurface(root, -1_350, 0, 24, 4_100, roadMaterial, -0.02);
  addSurface(root, 1_350, 0, 24, 4_100, roadMaterial, -0.02);
  addSurface(root, 0, -2_050, 2_700, 24, roadMaterial, -0.02);
  addSurface(root, 0, 2_050, 2_700, 24, roadMaterial, -0.02);

  const poleGeometry = new CylinderGeometry(0.32, 0.45, 16, 7);
  const poleMaterial = new MeshStandardMaterial({ color: 0x657174, metalness: 0.7 });
  const poles = new InstancedMesh(poleGeometry, poleMaterial, 42);
  const dummy = new Object3D();
  for (let i = 0; i < 42; i += 1) {
    const z = -1_800 + i * 88;
    dummy.position.set(-1_325, 8, z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
  }
  root.add(poles);
}

function createCity(root: Group, quality: QualityId, time: TimeId): void {
  const count = quality === "mobile" ? 85 : quality === "balanced" ? 145 : 230;
  const random = seededRandom(4_211);
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({
    color: time === "night" ? 0x36414c : 0x78858b,
    emissive: time === "night" ? 0x1f1b14 : 0x000000,
    emissiveIntensity: time === "night" ? 0.5 : 0,
    roughness: 0.78,
    metalness: 0.22,
  });
  const city = new InstancedMesh(geometry, material, count);
  const dummy = new Object3D();
  for (let i = 0; i < count; i += 1) {
    const side = random() > 0.5 ? 1 : -1;
    const x = side * (1_900 + random() * 2_900);
    const z = -3_500 + random() * 7_000;
    const width = 18 + random() * 52;
    const depth = 18 + random() * 52;
    const height = 12 + random() ** 2 * 145;
    dummy.position.set(x, terrainHeight(x, z) + height / 2, z);
    dummy.scale.set(width, height, depth);
    dummy.rotation.y = random() * Math.PI;
    dummy.updateMatrix();
    city.setMatrixAt(i, dummy.matrix);
  }
  city.castShadow = quality !== "mobile";
  city.receiveShadow = true;
  root.add(city);
}

function createVehicles(root: Group): Vehicle[] {
  const vehicles: Vehicle[] = [];
  const colors = [0xf0b930, 0xeceeea, 0x38a6b5, 0xd05a4d, 0xffffff];
  for (let i = 0; i < 12; i += 1) {
    const vehicle = new Group();
    const body = new Mesh(
      new BoxGeometry(i % 4 === 0 ? 9 : 5.5, 2.4, i % 4 === 0 ? 3.2 : 2.7),
      new MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.56,
        metalness: 0.3,
      }),
    );
    body.position.y = 1.4;
    body.castShadow = true;
    vehicle.add(body);
    const cab = new Mesh(
      new BoxGeometry(2.5, 1.8, 2.5),
      new MeshStandardMaterial({ color: 0x263841, roughness: 0.25, metalness: 0.55 }),
    );
    cab.position.set(-1.2, 2.8, 0);
    vehicle.add(cab);
    root.add(vehicle);
    vehicles.push({
      root: vehicle,
      offset: i * 530,
      lane: (i % 3 - 1) * 7,
      speed: 5 + (i % 4) * 1.3,
    });
  }
  return vehicles;
}

function createPapi(root: Group): Mesh[] {
  const lights: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const light = new Mesh(
      new SphereGeometry(0.78, 9, 6),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    light.position.set(-42 - i * 3.5, 1.3, 1_510);
    root.add(light);
    lights.push(light);
  }
  return lights;
}

function createWindsock(root: Group): Group {
  const group = new Group();
  const pole = new Mesh(
    new CylinderGeometry(0.22, 0.3, 12, 8),
    new MeshStandardMaterial({ color: 0xd8ddda, metalness: 0.7 }),
  );
  pole.position.y = 6;
  group.add(pole);
  const sock = new Mesh(
    new ConeGeometry(1.2, 7, 16, 1, true),
    new MeshStandardMaterial({
      color: 0xf15938,
      side: DoubleSide,
      roughness: 0.85,
    }),
  );
  sock.rotation.z = -Math.PI / 2;
  sock.position.set(3.3, 11.2, 0);
  group.add(sock);
  group.position.set(-165, 0, 1_720);
  root.add(group);
  return group;
}

function addSurface(
  root: Group,
  x: number,
  z: number,
  width: number,
  length: number,
  material: MeshStandardMaterial,
  y: number,
): void {
  const mesh = new Mesh(new BoxGeometry(width, 0.12, length), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  root.add(mesh);
}

function addLine(
  root: Group,
  x: number,
  z: number,
  width: number,
  length: number,
  material: MeshStandardMaterial,
  y: number,
): void {
  const mesh = new Mesh(new BoxGeometry(width, 0.025, length), material);
  mesh.position.set(x, y, z);
  root.add(mesh);
}

function addStandMarking(root: Group, x: number, z: number): void {
  const arc = new Mesh(
    new CircleGeometry(10, 24, 0, Math.PI),
    new MeshBasicMaterial({
      color: 0xe5b72f,
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
    }),
  );
  arc.rotation.x = -Math.PI / 2;
  arc.position.set(x, 0.17, z);
  arc.scale.y = 0.12;
  root.add(arc);
}

function createHoldShort(root: Group, x: number, z: number): void {
  for (let i = 0; i < 4; i += 1) {
    const line = new Mesh(new BoxGeometry(1.1, 0.035, 26), taxiYellow);
    line.position.set(x + (i - 1.5) * 2.2, 0.19, z);
    root.add(line);
  }
}

function makeGroundLabel(
  text: string,
  color: number,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  rotation: number,
): Mesh {
  const texture = textTexture(text, `#${color.toString(16).padStart(6, "0")}`, "transparent");
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.position.set(x, y, z);
  return mesh;
}

function createTaxiSign(root: Group, x: number, z: number, text: string): void {
  const sign = makeSign(text, "#f9d14a", "#111515", 28, 7);
  sign.position.set(x, 4.2, z);
  root.add(sign);
  const legs = new Mesh(
    new BoxGeometry(18, 4, 0.5),
    new MeshStandardMaterial({ color: 0x3b4141, roughness: 0.7 }),
  );
  legs.position.set(x, 2, z + 0.4);
  root.add(legs);
}

function makeSign(
  text: string,
  foreground: string,
  background: string,
  width: number,
  height: number,
): Mesh {
  const texture = textTexture(text, foreground, background);
  const material = new MeshBasicMaterial({ map: texture, transparent: true });
  return new Mesh(new PlaneGeometry(width, height), material);
}

function textTexture(
  text: string,
  foreground: string,
  background: string,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1_024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255,255,255,.35)";
    context.lineWidth = 8;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  }
  context.fillStyle = foreground;
  context.font = "700 150px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  return texture;
}
