import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  PCFSoftShadowMap,
} from "three";
import "./style.css";
import { AIRCRAFT, LIVERIES, WEATHER } from "./data";
import { FlightModel } from "./sim/FlightModel";
import { InputController } from "./sim/InputController";
import type {
  AircraftSystems,
  FlightSetup,
  FlightSnapshot,
  QualityId,
} from "./types";
import { AudioEngine } from "./audio/AudioEngine";
import { Interface } from "./ui/Interface";
import { TutorialDirector } from "./ui/Tutorial";
import { AircraftView } from "./world/AircraftView";
import { buildAirport, type AirportWorld } from "./world/Airport";
import { CameraController } from "./world/CameraController";
import { Effects } from "./world/Effects";
import { Environment } from "./world/Environment";

const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.08;

class AeroviaSimulator {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(68, 1, 0.025, 18_000);
  private readonly ui: Interface;

  private model: FlightModel | null = null;
  private aircraftView: AircraftView | null = null;
  private airport: AirportWorld | null = null;
  private environment: Environment | null = null;
  private effects: Effects | null = null;
  private audio: AudioEngine | null = null;
  private cameraController: CameraController | null = null;
  private input: InputController | null = null;
  private tutorial: TutorialDirector | null = null;
  private setup: FlightSetup | null = null;
  private snapshot: FlightSnapshot | null = null;
  private running = false;
  private paused = false;
  private accumulator = 0;
  private elapsed = 0;
  private previousTimestamp = 0;
  private lastUiUpdate = 0;
  private crashTriggered = false;
  private crashTimer = 0;

  constructor() {
    const canvas = document.getElementById("sim-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Aerovia requires a canvas element");
    }
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x071116, 1);

    this.ui = new Interface({
      beginFlight: (setup) => this.beginFlight(setup),
      togglePause: () => this.togglePause(),
      restartGate: () => this.restartGate(),
      retryApproach: () => this.retryApproach(),
      exitToSetup: () => this.exitToSetup(),
      cycleCamera: () => this.cycleCamera(),
      toggleSound: () => this.audio?.toggleMute() ?? false,
      toggleSystem: (system) => this.toggleSystem(system),
      toggleParkingBrake: () => this.toggleParkingBrake(),
      adjustFlaps: (delta) => this.adjustFlaps(delta),
      toggleGear: () => this.toggleGear(),
      toggleReverse: () => this.toggleReverse(),
      toggleAutopilot: () => this.toggleAutopilot(),
      adjustAutopilot: (kind, delta) => this.adjustAutopilot(kind, delta),
      setThrottle: (value) => this.setThrottle(value),
      tutorialAdvance: () => this.advanceTutorial(),
    });

    this.bindTouchControls();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resize();
    this.boot();
    requestAnimationFrame(this.animate);
  }

  private async boot(): Promise<void> {
    this.ui.setLoading(0.2, "Calibrating aerodynamic tables…");
    await nextPaint();
    this.ui.setLoading(0.52, "Building Aurelia International…");
    await delay(170);
    this.ui.setLoading(0.82, "Checking cockpit systems…");
    await delay(170);
    this.ui.setLoading(1, "Flight deck ready");
    await delay(240);
    this.ui.revealPreflight();
  }

  private beginFlight(setup: FlightSetup): void {
    this.disposeSimulation();
    this.setup = { ...setup };
    const spec = AIRCRAFT[setup.aircraftId];
    const weather = WEATHER[setup.weatherId];
    const quality = resolveQuality(setup.quality);
    const livery = LIVERIES[setup.liveryIndex] ?? LIVERIES[0]!;

    this.configureRenderer(quality);
    this.airport = buildAirport(this.scene, quality, setup.timeId);
    this.environment = new Environment(
      this.scene,
      weather,
      setup.timeId,
      quality,
    );
    this.model = new FlightModel(spec, weather, setup);
    this.aircraftView = new AircraftView(
      this.scene,
      spec,
      livery,
      setup.callsign,
      quality,
    );
    this.effects = new Effects(this.scene);
    this.audio = new AudioEngine(spec, weather);
    void this.audio.start();
    this.tutorial = new TutorialDirector(spec, setup.tutorial);
    this.snapshot = this.model.snapshot();

    this.camera.fov = spec.cameraFov;
    this.camera.updateProjectionMatrix();
    this.cameraController = new CameraController(
      this.camera,
      this.canvas,
      this.aircraftView,
    );
    this.cameraController.setEnabled(true);
    this.cameraController.setMode("cockpit");

    this.input = new InputController(this.model.controls, {
      onCamera: () => this.cycleCamera(),
      onMap: () => this.ui.toggleMap(),
      onPause: () => this.togglePause(),
      onGear: () => this.toggleGear(),
      onFlaps: (delta) => this.adjustFlaps(delta),
      onAutopilot: () => this.toggleAutopilot(),
      onInteract: () => this.advanceTutorial(),
    });

    this.elapsed = 0;
    this.accumulator = 0;
    this.previousTimestamp = performance.now();
    this.lastUiUpdate = 0;
    this.paused = false;
    this.running = true;
    this.crashTriggered = false;
    this.crashTimer = 0;
    this.ui.showFlight(spec, setup);
    this.ui.setCameraMode("cockpit");
    this.ui.showPause(false);
    this.aircraftView.update(
      0,
      this.model.position,
      this.model.orientation,
      this.model.controls,
      this.model.systems,
    );
    this.cameraController.update(1, 0, 0);
    this.ui.updateFlight(
      this.snapshot,
      this.model.controls,
      this.model.systems,
      this.tutorial,
    );
  }

  private readonly animate = (timestamp: number): void => {
    requestAnimationFrame(this.animate);
    const rawDelta = this.previousTimestamp
      ? (timestamp - this.previousTimestamp) / 1_000
      : 0;
    this.previousTimestamp = timestamp;
    const frameDelta = Math.min(MAX_FRAME, Math.max(0, rawDelta));

    if (
      !this.running ||
      !this.model ||
      !this.aircraftView ||
      !this.cameraController ||
      !this.environment ||
      !this.airport ||
      !this.effects ||
      !this.tutorial
    ) {
      return;
    }

    if (!this.paused) {
      this.input?.update(frameDelta);
      this.accumulator = Math.min(this.accumulator + frameDelta, MAX_FRAME);
      while (this.accumulator >= FIXED_STEP) {
        this.elapsed += FIXED_STEP;
        this.snapshot = this.model.step(FIXED_STEP, this.elapsed);
        this.tutorial.update(
          FIXED_STEP,
          this.snapshot,
          this.model.controls,
          this.model.systems,
        );
        this.accumulator -= FIXED_STEP;
      }

      if (this.snapshot) {
        this.aircraftView.update(
          frameDelta,
          this.model.position,
          this.model.orientation,
          this.model.controls,
          this.model.systems,
        );
        this.cameraController.update(
          frameDelta,
          this.elapsed,
          this.snapshot.airspeedKts,
        );
        this.environment.update(
          frameDelta,
          this.elapsed,
          this.camera,
          this.model.position,
        );
        this.airport.update(this.elapsed, this.model.position);
        this.effects.update(frameDelta);
        this.audio?.update(
          this.elapsed,
          this.model.systems.engineSpool,
          this.snapshot.airspeedKts,
          Boolean(this.model.systems.masterWarning),
        );
        this.handleOutcomes(frameDelta);

        if (this.elapsed - this.lastUiUpdate > 1 / 20) {
          this.lastUiUpdate = this.elapsed;
          this.ui.updateFlight(
            this.snapshot,
            this.model.controls,
            this.model.systems,
            this.tutorial,
          );
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private handleOutcomes(dt: number): void {
    if (!this.model || !this.snapshot || !this.aircraftView || !this.effects) return;
    const report = this.model.consumeLandingReport();
    if (report) {
      const touchdownPosition = this.model.position
        .clone()
        .add(new Vector3(0, -this.model.aircraft.gearHeightM, 0));
      this.effects.touchdown(touchdownPosition, report.grade === "hard");
      this.audio?.touchdown(report.grade === "hard");
      this.cameraController?.addShake(report.grade === "hard" ? 0.8 : 0.22);
      this.ui.showLanding(report);
    }

    if (this.snapshot.phase === "crashed") {
      if (!this.crashTriggered) {
        this.crashTriggered = true;
        this.crashTimer = 0;
        const scale =
          this.model.aircraft.id === "max9"
            ? 2.2
            : this.model.aircraft.id === "learjet"
              ? 1.45
              : 0.9;
        this.effects.crash(this.model.position, scale);
        this.audio?.crash();
        this.cameraController?.addShake(2.4 * scale);
      }
      this.crashTimer += dt;
      if (this.crashTimer >= 0.8) {
        this.ui.showCrash(this.model.reasonForCrash ?? "AIRCRAFT DAMAGED", this.snapshot);
      }
    }
  }

  private restartGate(): void {
    if (!this.model || !this.tutorial) return;
    this.model.resetAtGate(this.setup?.readyToTaxi ?? false);
    this.tutorial.reset();
    this.snapshot = this.model.snapshot();
    this.crashTriggered = false;
    this.crashTimer = 0;
    this.paused = false;
    this.ui.hideCrash();
    this.ui.showPause(false);
    this.ui.toggleMap(false);
    this.cameraController?.setMode("cockpit");
    this.cameraController?.resetLook();
    this.ui.setCameraMode("cockpit");
  }

  private retryApproach(): void {
    if (!this.model || !this.tutorial) return;
    this.model.resetOnApproach();
    this.snapshot = this.model.snapshot();
    this.crashTriggered = false;
    this.crashTimer = 0;
    this.paused = false;
    this.ui.hideCrash();
    this.ui.showPause(false);
    this.ui.toggleMap(false);
    this.cameraController?.setMode("cockpit");
    this.cameraController?.resetLook();
    this.ui.setCameraMode("cockpit");
  }

  private exitToSetup(): void {
    this.disposeSimulation();
    this.ui.showPreflight();
  }

  private togglePause(): void {
    if (!this.running) return;
    this.paused = !this.paused;
    this.ui.showPause(this.paused);
    this.cameraController?.setEnabled(!this.paused);
    if (!this.paused) this.previousTimestamp = performance.now();
  }

  private cycleCamera(): void {
    if (!this.cameraController || this.paused) return;
    const mode = this.cameraController.cycle();
    this.ui.setCameraMode(mode);
  }

  private toggleSystem(system: keyof AircraftSystems): void {
    if (!this.model) return;
    const booleanSystems = new Set<keyof AircraftSystems>([
      "battery",
      "avionics",
      "beacon",
      "navLights",
      "landingLights",
      "engineMaster",
    ]);
    if (!booleanSystems.has(system)) return;
    const current = this.model.systems[system];
    if (typeof current === "boolean") {
      (this.model.systems[system] as boolean) = !current;
    }
    if (system === "battery" && !this.model.systems.battery) {
      this.model.systems.avionics = false;
      this.model.systems.engineMaster = false;
      this.model.systems.autopilot = false;
    }
  }

  private toggleParkingBrake(): void {
    if (!this.model) return;
    this.model.controls.parkingBrake = !this.model.controls.parkingBrake;
  }

  private adjustFlaps(delta: number): void {
    if (!this.model) return;
    if (delta > 0) {
      this.model.controls.flaps =
        this.model.controls.flaps >= 3 ? 0 : this.model.controls.flaps + 1;
    } else {
      this.model.controls.flaps = Math.max(0, this.model.controls.flaps - 1);
    }
  }

  private toggleGear(): void {
    if (!this.model || this.model.aircraft.id === "cessna") return;
    this.model.controls.gearDown = !this.model.controls.gearDown;
  }

  private toggleReverse(): void {
    if (
      !this.model ||
      this.model.aircraft.engineKind !== "turbofan" ||
      !this.snapshot?.grounded
    ) {
      return;
    }
    this.model.controls.reverse = !this.model.controls.reverse;
  }

  private toggleAutopilot(): void {
    this.model?.toggleAutopilot();
  }

  private adjustAutopilot(kind: "heading" | "altitude", delta: number): void {
    if (kind === "heading") this.model?.adjustAutopilotHeading(delta);
    else this.model?.adjustAutopilotAltitude(delta);
  }

  private setThrottle(value: number): void {
    if (!this.model) return;
    this.input?.setThrottle(value);
    this.model.controls.throttle = value;
  }

  private advanceTutorial(): void {
    if (!this.tutorial?.active) return;
    if (this.tutorial.isComplete) {
      this.tutorial.skip();
    } else {
      this.tutorial.advance();
    }
    if (this.model && this.snapshot) {
      this.ui.updateFlight(
        this.snapshot,
        this.model.controls,
        this.model.systems,
        this.tutorial,
      );
    }
  }

  private bindTouchControls(): void {
    const stick = document.getElementById("touch-stick");
    const knob = document.getElementById("touch-knob");
    if (!(stick instanceof HTMLElement) || !(knob instanceof HTMLElement)) return;
    let activePointer = -1;

    const updateStick = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const radius = rect.width * 0.38;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const magnitude = Math.hypot(dx, dy);
      const scale = magnitude > radius ? radius / magnitude : 1;
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      this.input?.setTouchStick(x / radius, y / radius);
    };

    stick.addEventListener("pointerdown", (event) => {
      activePointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      updateStick(event);
    });
    stick.addEventListener("pointermove", (event) => {
      if (event.pointerId === activePointer) updateStick(event);
    });
    const releaseStick = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      activePointer = -1;
      knob.style.transform = "translate(-50%, -50%)";
      this.input?.clearTouchStick();
    };
    stick.addEventListener("pointerup", releaseStick);
    stick.addEventListener("pointercancel", releaseStick);

    for (const button of document.querySelectorAll<HTMLElement>("[data-rudder]")) {
      button.addEventListener("pointerdown", () => {
        this.input?.setTouchYaw(Number(button.dataset.rudder));
      });
      button.addEventListener("pointerup", () => this.input?.setTouchYaw(0));
      button.addEventListener("pointercancel", () => this.input?.setTouchYaw(0));
      button.addEventListener("pointerleave", () => this.input?.setTouchYaw(0));
    }
    const brake = document.getElementById("mobile-brake");
    brake?.addEventListener("pointerdown", () => this.input?.setTouchBrake(1));
    brake?.addEventListener("pointerup", () => this.input?.setTouchBrake(0));
    brake?.addEventListener("pointercancel", () => this.input?.setTouchBrake(0));
    brake?.addEventListener("pointerleave", () => this.input?.setTouchBrake(0));
  }

  private configureRenderer(quality: QualityId): void {
    const pixelRatio =
      quality === "mobile"
        ? Math.min(window.devicePixelRatio, 1.25)
        : quality === "balanced"
          ? Math.min(window.devicePixelRatio, 1.6)
          : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.shadowMap.enabled = quality !== "mobile";
    this.resize();
  }

  private disposeSimulation(): void {
    this.running = false;
    this.input?.dispose();
    this.cameraController?.dispose();
    this.aircraftView?.dispose(this.scene);
    this.airport?.dispose();
    this.environment?.dispose();
    this.effects?.dispose();
    this.audio?.dispose();
    this.input = null;
    this.cameraController = null;
    this.aircraftView = null;
    this.airport = null;
    this.environment = null;
    this.effects = null;
    this.audio = null;
    this.model = null;
    this.tutorial = null;
    this.snapshot = null;
    this.scene.clear();
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.running && !this.paused) {
      this.togglePause();
    }
  };
}

function resolveQuality(selected: QualityId): QualityId {
  if (selected !== "auto") return selected;
  const memory =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile =
    matchMedia("(pointer: coarse)").matches || window.innerWidth < 800;
  if (mobile || memory <= 4 || cores <= 4) return "mobile";
  return memory >= 8 && cores >= 8 ? "high" : "balanced";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

new AeroviaSimulator();
