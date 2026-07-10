# Aerovia Flight Simulator

Aerovia is a polished, browser-based 3D flight simulator set at the fictional
Aurelia International Airport (KAUR). It runs from one TypeScript/Three.js
codebase on desktop and touch devices, with no external model or texture
downloads.

## Flyable aircraft

- Cessna 172 Skyhawk — forgiving piston trainer with fixed gear
- Learjet 45 — fast twin-engine business jet
- Boeing 737 MAX 9 — high-inertia narrow-body airliner

Each aircraft has its own mass, wing, thrust, spool, control-response, stall,
rotation, approach, gear, and damage parameters.

## Features

- Configurable livery, callsign, fuel, payload, assists, quality, weather, and
  time of day
- Cold gate or ready-to-taxi startup at gate C12
- Interactive electrical, avionics, engine, lighting, flap, gear, brake,
  reverse-thrust, and autopilot controls
- 120 Hz fixed-step aerodynamic simulation with lift/drag, angle of attack,
  progressive stall, density altitude, ground effect, crosswind, turbulence,
  ground friction, braking, and aircraft-specific engine response
- Complete gate-to-departure tutorial with contextual highlights and hints
- Procedural two-runway airport, terminal, jet bridges, tower, signs, runway
  markings/lights, taxiways, traffic, city, terrain, water, clouds, rain, and
  day/night lighting
- Cockpit, chase, orbit, wing, and tower cameras
- PFD, engine display, telemetry, airport map, landing analysis, synthesized
  audio, impact particles, and recoverable crash sequence
- Responsive touch stick, rudder, brakes, flaps, gear, and camera controls
- Gamepad input and adaptive desktop/mobile rendering quality

## Start

```bash
npm install
npm run dev
```

Open `http://localhost:4173`.

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` or arrows | Pitch down / pitch up |
| `A` / `D` or arrows | Roll left / right |
| `Q` / `E` | Rudder and nose-wheel steering |
| `Shift` / `Ctrl` | Increase / decrease throttle |
| `Space` | Hold wheel brakes |
| `B` | Toggle parking brake |
| `F` / `Shift+F` | Extend / retract flaps |
| `G` | Toggle retractable landing gear |
| `R` | Toggle reverse thrust on jets after touchdown |
| `P` | Engage/disengage heading and altitude hold |
| `C` | Cycle camera |
| `M` | Toggle navigation map |
| `Enter` | Continue or skip the current tutorial step |
| `Escape` | Pause |

Drag the 3D view to look around. In orbit view, use the mouse wheel to zoom.
Mobile controls appear automatically below the 800 px breakpoint.

## Flight flow

1. Select and configure an aircraft.
2. Review runway, weather, rotation speed, and controls in the departure
   briefing.
3. Start electrical and engine systems, release the brake, and taxi east from
   C12.
4. Follow Charlie to Alpha, then the south threshold of runway 36L.
5. Configure takeoff flaps, line up heading 360, apply power, and rotate at the
   aircraft's displayed `Vr`.
6. Retract gear/flaps, explore free flight, or use the pause menu to load a
   stabilized final approach.
7. Fly two-white/two-red PAPI guidance, flare, brake, and review the landing
   score.

## Architecture

- `src/sim/FlightModel.ts` — deterministic flight, ground, systems, autopilot,
  landing, and damage state
- `src/world/Airport.ts` — procedural airport, terrain, buildings, lighting,
  traffic, and navigation landmarks
- `src/world/AircraftView.ts` — procedural aircraft and cockpit geometry
- `src/world/Environment.ts` — weather, sky, sun, clouds, precipitation, fog,
  and stars
- `src/world/CameraController.ts` — all cockpit and external camera rigs
- `src/ui/Interface.ts` and `src/ui/Tutorial.ts` — responsive flight deck,
  preflight experience, map, instruments, and training flow
- `src/audio/AudioEngine.ts` — synthesized engine, wind, rain, warning, and
  impact sound

## Validation

```bash
npm test
npm run test:e2e
npm run build
```

The unit suite verifies numeric utilities, initialization, startup/taxi,
physical takeoff for all three aircraft, approach checkpoints, autopilot
guards, and tutorial progression. Playwright verifies desktop and mobile
preflight-to-cockpit flows in a WebGL browser.

Aerovia is an entertainment simulation. Aircraft data and procedures are
game-tuned and must not be used for real-world navigation or flight training.