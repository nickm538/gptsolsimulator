import { AIRCRAFT, AIRPORT, DEFAULT_SETUP, LIVERIES, STORAGE_KEY, WEATHER } from "../data";
import {
  formatAltitude,
  formatHeading,
  shortestAngleDegrees,
  wrapDegrees,
} from "../sim/math";
import type {
  AircraftSpec,
  AircraftSystems,
  CameraMode,
  FlightControls,
  FlightSetup,
  FlightSnapshot,
  LandingReport,
  TimeId,
  WeatherId,
} from "../types";
import type { TutorialDirector } from "./Tutorial";

export interface InterfaceActions {
  beginFlight(setup: FlightSetup): void;
  togglePause(): void;
  restartGate(): void;
  retryApproach(): void;
  exitToSetup(): void;
  cycleCamera(): void;
  toggleSound(): boolean;
  toggleSystem(system: keyof AircraftSystems): void;
  toggleParkingBrake(): void;
  adjustFlaps(delta: number): void;
  toggleGear(): void;
  toggleReverse(): void;
  toggleAutopilot(): void;
  adjustAutopilot(kind: "heading" | "altitude", delta: number): void;
  setThrottle(value: number): void;
  tutorialAdvance(): void;
}

export class Interface {
  private setup: FlightSetup;
  private readonly actions: InterfaceActions;
  private mapOpen = false;
  private hintOpen = false;
  private lastTutorialIndex = -1;
  private highlightedTarget: Element | null = null;
  private currentSpec = AIRCRAFT.cessna;
  private snapshot: FlightSnapshot | null = null;

  constructor(actions: InterfaceActions) {
    this.actions = actions;
    this.setup = this.loadSetup();
    this.bindPreflight();
    this.bindFlightDeck();
    this.syncPreflight();
    this.startClock();
  }

  get flightSetup(): FlightSetup {
    return { ...this.setup };
  }

  setLoading(progress: number, status: string): void {
    element<HTMLElement>("loading-progress").style.width = `${Math.round(progress * 100)}%`;
    element("loading-status").textContent = status;
  }

  showPreflight(): void {
    element("flight-ui").classList.add("is-hidden");
    element("pause-overlay").classList.add("is-hidden");
    element("crash-overlay").classList.add("is-hidden");
    element("map-overlay").classList.add("is-hidden");
    element("landing-toast").classList.add("is-hidden");
    element("preflight-screen").classList.remove("is-hidden");
    this.mapOpen = false;
    this.syncPreflight();
  }

  revealPreflight(): void {
    const loading = element("loading-screen");
    loading.classList.add("fade-out");
    window.setTimeout(() => loading.classList.add("is-hidden"), 620);
    element("preflight-screen").classList.remove("is-hidden");
  }

  showFlight(spec: AircraftSpec, setup: FlightSetup): void {
    this.currentSpec = spec;
    this.setup = { ...setup };
    element("preflight-screen").classList.add("is-hidden");
    element("briefing-modal").classList.add("is-hidden");
    element("loading-screen").classList.add("is-hidden");
    element("flight-ui").classList.remove("is-hidden");
    element("crash-overlay").classList.add("is-hidden");
    element("landing-toast").classList.add("is-hidden");
    element("flight-callsign").textContent = setup.callsign.toUpperCase();
    element("flight-wind").textContent =
      `${String(WEATHER[setup.weatherId].windDirectionDeg).padStart(3, "0")} / ` +
      `${String(WEATHER[setup.weatherId].windKts).padStart(2, "0")}`;
    element("engine-label").textContent =
      spec.engineKind === "piston" ? "RPM %" : "N1 %";
    element("fuel-remaining").textContent = `${setup.fuelPercent}%`;
    element("tutorial-card").classList.toggle("is-hidden", !setup.tutorial);
    this.lastTutorialIndex = -1;
  }

  showPause(paused: boolean): void {
    element("pause-overlay").classList.toggle("is-hidden", !paused);
  }

  setCameraMode(mode: CameraMode): void {
    element("camera-label").textContent = mode.toUpperCase();
  }

  toggleMap(force?: boolean): boolean {
    this.mapOpen = force ?? !this.mapOpen;
    element("map-overlay").classList.toggle("is-hidden", !this.mapOpen);
    if (this.mapOpen && this.snapshot) this.drawMap(this.snapshot);
    return this.mapOpen;
  }

  updateFlight(
    snapshot: FlightSnapshot,
    controls: FlightControls,
    systems: AircraftSystems,
    tutorial: TutorialDirector,
  ): void {
    this.snapshot = snapshot;
    const powered = systems.battery && systems.avionics;
    element("pfd-screen").classList.toggle("is-off", !powered);
    element("pfd-power").textContent = powered ? "ONLINE" : "OFF";
    element("pfd-power").classList.toggle("is-online", powered);
    element("pfd-speed").textContent = Math.round(snapshot.airspeedKts)
      .toString()
      .padStart(3, "0");
    element("pfd-altitude").textContent = formatAltitude(snapshot.altitudeFt);
    element("pfd-vs").textContent = `${Math.round(snapshot.verticalSpeedFpm / 100)}`;
    element("pfd-heading").textContent = formatHeading(snapshot.headingDeg);
    element("fma-mode").textContent = systems.autopilot ? "AP CMD" : "MANUAL";
    element("fma-altitude").textContent = systems.autopilot
      ? `ALT ${Math.round(systems.apAltitudeFt)}`
      : "ALT ---";
    element<HTMLElement>("attitude-horizon").style.transform =
      `translate(-50%, calc(-50% + ${snapshot.pitchDeg * 1.65}px)) ` +
      `rotate(${-snapshot.rollDeg}deg)`;
    element<HTMLElement>("vs-indicator").style.transform =
      `rotate(${Math.max(-68, Math.min(68, snapshot.verticalSpeedFpm / 38))}deg)`;

    element("ground-speed").textContent = `${Math.round(snapshot.groundSpeedKts)}`;
    element("radio-altitude").textContent = `${Math.round(snapshot.radioAltitudeFt)}`;
    element("aoa").textContent = snapshot.aoaDeg.toFixed(1);
    element("g-force").textContent = snapshot.gForce.toFixed(1);
    element("position-label").textContent = phaseLabel(snapshot);

    const n1 = systems.engineSpool * 100;
    element("engine-n1").textContent = `${Math.round(n1)}`;
    element("engine-state").textContent = systems.enginesRunning ? "RUNNING" : "OFF";
    element("fuel-flow").textContent = systems.enginesRunning
      ? `${Math.round(n1 * (this.currentSpec.engineKind === "piston" ? 0.12 : 5.8))}`
      : "0";
    element("oil-pressure").textContent = systems.enginesRunning
      ? `${Math.round(28 + n1 * 0.54)}`
      : "0";
    element<SVGPathElement>("n1-arc").style.strokeDashoffset = `${126 - n1 * 1.26}`;

    element<HTMLInputElement>("throttle-input").value = `${Math.round(
      controls.throttle * 100,
    )}`;
    element("throttle-readout").textContent = `${Math.round(controls.throttle * 100)}%`;
    element("flaps-value").textContent =
      controls.flaps === 0 ? "UP" : `${controls.flaps}`;
    element("gear-value").textContent =
      this.currentSpec.id === "cessna" ? "FIXED" : controls.gearDown ? "DOWN" : "UP";
    element("reverse-value").textContent = controls.reverse ? "ARM" : "OFF";
    element("parking-brake-button").classList.toggle("is-active", controls.parkingBrake);
    element("flaps-button").classList.toggle("is-active", controls.flaps > 0);
    element("gear-button").classList.toggle("is-active", controls.gearDown);
    element("reverse-button").classList.toggle("is-active", controls.reverse);
    element("autopilot-button").classList.toggle("is-active", systems.autopilot);
    element("autopilot-button").querySelector("b")!.textContent = systems.autopilot
      ? "CMD"
      : "OFF";
    element("ap-heading").textContent = formatHeading(systems.apHeadingDeg);
    element("ap-altitude").textContent = formatAltitude(systems.apAltitudeFt);

    for (const button of document.querySelectorAll<HTMLElement>(".system-switch")) {
      const system = button.dataset.system as keyof AircraftSystems;
      const value = Boolean(systems[system]);
      button.classList.toggle("is-active", value);
      const state = button.querySelector("small");
      if (state) state.textContent = value ? "ON" : "OFF";
    }

    const warning = systems.masterWarning;
    element("master-warning").classList.toggle("is-hidden", !warning);
    if (warning) element("warning-text").textContent = warning;
    element("runway-guidance").classList.toggle(
      "is-hidden",
      snapshot.phase === "airborne" && snapshot.radioAltitudeFt > 1_500,
    );

    this.updateTutorial(tutorial);
    if (this.mapOpen) this.drawMap(snapshot);
  }

  showCrash(reason: string, snapshot: FlightSnapshot): void {
    element("crash-reason").textContent = reason;
    element("crash-speed").textContent = `${Math.round(snapshot.groundSpeedKts)} KT`;
    element("crash-vs").textContent =
      `${Math.round(Math.abs(snapshot.verticalSpeedFpm))} FPM`;
    element("crash-overlay").classList.remove("is-hidden");
    const flash = element("screen-flash");
    flash.classList.remove("flash");
    void flash.offsetWidth;
    flash.classList.add("flash");
  }

  hideCrash(): void {
    element("crash-overlay").classList.add("is-hidden");
  }

  showLanding(report: LandingReport): void {
    element("landing-score").textContent = `${report.score}`;
    element("landing-title").textContent = report.title;
    element("landing-sink").textContent = `−${report.sinkRateFpm} FPM`;
    element("landing-center").textContent = `${report.centerlineOffsetM.toFixed(1)} M`;
    element("landing-speed").textContent = `${report.speedErrorKts.toFixed(0)} KT`;
    element("landing-toast").classList.remove("is-hidden");
  }

  private bindPreflight(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-aircraft]")) {
      button.addEventListener("click", () => {
        this.setup.aircraftId = button.dataset.aircraft as FlightSetup["aircraftId"];
        this.syncPreflight();
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-livery]")) {
      button.addEventListener("click", () => {
        this.setup.liveryIndex = Number(button.dataset.livery);
        this.syncPreflight();
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-weather]")) {
      button.addEventListener("click", () => {
        this.setup.weatherId = button.dataset.weather as WeatherId;
        if (this.setup.weatherId === "golden") this.setup.timeId = "sunset";
        if (this.setup.weatherId === "storm" && this.setup.timeId === "day") {
          this.setup.timeId = "sunset";
        }
        this.syncPreflight();
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-time]")) {
      button.addEventListener("click", () => {
        this.setup.timeId = button.dataset.time as TimeId;
        this.syncPreflight();
      });
    }

    const callsign = element<HTMLInputElement>("callsign-input");
    callsign.addEventListener("input", () => {
      this.setup.callsign = callsign.value
        .toUpperCase()
        .replace(/[^A-Z0-9 -]/g, "")
        .slice(0, 12);
      callsign.value = this.setup.callsign;
    });
    const fuel = element<HTMLInputElement>("fuel-input");
    fuel.addEventListener("input", () => {
      this.setup.fuelPercent = Number(fuel.value);
      element("fuel-output").textContent = `${this.setup.fuelPercent}%`;
    });
    const payload = element<HTMLInputElement>("payload-input");
    payload.addEventListener("input", () => {
      this.setup.payloadPercent = Number(payload.value);
      element("payload-output").textContent = `${this.setup.payloadPercent}%`;
    });
    element<HTMLSelectElement>("quality-select").addEventListener("change", (event) => {
      this.setup.quality = (event.currentTarget as HTMLSelectElement)
        .value as FlightSetup["quality"];
    });
    element<HTMLInputElement>("tutorial-toggle").addEventListener("change", (event) => {
      this.setup.tutorial = (event.currentTarget as HTMLInputElement).checked;
    });
    element<HTMLInputElement>("assist-toggle").addEventListener("change", (event) => {
      this.setup.assisted = (event.currentTarget as HTMLInputElement).checked;
    });
    element<HTMLInputElement>("ready-toggle").addEventListener("change", (event) => {
      this.setup.readyToTaxi = (event.currentTarget as HTMLInputElement).checked;
    });

    element("review-flight-button").addEventListener("click", () => {
      this.syncBriefing();
      element("briefing-modal").classList.remove("is-hidden");
    });
    element("close-briefing").addEventListener("click", () => {
      element("briefing-modal").classList.add("is-hidden");
    });
    element("briefing-modal").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) {
        element("briefing-modal").classList.add("is-hidden");
      }
    });
    element("begin-flight-button").addEventListener("click", () => {
      if (!this.setup.callsign.trim()) this.setup.callsign = "AER 271";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.setup));
      this.actions.beginFlight({ ...this.setup });
    });
  }

  private bindFlightDeck(): void {
    element("pause-button").addEventListener("click", this.actions.togglePause);
    element("resume-button").addEventListener("click", this.actions.togglePause);
    element("restart-gate-button").addEventListener("click", this.actions.restartGate);
    element("retry-approach-button").addEventListener("click", this.actions.retryApproach);
    element("exit-button").addEventListener("click", this.actions.exitToSetup);
    element("camera-button").addEventListener("click", this.actions.cycleCamera);
    element("mobile-camera").addEventListener("click", this.actions.cycleCamera);
    element("map-button").addEventListener("click", () => this.toggleMap());
    element("close-map").addEventListener("click", () => this.toggleMap(false));
    element("map-overlay").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) this.toggleMap(false);
    });
    element("sound-button").addEventListener("click", () => {
      const muted = this.actions.toggleSound();
      element("sound-button").querySelector("b")!.textContent = muted ? "OFF" : "ON";
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>(".system-switch")) {
      button.addEventListener("click", () => {
        this.actions.toggleSystem(button.dataset.system as keyof AircraftSystems);
      });
    }
    element("parking-brake-button").addEventListener(
      "click",
      this.actions.toggleParkingBrake,
    );
    element("flaps-button").addEventListener("click", () => this.actions.adjustFlaps(1));
    element("mobile-flaps").addEventListener("click", () => this.actions.adjustFlaps(1));
    element("gear-button").addEventListener("click", this.actions.toggleGear);
    element("mobile-gear").addEventListener("click", this.actions.toggleGear);
    element("reverse-button").addEventListener("click", this.actions.toggleReverse);
    element("autopilot-button").addEventListener("click", this.actions.toggleAutopilot);
    element<HTMLInputElement>("throttle-input").addEventListener("input", (event) => {
      this.actions.setThrottle(Number((event.currentTarget as HTMLInputElement).value) / 100);
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ap]")) {
      button.addEventListener("click", () => {
        const action = button.dataset.ap;
        if (action === "heading-down") this.actions.adjustAutopilot("heading", -5);
        if (action === "heading-up") this.actions.adjustAutopilot("heading", 5);
        if (action === "altitude-down") this.actions.adjustAutopilot("altitude", -500);
        if (action === "altitude-up") this.actions.adjustAutopilot("altitude", 500);
      });
    }

    element("tutorial-continue").addEventListener("click", this.actions.tutorialAdvance);
    element("tutorial-hint").addEventListener("click", () => {
      this.hintOpen = !this.hintOpen;
      element("tutorial-hint-text").classList.toggle("is-hidden", !this.hintOpen);
      element("tutorial-hint").textContent = this.hintOpen ? "HIDE HINT" : "SHOW HINT";
    });
    element("collapse-tutorial").addEventListener("click", () => {
      const card = element("tutorial-card");
      card.classList.toggle("is-collapsed");
      element("collapse-tutorial").textContent = card.classList.contains("is-collapsed")
        ? "+"
        : "−";
    });

    element("crash-retry-approach").addEventListener("click", this.actions.retryApproach);
    element("crash-restart").addEventListener("click", this.actions.restartGate);
    element("close-landing").addEventListener("click", () => {
      element("landing-toast").classList.add("is-hidden");
    });
  }

  private syncPreflight(): void {
    const spec = AIRCRAFT[this.setup.aircraftId];
    const weather = WEATHER[this.setup.weatherId];
    document.documentElement.style.setProperty(
      "--accent",
      LIVERIES[this.setup.liveryIndex]?.accent ?? LIVERIES[0]!.accent,
    );
    for (const button of document.querySelectorAll<HTMLElement>("[data-aircraft]")) {
      button.classList.toggle("is-active", button.dataset.aircraft === this.setup.aircraftId);
    }
    for (const button of document.querySelectorAll<HTMLElement>("[data-livery]")) {
      button.classList.toggle(
        "is-active",
        Number(button.dataset.livery) === this.setup.liveryIndex,
      );
    }
    for (const button of document.querySelectorAll<HTMLElement>("[data-weather]")) {
      button.classList.toggle("is-active", button.dataset.weather === this.setup.weatherId);
    }
    for (const button of document.querySelectorAll<HTMLElement>("[data-time]")) {
      button.classList.toggle("is-active", button.dataset.time === this.setup.timeId);
    }

    element("hero-aircraft-code").textContent = spec.shortName;
    element("hero-range").textContent = `${spec.rangeNm.toLocaleString()} NM`;
    element("spec-cruise").textContent = `${spec.cruiseKts} KT`;
    element("spec-ceiling").textContent = `${spec.ceilingFt.toLocaleString()} FT`;
    element("spec-approach").textContent = `${spec.approachKts} KT`;
    element("aircraft-tagline").textContent = spec.tagline;
    element("hero-wind").textContent =
      `${weather.windDirectionDeg}° / ${String(weather.windKts).padStart(2, "0")} KT`;
    element("hero-visibility").textContent =
      weather.visibilityM >= 10_000
        ? `${Math.round(weather.visibilityM / 1_000)} KM`
        : `${(weather.visibilityM / 1_000).toFixed(1)} KM`;
    element("summary-aircraft").textContent =
      `${spec.fullName} · ${weather.label}`;

    element<HTMLInputElement>("callsign-input").value = this.setup.callsign;
    element<HTMLInputElement>("fuel-input").value = `${this.setup.fuelPercent}`;
    element("fuel-output").textContent = `${this.setup.fuelPercent}%`;
    element<HTMLInputElement>("payload-input").value = `${this.setup.payloadPercent}`;
    element("payload-output").textContent = `${this.setup.payloadPercent}%`;
    element<HTMLSelectElement>("quality-select").value = this.setup.quality;
    element<HTMLInputElement>("tutorial-toggle").checked = this.setup.tutorial;
    element<HTMLInputElement>("assist-toggle").checked = this.setup.assisted;
    element<HTMLInputElement>("ready-toggle").checked = this.setup.readyToTaxi;
  }

  private syncBriefing(): void {
    const spec = AIRCRAFT[this.setup.aircraftId];
    const weather = WEATHER[this.setup.weatherId];
    element("briefing-title").textContent = spec.fullName;
    element("briefing-subtitle").textContent =
      `Gate ${AIRPORT.gate} · Callsign ${this.setup.callsign || "AER 271"}`;
    element("briefing-vr").textContent = `${spec.rotateKts} kt`;
    element("briefing-weather").textContent =
      `WIND ${weather.windDirectionDeg} AT ${String(weather.windKts).padStart(2, "0")} · ` +
      `VISIBILITY ${Math.round(weather.visibilityM / 1_000)} KM`;
  }

  private updateTutorial(tutorial: TutorialDirector): void {
    if (!tutorial.active) {
      element("tutorial-card").classList.add("is-hidden");
      return;
    }
    element("tutorial-card").classList.remove("is-hidden");
    if (this.lastTutorialIndex === tutorial.index) return;
    this.lastTutorialIndex = tutorial.index;
    this.hintOpen = false;
    const step = tutorial.current;
    element("tutorial-eyebrow").textContent = step.eyebrow;
    element("tutorial-title").textContent = step.title;
    element("tutorial-body").textContent = step.body;
    element("tutorial-hint-text").textContent = step.hint;
    element("tutorial-hint-text").classList.add("is-hidden");
    element("tutorial-hint").textContent = "SHOW HINT";
    element<HTMLElement>("tutorial-progress").style.width =
      `${Math.round(tutorial.progress * 100)}%`;
    element("tutorial-continue").textContent =
      tutorial.index === 0
        ? "BEGIN CHECKLIST"
        : tutorial.isComplete
          ? "HIDE TUTORIAL"
          : "SKIP STEP";
    element("tutorial-action").classList.toggle("is-hidden", tutorial.isComplete);
    element("tutorial-action").querySelector("b")!.textContent =
      tutorial.index === 0 ? "PRESS ENTER" : "COMPLETE THE HIGHLIGHTED ACTION";

    this.highlightedTarget?.classList.remove("tutorial-target");
    this.highlightedTarget = step.target ? document.querySelector(step.target) : null;
    this.highlightedTarget?.classList.add("tutorial-target");
  }

  private drawMap(snapshot: FlightSnapshot): void {
    const canvas = element<HTMLCanvasElement>("map-canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const gradient = context.createRadialGradient(
      width * 0.5,
      height * 0.5,
      10,
      width * 0.5,
      height * 0.5,
      width * 0.75,
    );
    gradient.addColorStop(0, "#123138");
    gradient.addColorStop(1, "#061419");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(130,180,183,.08)";
    context.lineWidth = 1;
    for (let x = 20; x < width; x += 42) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 20; y < height; y += 42) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const scale = 0.13;
    const mapX = (worldX: number) => width * 0.5 + worldX * scale;
    const mapY = (worldZ: number) => height * 0.5 + worldZ * scale;

    context.fillStyle = "#2c3d40";
    context.fillRect(
      mapX(-1_050),
      mapY(-1_590),
      660 * scale,
      3_180 * scale,
    );
    context.fillStyle = "#526063";
    context.fillRect(
      mapX(-AIRPORT.runwayWidthM / 2),
      mapY(-AIRPORT.runwayLengthM / 2),
      AIRPORT.runwayWidthM * scale,
      AIRPORT.runwayLengthM * scale,
    );
    context.fillRect(
      mapX(760 - AIRPORT.runwayWidthM / 2),
      mapY(-AIRPORT.runwayLengthM / 2),
      AIRPORT.runwayWidthM * scale,
      AIRPORT.runwayLengthM * scale,
    );

    context.setLineDash([6, 5]);
    context.strokeStyle = "#f2bd4b";
    context.lineWidth = 2;
    context.beginPath();
    [
      [-315, 1_310],
      [-120, 1_310],
      [-120, 1_530],
      [0, 1_530],
      [0, 400],
    ].forEach(([x, z], index) => {
      if (index === 0) context.moveTo(mapX(x ?? 0), mapY(z ?? 0));
      else context.lineTo(mapX(x ?? 0), mapY(z ?? 0));
    });
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#8da2a4";
    context.font = "700 16px monospace";
    context.fillText("36L", mapX(0) - 15, mapY(1_700));
    context.fillText("36R", mapX(760) - 15, mapY(1_700));
    context.fillStyle = "#557278";
    context.font = "700 12px monospace";
    context.fillText("TERMINAL C", mapX(-850), mapY(-1_630));
    context.fillText("GATE C12", mapX(-370), mapY(1_310) - 11);

    context.save();
    context.translate(mapX(snapshot.position.x), mapY(snapshot.position.z));
    context.rotate((snapshot.headingDeg * Math.PI) / 180);
    context.fillStyle = "#21d4c2";
    context.shadowColor = "#21d4c2";
    context.shadowBlur = 14;
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(8, 10);
    context.lineTo(0, 6);
    context.lineTo(-8, 10);
    context.closePath();
    context.fill();
    context.restore();

    const north = -snapshot.position.z / 1_852;
    const east = snapshot.position.x / 1_852;
    element("map-coordinates").textContent =
      `N ${Math.abs(north).toFixed(3)} NM · E ${Math.abs(east).toFixed(3)} NM · ` +
      `HDG ${formatHeading(snapshot.headingDeg)}`;
  }

  private loadSetup(): FlightSetup {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return { ...DEFAULT_SETUP };
      const parsed = JSON.parse(saved) as Partial<FlightSetup>;
      if (!parsed.aircraftId || !(parsed.aircraftId in AIRCRAFT)) {
        return { ...DEFAULT_SETUP };
      }
      return { ...DEFAULT_SETUP, ...parsed };
    } catch {
      return { ...DEFAULT_SETUP };
    }
  }

  private startClock(): void {
    const update = () => {
      const now = new Date();
      element("local-clock").textContent =
        `${String(now.getUTCHours()).padStart(2, "0")}:` +
        `${String(now.getUTCMinutes()).padStart(2, "0")} UTC`;
    };
    update();
    window.setInterval(update, 30_000);
  }
}

function phaseLabel(snapshot: FlightSnapshot): string {
  switch (snapshot.phase) {
    case "gate":
      return `GATE ${AIRPORT.gate}`;
    case "taxi":
      return snapshot.position.x < -160 ? "TAXIWAY C" : "TAXIWAY A";
    case "takeoff":
      return "RUNWAY 36L";
    case "airborne":
      return "KAUR AREA";
    case "approach":
      return "FINAL 36L";
    case "landing":
      return "LANDING";
    case "rollout":
      return "ROLLOUT 36L";
    case "crashed":
      return "FLIGHT ENDED";
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element #${id}`);
  return found as T;
}

export function headingErrorToRunway(snapshot: FlightSnapshot): number {
  return shortestAngleDegrees(snapshot.headingDeg, wrapDegrees(AIRPORT.runwayHeading));
}
