import type { FlightControls } from "../types";
import { clamp, damp, moveToward } from "./math";

export interface InputActions {
  onCamera(): void;
  onMap(): void;
  onPause(): void;
  onGear(): void;
  onFlaps(delta: number): void;
  onAutopilot(): void;
  onReverse(): void;
  onParkingBrake(): void;
  onInteract(): void;
}

export class InputController {
  private readonly pressed = new Set<string>();
  private readonly controls: FlightControls;
  private readonly actions: InputActions;
  private touchPitch = 0;
  private touchRoll = 0;
  private touchYaw = 0;
  private touchBrake = 0;
  private gamepadConnected = false;

  constructor(controls: FlightControls, actions: InputActions) {
    this.controls = controls;
    this.actions = actions;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.clear);
    window.addEventListener("gamepadconnected", this.onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
    window.removeEventListener("gamepadconnected", this.onGamepadConnected);
    window.removeEventListener("gamepaddisconnected", this.onGamepadDisconnected);
  }

  reset(): void {
    this.clear();
  }

  update(dt: number): void {
    const keyboardRoll =
      (this.pressed.has("KeyD") || this.pressed.has("ArrowRight") ? 1 : 0) -
      (this.pressed.has("KeyA") || this.pressed.has("ArrowLeft") ? 1 : 0);
    const keyboardPitch =
      (this.pressed.has("KeyS") || this.pressed.has("ArrowDown") ? 1 : 0) -
      (this.pressed.has("KeyW") || this.pressed.has("ArrowUp") ? 1 : 0);
    const keyboardYaw =
      (this.pressed.has("KeyE") ? 1 : 0) -
      (this.pressed.has("KeyQ") ? 1 : 0);

    let roll = Math.abs(this.touchRoll) > 0.02 ? this.touchRoll : keyboardRoll;
    let pitch = Math.abs(this.touchPitch) > 0.02 ? this.touchPitch : keyboardPitch;
    let yaw = Math.abs(this.touchYaw) > 0.02 ? this.touchYaw : keyboardYaw;
    let gamepadBrake = 0;

    if (this.gamepadConnected) {
      const gamepad = navigator.getGamepads().find(Boolean);
      if (gamepad) {
        const gamepadRoll = this.shapeAxis(gamepad.axes[0] ?? 0);
        const gamepadPitch = this.shapeAxis(gamepad.axes[1] ?? 0);
        const gamepadYaw = this.shapeAxis(gamepad.axes[2] ?? 0);
        if (Math.abs(gamepadRoll) > 0.02) roll = gamepadRoll;
        if (Math.abs(gamepadPitch) > 0.02) pitch = gamepadPitch;
        if (Math.abs(gamepadYaw) > 0.02) yaw = gamepadYaw;
        const throttleAxis = gamepad.axes[3];
        if (typeof throttleAxis === "number" && Math.abs(throttleAxis) > 0.08) {
          this.controls.throttle = clamp((1 - throttleAxis) * 0.5, 0, 1);
        }
        gamepadBrake = gamepad.buttons[0]?.pressed ? 1 : 0;
      }
    }

    this.controls.roll = damp(this.controls.roll, clamp(roll, -1, 1), 9, dt);
    this.controls.pitch = damp(this.controls.pitch, clamp(pitch, -1, 1), 8, dt);
    this.controls.yaw = damp(this.controls.yaw, clamp(yaw, -1, 1), 7, dt);
    this.controls.brake = Math.max(
      this.touchBrake,
      this.pressed.has("Space") ? 1 : gamepadBrake,
    );

    const throttleRate = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight")
      ? 0.38
      : this.pressed.has("ControlLeft") || this.pressed.has("ControlRight")
        ? -0.38
        : 0;
    if (throttleRate !== 0) {
      this.controls.throttle = clamp(
        this.controls.throttle + throttleRate * dt,
        0,
        1,
      );
    }
  }

  setTouchStick(x: number, y: number): void {
    this.touchRoll = this.shapeAxis(x);
    this.touchPitch = this.shapeAxis(y);
  }

  clearTouchStick(): void {
    this.touchRoll = 0;
    this.touchPitch = 0;
  }

  setTouchYaw(value: number): void {
    this.touchYaw = clamp(value, -1, 1);
  }

  setTouchBrake(value: number): void {
    this.touchBrake = clamp(value, 0, 1);
  }

  setThrottle(value: number): void {
    this.controls.throttle = clamp(value, 0, 1);
  }

  nudgeThrottle(delta: number): void {
    this.controls.throttle = moveToward(
      this.controls.throttle,
      delta > 0 ? 1 : 0,
      Math.abs(delta),
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const focusedControl =
      event.target instanceof Element
        ? event.target.closest(
            "button, a, input, select, textarea, [role='button']",
          )
        : null;
    if (focusedControl) {
      return;
    }
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
      ].includes(event.code)
    ) {
      event.preventDefault();
    }
    this.pressed.add(event.code);
    if (event.repeat) return;

    switch (event.code) {
      case "KeyC":
        this.actions.onCamera();
        break;
      case "KeyM":
        this.actions.onMap();
        break;
      case "Escape":
        this.actions.onPause();
        break;
      case "KeyG":
        this.actions.onGear();
        break;
      case "KeyF":
        this.actions.onFlaps(event.shiftKey ? -1 : 1);
        break;
      case "KeyP":
        this.actions.onAutopilot();
        break;
      case "KeyR":
        this.actions.onReverse();
        break;
      case "KeyB":
        this.actions.onParkingBrake();
        break;
      case "Enter":
        this.actions.onInteract();
        break;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.touchPitch = 0;
    this.touchRoll = 0;
    this.touchYaw = 0;
    this.touchBrake = 0;
    this.controls.pitch = 0;
    this.controls.roll = 0;
    this.controls.yaw = 0;
    this.controls.brake = 0;
  };

  private readonly onGamepadConnected = (): void => {
    this.gamepadConnected = true;
  };

  private readonly onGamepadDisconnected = (): void => {
    this.gamepadConnected = navigator.getGamepads().some(Boolean);
  };

  private shapeAxis(value: number): number {
    const deadzone = 0.07;
    const magnitude = Math.max(0, (Math.abs(value) - deadzone) / (1 - deadzone));
    return Math.sign(value) * (magnitude * 0.72 + magnitude ** 3 * 0.28);
  }
}
