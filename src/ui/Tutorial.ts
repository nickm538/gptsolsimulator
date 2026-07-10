import { AIRPORT } from "../data";
import type {
  AircraftSpec,
  AircraftSystems,
  FlightControls,
  FlightSnapshot,
  TutorialStep,
} from "../types";

export class TutorialDirector {
  readonly steps: TutorialStep[];
  index = 0;
  active: boolean;
  private completionTime = 0;

  constructor(spec: AircraftSpec, enabled: boolean) {
    this.active = enabled;
    this.steps = buildSteps(spec);
  }

  get current(): TutorialStep {
    return this.steps[Math.min(this.index, this.steps.length - 1)]!;
  }

  get progress(): number {
    return (this.index + 1) / this.steps.length;
  }

  get isComplete(): boolean {
    return this.index >= this.steps.length - 1;
  }

  update(
    dt: number,
    snapshot: FlightSnapshot,
    controls: FlightControls,
    systems: AircraftSystems,
  ): boolean {
    if (!this.active || this.isComplete || this.index === 0) return false;
    if (this.current.complete(snapshot, controls, systems)) {
      this.completionTime += dt;
      if (this.completionTime >= 0.55) {
        this.advance();
        return true;
      }
    } else {
      this.completionTime = 0;
    }
    return false;
  }

  advance(): void {
    if (this.index < this.steps.length - 1) this.index += 1;
    this.completionTime = 0;
  }

  skip(): void {
    this.active = false;
  }

  reset(): void {
    this.index = 0;
    this.completionTime = 0;
  }
}

function buildSteps(spec: AircraftSpec): TutorialStep[] {
  return [
    {
      id: "welcome",
      eyebrow: "LESSON 01 · FLIGHT DECK",
      title: "Welcome aboard",
      body:
        "Drag anywhere outside the panels to look around. Every flight begins with a deliberate cockpit setup.",
      hint: "On desktop, drag the view with your mouse. On mobile, drag the open sky.",
      complete: () => false,
    },
    {
      id: "battery",
      eyebrow: "LESSON 02 · ELECTRICAL",
      title: "Power the aircraft",
      body: "Set the BAT switch ON. This energizes the main electrical bus.",
      hint: "The BAT switch is in the SYSTEMS bank along the bottom flight deck.",
      target: '[data-system="battery"]',
      complete: (_snapshot, _controls, systems) => systems.battery,
    },
    {
      id: "avionics",
      eyebrow: "LESSON 03 · AVIONICS",
      title: "Bring displays online",
      body: "Switch AVIONICS ON and confirm the primary flight display illuminates.",
      hint: "Look for the second switch in the SYSTEMS bank.",
      target: '[data-system="avionics"]',
      complete: (_snapshot, _controls, systems) => systems.avionics,
    },
    {
      id: "engine",
      eyebrow: "LESSON 04 · ENGINE START",
      title: `Start ${spec.engineCount === 1 ? "the engine" : "both engines"}`,
      body:
        "Set BEACON first, then engage ENGINE. Allow the spool indication to stabilize.",
      hint: "BEACON is under exterior lights. ENGINE is the third SYSTEMS switch.",
      target: '[data-system="engineMaster"]',
      complete: (_snapshot, _controls, systems) =>
        systems.beacon && systems.enginesRunning,
    },
    {
      id: "navigation-lights",
      eyebrow: "LESSON 05 · EXTERIOR",
      title: "Make the aircraft visible",
      body: "Set NAV lights ON. Use landing lights when entering the runway.",
      hint: "NAV is the center switch in the EXTERIOR LIGHTS bank.",
      target: '[data-system="navLights"]',
      complete: (_snapshot, _controls, systems) => systems.navLights,
    },
    {
      id: "release-brake",
      eyebrow: "LESSON 06 · TAXI",
      title: "Release parking brake",
      body:
        "Release PARK, ease throttle to 12–18%, and steer with Q / E or the rudder buttons.",
      hint: "Tap the PARK lever. Keep taxi speed below 20 kt and use brakes to regulate speed.",
      target: "#parking-brake-button",
      complete: (_snapshot, controls) => !controls.parkingBrake,
    },
    {
      id: "taxi",
      eyebrow: "LESSON 07 · TAXI",
      title: "Follow Charlie east",
      body:
        "Track the amber centerline away from gate C12. Turn right onto Alpha for runway 36L.",
      hint: "Open the map with M. From the gate, taxi east, then south to the runway 36L threshold.",
      target: "#map-button",
      complete: (snapshot) =>
        snapshot.distanceTravelledM > 115 && snapshot.groundSpeedKts > 2,
    },
    {
      id: "hold-short",
      eyebrow: "LESSON 08 · HOLD SHORT",
      title: "Configure for departure",
      body:
        "Set takeoff flaps, landing lights ON, and stop at the paired yellow hold-short lines.",
      hint: "Use one notch of flaps. Runway 36L begins at the south end of the field.",
      target: "#flaps-button",
      complete: (snapshot, controls, systems) =>
        controls.flaps >= 1 &&
        systems.landingLights &&
        Math.abs(snapshot.position.x) < 155 &&
        snapshot.position.z > 1_420,
    },
    {
      id: "line-up",
      eyebrow: "LESSON 09 · LINE UP",
      title: "Enter runway 36L",
      body:
        "Check final, cross the hold line, then turn left to heading 360 on the centerline.",
      hint: "The runway runs north–south. Heading 360 points toward the far end.",
      complete: (snapshot) =>
        snapshot.onRunway &&
        (snapshot.headingDeg < 18 || snapshot.headingDeg > 342),
    },
    {
      id: "takeoff-power",
      eyebrow: "LESSON 10 · TAKEOFF",
      title: "Set takeoff power",
      body: `Hold centerline and advance throttle above 90%. Rotate smoothly at ${spec.rotateKts} kt.`,
      hint: "Hold SHIFT or drag the throttle. Use gentle rudder corrections as speed builds.",
      target: "#throttle-input",
      complete: (snapshot, controls) =>
        snapshot.onRunway && controls.throttle > 0.88 && snapshot.airspeedKts > 20,
    },
    {
      id: "rotate",
      eyebrow: "LESSON 11 · ROTATION",
      title: `Rotate at ${spec.rotateKts} knots`,
      body:
        "Pull back gently with S. Target 8–12° nose up and let the aircraft fly off the runway.",
      hint: "Do not yank the controls. Hold S until the nose rises, then relax pressure.",
      complete: (snapshot) => !snapshot.grounded && snapshot.radioAltitudeFt > 25,
    },
    {
      id: "positive-climb",
      eyebrow: "LESSON 12 · CLIMB",
      title: "Positive rate — gear up",
      body:
        spec.id === "cessna"
          ? "Maintain 8° nose up. Retract flaps one step at a time as airspeed increases."
          : "Select gear UP, then retract flaps one step at a time above a safe speed.",
      hint:
        spec.id === "cessna"
          ? "The Skyhawk has fixed gear. Tap FLAPS until the indication reads UP."
          : "Tap G for gear, then use Shift+F to retract flaps.",
      target: spec.id === "cessna" ? "#flaps-button" : "#gear-button",
      complete: (snapshot, controls) =>
        snapshot.radioAltitudeFt > 130 &&
        controls.flaps === 0 &&
        (spec.id === "cessna" || !controls.gearDown),
    },
    {
      id: "climb",
      eyebrow: "LESSON 13 · DEPARTURE",
      title: "Climb to pattern altitude",
      body:
        "Climb through 1,000 feet above the field. Bank gently and use the map to explore or return.",
      hint: "Pitch controls airspeed; power controls climb. Try autopilot P after leveling off.",
      complete: (snapshot) =>
        snapshot.altitudeFt > AIRPORT.elevationFt + 1_000,
    },
    {
      id: "complete",
      eyebrow: "TUTORIAL COMPLETE",
      title: "The aircraft is yours",
      body:
        "Continue free flight, practice a circuit, or load final approach from the pause menu. Aim for two white and two red PAPI lights.",
      hint: "Press M for the map, C for cameras, and Escape for checkpoints.",
      complete: () => false,
    },
  ];
}
