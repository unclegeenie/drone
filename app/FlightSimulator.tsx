"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  distanceFromPilot,
  drawPilotScene,
} from "./PilotRenderer";
import type { PilotDroneLayer, PilotGuideMode } from "./PilotRenderer";
import type {
  DroneThreeRenderer as DroneThreeRendererInstance,
} from "./DroneThreeRenderer";
import {
  COURSE_CIRCLE,
  COURSE_POINTS,
  FIELD_BOUNDS,
  HOVER_ALTITUDE,
  TRIANGLE_RISE,
} from "./CourseGeometry";

type Grade = "1" | "2";
type TrainingMode = "course" | "exam";
type FlightPhase =
  | "briefing"
  | "running"
  | "paused"
  | "completed"
  | "crashed";
type AutoVertical = "takeoff" | "landing" | null;

const GUIDE_MODE_LABELS: Record<PilotGuideMode, string> = {
  full: "전체",
  target: "목표",
  off: "실전",
};

const GUIDE_MODE_DESCRIPTIONS: Record<PilotGuideMode, string> = {
  full: "경로·공간 가이드와 전체 지도를 표시합니다.",
  target: "현재 목표 공간과 전체 지도만 표시합니다.",
  off: "비행 가이드를 숨기고 전체 지도만 표시합니다.",
};

const NEXT_GUIDE_MODE: Record<PilotGuideMode, PilotGuideMode> = {
  full: "target",
  target: "off",
  off: "full",
};

type Waypoint = {
  x: number;
  z: number;
  altitude: number;
  label: string;
  stage: string;
  stageNumber: number;
  radius?: number;
  hold?: number;
  landing?: boolean;
  mustStop?: boolean;
  targetYaw?: number;
  yawTolerance?: number;
};

type FlightState = {
  x: number;
  z: number;
  altitude: number;
  vx: number;
  vz: number;
  vy: number;
  yaw: number;
  pitch: number;
  roll: number;
  yawRate: number;
  battery: number;
  elapsed: number;
  waypointIndex: number;
  holdProgress: number;
  phase: FlightPhase;
  autoVertical: AutoVertical;
  inputLabel: string;
  controllerName?: string;
  warning: string | null;
  penalty: number;
  boundaryContact: boolean;
  motorsArmed: boolean;
};

type FlightSimulatorProps = {
  grade: Grade;
  trainingMode: TrainingMode;
  courseId: string;
  courseLabel: string;
  weight: number;
  weightBasisLabel: string;
  controllerName?: string;
  onExit: () => void;
};

const FIELD = FIELD_BOUNDS;

const COURSE_STAGE_LABELS: Record<string, string> = {
  hover: "공중 정지비행",
  straight: "직진·후진 수평비행",
  triangle: "삼각비행",
  circle: "원주비행",
  emergency: "비상조작",
  "normal-landing": "정상접근·착륙",
  crosswind: "측풍접근·착륙",
  diamond: "마름모비행",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
};

const signedSpeedRatio = (value: number, maximum = 4.5) => {
  if (Math.abs(value) <= 0.12) return 0;
  return (
    Math.sign(value) *
    clamp((Math.abs(value) - 0.12) / (maximum - 0.12), 0, 1)
  );
};

const yawError = (current: number, target: number) =>
  Math.abs(((current - target + 540) % 360) - 180);

const RAMPED_INPUT_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

type KeyboardRampProfile = {
  initial: number;
  fullAfter: number;
};

const KEYBOARD_RAMP = {
  horizontal: { initial: 0.16, fullAfter: 1.4 },
  vertical: { initial: 0.18, fullAfter: 1.7 },
  yaw: { initial: 0.18, fullAfter: 1.2 },
} satisfies Record<string, KeyboardRampProfile>;

function keyboardHoldStrength(
  keys: Set<string>,
  startedAt: Map<string, number>,
  code: string,
  now: number,
  profile: KeyboardRampProfile,
) {
  if (!keys.has(code)) return 0;
  const heldSeconds = Math.max(
    0,
    (now - (startedAt.get(code) ?? now)) / 1000,
  );
  const progress = clamp(heldSeconds / profile.fullAfter, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return profile.initial + (1 - profile.initial) * eased;
}

const waypoint = (
  x: number,
  z: number,
  altitude: number,
  label: string,
  stage: string,
  stageNumber: number,
  options: Partial<Waypoint> = {},
): Waypoint => ({
  x,
  z,
  altitude,
  label,
  stage,
  stageNumber,
  radius: 4.2,
  hold: 0.8,
  ...options,
});

const circlePoints = (
  stage: string,
  stageNumber: number,
  count = 16,
) =>
  Array.from({ length: count + 1 }, (_, index) => {
    // H → B → C → D → H. 도면상의 A 중심 반경 7.5m 원주입니다.
    const angle = -Math.PI / 2 - (Math.PI * 2 * index) / count;
    const cardinalLabels: Record<number, string> = {
      0: "H에서 원주비행 시작 전 5초 호버링",
      [count / 4]: "B 기준점 통과",
      [count / 2]: "C 기준점 통과",
      [(count * 3) / 4]: "D 기준점 통과",
      [count]: "H 복귀 후 5초 호버링",
    };
    const isStartOrFinish = index === 0 || index === count;
    return waypoint(
      COURSE_CIRCLE.centerX + Math.cos(angle) * COURSE_CIRCLE.radius,
      COURSE_CIRCLE.centerZ + Math.sin(angle) * COURSE_CIRCLE.radius,
      HOVER_ALTITUDE,
      cardinalLabels[index] ?? "반경 7.5m 원주 유지",
      stage,
      stageNumber,
      {
        radius: isStartOrFinish ? 2.2 : 2.7,
        hold: isStartOrFinish ? 5 : 0.18,
        mustStop: isStartOrFinish,
      },
    );
  });

const trianglePoints = (
  stage: string,
  stageNumber: number,
  includeCenterEntry = false,
) => {
  const center = COURSE_POINTS.A;
  const left = COURSE_POINTS.B;
  const right = COURSE_POINTS.D;
  const baseAltitude = HOVER_ALTITUDE;
  const points: Waypoint[] = [];

  if (includeCenterEntry) {
    points.push(
      waypoint(
        center.x,
        center.z,
        baseAltitude,
        "A 호버링 위치에서 5초 정지",
        stage,
        stageNumber,
        {
          radius: 2.2,
          hold: 5,
          mustStop: true,
        },
      ),
    );
  }

  points.push(
    waypoint(
      left.x,
      left.z,
      baseAltitude,
      "B까지 좌측 수평이동 후 5초 정지",
      stage,
      stageNumber,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    waypoint(
      center.x,
      center.z,
      baseAltitude + TRIANGLE_RISE,
      "A 상공 +7.5m까지 대각상승 후 5초 정지",
      stage,
      stageNumber,
      {
        radius: 2.2,
        hold: 5,
        mustStop: true,
      },
    ),
    waypoint(
      right.x,
      right.z,
      baseAltitude,
      "D까지 대각하강 후 5초 정지",
      stage,
      stageNumber,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    waypoint(
      center.x,
      center.z,
      baseAltitude,
      "A 호버링 위치로 수평복귀 후 5초 정지",
      stage,
      stageNumber,
      {
        radius: 2.2,
        hold: 5,
        mustStop: true,
      },
    ),
  );

  return points;
};

const hoverSequence = (stage: string, stageNumber: number): Waypoint[] => [
  waypoint(
    COURSE_POINTS.A.x,
    COURSE_POINTS.A.z,
    HOVER_ALTITUDE,
    "전방 호버링 · 목표 000°",
    stage,
    stageNumber,
    {
      radius: 2.2,
      hold: 5,
      mustStop: true,
      targetYaw: 0,
      yawTolerance: 12,
    },
  ),
  waypoint(
    COURSE_POINTS.A.x,
    COURSE_POINTS.A.z,
    HOVER_ALTITUDE,
    "좌측면 호버링 · 목표 270°",
    stage,
    stageNumber,
    {
      radius: 2.2,
      hold: 5,
      mustStop: true,
      targetYaw: 270,
      yawTolerance: 12,
    },
  ),
  waypoint(
    COURSE_POINTS.A.x,
    COURSE_POINTS.A.z,
    HOVER_ALTITUDE,
    "우측면 호버링 · 목표 090°",
    stage,
    stageNumber,
    {
      radius: 2.2,
      hold: 5,
      mustStop: true,
      targetYaw: 90,
      yawTolerance: 12,
    },
  ),
  waypoint(
    COURSE_POINTS.A.x,
    COURSE_POINTS.A.z,
    HOVER_ALTITUDE,
    "전방 복귀 및 직진 준비 · 목표 000°",
    stage,
    stageNumber,
    {
      radius: 2.2,
      hold: 2,
      mustStop: true,
      targetYaw: 0,
      yawTolerance: 12,
    },
  ),
];

function buildCourseMission(courseId: string, courseLabel: string): Waypoint[] {
  const takeoff = waypoint(
    COURSE_POINTS.H.x,
    COURSE_POINTS.H.z,
    3,
    "이륙 후 고도 3m 확보",
    "이륙비행",
    1,
    { radius: 5, hold: 0.8 },
  );
  const stage = COURSE_STAGE_LABELS[courseId] ?? courseLabel;
  const landHome = waypoint(
    COURSE_POINTS.H.x,
    COURSE_POINTS.H.z,
    0,
    "착륙장에 안전하게 착륙",
    stage,
    2,
    { radius: 5.5, hold: 0.5, landing: true },
  );

  switch (courseId) {
    case "hover":
      return [
        takeoff,
        ...hoverSequence(stage, 2),
        landHome,
      ];
    case "straight":
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.A.x,
          COURSE_POINTS.A.z,
          HOVER_ALTITUDE,
          "A에서 직진비행 준비",
          stage,
          2,
          { radius: 2.2, hold: 2, mustStop: true },
        ),
        waypoint(
          COURSE_POINTS.E.x,
          COURSE_POINTS.E.z,
          HOVER_ALTITUDE,
          "E까지 40m 직진 후 정지",
          stage,
          2,
          { radius: 3, hold: 3, mustStop: true },
        ),
        waypoint(
          COURSE_POINTS.A.x,
          COURSE_POINTS.A.z,
          HOVER_ALTITUDE,
          "기수를 유지한 채 A까지 후진 후 5초 정지",
          stage,
          2,
          { radius: 2.2, hold: 5, mustStop: true },
        ),
        landHome,
      ];
    case "triangle":
      return [
        takeoff,
        ...trianglePoints(stage, 2, true),
        landHome,
      ];
    case "diamond":
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.B.x,
          COURSE_POINTS.B.z,
          HOVER_ALTITUDE,
          "B 기준점 통과",
          stage,
          2,
        ),
        waypoint(
          COURSE_POINTS.C.x,
          COURSE_POINTS.C.z,
          HOVER_ALTITUDE,
          "C 기준점 통과",
          stage,
          2,
        ),
        waypoint(
          COURSE_POINTS.D.x,
          COURSE_POINTS.D.z,
          HOVER_ALTITUDE,
          "D 기준점 통과",
          stage,
          2,
        ),
        waypoint(
          COURSE_POINTS.H.x,
          COURSE_POINTS.H.z,
          HOVER_ALTITUDE,
          "H 복귀 후 5초 호버링",
          stage,
          2,
          { radius: 2.2, hold: 5, mustStop: true },
        ),
        landHome,
      ];
    case "circle":
      return [
        takeoff,
        ...circlePoints(stage, 2),
        landHome,
      ];
    case "emergency":
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.H.x,
          COURSE_POINTS.H.z,
          HOVER_ALTITUDE + 2,
          "H 상공에서 2m 수직상승 후 정지",
          stage,
          2,
          {
          radius: 2.2,
          hold: 3,
          mustStop: true,
        }),
        waypoint(
          COURSE_POINTS.F_LEFT.x,
          COURSE_POINTS.F_LEFT.z,
          1,
          "좌측 F 상공 1m 이내로 신속히 접근",
          stage,
          2,
          { radius: 1.6, hold: 0.7 },
        ),
        waypoint(
          COURSE_POINTS.F_LEFT.x,
          COURSE_POINTS.F_LEFT.z,
          0,
          "좌측 F 비상착륙장에 착륙",
          stage,
          2,
          {
          radius: 1.4,
          hold: 0.5,
          landing: true,
        }),
      ];
    case "normal-landing":
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.F_LEFT.x,
          COURSE_POINTS.F_LEFT.z,
          HOVER_ALTITUDE,
          "좌측 F까지 이동 후 정상접근 준비",
          stage,
          2,
          { radius: 1.8, hold: 3, mustStop: true },
        ),
        waypoint(
          COURSE_POINTS.H.x,
          COURSE_POINTS.H.z,
          HOVER_ALTITUDE,
          "H 상공으로 수평접근 후 5초 정지",
          stage,
          2,
          { radius: 2.2, hold: 5, mustStop: true },
        ),
        landHome,
      ];
    case "crosswind":
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.D.x,
          COURSE_POINTS.D.z,
          HOVER_ALTITUDE,
          "D에서 측풍 방향으로 기수 정렬 후 5초 정지",
          stage,
          2,
          { radius: 2.2, hold: 5, mustStop: true },
        ),
        waypoint(
          COURSE_POINTS.H.x,
          COURSE_POINTS.H.z,
          HOVER_ALTITUDE,
          "기수를 유지하며 H로 측풍 보정 접근",
          stage,
          2,
          { radius: 2.2, hold: 5, mustStop: true },
        ),
        landHome,
      ];
    default:
      return [
        takeoff,
        waypoint(
          COURSE_POINTS.A.x,
          COURSE_POINTS.A.z,
          HOVER_ALTITUDE,
          courseLabel,
          stage,
          2,
        ),
        landHome,
      ];
  }
}

function buildExamMission(grade: Grade): Waypoint[] {
  const points: Waypoint[] = [
    waypoint(
      COURSE_POINTS.H.x,
      COURSE_POINTS.H.z,
      3,
      "H에서 고도 3m까지 수직이륙",
      "이륙비행",
      1,
      {
      radius: 5,
      hold: 0.8,
      },
    ),
  ];

  if (grade === "1") {
    points.push(
      ...hoverSequence("공중 정지비행", 2),
      waypoint(
        COURSE_POINTS.E.x,
        COURSE_POINTS.E.z,
        HOVER_ALTITUDE,
        "E까지 40m 직진 후 정지",
        "직진·후진 수평비행",
        3,
        { radius: 3, hold: 3, mustStop: true },
      ),
      waypoint(
        COURSE_POINTS.A.x,
        COURSE_POINTS.A.z,
        HOVER_ALTITUDE,
        "기수를 유지한 채 A까지 후진",
        "직진·후진 수평비행",
        3,
        { radius: 2.2, hold: 5, mustStop: true },
      ),
      ...trianglePoints("삼각비행", 4),
      ...circlePoints("원주비행", 5),
      waypoint(
        COURSE_POINTS.H.x,
        COURSE_POINTS.H.z,
        HOVER_ALTITUDE + 2,
        "H 상공에서 2m 수직상승 후 정지",
        "비상조작",
        6,
        { radius: 2.2, hold: 3, mustStop: true },
      ),
      waypoint(
        COURSE_POINTS.F_LEFT.x,
        COURSE_POINTS.F_LEFT.z,
        1,
        "좌측 F 상공 1m 이내로 신속히 접근",
        "비상조작",
        6,
        { radius: 1.6, hold: 0.7 },
      ),
      waypoint(
        COURSE_POINTS.F_LEFT.x,
        COURSE_POINTS.F_LEFT.z,
        0,
        "좌측 F에 비상착륙",
        "비상조작",
        6,
        {
        radius: 1.4,
        hold: 0.5,
        landing: true,
      }),
      waypoint(
        COURSE_POINTS.F_LEFT.x,
        COURSE_POINTS.F_LEFT.z,
        HOVER_ALTITUDE,
        "F에서 재이륙 후 5초 정지",
        "정상접근·착륙",
        7,
        { radius: 1.8, hold: 5, mustStop: true },
      ),
      waypoint(
        COURSE_POINTS.H.x,
        COURSE_POINTS.H.z,
        HOVER_ALTITUDE,
        "H 상공으로 정상접근 후 5초 정지",
        "정상접근·착륙",
        7,
        { radius: 2.2, hold: 5, mustStop: true },
      ),
      waypoint(
        COURSE_POINTS.H.x,
        COURSE_POINTS.H.z,
        0,
        "H에 정상착륙",
        "정상접근·착륙",
        7,
        {
        radius: 2.2,
        hold: 0.5,
        landing: true,
      }),
      waypoint(
        COURSE_POINTS.H.x,
        COURSE_POINTS.H.z,
        HOVER_ALTITUDE,
        "측풍비행 재이륙",
        "측풍접근·착륙",
        8,
        { radius: 2.2, hold: 2 },
      ),
      waypoint(
        COURSE_POINTS.D.x,
        COURSE_POINTS.D.z,
        HOVER_ALTITUDE,
        "D에서 측풍 방향으로 기수 정렬",
        "측풍접근·착륙",
        8,
        { radius: 2.2, hold: 5, mustStop: true },
      ),
      waypoint(
        COURSE_POINTS.H.x,
        COURSE_POINTS.H.z,
        0,
        "측풍을 보정하며 H에 최종 착륙",
        "측풍접근·착륙",
        8,
        {
        radius: 2.2,
        hold: 0.5,
        landing: true,
      }),
    );
    return points;
  }

  points.push(
    waypoint(
      COURSE_POINTS.A.x,
      COURSE_POINTS.A.z,
      HOVER_ALTITUDE,
      "A에서 직진비행 준비",
      "직진·후진 수평비행",
      2,
      { radius: 2.2, hold: 2, mustStop: true },
    ),
    waypoint(
      COURSE_POINTS.E.x,
      COURSE_POINTS.E.z,
      HOVER_ALTITUDE,
      "E까지 40m 직진",
      "직진·후진 수평비행",
      2,
      { radius: 3, hold: 3, mustStop: true },
    ),
    waypoint(
      COURSE_POINTS.A.x,
      COURSE_POINTS.A.z,
      HOVER_ALTITUDE,
      "기수를 유지한 채 A까지 후진",
      "직진·후진 수평비행",
      2,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    ...trianglePoints("삼각비행", 3),
    waypoint(
      COURSE_POINTS.H.x,
      COURSE_POINTS.H.z,
      HOVER_ALTITUDE,
      "H에서 마름모비행 시작",
      "마름모비행",
      4,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    waypoint(
      COURSE_POINTS.B.x,
      COURSE_POINTS.B.z,
      HOVER_ALTITUDE,
      "B 기준점 통과",
      "마름모비행",
      4,
    ),
    waypoint(
      COURSE_POINTS.C.x,
      COURSE_POINTS.C.z,
      HOVER_ALTITUDE,
      "C 기준점 통과",
      "마름모비행",
      4,
    ),
    waypoint(
      COURSE_POINTS.D.x,
      COURSE_POINTS.D.z,
      HOVER_ALTITUDE,
      "D 기준점 통과",
      "마름모비행",
      4,
    ),
    waypoint(
      COURSE_POINTS.H.x,
      COURSE_POINTS.H.z,
      HOVER_ALTITUDE,
      "H 복귀 후 5초 호버링",
      "마름모비행",
      4,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    waypoint(
      COURSE_POINTS.D.x,
      COURSE_POINTS.D.z,
      HOVER_ALTITUDE,
      "D에서 측풍 방향으로 기수 정렬",
      "측풍접근·착륙",
      5,
      { radius: 2.2, hold: 5, mustStop: true },
    ),
    waypoint(
      COURSE_POINTS.H.x,
      COURSE_POINTS.H.z,
      0,
      "측풍을 보정하며 H에 최종 착륙",
      "측풍접근·착륙",
      5,
      {
      radius: 2.2,
      hold: 0.5,
      landing: true,
    }),
  );
  return points;
}

function createInitialState(
  controllerName?: string,
  phase: FlightPhase = "briefing",
): FlightState {
  return {
    x: FIELD.homeX,
    z: FIELD.homeZ,
    altitude: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    yawRate: 0,
    battery: 100,
    elapsed: 0,
    waypointIndex: 0,
    holdProgress: 0,
    phase,
    autoVertical: null,
    inputLabel: controllerName ? "USB 조종기" : "키보드 · 누름 가속",
    controllerName,
    warning: null,
    penalty: 0,
    boundaryContact: false,
    motorsArmed: false,
  };
}

function deadzone(value: number, zone = 0.12) {
  if (Math.abs(value) <= zone) return 0;
  return (
    ((Math.abs(value) - zone) / (1 - zone)) * (value < 0 ? -1 : 1)
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height,
  );
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function mapWorld(
  x: number,
  z: number,
  width: number,
  height: number,
) {
  const padX = Math.max(34, width * 0.055);
  const padTop = Math.max(70, height * 0.1);
  const padBottom = Math.max(42, height * 0.075);
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  return {
    x: padX + ((x - FIELD.minX) / (FIELD.maxX - FIELD.minX)) * usableWidth,
    y:
      padTop +
      ((FIELD.maxZ - z) / (FIELD.maxZ - FIELD.minZ)) * usableHeight,
    scaleX: usableWidth / (FIELD.maxX - FIELD.minX),
    scaleZ: usableHeight / (FIELD.maxZ - FIELD.minZ),
  };
}

export function drawTopDownScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: FlightState,
  mission: Waypoint[],
  windActive: boolean,
) {
  context.clearRect(0, 0, width, height);

  const grass = context.createLinearGradient(0, 0, 0, height);
  grass.addColorStop(0, "#1f5a4f");
  grass.addColorStop(0.48, "#174838");
  grass.addColorStop(1, "#0d2d28");
  context.fillStyle = grass;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.12;
  for (let stripe = 0; stripe < 12; stripe += 1) {
    context.fillStyle = stripe % 2 === 0 ? "#8cb77a" : "#071e1a";
    context.fillRect(0, (stripe * height) / 12, width, height / 12);
  }
  context.restore();

  const topLeft = mapWorld(FIELD.minX, FIELD.maxZ, width, height);
  const bottomRight = mapWorld(FIELD.maxX, FIELD.minZ, width, height);

  context.save();
  context.strokeStyle = "rgba(215, 239, 219, 0.13)";
  context.lineWidth = 1;
  for (
    let x = Math.ceil(FIELD.minX / 5) * 5;
    x <= FIELD.maxX;
    x += 5
  ) {
    const from = mapWorld(x, FIELD.minZ, width, height);
    const to = mapWorld(x, FIELD.maxZ, width, height);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  for (
    let z = Math.ceil(FIELD.minZ / 5) * 5;
    z <= FIELD.maxZ;
    z += 5
  ) {
    const from = mapWorld(FIELD.minX, z, width, height);
    const to = mapWorld(FIELD.maxX, z, width, height);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  context.strokeStyle = "rgba(235, 249, 238, 0.5)";
  context.lineWidth = 2;
  context.setLineDash([9, 7]);
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  context.restore();

  const home = mapWorld(FIELD.homeX, FIELD.homeZ, width, height);
  context.save();
  context.translate(home.x, home.y);
  context.fillStyle = "rgba(6, 28, 31, 0.72)";
  context.strokeStyle = "rgba(255, 255, 255, 0.72)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(0, 0, Math.max(21, width * 0.018), 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.82)";
  context.font = `700 ${Math.max(10, width * 0.009)}px Pretendard, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("H", 0, 1);
  context.restore();

  const alternate = mapWorld(
    COURSE_POINTS.F_LEFT.x,
    COURSE_POINTS.F_LEFT.z,
    width,
    height,
  );
  context.save();
  context.strokeStyle = "rgba(255, 210, 74, 0.58)";
  context.lineWidth = 2;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.arc(alternate.x, alternate.y, Math.max(18, width * 0.015), 0, Math.PI * 2);
  context.stroke();
  context.restore();

  if (windActive) {
    context.save();
    context.strokeStyle = "rgba(99, 207, 237, 0.4)";
    context.fillStyle = "rgba(99, 207, 237, 0.55)";
    context.lineWidth = 2;
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const x = width * (0.12 + column * 0.15);
        const y = height * (0.26 + row * 0.17);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 28, y - 7);
        context.stroke();
        context.beginPath();
        context.moveTo(x + 28, y - 7);
        context.lineTo(x + 20, y - 11);
        context.lineTo(x + 22, y - 2);
        context.closePath();
        context.fill();
      }
    }
    context.restore();
  }

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.2)";
  context.lineWidth = 2;
  context.setLineDash([7, 8]);
  context.beginPath();
  mission.forEach((point, index) => {
    const mapped = mapWorld(point.x, point.z, width, height);
    if (index === 0) context.moveTo(mapped.x, mapped.y);
    else context.lineTo(mapped.x, mapped.y);
  });
  context.stroke();
  context.restore();

  const markerStart = Math.max(0, state.waypointIndex - 1);
  const markerEnd = Math.min(mission.length, state.waypointIndex + 5);
  const pulse = 1 + Math.sin(state.elapsed * 5) * 0.08;

  for (let index = markerStart; index < markerEnd; index += 1) {
    const point = mission[index];
    const mapped = mapWorld(point.x, point.z, width, height);
    const active = index === state.waypointIndex;
    const completed = index < state.waypointIndex;
    const radius = Math.max(
      10,
      (point.radius ?? 4) * Math.min(mapped.scaleX, mapped.scaleZ),
    );

    context.save();
    context.translate(mapped.x, mapped.y);
    context.globalAlpha = active ? 1 : completed ? 0.46 : 0.28;
    context.strokeStyle = completed
      ? "#78d99a"
      : active
        ? "#ffd24a"
        : "#e7f4f6";
    context.fillStyle = active
      ? "rgba(255, 210, 74, 0.13)"
      : "rgba(255, 255, 255, 0.04)";
    context.lineWidth = active ? 3 : 1.5;
    context.beginPath();
    context.arc(0, 0, active ? radius * pulse : radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.setLineDash([3, 4]);
    context.beginPath();
    context.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    if (active) {
      const boxWidth = Math.min(168, Math.max(116, width * 0.13));
      const boxY = -radius - 35;
      roundedRect(context, -boxWidth / 2, boxY, boxWidth, 25, 8);
      context.fillStyle = "rgba(6, 28, 37, 0.9)";
      context.fill();
      context.strokeStyle = "rgba(255, 210, 74, 0.5)";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#fff4c5";
      context.font = `700 ${Math.max(10, width * 0.0085)}px Pretendard, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const label =
        point.altitude > 0
          ? `${point.label} · ${point.altitude.toFixed(1)}m`
          : point.label;
      context.fillText(label, 0, boxY + 13, boxWidth - 12);
    }
    context.restore();
  }

  const drone = mapWorld(state.x, state.z, width, height);
  const shadowOffset = Math.min(22, state.altitude * 2.5);
  context.save();
  context.translate(drone.x + shadowOffset, drone.y + shadowOffset * 0.45);
  context.scale(1 + state.altitude * 0.025, 0.52 + state.altitude * 0.012);
  context.fillStyle = `rgba(0, 0, 0, ${clamp(0.32 - state.altitude * 0.016, 0.08, 0.3)})`;
  context.beginPath();
  context.arc(0, 0, 20, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.translate(drone.x, drone.y);
  context.rotate((state.yaw * Math.PI) / 180);
  const droneScale = clamp(0.88 + state.altitude * 0.035, 0.88, 1.3);
  context.scale(droneScale, droneScale);
  context.strokeStyle = "#d8e9ed";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-15, -15);
  context.lineTo(15, 15);
  context.moveTo(15, -15);
  context.lineTo(-15, 15);
  context.stroke();

  const rotorPoints = [
    [-17, -17],
    [17, -17],
    [-17, 17],
    [17, 17],
  ];
  rotorPoints.forEach(([x, y]) => {
    context.fillStyle = "rgba(7, 28, 37, 0.88)";
    context.strokeStyle = "#a9cad2";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.56)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x - 9, y);
    context.lineTo(x + 9, y);
    context.stroke();
  });

  roundedRect(context, -10, -13, 20, 27, 6);
  context.fillStyle = "#0b2b39";
  context.fill();
  context.strokeStyle = "#f5fbfc";
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = "#ffd24a";
  context.beginPath();
  context.arc(0, -9, 4, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const speed = Math.hypot(state.vx, state.vz);
  if (speed > 0.3) {
    context.save();
    context.strokeStyle = "rgba(255, 210, 74, 0.7)";
    context.fillStyle = "rgba(255, 210, 74, 0.85)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(drone.x, drone.y);
    context.lineTo(drone.x + state.vx * 4, drone.y - state.vz * 4);
    context.stroke();
    context.restore();
  }

  const vignette = context.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.7,
  );
  vignette.addColorStop(0, "rgba(4, 18, 25, 0)");
  vignette.addColorStop(1, "rgba(2, 14, 20, 0.48)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

export default function FlightSimulator({
  grade,
  trainingMode,
  courseId,
  courseLabel,
  weight,
  weightBasisLabel,
  controllerName,
  onExit,
}: FlightSimulatorProps) {
  const mission = useMemo(
    () =>
      trainingMode === "exam"
        ? buildExamMission(grade)
        : buildCourseMission(courseId, courseLabel),
    [courseId, courseLabel, grade, trainingMode],
  );
  const stageTotal = useMemo(
    () => Math.max(...mission.map((point) => point.stageNumber)),
    [mission],
  );

  const initial = useMemo(
    () => createInitialState(controllerName),
    [controllerName],
  );
  const flightRef = useRef<FlightState>(initial);
  const [snapshot, setSnapshot] = useState<FlightState>(initial);
  const [helpOpen, setHelpOpen] = useState(true);
  const [guideMode, setGuideMode] = useState<PilotGuideMode>("full");
  const guideModeRef = useRef<PilotGuideMode>(guideMode);
  const [announcement, setAnnouncement] = useState(
    "비행 준비가 완료되었습니다.",
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const droneImageRef = useRef<HTMLImageElement | null>(null);
  const pressedKeysRef = useRef(new Set<string>());
  const keyHoldStartedAtRef = useRef(new Map<string, number>());
  const previousButtonsRef = useRef([false, false, false]);

  useEffect(() => {
    guideModeRef.current = guideMode;
  }, [guideMode]);
  const controllerWasActiveRef = useRef(Boolean(controllerName));
  const lastHudUpdateRef = useRef(0);
  const lastAnnouncedWaypointRef = useRef(-1);

  const commitState = useCallback((next: FlightState) => {
    flightRef.current = next;
    setSnapshot({ ...next });
  }, []);

  const toggleMotors = useCallback(() => {
    const current = flightRef.current;
    if (current.phase !== "briefing" && current.phase !== "running") return;

    if (
      current.motorsArmed &&
      (current.altitude > 0.1 || Math.hypot(current.vx, current.vz) > 0.25)
    ) {
      commitState({
        ...current,
        warning: "비행 중에는 시동을 끌 수 없습니다.",
      });
      setAnnouncement("안전을 위해 착륙 후에만 시동을 끌 수 있습니다.");
      return;
    }

    const motorsArmed = !current.motorsArmed;
    const next = {
      ...current,
      phase: "running" as const,
      motorsArmed,
      autoVertical: null,
      vx: motorsArmed ? current.vx : 0,
      vz: motorsArmed ? current.vz : 0,
      vy: motorsArmed ? current.vy : 0,
      pitch: motorsArmed ? current.pitch : 0,
      roll: motorsArmed ? current.roll : 0,
      yawRate: 0,
      warning: motorsArmed
        ? null
        : "시동이 꺼졌습니다.",
    };
    pressedKeysRef.current.clear();
    keyHoldStartedAtRef.current.clear();
    commitState(next);
    setHelpOpen(motorsArmed);
    setAnnouncement(
      motorsArmed
        ? "기체 시동이 완료되었습니다. 프로펠러가 회전합니다."
        : "기체 시동을 껐습니다.",
    );
  }, [commitState]);

  const toggleAutoVertical = useCallback(() => {
    const current = flightRef.current;
    if (current.phase === "briefing") {
      setAnnouncement("먼저 기체 시동 걸기 버튼을 눌러주세요.");
      return;
    }
    if (current.phase !== "running") return;
    if (!current.motorsArmed) {
      commitState({
        ...current,
        warning: "먼저 기체 시동을 걸어주세요.",
      });
      setAnnouncement("자동 이륙 전에 기체 시동을 걸어주세요.");
      return;
    }
    const nextMode: AutoVertical =
      current.altitude < 0.35 ? "takeoff" : "landing";
    commitState({
      ...current,
      autoVertical: nextMode,
      warning:
        nextMode === "takeoff" ? "자동 이륙 중" : "자동 착륙 중",
    });
    setAnnouncement(
      nextMode === "takeoff"
        ? "자동 이륙을 시작합니다."
        : "자동 착륙을 시작합니다.",
    );
  }, [commitState]);

  const togglePause = useCallback(() => {
    const current = flightRef.current;
    if (current.phase === "running") {
      pressedKeysRef.current.clear();
      keyHoldStartedAtRef.current.clear();
      commitState({
        ...current,
        phase: "paused",
        yawRate: 0,
        warning: null,
      });
      setAnnouncement("비행이 일시정지되었습니다.");
      return;
    }
    if (current.phase === "paused") {
      pressedKeysRef.current.clear();
      keyHoldStartedAtRef.current.clear();
      commitState({ ...current, phase: "running", warning: null });
      setAnnouncement("비행을 계속합니다.");
    }
  }, [commitState]);

  const resetFlight = useCallback(() => {
    pressedKeysRef.current.clear();
    keyHoldStartedAtRef.current.clear();
    previousButtonsRef.current = [false, false, false];
    const next = createInitialState(
      flightRef.current.controllerName ?? controllerName,
      "briefing",
    );
    commitState(next);
    lastAnnouncedWaypointRef.current = -1;
    setHelpOpen(true);
    setAnnouncement("훈련을 초기화했습니다. 기체 시동부터 다시 시작합니다.");
  }, [commitState, controllerName]);

  const cycleGuideMode = useCallback(() => {
    const nextMode = NEXT_GUIDE_MODE[guideMode];
    setGuideMode(nextMode);
    setAnnouncement(
      `비행 가이드를 ${GUIDE_MODE_LABELS[nextMode]} 모드로 변경했습니다. ${GUIDE_MODE_DESCRIPTIONS[nextMode]}`,
    );
  }, [guideMode]);

  useEffect(() => {
    const activeCodes = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "KeyM",
      "KeyP",
      "KeyR",
      "Escape",
    ]);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeCodes.has(event.code)) return;
      event.preventDefault();
      pressedKeysRef.current.add(event.code);
      if (
        RAMPED_INPUT_CODES.has(event.code) &&
        !keyHoldStartedAtRef.current.has(event.code)
      ) {
        keyHoldStartedAtRef.current.set(event.code, performance.now());
      }
      if (event.repeat) return;
      if (event.code === "KeyM") toggleMotors();
      if (event.code === "Space") toggleAutoVertical();
      if (event.code === "KeyP" || event.code === "Escape") togglePause();
      if (event.code === "KeyR") resetFlight();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.code);
      keyHoldStartedAtRef.current.delete(event.code);
    };
    const pauseForFocusLoss = () => {
      pressedKeysRef.current.clear();
      keyHoldStartedAtRef.current.clear();
      const current = flightRef.current;
      if (current.phase === "running") {
        commitState({
          ...current,
          phase: "paused",
          yawRate: 0,
          warning: "화면 이탈로 자동 일시정지되었습니다.",
        });
        setAnnouncement("화면 이탈로 비행이 자동 일시정지되었습니다.");
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) pauseForFocusLoss();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", pauseForFocusLoss);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", pauseForFocusLoss);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    commitState,
    resetFlight,
    toggleAutoVertical,
    toggleMotors,
    togglePause,
  ]);

  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = `${import.meta.env.BASE_URL}real-test-hexacopter.png`;
    image.onload = () => {
      droneImageRef.current = image;
    };
    return () => {
      image.onload = null;
      droneImageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let droneThreeRenderer: DroneThreeRendererInstance | null = null;
    let effectDisposed = false;
    void import("./DroneThreeRenderer")
      .then((module) => {
        if (effectDisposed) return;
        try {
          droneThreeRenderer = new module.DroneThreeRenderer();
        } catch {
          droneThreeRenderer = null;
        }
      })
      .catch(() => {
        droneThreeRenderer = null;
      });

    const viewport = { width: 0, height: 0, ratio: 1 };
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      viewport.width = Math.max(1, rect.width);
      viewport.height = Math.max(1, rect.height);
      viewport.ratio = ratio;
      canvas.width = Math.round(viewport.width * ratio);
      canvas.height = Math.round(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let animationFrame = 0;
    let previousTime = performance.now();

    const animate = (time: number) => {
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const state = { ...flightRef.current };

      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find(
        (item): item is Gamepad => Boolean(item),
      );

      if (gamepad) {
        controllerWasActiveRef.current = true;
        state.controllerName = gamepad.id;
        state.inputLabel = "USB 조종기";
      } else {
        state.inputLabel = "키보드";
        state.controllerName = undefined;
        if (
          controllerWasActiveRef.current &&
          flightRef.current.phase === "running"
        ) {
          state.phase = "paused";
          state.yawRate = 0;
          pressedKeysRef.current.clear();
          keyHoldStartedAtRef.current.clear();
          state.warning = "조종기 연결이 해제되어 일시정지했습니다.";
          setAnnouncement("조종기 연결이 해제되어 비행을 일시정지했습니다.");
        }
        controllerWasActiveRef.current = false;
      }

      const buttonTakeoff = Boolean(gamepad?.buttons[0]?.pressed);
      const buttonLanding = Boolean(gamepad?.buttons[1]?.pressed);
      const buttonPause = Boolean(gamepad?.buttons[9]?.pressed);
      const previousButtons = previousButtonsRef.current;

      if (buttonTakeoff && !previousButtons[0]) {
        if (state.phase === "briefing") {
          state.phase = "running";
          state.motorsArmed = true;
          state.autoVertical = null;
          state.warning = null;
        } else if (state.phase === "running") {
          if (!state.motorsArmed) {
            state.motorsArmed = true;
            state.warning = null;
          } else {
            state.autoVertical =
              state.altitude < 0.35 ? "takeoff" : "landing";
          }
        }
      }
      if (
        buttonLanding &&
        !previousButtons[1] &&
        state.phase === "running" &&
        state.motorsArmed
      ) {
        state.autoVertical = "landing";
      }
      if (buttonPause && !previousButtons[2]) {
        if (state.phase === "running") {
          state.phase = "paused";
          state.yawRate = 0;
          pressedKeysRef.current.clear();
          keyHoldStartedAtRef.current.clear();
        } else if (state.phase === "paused") {
          state.phase = "running";
        }
      }
      previousButtonsRef.current = [
        buttonTakeoff,
        buttonLanding,
        buttonPause,
      ];

      if (state.phase === "running") {
        const keys = pressedKeysRef.current;
        const keyStarts = keyHoldStartedAtRef.current;
        const keyboardPitch =
          keyboardHoldStrength(
            keys,
            keyStarts,
            "ArrowUp",
            time,
            KEYBOARD_RAMP.horizontal,
          ) -
          keyboardHoldStrength(
            keys,
            keyStarts,
            "ArrowDown",
            time,
            KEYBOARD_RAMP.horizontal,
          );
        const keyboardRoll =
          keyboardHoldStrength(
            keys,
            keyStarts,
            "ArrowRight",
            time,
            KEYBOARD_RAMP.horizontal,
          ) -
          keyboardHoldStrength(
            keys,
            keyStarts,
            "ArrowLeft",
            time,
            KEYBOARD_RAMP.horizontal,
          );
        const keyboardYaw =
          keyboardHoldStrength(
            keys,
            keyStarts,
            "KeyD",
            time,
            KEYBOARD_RAMP.yaw,
          ) -
          keyboardHoldStrength(
            keys,
            keyStarts,
            "KeyA",
            time,
            KEYBOARD_RAMP.yaw,
          );
        const keyboardThrottle =
          keyboardHoldStrength(
            keys,
            keyStarts,
            "KeyW",
            time,
            KEYBOARD_RAMP.vertical,
          ) -
          keyboardHoldStrength(
            keys,
            keyStarts,
            "KeyS",
            time,
            KEYBOARD_RAMP.vertical,
          );
        const keyboardPeak = Math.max(
          Math.abs(keyboardPitch),
          Math.abs(keyboardRoll),
          Math.abs(keyboardYaw),
          Math.abs(keyboardThrottle),
        );

        if (!gamepad) {
          state.inputLabel =
            keyboardPeak === 0
              ? "키보드 · 누름 가속"
              : keyboardPeak < 0.42
                ? "키보드 · 미세"
                : keyboardPeak < 0.8
                  ? "키보드 · 중속"
                  : "키보드 · 가속";
        }

        const axes = gamepad?.axes ?? [];
        const pitch = clamp(
          keyboardPitch - deadzone(axes[3] ?? 0),
          -1,
          1,
        );
        const roll = clamp(
          keyboardRoll + deadzone(axes[2] ?? 0),
          -1,
          1,
        );
        const yawInput = clamp(
          keyboardYaw + deadzone(axes[0] ?? 0),
          -1,
          1,
        );
        const throttle = clamp(
          keyboardThrottle - deadzone(axes[1] ?? 0),
          -1,
          1,
        );

        const response = clamp(Math.sqrt(32 / weight), 0.65, 1.25);
        const airborne =
          state.motorsArmed &&
          (state.altitude > 0.12 || state.autoVertical === "takeoff");
        const yawRadians = (state.yaw * Math.PI) / 180;
        const acceleration = 5 * response;
        const worldAx =
          (roll * Math.cos(yawRadians) + pitch * Math.sin(yawRadians)) *
          acceleration;
        const worldAz =
          (pitch * Math.cos(yawRadians) - roll * Math.sin(yawRadians)) *
          acceleration;
        const targetYawRate = airborne
          ? yawInput * 55 * response
          : 0;
        state.yawRate +=
          (targetYawRate - state.yawRate) *
          (1 - Math.exp(-8 * delta));

        if (airborne) {
          state.vx += worldAx * delta;
          state.vz += worldAz * delta;
          state.yaw =
            (state.yaw + state.yawRate * delta + 360) % 360;
        }

        const activeWaypoint = mission[state.waypointIndex];
        const windActive =
          activeWaypoint?.stage.includes("측풍") ||
          (trainingMode === "course" && courseId === "crosswind");
        if (state.motorsArmed && windActive && state.altitude > 0.2) {
          state.vx += (0.65 + Math.sin(state.elapsed * 0.8) * 0.18) * delta;
        }

        const horizontalDamping = Math.exp(-2.5 * delta);
        state.vx *= horizontalDamping;
        state.vz *= horizontalDamping;
        const horizontalSpeed = Math.hypot(state.vx, state.vz);
        if (horizontalSpeed > 4.5) {
          const speedScale = 4.5 / horizontalSpeed;
          state.vx *= speedScale;
          state.vz *= speedScale;
        }

        // 실제 멀티콥터처럼 입력 방향으로 기울고, 스틱을 놓으면 진행 방향의
        // 반대로 살짝 기울며 제동한 뒤 호버링 자세로 복귀합니다.
        const attitudeYaw = (state.yaw * Math.PI) / 180;
        const forwardSpeed =
          state.vx * Math.sin(attitudeYaw) +
          state.vz * Math.cos(attitudeYaw);
        const rightSpeed =
          state.vx * Math.cos(attitudeYaw) -
          state.vz * Math.sin(attitudeYaw);
        const pitchWeight = smoothstep(0.04, 0.14, Math.abs(pitch));
        const rollWeight = smoothstep(0.04, 0.14, Math.abs(roll));
        const brakingPitch = -signedSpeedRatio(forwardSpeed) * 8;
        const brakingRoll = -signedSpeedRatio(rightSpeed) * 8;
        let targetPitch =
          brakingPitch + (pitch * 17 - brakingPitch) * pitchWeight;
        let targetRoll =
          brakingRoll + (roll * 17 - brakingRoll) * rollWeight;
        targetPitch = clamp(targetPitch, -22, 22);
        targetRoll = clamp(targetRoll, -22, 22);
        if (!state.motorsArmed || state.altitude <= 0.08) {
          targetPitch = 0;
          targetRoll = 0;
        }
        const commandActive =
          Math.max(Math.abs(pitch), Math.abs(roll)) > 0.04;
        const attitudeRate =
          !state.motorsArmed || state.altitude <= 0.08
            ? 11
            : commandActive
              ? 7.5
              : 5;
        const attitudeAlpha = 1 - Math.exp(-attitudeRate * delta);
        state.pitch += (targetPitch - state.pitch) * attitudeAlpha;
        state.roll += (targetRoll - state.roll) * attitudeAlpha;

        let desiredVerticalSpeed = state.motorsArmed
          ? throttle * 1.8 * response
          : 0;
        if (state.motorsArmed && state.autoVertical === "takeoff") {
          desiredVerticalSpeed = state.altitude < 2.95 ? 1.55 : 0;
          if (state.altitude >= 2.95) {
            state.autoVertical = null;
            state.warning = null;
          }
        } else if (state.motorsArmed && state.autoVertical === "landing") {
          desiredVerticalSpeed = -0.78;
          if (keys.has("KeyW") || throttle > 0.45) {
            state.autoVertical = null;
            state.warning = "자동 착륙이 해제되었습니다.";
          }
        }

        state.vy +=
          (desiredVerticalSpeed - state.vy) *
          Math.min(1, delta * 4.5 * response);
        const previousAltitude = state.altitude;
        state.altitude += state.vy * delta;
        state.x += state.vx * delta;
        state.z += state.vz * delta;

        if (state.altitude <= 0) {
          const impactSpeed = Math.abs(state.vy);
          const groundSpeed = Math.hypot(state.vx, state.vz);
          const wasAirborne = previousAltitude > 0.08;
          state.altitude = 0;
          if (
            wasAirborne &&
            state.autoVertical !== "landing" &&
            (impactSpeed > 2.25 || groundSpeed > 3.2)
          ) {
            state.phase = "crashed";
            state.motorsArmed = false;
            state.pitch = 0;
            state.roll = 0;
            state.yawRate = 0;
            state.warning = "강한 충격이 감지되었습니다.";
            state.penalty += 20;
            setAnnouncement("강한 충격으로 비행이 종료되었습니다.");
          }
          state.vy = 0;
          state.vx *= 0.7;
          state.vz *= 0.7;
          state.pitch = 0;
          state.roll = 0;
          state.yawRate = 0;
          state.autoVertical = null;
        }

        const outsideBoundary =
          state.x < FIELD.minX ||
          state.x > FIELD.maxX ||
          state.z < FIELD.minZ ||
          state.z > FIELD.maxZ;
        if (outsideBoundary) {
          state.x = clamp(state.x, FIELD.minX, FIELD.maxX);
          state.z = clamp(state.z, FIELD.minZ, FIELD.maxZ);
          state.vx *= -0.18;
          state.vz *= -0.18;
          state.warning = "비행구역 경계입니다. 중앙으로 복귀하세요.";
          if (!state.boundaryContact) state.penalty += 3;
          state.boundaryContact = true;
        } else {
          state.boundaryContact = false;
          if (state.warning?.includes("경계")) state.warning = null;
        }

        if (
          state.phase === "running" &&
          state.motorsArmed &&
          activeWaypoint
        ) {
          const horizontalDistance = Math.hypot(
            state.x - activeWaypoint.x,
            state.z - activeWaypoint.z,
          );
          const horizontalVelocity = Math.hypot(state.vx, state.vz);
          const altitudeDifference = Math.abs(
            state.altitude - activeWaypoint.altitude,
          );
          const totalVelocity = Math.hypot(
            state.vx,
            state.vz,
            state.vy,
          );
          const speedWithinLimit = activeWaypoint.mustStop
            ? totalVelocity < 0.6
            : horizontalVelocity < 3.4;
          const headingWithinLimit =
            activeWaypoint.targetYaw === undefined ||
            yawError(state.yaw, activeWaypoint.targetYaw) <=
              (activeWaypoint.yawTolerance ?? 12);
          const targetReached = activeWaypoint.landing
            ? state.altitude < 0.1 &&
              horizontalDistance <= (activeWaypoint.radius ?? 5) &&
              horizontalVelocity < 1.6
            : horizontalDistance <= (activeWaypoint.radius ?? 4) &&
              altitudeDifference <= 1.15 &&
              speedWithinLimit &&
              headingWithinLimit;

          if (targetReached) {
            state.holdProgress += delta;
          } else {
            state.holdProgress = activeWaypoint.mustStop
              ? 0
              : Math.max(0, state.holdProgress - delta * 0.45);
          }

          if (state.holdProgress >= (activeWaypoint.hold ?? 0.8)) {
            state.waypointIndex += 1;
            state.holdProgress = 0;
            if (state.waypointIndex >= mission.length) {
              state.phase = "completed";
              state.vx = 0;
              state.vz = 0;
              state.vy = 0;
              state.pitch = 0;
              state.roll = 0;
              state.yawRate = 0;
              state.motorsArmed = false;
              state.warning = null;
              setAnnouncement("모든 비행 평가동작을 완료했습니다.");
            }
          }
        }

        if (state.motorsArmed) {
          state.elapsed += delta;
          const drainRate = 0.045 + weight / 9000;
          state.battery = Math.max(0, state.battery - drainRate * delta);
          if (state.battery <= 10 && !state.warning) {
            state.warning = "배터리 잔량이 낮습니다.";
          }
        }
      }

      flightRef.current = state;

      const activeWaypoint = mission[Math.min(state.waypointIndex, mission.length - 1)];
      const windActive =
        Boolean(activeWaypoint?.stage.includes("측풍")) ||
        (trainingMode === "course" && courseId === "crosswind");
      context.setTransform(
        viewport.ratio,
        0,
        0,
        viewport.ratio,
        0,
        0,
      );
      let droneLayer: PilotDroneLayer | null = null;
      if (droneThreeRenderer) {
        try {
          droneLayer = droneThreeRenderer.render(
            state,
            viewport.width,
            viewport.height,
          );
        } catch {
          droneThreeRenderer.dispose();
          droneThreeRenderer = null;
        }
      }
      drawPilotScene(
        context,
        viewport.width,
        viewport.height,
        state,
        mission,
        windActive,
        {
          droneImage: droneImageRef.current,
          droneLayer,
          guideMode: guideModeRef.current,
        },
      );

      if (state.waypointIndex !== lastAnnouncedWaypointRef.current) {
        lastAnnouncedWaypointRef.current = state.waypointIndex;
        if (activeWaypoint && state.phase === "running") {
          setAnnouncement(
            `${activeWaypoint.stage}, 다음 목표: ${activeWaypoint.label}`,
          );
        }
      }

      if (time - lastHudUpdateRef.current > 90) {
        lastHudUpdateRef.current = time;
        setSnapshot({ ...state });
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => {
      effectDisposed = true;
      droneThreeRenderer?.dispose();
      droneThreeRenderer = null;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [courseId, mission, trainingMode, weight]);

  const activeWaypoint =
    mission[Math.min(snapshot.waypointIndex, mission.length - 1)];
  const stageNumber = activeWaypoint?.stageNumber ?? stageTotal;
  const progress = clamp(snapshot.waypointIndex / mission.length, 0, 1);
  const targetHold = activeWaypoint?.hold ?? 0.8;
  const holdProgress = clamp(snapshot.holdProgress / targetHold, 0, 1);
  const speed = Math.hypot(snapshot.vx, snapshot.vz);
  const pilotDistance = distanceFromPilot(snapshot.x, snapshot.z);
  const windActive =
    Boolean(activeWaypoint?.stage.includes("측풍")) ||
    (trainingMode === "course" && courseId === "crosswind");
  const finalScore = Math.max(
    0,
    Math.round(100 - snapshot.penalty - snapshot.elapsed / 90),
  );
  const missionTitle =
    trainingMode === "exam" ? `${grade}종 전체 시험` : courseLabel;

  const pressTouch = (code: string) => (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressedKeysRef.current.add(code);
    if (
      RAMPED_INPUT_CODES.has(code) &&
      !keyHoldStartedAtRef.current.has(code)
    ) {
      keyHoldStartedAtRef.current.set(code, performance.now());
    }
  };
  const releaseTouch = (code: string) => (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    pressedKeysRef.current.delete(code);
    keyHoldStartedAtRef.current.delete(code);
  };

  const touchButtonProps = (code: string, label: string) => ({
    "aria-label": label,
    onPointerDown: pressTouch(code),
    onPointerUp: releaseTouch(code),
    onPointerCancel: releaseTouch(code),
  });

  const flightStyle = {
    "--mission-progress": `${progress * 100}%`,
    "--target-progress": `${holdProgress * 100}%`,
  } as CSSProperties;

  return (
    <main className="flight-shell" style={flightStyle}>
      <section className="flight-stage" aria-label={`${missionTitle} 비행 훈련장`}>
        <canvas
          ref={canvasRef}
          className="flight-canvas"
          role="img"
          aria-label={`조종자 시점 비행장과 전체 지도. 기체 위치 x ${snapshot.x.toFixed(1)}m, z ${snapshot.z.toFixed(1)}m, 고도 ${snapshot.altitude.toFixed(1)}m. 현재 목표: ${activeWaypoint?.label ?? "훈련 완료"}`}
        />
        <div className="flight-stage-glow" aria-hidden="true" />
      </section>

      <header className="flight-topbar">
        <div className="flight-brand">
          <span className="mini-drone-mark" aria-hidden="true">◆</span>
          <span>
            <strong>드론 실기 시뮬레이터</strong>
            <small>{missionTitle}</small>
          </span>
        </div>

        <div className="flight-top-actions">
          <span
            className={`input-pill ${snapshot.controllerName ? "is-connected" : ""}`}
            title={snapshot.controllerName}
          >
            <i aria-hidden="true" />
            {snapshot.inputLabel}
          </span>
          <span
            className={`input-pill motor-pill ${snapshot.motorsArmed ? "is-armed" : ""}`}
            aria-label={`기체 시동 ${snapshot.motorsArmed ? "켜짐" : "꺼짐"}`}
          >
            <i aria-hidden="true" />
            {snapshot.motorsArmed ? "MOTOR ON" : "MOTOR OFF"}
          </span>
          <button
            type="button"
            className="hud-action guide-mode-toggle"
            onClick={cycleGuideMode}
            title={`비행 가이드: ${GUIDE_MODE_LABELS[guideMode]} — ${GUIDE_MODE_DESCRIPTIONS[guideMode]}`}
            aria-label={`비행 가이드 ${GUIDE_MODE_LABELS[guideMode]} 모드. 눌러서 다음 모드로 변경`}
          >
            <span aria-hidden="true">가이드</span>
            <b>{GUIDE_MODE_LABELS[guideMode]}</b>
          </button>
          <button
            type="button"
            className="hud-action hud-help-toggle"
            onClick={() => setHelpOpen((open) => !open)}
            aria-expanded={helpOpen}
            aria-label="조작 도움말"
          >
            ?
          </button>
          <button
            type="button"
            className="hud-action"
            onClick={togglePause}
            aria-label="비행 일시정지"
            aria-keyshortcuts="P Escape"
          >
            Ⅱ
          </button>
          <button
            type="button"
            className="hud-action hud-exit"
            onClick={onExit}
          >
            설정
          </button>
        </div>
      </header>

      <div className="flight-hud">
        <section className="objective-card" aria-label="현재 비행 목표">
          <div className="objective-heading">
            <span>STAGE {stageNumber} / {stageTotal}</span>
            <b>{Math.min(snapshot.waypointIndex + 1, mission.length)} / {mission.length}</b>
          </div>
          <h1>{activeWaypoint?.stage ?? "훈련 완료"}</h1>
          <p>{activeWaypoint?.label ?? "모든 평가동작을 완료했습니다."}</p>
          <div className="mission-progress" aria-hidden="true">
            <i />
          </div>
          {snapshot.holdProgress > 0 && snapshot.phase === "running" && (
            <div className="target-hold">
              <span>목표 유지</span>
              <i><b /></i>
            </div>
          )}
        </section>

        <section className="telemetry-card" aria-label="비행 계기">
          <div>
            <span>고도</span>
            <strong>{snapshot.altitude.toFixed(1)}</strong>
            <small>m</small>
          </div>
          <div>
            <span>거리</span>
            <strong>{pilotDistance.toFixed(1)}</strong>
            <small>m</small>
          </div>
          <div>
            <span>속도</span>
            <strong>{speed.toFixed(1)}</strong>
            <small>m/s</small>
          </div>
          <div>
            <span>방향</span>
            <strong>{Math.round(snapshot.yaw)}</strong>
            <small>°</small>
          </div>
          <div>
            <span>시간</span>
            <strong>{formatTime(snapshot.elapsed)}</strong>
          </div>
          <div className={snapshot.battery <= 20 ? "is-warning" : ""}>
            <span>배터리</span>
            <strong>{Math.round(snapshot.battery)}</strong>
            <small>%</small>
          </div>
        </section>
      </div>

      <div className="pilot-view-badge" aria-label="현재 화면: 조종자 시점">
        <i aria-hidden="true" />
        PILOT VIEW · 조종자 시점
      </div>

      {windActive && (
        <div className="wind-indicator" role="status">
          <span aria-hidden="true">➜</span>
          측풍 동→서 2.4 m/s
        </div>
      )}

      {snapshot.warning && snapshot.phase === "running" && (
        <div className="flight-warning" role="status">
          <span aria-hidden="true">!</span>
          {snapshot.warning}
        </div>
      )}

      {helpOpen && snapshot.phase === "running" && (
        <aside className="flight-help" aria-label="조작 방법">
          <div className="help-title">
            <strong>조작 방법</strong>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              aria-label="조작 도움말 닫기"
            >
              ×
            </button>
          </div>
          <dl>
            <div><dt>W / S</dt><dd>상승 · 하강</dd></div>
            <div><dt>A / D</dt><dd>러더 좌 · 우</dd></div>
            <div><dt>↑ / ↓</dt><dd>전진 · 후진</dd></div>
            <div><dt>← / →</dt><dd>좌 · 우 이동</dd></div>
            <div><dt>M</dt><dd>기체 시동 · 정지</dd></div>
            <div><dt>SPACE</dt><dd>자동 이륙 · 착륙</dd></div>
          </dl>
          <p>방향키 이동은 기체의 기수 방향 기준 · 짧게 누르면 미세조작</p>
          <p>길게 누르면 점진 가속 · P/ESC 일시정지</p>
          <p>USB 조종기: MODE 2 · A 버튼 시동 후 자동 이륙/착륙</p>
        </aside>
      )}

      {snapshot.phase === "running" && (
        <button
          type="button"
          className={`auto-flight-button ${snapshot.motorsArmed ? "" : "engine-start-button"}`}
          onClick={snapshot.motorsArmed ? toggleAutoVertical : toggleMotors}
          aria-keyshortcuts={snapshot.motorsArmed ? "Space" : "M"}
          aria-pressed={!snapshot.motorsArmed ? false : undefined}
        >
          <span aria-hidden="true">
            {!snapshot.motorsArmed
              ? "⏻"
              : snapshot.altitude < 0.35
                ? "↑"
                : "↓"}
          </span>
          {!snapshot.motorsArmed
            ? "시동 걸기"
            : snapshot.altitude < 0.35
              ? "자동 이륙"
              : "자동 착륙"}
          <small>{snapshot.motorsArmed ? "SPACE" : "M"}</small>
        </button>
      )}

      <div className="touch-controls" aria-label="터치 비행 조작">
        <div className="touch-cluster altitude-cluster">
          <button type="button" {...touchButtonProps("KeyW", "상승")}>W</button>
          <button type="button" {...touchButtonProps("KeyA", "왼쪽 러더")}>A</button>
          <button type="button" {...touchButtonProps("KeyD", "오른쪽 러더")}>D</button>
          <button type="button" {...touchButtonProps("KeyS", "하강")}>S</button>
        </div>
        <div className="touch-cluster direction-cluster">
          <button type="button" {...touchButtonProps("ArrowUp", "전진")}>↑</button>
          <button type="button" {...touchButtonProps("ArrowLeft", "왼쪽 이동")}>←</button>
          <button type="button" {...touchButtonProps("ArrowRight", "오른쪽 이동")}>→</button>
          <button type="button" {...touchButtonProps("ArrowDown", "후진")}>↓</button>
        </div>
      </div>

      {snapshot.phase === "briefing" && (
        <div className="flight-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
          <section className="flight-dialog briefing-dialog">
            <span className="dialog-kicker">PRE-FLIGHT BRIEFING</span>
            <h2 id="briefing-title">{missionTitle}</h2>
            <p>
              지상 조종자 위치에서 기체를 바라보며 노란 목표지점을
              순서대로 통과해 주세요. 먼저 기체 시동을 걸면 프로펠러가
              회전하며, W키 상승 또는 SPACE 자동이륙으로 출발합니다.
            </p>
            <div className="briefing-meta">
              <div><span>시험 종별</span><strong>{grade}종</strong></div>
              <div><span>기체 설정</span><strong>{weight.toFixed(1)} kg</strong></div>
              <div><span>중량 기준</span><strong>{weightBasisLabel}</strong></div>
              <div><span>평가 단계</span><strong>{stageTotal}단계</strong></div>
            </div>
            <div className="briefing-controls">
              <span><b>W · S</b> 상승 · 하강</span>
              <span><b>A · D</b> 러더 좌 · 우</span>
              <span><b>방향키</b> 전후좌우 이동</span>
              <span><b>M</b> 기체 시동 · 정지</span>
              <span><b>SPACE</b> 이륙 · 착륙</span>
            </div>
            <button
              type="button"
              className="dialog-primary"
              onClick={toggleMotors}
              aria-keyshortcuts="M"
              autoFocus
            >
              기체 시동 걸기
              <span aria-hidden="true">⏻</span>
            </button>
            <small className="briefing-note">
              USB 조종기는 MODE 2 기본축으로 작동하며 A 버튼으로 시동을 겁니다.
            </small>
          </section>
        </div>
      )}

      {snapshot.phase === "paused" && (
        <div className="flight-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <section className="flight-dialog">
            <span className="dialog-kicker">FLIGHT PAUSED</span>
            <h2 id="pause-title">비행 일시정지</h2>
            <p>{snapshot.warning ?? "현재 위치와 시간이 안전하게 정지되었습니다."}</p>
            <div className="dialog-actions">
              <button type="button" className="dialog-primary" onClick={togglePause} autoFocus>
                계속 비행
              </button>
              <button type="button" className="dialog-secondary" onClick={resetFlight}>
                처음부터 다시
              </button>
              <button type="button" className="dialog-secondary" onClick={onExit}>
                설정으로 나가기
              </button>
            </div>
          </section>
        </div>
      )}

      {snapshot.phase === "completed" && (
        <div className="flight-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <section className="flight-dialog result-dialog">
            <span className="result-check" aria-hidden="true">✓</span>
            <span className="dialog-kicker">MISSION COMPLETE</span>
            <h2 id="result-title">비행 훈련 완료</h2>
            <p>{missionTitle}의 모든 평가동작을 순서대로 완료했습니다.</p>
            <div className="result-score">
              <strong>{finalScore}</strong>
              <span>훈련 점수</span>
            </div>
            <div className="result-stats">
              <span>비행시간 <b>{formatTime(snapshot.elapsed)}</b></span>
              <span>배터리 <b>{Math.round(snapshot.battery)}%</b></span>
              <span>감점 <b>{snapshot.penalty}점</b></span>
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-primary" onClick={resetFlight} autoFocus>
                다시 비행
              </button>
              <button type="button" className="dialog-secondary" onClick={onExit}>
                설정으로 돌아가기
              </button>
            </div>
          </section>
        </div>
      )}

      {snapshot.phase === "crashed" && (
        <div className="flight-overlay is-danger" role="dialog" aria-modal="true" aria-labelledby="crash-title">
          <section className="flight-dialog">
            <span className="dialog-kicker">FLIGHT TERMINATED</span>
            <h2 id="crash-title">강한 착지 충격 감지</h2>
            <p>하강 속도나 수평 속도가 안전 범위를 초과했습니다. 기체를 초기화한 뒤 다시 시도해 주세요.</p>
            <div className="dialog-actions">
              <button type="button" className="dialog-primary" onClick={resetFlight} autoFocus>
                훈련 다시 시작
              </button>
              <button type="button" className="dialog-secondary" onClick={onExit}>
                설정으로 나가기
              </button>
            </div>
          </section>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </main>
  );
}
