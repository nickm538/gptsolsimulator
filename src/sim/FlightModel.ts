import {
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { AIRPORT } from "../data";
import type {
  AircraftSpec,
  AircraftSystems,
  FlightControls,
  FlightPhase,
  FlightSetup,
  FlightSnapshot,
  LandingReport,
  WeatherSpec,
} from "../types";
import {
  clamp,
  damp,
  DEG2RAD,
  KTS_TO_MPS,
  MPS_TO_FPM,
  MPS_TO_KTS,
  M_TO_FT,
  RAD2DEG,
  shortestAngleDegrees,
  smoothstep,
  terrainHeight,
  wrapDegrees,
  wrapRadians,
} from "./math";

const GRAVITY = 9.80665;
const RUNWAY_HALF_LENGTH = AIRPORT.runwayLengthM / 2;
const RUNWAY_HALF_WIDTH = AIRPORT.runwayWidthM / 2;

const tempForward = new Vector3();
const tempRight = new Vector3();
const tempUp = new Vector3();
const tempBackward = new Vector3();
const tempAirVelocity = new Vector3();
const tempForce = new Vector3();
const tempDrag = new Vector3();
const tempWind = new Vector3();
const tempMatrix = new Matrix4();

export class FlightModel {
  readonly controls: FlightControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    brake: 0,
    parkingBrake: true,
    flaps: 0,
    gearDown: true,
    reverse: false,
  };

  readonly systems: AircraftSystems = {
    battery: false,
    avionics: false,
    beacon: false,
    navLights: false,
    landingLights: false,
    engineMaster: false,
    enginesRunning: false,
    engineSpool: 0,
    autopilot: false,
    apHeadingDeg: 90,
    apAltitudeFt: 2_500,
    masterWarning: null,
  };

  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();

  private spec: AircraftSpec;
  private weather: WeatherSpec;
  private setup: FlightSetup;
  private yaw = -Math.PI / 2;
  private pitch = 0;
  private roll = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private yawRate = 0;
  private grounded = true;
  private phase: FlightPhase = "gate";
  private elapsed = 0;
  private distanceTravelledM = 0;
  private aoa = 0;
  private liftN = 0;
  private stallRatio = 0;
  private loadFactor = 1;
  private engineStartTimer = 0;
  private overspeedTimer = 0;
  private transientWarningTimer = 0;
  private gForce = 1;
  private previousVerticalVelocity = 0;
  private landingReport: LandingReport | null = null;
  private crashReason: string | null = null;
  private landedThisFlight = false;

  constructor(spec: AircraftSpec, weather: WeatherSpec, setup: FlightSetup) {
    this.spec = spec;
    this.weather = weather;
    this.setup = setup;
    this.resetAtGate(setup.readyToTaxi);
  }

  get aircraft(): AircraftSpec {
    return this.spec;
  }

  get currentPhase(): FlightPhase {
    return this.phase;
  }

  get reasonForCrash(): string | null {
    return this.crashReason;
  }

  setWeather(weather: WeatherSpec): void {
    this.weather = weather;
  }

  resetAtGate(readyToTaxi = false): void {
    this.position.set(-315, this.spec.gearHeightM, 1_310);
    this.velocity.set(0, 0, 0);
    this.yaw = -Math.PI / 2;
    this.pitch = 0;
    this.roll = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.grounded = true;
    this.phase = "gate";
    this.elapsed = 0;
    this.distanceTravelledM = 0;
    this.aoa = 0;
    this.liftN = 0;
    this.stallRatio = 0;
    this.engineStartTimer = 0;
    this.overspeedTimer = 0;
    this.transientWarningTimer = 0;
    this.previousVerticalVelocity = 0;
    this.landingReport = null;
    this.crashReason = null;
    this.landedThisFlight = false;

    this.controls.pitch = 0;
    this.controls.roll = 0;
    this.controls.yaw = 0;
    this.controls.throttle = 0;
    this.controls.brake = 0;
    this.controls.parkingBrake = true;
    this.controls.flaps = 0;
    this.controls.gearDown = true;
    this.controls.reverse = false;

    this.systems.battery = readyToTaxi;
    this.systems.avionics = readyToTaxi;
    this.systems.beacon = readyToTaxi;
    this.systems.navLights = readyToTaxi;
    this.systems.landingLights = false;
    this.systems.engineMaster = readyToTaxi;
    this.systems.enginesRunning = readyToTaxi;
    this.systems.engineSpool = readyToTaxi ? 0.08 : 0;
    this.systems.autopilot = false;
    this.systems.apHeadingDeg = 90;
    this.systems.apAltitudeFt = 2_500;
    this.systems.masterWarning = null;
    this.updateOrientation();
  }

  resetOnApproach(): void {
    const approachSpeed = this.spec.approachKts * KTS_TO_MPS;
    const glideAngle = 3 * DEG2RAD;
    const distanceFromThreshold = 3_800;
    const glideHeight = Math.tan(glideAngle) * distanceFromThreshold;
    const mass = this.getMassKg();
    const rho = 1.225 * Math.exp(-glideHeight / 8_500);
    const dynamicPressure = 0.5 * rho * approachSpeed * approachSpeed;
    const clRequired =
      (mass * GRAVITY * Math.cos(glideAngle)) /
      (dynamicPressure * this.spec.wingArea);
    const alphaTrim = clamp(
      (clRequired - (this.spec.cl0 + this.spec.flapLift)) /
        this.spec.clAlpha,
      -4 * DEG2RAD,
      8 * DEG2RAD,
    );
    const cd =
      this.spec.cd0 +
      this.spec.inducedDrag * clRequired * clRequired +
      this.spec.flapDrag +
      (this.spec.id === "cessna" ? 0 : this.spec.gearDrag);
    const drag = dynamicPressure * this.spec.wingArea * cd;
    const mach = approachSpeed / 340;
    const availableThrust =
      this.spec.maxThrustN *
      Math.pow(rho / 1.225, this.spec.engineKind === "piston" ? 0.8 : 0.7) *
      clamp(1 - mach * 0.3, 0.65, 1);
    const trimThrottle = clamp(
      (drag - mass * GRAVITY * Math.sin(glideAngle)) /
        Math.max(1, availableThrust),
      0.08,
      1,
    );
    this.position.set(
      0,
      glideHeight + this.spec.gearHeightM,
      RUNWAY_HALF_LENGTH + distanceFromThreshold,
    );
    this.velocity.set(
      0,
      -approachSpeed * Math.tan(glideAngle),
      -approachSpeed,
    );
    this.yaw = 0;
    this.pitch = -glideAngle + alphaTrim;
    this.roll = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.grounded = false;
    this.phase = "approach";
    this.aoa = alphaTrim;
    this.liftN = mass * GRAVITY * Math.cos(glideAngle);
    this.stallRatio = 0;
    this.loadFactor = Math.cos(glideAngle);
    this.gForce = 1;
    this.previousVerticalVelocity = this.velocity.y;
    this.distanceTravelledM = 0;
    this.engineStartTimer = 10;
    this.overspeedTimer = 0;
    this.crashReason = null;
    this.landingReport = null;
    this.landedThisFlight = false;
    this.transientWarningTimer = 0;
    this.controls.pitch = 0;
    this.controls.roll = 0;
    this.controls.yaw = 0;
    this.controls.throttle = trimThrottle;
    this.controls.brake = 0;
    this.controls.parkingBrake = false;
    this.controls.flaps = 3;
    this.controls.gearDown = true;
    this.controls.reverse = false;
    this.systems.battery = true;
    this.systems.avionics = true;
    this.systems.beacon = true;
    this.systems.navLights = true;
    this.systems.landingLights = true;
    this.systems.engineMaster = true;
    this.systems.enginesRunning = true;
    this.systems.engineSpool = this.controls.throttle;
    this.systems.autopilot = false;
    this.systems.apHeadingDeg = 0;
    this.systems.apAltitudeFt =
      Math.round(this.getAltitudeFt() / 100) * 100;
    this.systems.masterWarning = null;
    this.updateOrientation();
  }

  consumeLandingReport(): LandingReport | null {
    const report = this.landingReport;
    this.landingReport = null;
    return report;
  }

  toggleAutopilot(): boolean {
    if (
      this.grounded ||
      this.phase === "crashed" ||
      this.getAirspeedKts() < this.spec.approachKts * 0.8
    ) {
      this.systems.masterWarning = "AUTOPILOT UNAVAILABLE";
      this.transientWarningTimer = 3;
      return false;
    }
    this.systems.autopilot = !this.systems.autopilot;
    if (this.systems.autopilot) {
      this.systems.apHeadingDeg = this.getHeadingDeg();
      this.systems.apAltitudeFt = Math.round(this.getAltitudeFt() / 100) * 100;
    }
    return this.systems.autopilot;
  }

  adjustAutopilotHeading(delta: number): void {
    this.systems.apHeadingDeg = wrapDegrees(this.systems.apHeadingDeg + delta);
  }

  adjustAutopilotAltitude(delta: number): void {
    this.systems.apAltitudeFt = clamp(
      this.systems.apAltitudeFt + delta,
      AIRPORT.elevationFt + 500,
      this.spec.ceilingFt,
    );
  }

  step(dt: number, elapsed: number): FlightSnapshot {
    this.elapsed = elapsed;
    if (this.phase === "crashed") {
      this.velocity.multiplyScalar(Math.exp(-2.8 * dt));
      this.position.addScaledVector(this.velocity, dt);
      const floor = terrainHeight(this.position.x, this.position.z);
      this.position.y = Math.max(floor + this.spec.gearHeightM * 0.25, this.position.y);
      this.roll = damp(this.roll, clamp(this.roll, -0.7, 0.7), 2, dt);
      this.pitch = damp(this.pitch, -0.08, 2, dt);
      this.updateOrientation();
      return this.snapshot();
    }

    if (this.grounded && this.spec.id !== "cessna") {
      this.controls.gearDown = true;
    }
    this.updateSystems(dt);
    this.updateOrientation();
    this.getBasis(tempForward, tempRight, tempUp);
    this.getWind(elapsed, tempWind);

    tempAirVelocity.copy(this.velocity).sub(tempWind);
    const airspeed = tempAirVelocity.length();
    const forwardSpeed = tempAirVelocity.dot(tempForward);
    const verticalBodySpeed = tempAirVelocity.dot(tempUp);
    const sideSpeed = tempAirVelocity.dot(tempRight);
    const altitude = Math.max(0, this.position.y - terrainHeight(this.position.x, this.position.z));
    const rho = 1.225 * Math.exp(-altitude / 8_500);
    const dynamicPressure = 0.5 * rho * airspeed * airspeed;
    const mach = airspeed / Math.sqrt(1.4 * 287.05 * Math.max(216.65, 288.15 - 0.0065 * altitude));

    this.aoa = Math.atan2(-verticalBodySpeed, Math.max(1, forwardSpeed));
    const beta = Math.atan2(sideSpeed, Math.max(2, Math.abs(forwardSpeed)));
    const flap = this.controls.flaps / 3;
    const clBase = this.spec.cl0 + flap * this.spec.flapLift;
    const clMax = this.spec.clMax + flap * this.spec.flapLift * 0.65;
    const alphaCritical = Math.max(8 * DEG2RAD, (clMax - clBase) / this.spec.clAlpha);
    const stallTarget = smoothstep(alphaCritical * 0.92, alphaCritical + 9 * DEG2RAD, Math.abs(this.aoa));
    this.stallRatio = damp(this.stallRatio, stallTarget, 8, dt);

    const clLinear = clBase + this.spec.clAlpha * this.aoa;
    const clPlate = 1.05 * Math.sin(2 * clamp(this.aoa, -Math.PI / 2, Math.PI / 2));
    const cl = clamp(
      clLinear * (1 - this.stallRatio) + clPlate * this.stallRatio,
      -1.6,
      clMax,
    );
    const groundClearance = Math.max(0, altitude - this.spec.gearHeightM);
    const groundEffect = 1 - 0.45 * Math.exp((-4 * groundClearance) / this.spec.spanM);
    const cd =
      this.spec.cd0 +
      this.spec.inducedDrag * cl * cl * groundEffect +
      flap * flap * this.spec.flapDrag +
      (this.controls.gearDown && this.spec.id !== "cessna" ? this.spec.gearDrag : 0) +
      this.stallRatio * 0.28;

    this.liftN = dynamicPressure * this.spec.wingArea * cl;
    const dragN = dynamicPressure * this.spec.wingArea * cd;
    const mass = this.getMassKg();
    this.loadFactor = clamp(this.liftN / Math.max(1, mass * GRAVITY), -2, 6);

    let thrustN =
      this.systems.engineSpool *
      this.spec.maxThrustN *
      Math.pow(rho / 1.225, this.spec.engineKind === "piston" ? 0.8 : 0.7) *
      clamp(1 - mach * 0.3, 0.65, 1);
    if (this.controls.reverse && this.grounded && this.spec.engineKind === "turbofan") {
      thrustN *= -0.32;
    }

    tempForce.copy(tempForward).multiplyScalar(thrustN);
    tempForce.addScaledVector(tempUp, this.liftN);
    tempForce.addScaledVector(tempRight, -beta * dynamicPressure * this.spec.wingArea * 0.35);
    if (airspeed > 0.1) {
      tempDrag.copy(tempAirVelocity).normalize().multiplyScalar(-dragN);
      tempForce.add(tempDrag);
    }
    tempForce.y -= mass * GRAVITY;

    this.updateRotation(
      dt,
      dynamicPressure,
      forwardSpeed,
      beta,
      alphaCritical,
    );
    this.updateOrientation();
    this.getBasis(tempForward, tempRight, tempUp);

    const acceleration = tempForce.multiplyScalar(1 / mass);
    const previousPosition = this.position.clone();
    this.previousVerticalVelocity = this.velocity.y;

    if (this.grounded) {
      this.updateGroundMotion(dt, acceleration, forwardSpeed, rho);
    } else {
      this.velocity.addScaledVector(acceleration, dt);
      this.applyTurbulence(dt, elapsed, airspeed);
      this.position.addScaledVector(this.velocity, dt);
    }

    this.distanceTravelledM += this.position.distanceTo(previousPosition);
    this.resolveGroundContact(dt);
    this.updatePhase();
    this.updateWarnings(dt, mach);

    this.gForce = damp(
      this.gForce,
      clamp(this.loadFactor + acceleration.y / GRAVITY, -2.5, 6),
      5,
      dt,
    );
    return this.snapshot();
  }

  snapshot(): FlightSnapshot {
    const terrain = terrainHeight(this.position.x, this.position.z);
    const radioAltitudeM = Math.max(
      0,
      this.position.y - terrain - this.spec.gearHeightM,
    );
    return {
      position: this.position,
      velocity: this.velocity,
      headingDeg: this.getHeadingDeg(),
      pitchDeg: this.pitch * RAD2DEG,
      rollDeg: this.roll * RAD2DEG,
      altitudeFt: this.getAltitudeFt(),
      radioAltitudeFt: radioAltitudeM * M_TO_FT,
      airspeedKts: this.getAirspeedKts(),
      groundSpeedKts: Math.hypot(this.velocity.x, this.velocity.z) * MPS_TO_KTS,
      verticalSpeedFpm: this.velocity.y * MPS_TO_FPM,
      aoaDeg: this.aoa * RAD2DEG,
      mach: this.getAirspeedKts() * KTS_TO_MPS / 340,
      loadFactor: this.loadFactor,
      liftN: this.liftN,
      grounded: this.grounded,
      onRunway: this.isOnRunway(),
      phase: this.phase,
      stallRatio: this.stallRatio,
      overspeedRatio: this.getAirspeedKts() / this.spec.maxKts,
      distanceTravelledM: this.distanceTravelledM,
      gForce: this.gForce,
    };
  }

  private updateSystems(dt: number): void {
    if (this.systems.engineMaster && this.systems.battery) {
      this.engineStartTimer += dt;
      if (this.engineStartTimer > (this.spec.engineKind === "piston" ? 0.7 : 2.4)) {
        this.systems.enginesRunning = true;
      }
    } else {
      this.engineStartTimer = 0;
      this.systems.enginesRunning = false;
    }

    const idle = this.systems.enginesRunning ? 0.075 : 0;
    const target = this.systems.enginesRunning
      ? Math.max(idle, this.controls.throttle)
      : 0;
    this.systems.engineSpool = damp(
      this.systems.engineSpool,
      target,
      1 / this.spec.spoolSeconds,
      dt,
    );

    if (!this.systems.battery) {
      this.systems.avionics = false;
      this.systems.autopilot = false;
    }
    if (!this.systems.enginesRunning) this.systems.autopilot = false;
  }

  private updateRotation(
    dt: number,
    dynamicPressure: number,
    forwardSpeed: number,
    beta: number,
    alphaCritical: number,
  ): void {
    let pitchControl = this.controls.pitch;
    let rollControl = this.controls.roll;
    let yawControl = this.controls.yaw;

    if (this.systems.autopilot && !this.grounded) {
      const headingError =
        shortestAngleDegrees(this.getHeadingDeg(), this.systems.apHeadingDeg) *
        DEG2RAD;
      const targetRoll = clamp(headingError * 0.6, -25 * DEG2RAD, 25 * DEG2RAD);
      const altitudeError = this.systems.apAltitudeFt - this.getAltitudeFt();
      const targetPitch = clamp(
        altitudeError * 0.0022 * DEG2RAD - this.velocity.y * 0.018,
        -8 * DEG2RAD,
        14 * DEG2RAD,
      );
      rollControl = clamp((targetRoll - this.roll) * 2.7 - this.rollRate * 1.1, -1, 1);
      pitchControl = clamp(
        (targetPitch - this.pitch) * 2.8 - this.pitchRate * 1.25,
        -1,
        1,
      );
      yawControl = clamp(-beta * 3, -0.35, 0.35);
    }

    const referencePressure =
      0.5 * 1.225 * Math.pow(this.spec.rotateKts * KTS_TO_MPS, 2);
    const authority = clamp(dynamicPressure / Math.max(1, referencePressure), 0.08, 1.45);
    const stallAuthority = 1 - this.stallRatio * 0.62;
    const highSpeedScale = clamp(
      Math.sqrt((referencePressure * 3.2) / Math.max(referencePressure * 3.2, dynamicPressure)),
      0.38,
      1,
    );
    const effective = authority * stallAuthority * highSpeedScale * this.spec.controlPower;

    const trimAlpha = clamp(
      (this.getMassKg() * GRAVITY / Math.max(1, dynamicPressure * this.spec.wingArea) -
        (this.spec.cl0 + (this.controls.flaps / 3) * this.spec.flapLift)) /
        this.spec.clAlpha,
      -3 * DEG2RAD,
      alphaCritical * 0.72,
    );

    const pitchAcceleration =
      pitchControl * this.spec.pitchResponse * effective -
      this.pitchRate * (1.65 + authority * 0.6) -
      (this.aoa - trimAlpha) * (0.34 + authority * 0.22) -
      this.stallRatio * Math.sign(this.aoa || 1) * 0.28;
    const rollAcceleration =
      rollControl * this.spec.rollResponse * effective -
      this.rollRate * (1.8 + authority * 0.55) -
      beta * 0.18;

    this.pitchRate += pitchAcceleration * dt;
    this.rollRate += rollAcceleration * dt;

    if (this.setup.assisted && Math.abs(this.controls.roll) < 0.06 && !this.systems.autopilot) {
      this.rollRate += -this.roll * 0.38 * dt;
    }
    if (this.setup.assisted && Math.abs(this.controls.pitch) < 0.06 && !this.systems.autopilot) {
      this.pitchRate += -this.pitch * 0.07 * dt;
    }

    if (this.grounded) {
      const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const steeringFade = 1 - smoothstep(8, 34, groundSpeed);
      const steeringRate =
        -yawControl *
        (this.spec.id === "cessna" ? 0.48 : 0.38) *
        steeringFade *
        smoothstep(0.25, 3.5, groundSpeed);
      this.yawRate = damp(this.yawRate, steeringRate, 6, dt);
      this.rollRate = damp(this.rollRate, 0, 9, dt);
      this.roll = damp(this.roll, 0, 12, dt);

      const canRotate =
        forwardSpeed > this.spec.rotateKts * KTS_TO_MPS * 0.68 &&
        this.liftN > this.getMassKg() * GRAVITY * 0.42;
      if (!canRotate) {
        this.pitchRate = damp(this.pitchRate, 0, 10, dt);
        this.pitch = damp(this.pitch, 0, 12, dt);
      }
    } else {
      const coordinatedYaw =
        -GRAVITY * Math.tan(clamp(this.roll, -1.15, 1.15)) / Math.max(18, Math.abs(forwardSpeed));
      const rudderYaw = -yawControl * this.spec.yawResponse * effective * 0.55;
      this.yawRate = damp(this.yawRate, coordinatedYaw + rudderYaw - beta * 0.42, 3.2, dt);
    }

    this.pitchRate = clamp(this.pitchRate, -1.2, 1.2);
    this.rollRate = clamp(this.rollRate, -1.8, 1.8);
    this.yawRate = clamp(this.yawRate, -0.9, 0.9);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -78 * DEG2RAD, 78 * DEG2RAD);
    this.roll = wrapRadians(this.roll + this.rollRate * dt);
    this.yaw = wrapRadians(this.yaw + this.yawRate * dt);

    if (this.setup.assisted) {
      this.roll = clamp(this.roll, -82 * DEG2RAD, 82 * DEG2RAD);
    }
  }

  private updateGroundMotion(
    dt: number,
    acceleration: Vector3,
    forwardSpeed: number,
    rho: number,
  ): void {
    const floor = terrainHeight(this.position.x, this.position.z);
    const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const mass = this.getMassKg();
    const weightOnWheels = clamp(
      1 - this.liftN / Math.max(1, mass * GRAVITY),
      0.05,
      1,
    );
    const brakeAmount = Math.max(
      this.controls.brake,
      this.controls.parkingBrake ? 1 : 0,
    );
    const rollingDecel = 0.14 + brakeAmount * 8.2 * this.weather.runwayFriction;

    acceleration.y = 0;
    this.velocity.addScaledVector(acceleration, dt);
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizontalSpeed > 0.01) {
      const decel = Math.min(
        horizontalSpeed,
        rollingDecel * weightOnWheels * dt,
      );
      this.velocity.x -= (this.velocity.x / horizontalSpeed) * decel;
      this.velocity.z -= (this.velocity.z / horizontalSpeed) * decel;
    }

    if (
      this.controls.parkingBrake &&
      this.controls.throttle < 0.28 &&
      groundSpeed < 0.5
    ) {
      this.velocity.x = damp(this.velocity.x, 0, 18, dt);
      this.velocity.z = damp(this.velocity.z, 0, 18, dt);
    }

    const lateralSpeed = this.velocity.dot(tempRight);
    this.velocity.addScaledVector(
      tempRight,
      -lateralSpeed * Math.min(1, dt * 3.5 * this.weather.runwayFriction),
    );

    this.position.addScaledVector(this.velocity, dt);
    this.position.y = floor + this.spec.gearHeightM;
    this.velocity.y = 0;

    const liftoffSpeed = this.spec.rotateKts * KTS_TO_MPS * 0.83;
    if (
      forwardSpeed > liftoffSpeed &&
      this.pitch > 2.2 * DEG2RAD &&
      this.liftN > mass * GRAVITY * 0.72
    ) {
      this.grounded = false;
      this.velocity.y = Math.max(0.8, forwardSpeed * Math.sin(this.pitch) * 0.4);
      this.phase = "airborne";
    }

    void rho; // consumed to satisfy noUnusedParameters in strict builds
  }

  private applyTurbulence(dt: number, elapsed: number, airspeed: number): void {
    const intensity = this.weather.turbulence;
    if (intensity <= 0 || airspeed < 15) return;
    const gust =
      (Math.sin(elapsed * 1.73) +
        Math.sin(elapsed * 3.91 + 1.4) * 0.45 +
        Math.sin(elapsed * 8.17 + 4.2) * 0.16) *
      intensity;
    this.velocity.y += gust * dt * 2.4;
    this.rollRate +=
      Math.sin(elapsed * 2.31 + 0.7) * intensity * dt * 0.18;
    this.yawRate += Math.sin(elapsed * 1.19) * intensity * dt * 0.045;
  }

  private resolveGroundContact(dt: number): void {
    if (this.grounded) return;
    const floor = terrainHeight(this.position.x, this.position.z);
    const gearClearance = this.controls.gearDown
      ? this.spec.gearHeightM
      : this.spec.gearHeightM * 0.22;
    if (this.position.y > floor + gearClearance) return;
    if (this.velocity.y > 0.05) {
      // The first airborne frame begins at fully extended strut height. Let an
      // upward-moving aircraft unload the gear instead of counting it as an
      // immediate touchdown.
      this.position.y = floor + gearClearance + 0.015;
      return;
    }

    const touchdownSink = Math.max(0, -this.previousVerticalVelocity);
    const bankDeg = Math.abs(this.roll * RAD2DEG);
    const onRunway = this.isOnRunway();
    const gearSafe = this.controls.gearDown || this.spec.id === "cessna";
    const structuralStrike = !gearSafe || bankDeg > 17 || Math.abs(this.pitch * RAD2DEG) > 17;
    const offFieldPenalty = onRunway ? 1 : this.spec.id === "cessna" ? 1.22 : 0.72;
    const crashLimit = this.spec.hardLandingMps * offFieldPenalty;

    this.position.y = floor + gearClearance;
    if (structuralStrike || touchdownSink > crashLimit) {
      this.crash(
        !gearSafe
          ? "GEAR-UP LANDING"
          : structuralStrike
            ? "STRUCTURAL GROUND CONTACT"
            : "EXCESSIVE TOUCHDOWN LOAD",
      );
      return;
    }

    if (touchdownSink > this.spec.maxSafeSinkMps) {
      this.velocity.y = touchdownSink * 0.18;
      this.pitchRate *= 0.45;
      this.systems.masterWarning = "HARD LANDING";
      this.transientWarningTimer = 4;
    } else {
      this.velocity.y = 0;
      this.grounded = true;
      this.pitchRate = 0;
      this.rollRate *= 0.25;
      this.roll *= 0.35;
      this.phase = "rollout";
      if (!this.landedThisFlight) {
        this.landedThisFlight = true;
        this.landingReport = this.gradeLanding(touchdownSink);
      }
    }

    if (dt < 0) this.velocity.y = 0;
  }

  private updatePhase(): void {
    if (this.phase === "crashed") return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z) * MPS_TO_KTS;
    if (this.grounded) {
      if (this.landedThisFlight) {
        this.phase = "rollout";
      } else if (speed > 2 || !this.controls.parkingBrake) {
        this.phase =
          this.isOnRunway() && this.controls.throttle > 0.72
            ? "takeoff"
            : "taxi";
      } else {
        this.phase = "gate";
      }
      return;
    }

    const radioAltitude =
      this.position.y -
      terrainHeight(this.position.x, this.position.z) -
      this.spec.gearHeightM;
    const approaching =
      this.position.z > RUNWAY_HALF_LENGTH &&
      Math.abs(this.position.x) < 350 &&
      Math.abs(shortestAngleDegrees(this.getHeadingDeg(), 0)) < 35 &&
      this.velocity.y < 1 &&
      radioAltitude < 750;
    this.phase = approaching ? "approach" : "airborne";
  }

  private updateWarnings(dt: number, mach: number): void {
    this.transientWarningTimer = Math.max(
      0,
      this.transientWarningTimer - dt,
    );
    const airspeed = this.getAirspeedKts();
    const overspeed = airspeed > this.spec.maxKts || mach > 0.84;
    this.overspeedTimer = overspeed
      ? this.overspeedTimer + dt
      : Math.max(0, this.overspeedTimer - dt * 2);

    if (this.overspeedTimer > 7) {
      this.crash("AIRFRAME OVERSPEED");
      return;
    }

    if (this.stallRatio > 0.52 && !this.grounded) {
      this.systems.masterWarning = "STALL · LOWER NOSE";
      if (this.systems.autopilot) this.systems.autopilot = false;
    } else if (overspeed) {
      this.systems.masterWarning = "OVERSPEED";
    } else if (
      !this.controls.gearDown &&
      this.position.y - terrainHeight(this.position.x, this.position.z) < 160 &&
      this.velocity.y < -1
    ) {
      this.systems.masterWarning = "TOO LOW · GEAR";
    } else if (this.transientWarningTimer <= 0) {
      this.systems.masterWarning = null;
    }
  }

  private gradeLanding(sinkMps: number): LandingReport {
    const sinkRateFpm = sinkMps * MPS_TO_FPM;
    const centerlineOffsetM = Math.abs(this.position.x);
    const speedErrorKts = Math.abs(this.getAirspeedKts() - this.spec.approachKts);
    const bankDeg = Math.abs(this.roll * RAD2DEG);
    const sinkScore = clamp(100 - Math.max(0, sinkRateFpm - 80) * 0.16, 0, 100);
    const centerScore = clamp(100 - centerlineOffsetM * 4.2, 0, 100);
    const speedScore = clamp(100 - speedErrorKts * 3, 0, 100);
    const bankScore = clamp(100 - bankDeg * 10, 0, 100);
    const score = Math.round(
      sinkScore * 0.46 + centerScore * 0.24 + speedScore * 0.18 + bankScore * 0.12,
    );
    const grade =
      score >= 90
        ? "excellent"
        : score >= 75
          ? "good"
          : score >= 55
            ? "firm"
            : "hard";
    return {
      title:
        grade === "excellent"
          ? "Butter landing"
          : grade === "good"
            ? "Runway made"
            : grade === "firm"
              ? "Positive arrival"
              : "Hard landing",
      score,
      sinkRateFpm: Math.round(sinkRateFpm),
      centerlineOffsetM,
      speedErrorKts,
      bankDeg,
      grade,
    };
  }

  private crash(reason: string): void {
    this.phase = "crashed";
    this.crashReason = reason;
    this.systems.autopilot = false;
    this.systems.masterWarning = reason;
    this.controls.throttle = 0;
    this.controls.reverse = false;
    this.velocity.multiplyScalar(0.38);
    this.velocity.y = Math.max(0, this.velocity.y);
  }

  private getMassKg(): number {
    const fuelFactor = 0.82 + this.setup.fuelPercent * 0.0012;
    const payloadFactor = 0.88 + this.setup.payloadPercent * 0.0012;
    return this.spec.massKg * fuelFactor * payloadFactor;
  }

  private getWind(elapsed: number, target: Vector3): Vector3 {
    const toward = (this.weather.windDirectionDeg + 180) * DEG2RAD;
    const gust =
      (Math.sin(elapsed * 0.37) + Math.sin(elapsed * 1.13 + 2.1) * 0.42) *
      this.weather.gustKts *
      KTS_TO_MPS;
    const speed = this.weather.windKts * KTS_TO_MPS + gust;
    target.set(Math.sin(toward) * speed, 0, -Math.cos(toward) * speed);
    return target;
  }

  private getBasis(forward: Vector3, right: Vector3, up: Vector3): void {
    const cosPitch = Math.cos(this.pitch);
    forward.set(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    up.crossVectors(right, forward).normalize();
    right
      .multiplyScalar(Math.cos(this.roll))
      .addScaledVector(up, -Math.sin(this.roll))
      .normalize();
    up.crossVectors(right, forward).normalize();
  }

  private updateOrientation(): void {
    this.getBasis(tempForward, tempRight, tempUp);
    tempBackward.copy(tempForward).multiplyScalar(-1);
    tempMatrix.makeBasis(tempRight, tempUp, tempBackward);
    this.orientation.setFromRotationMatrix(tempMatrix).normalize();
  }

  private getAirspeedKts(): number {
    this.getWind(this.elapsed, tempWind);
    return tempAirVelocity
      .copy(this.velocity)
      .sub(tempWind)
      .length() * MPS_TO_KTS;
  }

  private getHeadingDeg(): number {
    return wrapDegrees(-this.yaw * RAD2DEG);
  }

  private getAltitudeFt(): number {
    return AIRPORT.elevationFt + Math.max(0, this.position.y) * M_TO_FT;
  }

  private isOnRunway(): boolean {
    return (
      Math.abs(this.position.x) <= RUNWAY_HALF_WIDTH &&
      Math.abs(this.position.z) <= RUNWAY_HALF_LENGTH
    );
  }
}
