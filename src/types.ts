import type { Vector3 } from "three";

export type AircraftId = "cessna" | "learjet" | "max9";
export type WeatherId = "clear" | "golden" | "overcast" | "storm";
export type TimeId = "day" | "sunset" | "night";
export type QualityId = "auto" | "high" | "balanced" | "mobile";
export type CameraMode = "cockpit" | "chase" | "orbit" | "wing" | "tower";
export type FlightPhase =
  | "gate"
  | "taxi"
  | "takeoff"
  | "airborne"
  | "approach"
  | "landing"
  | "rollout"
  | "crashed";

export interface AircraftSpec {
  id: AircraftId;
  shortName: string;
  manufacturer: string;
  fullName: string;
  category: string;
  tagline: string;
  seats: number;
  massKg: number;
  wingArea: number;
  spanM: number;
  lengthM: number;
  heightM: number;
  gearHeightM: number;
  maxThrustN: number;
  engineCount: number;
  engineKind: "piston" | "turbofan";
  spoolSeconds: number;
  cl0: number;
  clAlpha: number;
  clMax: number;
  cd0: number;
  inducedDrag: number;
  rotateKts: number;
  approachKts: number;
  cruiseKts: number;
  maxKts: number;
  ceilingFt: number;
  rangeNm: number;
  flapLift: number;
  flapDrag: number;
  gearDrag: number;
  controlPower: number;
  pitchResponse: number;
  rollResponse: number;
  yawResponse: number;
  maxSafeSinkMps: number;
  hardLandingMps: number;
  cockpitPosition: [number, number, number];
  cameraFov: number;
}

export interface WeatherSpec {
  id: WeatherId;
  label: string;
  description: string;
  windKts: number;
  windDirectionDeg: number;
  gustKts: number;
  visibilityM: number;
  cloudCover: number;
  rain: number;
  turbulence: number;
  runwayFriction: number;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
}

export interface Livery {
  name: string;
  primary: string;
  accent: string;
  metallic: number;
}

export interface FlightSetup {
  aircraftId: AircraftId;
  weatherId: WeatherId;
  timeId: TimeId;
  quality: QualityId;
  liveryIndex: number;
  callsign: string;
  fuelPercent: number;
  payloadPercent: number;
  assisted: boolean;
  tutorial: boolean;
  readyToTaxi: boolean;
}

export interface FlightControls {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  brake: number;
  parkingBrake: boolean;
  flaps: number;
  gearDown: boolean;
  reverse: boolean;
}

export interface AircraftSystems {
  battery: boolean;
  avionics: boolean;
  beacon: boolean;
  navLights: boolean;
  landingLights: boolean;
  engineMaster: boolean;
  enginesRunning: boolean;
  engineSpool: number;
  autopilot: boolean;
  apHeadingDeg: number;
  apAltitudeFt: number;
  masterWarning: string | null;
}

export interface FlightSnapshot {
  position: Vector3;
  velocity: Vector3;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  altitudeFt: number;
  radioAltitudeFt: number;
  airspeedKts: number;
  groundSpeedKts: number;
  verticalSpeedFpm: number;
  aoaDeg: number;
  mach: number;
  loadFactor: number;
  liftN: number;
  grounded: boolean;
  onRunway: boolean;
  phase: FlightPhase;
  stallRatio: number;
  overspeedRatio: number;
  distanceTravelledM: number;
  gForce: number;
}

export interface LandingReport {
  title: string;
  score: number;
  sinkRateFpm: number;
  centerlineOffsetM: number;
  speedErrorKts: number;
  bankDeg: number;
  grade: "excellent" | "good" | "firm" | "hard";
}

export interface TutorialStep {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  hint: string;
  target?: string;
  complete: (
    snapshot: FlightSnapshot,
    controls: FlightControls,
    systems: AircraftSystems,
  ) => boolean;
}

export interface WorldUpdate {
  elapsed: number;
  dt: number;
  aircraftPosition: Vector3;
  cameraPosition: Vector3;
  speedKts: number;
  engineSpool: number;
  crashed: boolean;
}
