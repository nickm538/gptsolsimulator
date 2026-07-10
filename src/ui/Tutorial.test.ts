import { describe, expect, it } from "vitest";
import { AIRCRAFT, DEFAULT_SETUP, WEATHER } from "../data";
import { FlightModel } from "../sim/FlightModel";
import { TutorialDirector } from "./Tutorial";

describe("TutorialDirector", () => {
  it("provides a complete gate-to-flight lesson for every aircraft", () => {
    for (const spec of Object.values(AIRCRAFT)) {
      const tutorial = new TutorialDirector(spec, true);
      expect(tutorial.steps.length).toBeGreaterThanOrEqual(12);
      expect(tutorial.current.id).toBe("welcome");
      expect(tutorial.steps.at(-1)?.id).toBe("complete");
      expect(tutorial.steps.every((step) => step.hint.length > 0)).toBe(true);
    }
  });

  it("advances after a required condition remains satisfied", () => {
    const tutorial = new TutorialDirector(AIRCRAFT.cessna, true);
    const model = new FlightModel(
      AIRCRAFT.cessna,
      WEATHER.clear,
      { ...DEFAULT_SETUP, readyToTaxi: true },
    );
    tutorial.advance();
    expect(tutorial.current.id).toBe("battery");

    const snapshot = model.snapshot();
    expect(
      tutorial.update(0.3, snapshot, model.controls, model.systems),
    ).toBe(false);
    expect(
      tutorial.update(0.3, snapshot, model.controls, model.systems),
    ).toBe(true);
    expect(tutorial.current.id).toBe("avionics");
  });

  it("can be disabled for uninterrupted free flight", () => {
    const tutorial = new TutorialDirector(AIRCRAFT.max9, false);
    expect(tutorial.active).toBe(false);
    tutorial.skip();
    expect(tutorial.active).toBe(false);
  });

  it("loads the approach lesson with an approach checkpoint", () => {
    const tutorial = new TutorialDirector(AIRCRAFT.learjet, true);
    tutorial.jumpTo("approach-config");
    expect(tutorial.current.id).toBe("approach-config");
    expect(tutorial.steps.some((step) => step.id === "flare")).toBe(true);
    expect(tutorial.steps.some((step) => step.id === "rollout")).toBe(true);
  });
});
