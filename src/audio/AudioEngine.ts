import type { AircraftSpec, WeatherSpec } from "../types";
import { clamp } from "../sim/math";

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineHarmonic: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private warningGain: GainNode | null = null;
  private warningOscillator: OscillatorNode | null = null;
  private muted = false;

  constructor(
    private readonly spec: AircraftSpec,
    private readonly weather: WeatherSpec,
  ) {}

  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.62;
    this.master.connect(context.destination);

    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = this.spec.engineKind === "piston" ? 1_200 : 750;
    engineFilter.Q.value = 1.4;
    engineFilter.connect(this.master);

    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(engineFilter);
    this.engineOscillator = context.createOscillator();
    this.engineOscillator.type =
      this.spec.engineKind === "piston" ? "sawtooth" : "sine";
    this.engineOscillator.frequency.value = 45;
    this.engineOscillator.connect(this.engineGain);
    this.engineOscillator.start();

    this.engineHarmonic = context.createOscillator();
    this.engineHarmonic.type = "triangle";
    this.engineHarmonic.frequency.value = 90;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.13;
    this.engineHarmonic.connect(harmonicGain).connect(this.engineGain);
    this.engineHarmonic.start();

    const noise = this.makeNoise(context);
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.55;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    noise.connect(windFilter).connect(this.windGain).connect(this.master);

    const rainNoise = this.makeNoise(context);
    const rainFilter = context.createBiquadFilter();
    rainFilter.type = "highpass";
    rainFilter.frequency.value = 1_600;
    this.rainGain = context.createGain();
    this.rainGain.gain.value = this.weather.rain * 0.025;
    rainNoise.connect(rainFilter).connect(this.rainGain).connect(this.master);

    this.warningGain = context.createGain();
    this.warningGain.gain.value = 0;
    this.warningGain.connect(this.master);
    this.warningOscillator = context.createOscillator();
    this.warningOscillator.type = "square";
    this.warningOscillator.frequency.value = 715;
    this.warningOscillator.connect(this.warningGain);
    this.warningOscillator.start();

    await context.resume();
  }

  update(
    elapsed: number,
    engineSpool: number,
    airspeedKts: number,
    warning: boolean,
  ): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const baseFrequency = this.spec.engineKind === "piston" ? 48 : 34;
    const range = this.spec.engineKind === "piston" ? 125 : 220;
    this.engineOscillator?.frequency.setTargetAtTime(
      baseFrequency + engineSpool * range,
      now,
      0.04,
    );
    this.engineHarmonic?.frequency.setTargetAtTime(
      (baseFrequency + engineSpool * range) * 2.03,
      now,
      0.04,
    );
    this.engineGain?.gain.setTargetAtTime(
      this.muted ? 0 : engineSpool * 0.18,
      now,
      0.08,
    );
    this.windGain?.gain.setTargetAtTime(
      this.muted ? 0 : clamp((airspeedKts - 20) / 420, 0, 1) * 0.16,
      now,
      0.16,
    );
    this.rainGain?.gain.setTargetAtTime(
      this.muted
        ? 0
        : this.weather.rain * (0.025 + clamp(airspeedKts / 300, 0, 1) * 0.05),
      now,
      0.2,
    );
    const warningPulse = warning && Math.sin(elapsed * 10) > 0 ? 0.055 : 0;
    this.warningGain?.gain.setTargetAtTime(
      this.muted ? 0 : warningPulse,
      now,
      0.012,
    );
  }

  touchdown(hard: boolean): void {
    this.playBurst(hard ? 0.22 : 0.09, hard ? 0.55 : 0.22);
  }

  crash(): void {
    this.playBurst(0.65, 1.4);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.62,
        this.context.currentTime,
        0.03,
      );
    }
    return this.muted;
  }

  dispose(): void {
    this.engineOscillator?.stop();
    this.engineHarmonic?.stop();
    this.warningOscillator?.stop();
    void this.context?.close();
    this.context = null;
  }

  private makeNoise(context: AudioContext): AudioBufferSourceNode {
    const frames = context.sampleRate * 2;
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      channel[i] = last;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  }

  private playBurst(volume: number, duration: number): void {
    if (!this.context || !this.master || this.muted) return;
    const source = this.makeNoise(this.context);
    source.loop = false;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.disconnect();
    source.connect(filter).connect(gain).connect(this.master);
    source.stop(now + duration);
  }
}
