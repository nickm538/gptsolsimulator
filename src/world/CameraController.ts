import {
  Euler,
  MathUtils,
  PerspectiveCamera,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import type { CameraMode } from "../types";
import { damp } from "../sim/math";
import type { AircraftView } from "./AircraftView";

const MODES: CameraMode[] = ["cockpit", "chase", "orbit", "wing", "tower"];
const targetPosition = new Vector3();
const targetLook = new Vector3();
const worldOffset = new Vector3();
const anchorPosition = new Vector3();
const anchorQuaternion = new Quaternion();
const lookQuaternion = new Quaternion();
const lookEuler = new Euler(0, 0, 0, "YXZ");

export class CameraController {
  mode: CameraMode = "cockpit";
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private aircraft: AircraftView;
  private enabled = false;
  private dragging = false;
  private pointerId = -1;
  private lastPointer = new Vector2();
  private lookYaw = 0;
  private lookPitch = -0.03;
  private orbitAzimuth = 0;
  private orbitElevation = 0.22;
  private orbitDistance = 34;
  private shake = 0;

  constructor(
    camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
    aircraft: AircraftView,
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.aircraft = aircraft;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  setAircraft(aircraft: AircraftView): void {
    this.aircraft = aircraft;
    this.aircraft.setCockpitMode(this.mode === "cockpit");
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.dragging = false;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.aircraft.setCockpitMode(mode === "cockpit");
    this.camera.near = mode === "cockpit" ? 0.025 : 0.15;
    this.camera.updateProjectionMatrix();
  }

  cycle(): CameraMode {
    const index = MODES.indexOf(this.mode);
    this.setMode(MODES[(index + 1) % MODES.length] ?? "cockpit");
    return this.mode;
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  resetLook(): void {
    this.lookYaw = 0;
    this.lookPitch = -0.03;
    this.orbitAzimuth = 0;
    this.orbitElevation = 0.22;
  }

  update(dt: number, elapsed: number, speedKts: number): void {
    this.aircraft.root.updateMatrixWorld(true);
    const root = this.aircraft.root;
    const aircraftPosition = root.position;

    switch (this.mode) {
      case "cockpit": {
        this.aircraft.cockpitAnchor.getWorldPosition(anchorPosition);
        this.aircraft.cockpitAnchor.getWorldQuaternion(anchorQuaternion);
        lookEuler.set(this.lookPitch, this.lookYaw, 0);
        lookQuaternion.setFromEuler(lookEuler);
        this.camera.position.copy(anchorPosition);
        this.camera.quaternion.copy(anchorQuaternion).multiply(lookQuaternion);
        break;
      }
      case "chase": {
        const distance =
          this.aircraft.root.name.includes("737")
            ? 82
            : this.aircraft.root.name.includes("Learjet")
              ? 42
              : 24;
        worldOffset
          .set(
            Math.sin(this.orbitAzimuth) *
              Math.cos(this.orbitElevation) *
              distance,
            3.5 + Math.sin(this.orbitElevation) * distance,
            Math.cos(this.orbitAzimuth) *
              Math.cos(this.orbitElevation) *
              distance,
          )
          .applyQuaternion(root.quaternion);
        targetPosition.copy(aircraftPosition).add(worldOffset);
        const follow = clampFollow(dt, speedKts);
        this.camera.position.lerp(targetPosition, follow);
        worldOffset.set(0, 1, -1).applyQuaternion(root.quaternion);
        targetLook.copy(aircraftPosition).addScaledVector(worldOffset, 3);
        this.camera.lookAt(targetLook);
        break;
      }
      case "orbit": {
        worldOffset.set(
          Math.sin(this.orbitAzimuth) *
            Math.cos(this.orbitElevation) *
            this.orbitDistance,
          Math.sin(this.orbitElevation) * this.orbitDistance,
          Math.cos(this.orbitAzimuth) *
            Math.cos(this.orbitElevation) *
            this.orbitDistance,
        );
        targetPosition.copy(aircraftPosition).add(worldOffset);
        this.camera.position.lerp(targetPosition, 1 - Math.exp(-8 * dt));
        this.camera.lookAt(aircraftPosition);
        break;
      }
      case "wing": {
        this.aircraft.leftWingAnchor.getWorldPosition(anchorPosition);
        this.aircraft.leftWingAnchor.getWorldQuaternion(anchorQuaternion);
        lookEuler.set(this.lookPitch, this.lookYaw, 0);
        lookQuaternion.setFromEuler(lookEuler);
        this.camera.position.copy(anchorPosition);
        this.camera.quaternion.copy(anchorQuaternion).multiply(lookQuaternion);
        break;
      }
      case "tower": {
        targetPosition.set(-840, 103, 785);
        this.camera.position.lerp(targetPosition, 1 - Math.exp(-5 * dt));
        this.camera.lookAt(aircraftPosition);
        break;
      }
    }

    if (this.shake > 0.001) {
      const magnitude = this.shake * 0.28;
      this.camera.position.x += Math.sin(elapsed * 72) * magnitude;
      this.camera.position.y += Math.sin(elapsed * 91 + 1.2) * magnitude;
      this.camera.position.z += Math.sin(elapsed * 67 + 3.8) * magnitude;
      this.shake = damp(this.shake, 0, 3.8, dt);
    }
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || this.mode === "tower") return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.lastPointer.set(event.clientX, event.clientY);
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer.set(event.clientX, event.clientY);
    if (this.mode === "cockpit" || this.mode === "wing") {
      this.lookYaw = MathUtils.clamp(
        this.lookYaw - dx * 0.0035,
        -Math.PI * 0.72,
        Math.PI * 0.72,
      );
      this.lookPitch = MathUtils.clamp(
        this.lookPitch - dy * 0.0033,
        -Math.PI * 0.42,
        Math.PI * 0.4,
      );
    } else {
      this.orbitAzimuth -= dx * 0.004;
      this.orbitElevation = MathUtils.clamp(
        this.orbitElevation + dy * 0.003,
        -0.05,
        Math.PI * 0.46,
      );
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = -1;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled || this.mode !== "orbit") return;
    event.preventDefault();
    this.orbitDistance = MathUtils.clamp(
      this.orbitDistance + event.deltaY * 0.03,
      8,
      150,
    );
  };
}

function clampFollow(dt: number, speedKts: number): number {
  const response = MathUtils.clamp(5.8 - speedKts * 0.002, 2.8, 5.8);
  return 1 - Math.exp(-response * dt);
}
