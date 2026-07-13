import { describe, expect, it } from "vitest";
import { AIRCRAFT, DEFAULT_SETUP, WEATHER } from "../data";
import { FlightModel } from "./FlightModel";

function run(model: FlightModel, seconds: number): void {
  const dt = 1 / 120;
  const frames = Math.round(seconds / dt);
  for (let frame = 0; frame < frames; frame += 1) {
    model.step(dt, frame * dt);
  }
}

describe("FlightModel", () => {
  it.each(["cessna", "learjet", "max9"] as const)(
    "initializes %s safely at gate C12",
    (aircraftId) => {
      const setup = {
        ...DEFAULT_SETUP,
        aircraftId,
        readyToTaxi: false,
      };
      const model = new FlightModel(
        AIRCRAFT[aircraftId],
        WEATHER.clear,
        setup,
      );
      const snapshot = model.snapshot();

      expect(snapshot.phase).toBe("gate");
      expect(snapshot.grounded).toBe(true);
      expect(snapshot.headingDeg).toBeCloseTo(90, 5);
      expect(snapshot.position.x).toBeCloseTo(-315, 5);
      expect(snapshot.position.z).toBeCloseTo(1_310, 5);
      expect(snapshot.airspeedKts).toBeGreaterThan(0);
      expect(model.systems.enginesRunning).toBe(false);
    },
  );

  it("starts, releases brakes, and taxis under engine power", () => {
    const setup = {
      ...DEFAULT_SETUP,
      readyToTaxi: true,
    };
    const model = new FlightModel(AIRCRAFT.cessna, WEATHER.clear, setup);
    model.controls.parkingBrake = false;
    model.controls.throttle = 0.38;
    run(model, 8);
    const snapshot = model.snapshot();

    expect(model.systems.enginesRunning).toBe(true);
    expect(snapshot.distanceTravelledM).toBeGreaterThan(5);
    expect(snapshot.groundSpeedKts).toBeGreaterThan(2);
    expect(snapshot.phase).toBe("taxi");
    expect(Number.isFinite(snapshot.airspeedKts)).toBe(true);
  });

  it.each(["cessna", "learjet", "max9"] as const)(
    "accelerates, rotates, and lifts off in the %s",
    (aircraftId) => {
      const spec = AIRCRAFT[aircraftId];
      const model = new FlightModel(
        spec,
        WEATHER.clear,
        {
          ...DEFAULT_SETUP,
          aircraftId,
          readyToTaxi: true,
        },
      );
      model.position.set(0, spec.gearHeightM, 1_450);
      (model as unknown as { yaw: number }).yaw = 0;
      model.controls.parkingBrake = false;
      model.controls.flaps = 1;
      model.controls.throttle = 1;

      const dt = 1 / 120;
      let departed = false;
      for (let frame = 0; frame < 120 * 45; frame += 1) {
        const before = model.snapshot();
        model.controls.pitch = !before.grounded
          ? 0.16
          : before.airspeedKts > spec.rotateKts * 0.78
            ? 0.58
            : 0;
        const after = model.step(dt, frame * dt);
        if (!after.grounded && after.radioAltitudeFt > 10) {
          departed = true;
          break;
        }
      }

      const snapshot = model.snapshot();
      expect(
        departed,
        `${aircraftId} failed to depart: ${JSON.stringify({
          speed: snapshot.airspeedKts,
          groundSpeed: snapshot.groundSpeedKts,
          pitch: snapshot.pitchDeg,
          lift: snapshot.liftN,
          phase: snapshot.phase,
          position: snapshot.position.toArray(),
        })}`,
      ).toBe(true);
      expect(snapshot.phase).toBe("airborne");
      expect(snapshot.position.z).toBeLessThan(1_450);
      expect(snapshot.airspeedKts).toBeGreaterThan(spec.rotateKts * 0.75);
    },
  );

  it("loads a stable final-approach checkpoint", () => {
    const setup = {
      ...DEFAULT_SETUP,
      aircraftId: "learjet" as const,
    };
    const model = new FlightModel(AIRCRAFT.learjet, WEATHER.overcast, setup);
    model.resetOnApproach();
    const initial = model.snapshot();

    expect(initial.phase).toBe("approach");
    expect(initial.grounded).toBe(false);
    expect(initial.airspeedKts).toBeGreaterThan(90);
    expect(
      Math.atan2(
        initial.position.y - AIRCRAFT.learjet.gearHeightM,
        initial.position.z - 1_800,
      ) *
        (180 / Math.PI),
    ).toBeCloseTo(3, 5);
    expect(
      Math.atan2(-model.velocity.y, Math.abs(model.velocity.z)) *
        (180 / Math.PI),
    ).toBeCloseTo(3, 5);
    expect(model.controls.flaps).toBe(3);
    expect(model.controls.gearDown).toBe(true);
    expect(model.toggleAutopilot()).toBe(true);

    run(model, 2);
    const after = model.snapshot();
    expect(Number.isFinite(after.altitudeFt)).toBe(true);
    expect(Number.isFinite(after.pitchDeg)).toBe(true);
    expect(Number.isFinite(after.rollDeg)).toBe(true);
    expect(after.phase).not.toBe("crashed");
  });

  it.each(["cessna", "learjet", "max9"] as const)(
    "holds a flyable uncommanded three-degree approach in the %s",
    (aircraftId) => {
      const spec = AIRCRAFT[aircraftId];
      const model = new FlightModel(
        spec,
        WEATHER.clear,
        { ...DEFAULT_SETUP, aircraftId },
      );
      model.resetOnApproach();
      const initial = model.snapshot();
      const initialAltitudeM = initial.position.y;
      const initialDistanceZ = initial.position.z;
      const initialSpeedKts = initial.airspeedKts;
      run(model, 12);
      const after = model.snapshot();
      const distanceFlownM = initialDistanceZ - after.position.z;
      const expectedAltitudeM =
        initialAltitudeM - distanceFlownM * Math.tan((3 * Math.PI) / 180);

      expect(after.phase).toBe("approach");
      expect(after.position.y).toBeLessThan(initialAltitudeM);
      expect(Math.abs(after.position.y - expectedAltitudeM)).toBeLessThan(18);
      expect(after.airspeedKts).toBeGreaterThan(initialSpeedKts * 0.82);
      expect(after.airspeedKts).toBeLessThan(initialSpeedKts * 1.18);
      expect(after.verticalSpeedFpm).toBeLessThan(-150);
      expect(after.verticalSpeedFpm).toBeGreaterThan(-1_400);
    },
  );

  it("rejects autopilot engagement while on the ground", () => {
    const model = new FlightModel(
      AIRCRAFT.max9,
      WEATHER.clear,
      { ...DEFAULT_SETUP, aircraftId: "max9", readyToTaxi: true },
    );
    expect(model.toggleAutopilot()).toBe(false);
    expect(model.systems.autopilot).toBe(false);
    expect(model.systems.masterWarning).toContain("AUTOPILOT");
    run(model, 3.5);
    expect(model.systems.masterWarning).toBeNull();
  });

  it("keeps retractable gear down while weight is on wheels", () => {
    const model = new FlightModel(
      AIRCRAFT.max9,
      WEATHER.clear,
      { ...DEFAULT_SETUP, aircraftId: "max9", readyToTaxi: true },
    );
    model.controls.gearDown = false;
    model.step(1 / 120, 0);
    expect(model.controls.gearDown).toBe(true);
  });
});
