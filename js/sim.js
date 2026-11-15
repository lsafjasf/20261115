export const WORLD = Object.freeze({
  width: 1200,
  ceiling: 520,
  startX: 112,
  startAlt: 445,
  runwayStart: 988,
  runwayEnd: 1180,
  landingAlt: 63,
});

export const LIMITS = Object.freeze({
  touchdownSpeed: 30,
  stallSpeed: 14,
  maxAlpha: 17,
  groundLimit: 520,
});

export const TERRAIN = Object.freeze([
  [0, 108], [55, 114], [112, 121], [172, 107], [236, 118],
  [294, 166], [346, 177], [392, 145], [448, 112], [503, 126],
  [557, 158], [612, 151], [663, 113], [716, 101], [774, 118],
  [832, 136], [884, 112], [930, 83], [970, 70], [988, 63],
  [1180, 63], [1194, 67], [1200, 64],
]);

export const CHECKPOINTS = Object.freeze([
  { id: "cp1", x: 365, alt: 331, tolerance: 54, name: "切变入口" },
  { id: "cp2", x: 722, alt: 204, tolerance: 48, name: "谷口" },
]);

export const WIND_ZONES = Object.freeze([
  { id: "high", min: 312, max: 520, x: 7.4, y: -0.2, name: "高空西风", short: "W → E" },
  { id: "shear", min: 176, max: 312, x: -5.8, y: 1.15, name: "切变逆风", short: "E → W" },
  { id: "valley", min: 0, max: 176, x: 3.1, y: -1.65, name: "谷地下沉风", short: "W → E" },
]);

const DEG = Math.PI / 180;
const G = 9.81;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function terrainAt(x) {
  if (x <= TERRAIN[0][0]) return TERRAIN[0][1];
  if (x >= TERRAIN.at(-1)[0]) return TERRAIN.at(-1)[1];

  for (let index = 1; index < TERRAIN.length; index += 1) {
    const [rightX, rightY] = TERRAIN[index];
    if (x > rightX) continue;
    const [leftX, leftY] = TERRAIN[index - 1];
    return lerp(leftY, rightY, (x - leftX) / (rightX - leftX));
  }
  return TERRAIN.at(-1)[1];
}

export function windAt(altitude, time = 0) {
  let low = WIND_ZONES[2];
  let high = WIND_ZONES[0];

  if (altitude <= 176) {
    low = WIND_ZONES[2];
    high = WIND_ZONES[0];
  } else if (altitude < 312) {
    low = WIND_ZONES[1];
    high = WIND_ZONES[0];
  }

  let blend = 0;
  if (altitude > 144 && altitude < 208) {
    blend = smoothstep(144, 208, altitude);
    low = WIND_ZONES[2];
    high = WIND_ZONES[1];
  } else if (altitude >= 208 && altitude < 280) {
    blend = smoothstep(280, 344, altitude);
    low = WIND_ZONES[1];
    high = WIND_ZONES[0];
  } else if (altitude >= 280) {
    blend = smoothstep(280, 344, altitude);
    low = WIND_ZONES[1];
    high = WIND_ZONES[0];
  } else {
    blend = 0;
    low = WIND_ZONES[2];
    high = WIND_ZONES[2];
  }

  const gust = Math.sin(time * 0.43 + altitude * 0.018) * 0.44;
  const gustY = Math.cos(time * 0.31 + altitude * 0.012) * 0.28;
  return {
    x: lerp(low.x, high.x, blend) + gust,
    y: lerp(low.y, high.y, blend) + gustY,
  };
}

export function windZoneAt(altitude) {
  if (altitude >= 312) return WIND_ZONES[0];
  if (altitude >= 176) return WIND_ZONES[1];
  return WIND_ZONES[2];
}

export function settingsFrom(overrides = {}) {
  return {
    span: 3.4,
    cg: -2,
    pitch: -17.5,
    ...overrides,
  };
}

export function aircraftFrom(settings, initial = {}) {
  const span = clamp(Number(settings.span) || 3.4, 2.6, 4.2);
  const cgPercent = clamp(Number(settings.cg) || 0, -12, 12);
  const cg = cgPercent / 100;
  const cgPenalty = 0.00034 * Math.pow(cg / 0.05, 2);
  const dragK = 0.00445 * Math.pow(3.4 / span, 0.72) + cgPenalty;
  const trimAlpha = 5.1 + cg * 18;
  const stallSpeed = 13.3 + Math.abs(cg + 0.01) * 12 - (span - 3.4) * 0.35;
  return {
    span,
    cg,
    cgPercent,
    dragK,
    trimAlpha,
    stallSpeed,
    speed: initial.speed ?? 27.5,
  };
}

export function createFlight(settings = settingsFrom()) {
  const aircraft = aircraftFrom(settings);
  const pitch = clamp(Number(settings.pitch) || settingsFrom().pitch, -32, 15);
  const gamma = (pitch - aircraft.trimAlpha) * DEG;
  return {
    status: "ready",
    reason: "",
    time: 0,
    x: WORLD.startX,
    y: WORLD.startAlt,
    speed: aircraft.speed,
    gamma,
    pitch: pitch * DEG,
    pitchCommand: pitch,
    alpha: 0,
    groundSpeed: 0,
    sinkRate: 0,
    wind: windAt(WORLD.startAlt, 0),
    aircraft,
    settings: { ...settings, span: aircraft.span, cg: aircraft.cgPercent, pitch },
    checkpointIndex: 0,
    checkpointMarks: [],
    trail: [],
    touchdown: null,
  };
}

export function setPitchCommand(flight, pitchDegrees) {
  flight.pitchCommand = clamp(Number(pitchDegrees) || 0, -32, 15);
}

function checkpointAtCrossing(previousX, flight) {
  const checkpoint = CHECKPOINTS[flight.checkpointIndex];
  if (!checkpoint || previousX >= checkpoint.x || flight.x < checkpoint.x) return;

  const offset = flight.y - checkpoint.alt;
  flight.checkpointMarks.push({
    ...checkpoint,
    reachedAlt: flight.y,
    offset,
    passed: Math.abs(offset) <= checkpoint.tolerance,
    time: flight.time,
  });
  flight.checkpointIndex += 1;
  if (Math.abs(offset) > checkpoint.tolerance) {
    flight.status = "failed";
    flight.reason = `偏离${checkpoint.name}检查点 ${Math.abs(offset).toFixed(0)} m`;
  }
}

function finishFlight(flight, groundSpeed, reason = "") {
  const inRunway = flight.x >= WORLD.runwayStart && flight.x <= WORLD.runwayEnd;
  const gentleEnough = groundSpeed <= LIMITS.touchdownSpeed;
  flight.touchdown = {
    x: flight.x,
    y: flight.y,
    speed: groundSpeed,
    time: flight.time,
    inRunway,
  };

  if (inRunway && gentleEnough) {
    flight.status = "success";
    flight.reason = "安全降落";
    return;
  }
  flight.status = "failed";
  if (!inRunway) {
    flight.reason = "未到达降落区";
  } else {
    flight.reason = `${reason || `触地速度 ${groundSpeed.toFixed(1)} m/s`}`;
  }
}

export function stepFlight(flight, dt = 1 / 60) {
  if (flight.status === "ready") flight.status = "flying";
  if (flight.status !== "flying") return flight;

  const previousX = flight.x;
  flight.time += dt;

  const pitchTarget = flight.pitchCommand * DEG;
  const pitchResponse = 1 - Math.exp(-2.9 * dt);
  flight.pitch += (pitchTarget - flight.pitch) * pitchResponse;

  const gammaTarget = clamp(
    (flight.pitch / DEG - flight.aircraft.trimAlpha) * DEG,
    -68 * DEG,
    16 * DEG,
  );
  const gammaResponse = 1 - Math.exp(-2.35 * dt);
  flight.gamma += (gammaTarget - flight.gamma) * gammaResponse;

  const alphaRad = flight.pitch - flight.gamma;
  flight.alpha = alphaRad / DEG;
  const stallDrag = Math.max(0, Math.abs(flight.alpha) - 11) * 0.00036;
  const drag = flight.aircraft.dragK + stallDrag;
  const acceleration = -G * Math.sin(flight.gamma) - drag * flight.speed * flight.speed;
  flight.speed = Math.max(0, flight.speed + acceleration * dt);

  flight.wind = windAt(flight.y, flight.time);
  const airX = flight.speed * Math.cos(flight.gamma);
  const airY = flight.speed * Math.sin(flight.gamma);
  const groundX = airX + flight.wind.x;
  const groundY = airY + flight.wind.y;
  flight.groundSpeed = Math.hypot(groundX, groundY);
  flight.sinkRate = -groundY;
  flight.x += groundX * dt;
  flight.y += groundY * dt;

  if (flight.trail.length === 0 || flight.time - flight.trail.at(-1).time >= 0.045) {
    flight.trail.push({
      time: flight.time,
      x: flight.x,
      y: flight.y,
      speed: flight.speed,
      groundSpeed: flight.groundSpeed,
      pitch: flight.pitch / DEG,
      gamma: flight.gamma / DEG,
      alpha: flight.alpha,
      windX: flight.wind.x,
      windY: flight.wind.y,
    });
  }

  checkpointAtCrossing(previousX, flight);
  if (flight.status !== "flying") return flight;

  if (flight.alpha > LIMITS.maxAlpha) {
    flight.status = "failed";
    flight.reason = `迎角 ${flight.alpha.toFixed(0)}° · 失速`;
    return flight;
  }
  if (flight.speed < flight.aircraft.stallSpeed) {
    flight.status = "failed";
    flight.reason = `${flight.speed.toFixed(1)} m/s · 失速`;
    return flight;
  }
  if (flight.y > LIMITS.groundLimit) {
    flight.status = "failed";
    flight.reason = "超出试验空域";
    return flight;
  }
  if (flight.x > WORLD.width + 20) {
    flight.status = "failed";
    flight.reason = "飞越降落区";
    return flight;
  }

  const ground = terrainAt(flight.x);
  if (flight.y <= ground) {
    flight.y = ground;
    finishFlight(flight, flight.groundSpeed);
  }
  return flight;
}

export function targetAltitudeAt(x) {
  const path = [
    [WORLD.startX, WORLD.startAlt],
    [CHECKPOINTS[0].x, CHECKPOINTS[0].alt],
    [CHECKPOINTS[1].x, CHECKPOINTS[1].alt],
    [1002, WORLD.landingAlt],
  ];
  if (x <= path[0][0]) return path[0][1];
  if (x >= path.at(-1)[0]) return path.at(-1)[1];
  for (let index = 1; index < path.length; index += 1) {
    if (x > path[index][0]) continue;
    const [leftX, leftY] = path[index - 1];
    const [rightX, rightY] = path[index];
    return lerp(leftY, rightY, (x - leftX) / (rightX - leftX));
  }
  return path.at(-1)[1];
}

export function autopilotPitch(flight) {
  const lookAhead = 34;
  const targetHere = targetAltitudeAt(flight.x);
  const targetAhead = targetAltitudeAt(flight.x + lookAhead);
  const pathSlope = (targetAhead - targetHere) / lookAhead;
  const groundX = Math.max(8, flight.speed * Math.cos(flight.gamma) + flight.wind.x);
  const desiredAirY = pathSlope * groundX - flight.wind.y;
  let desiredGamma = Math.asin(clamp(desiredAirY / Math.max(flight.speed, 8), -0.9, 0.2));
  const altitudeError = targetHere - flight.y;
  desiredGamma += clamp(altitudeError * 0.0025, -0.07, 0.07);

  const flareStart = 900;
  if (flight.x > flareStart && flight.y < 105) {
    const flare = smoothstep(flareStart, 1040, flight.x);
    desiredGamma = lerp(desiredGamma, -3.6 * DEG, flare * 0.78);
  }

  return desiredGamma / DEG + flight.aircraft.trimAlpha;
}

export function runSimulation(settings = settingsFrom(), options = {}) {
  const flight = createFlight(settings);
  const maxTime = options.maxTime ?? 95;
  const auto = options.auto ?? true;
  const dt = options.dt ?? 1 / 90;
  flight.status = "flying";

  while (flight.status === "flying" && flight.time < maxTime) {
    if (auto) setPitchCommand(flight, autopilotPitch(flight));
    stepFlight(flight, dt);
  }
  if (flight.status === "flying") {
    flight.status = "failed";
    flight.reason = "超时";
  }
  return flight;
}
