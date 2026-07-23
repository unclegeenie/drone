import { drawFieldMiniMap } from "./FieldMiniMap";
import {
  COURSE_CIRCLE,
  COURSE_CONES,
  COURSE_POINTS,
  EMERGENCY_PADS,
  FIELD_BOUNDS,
  downwashFootprint,
  getDownwashIntensity,
} from "./CourseGeometry";

export type PilotWaypoint = {
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

export type PilotFlightState = {
  x: number;
  z: number;
  altitude: number;
  vx: number;
  vz: number;
  vy: number;
  yaw: number;
  pitch: number;
  roll: number;
  elapsed: number;
  waypointIndex: number;
  motorsArmed: boolean;
};

export type PilotGuideMode = "full" | "target" | "off";

export type PilotDroneLayer = {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PilotSceneOptions = {
  droneImage?: HTMLImageElement | null;
  droneLayer?: PilotDroneLayer | null;
  guideMode?: PilotGuideMode;
};

export const PILOT_CAMERA = {
  x: COURSE_POINTS.P.x,
  z: COURSE_POINTS.P.z,
  height: 1.65,
};

// 실제 거리 평가 기준의 P점은 유지하되, 사람 눈높이와 조종자가 서는 좌측
// 여유 공간을 화면 투영에 반영합니다. 중심선 H-A-C-E가 깊이에 따라 자연스럽게
// 벌어져 실제 시험장에서 느끼는 사선 거리감을 제공합니다.
const VIEW_EYE_HEIGHT = 1.8;
const VIEW_EYE_X = PILOT_CAMERA.x - 1.6;
const VIEW_YAW = Math.atan2(
  COURSE_POINTS.C.x - VIEW_EYE_X,
  COURSE_POINTS.C.z - PILOT_CAMERA.z,
);
const VIEW_YAW_COSINE = Math.cos(VIEW_YAW);
const VIEW_YAW_SINE = Math.sin(VIEW_YAW);
const VIEW_HORIZON_RATIO = 0.605;

export const PILOT_VIEW_CONFIG = {
  eyeX: VIEW_EYE_X,
  eyeHeight: VIEW_EYE_HEIGHT,
  eyeZ: PILOT_CAMERA.z,
  yaw: VIEW_YAW,
  horizonRatio: VIEW_HORIZON_RATIO,
} as const;

const FIELD_LIMITS = FIELD_BOUNDS;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type ProjectedPoint = {
  x: number;
  y: number;
  depth: number;
  focal: number;
  visible: boolean;
};

export function distanceFromPilot(x: number, z: number) {
  return Math.hypot(x - PILOT_CAMERA.x, z - PILOT_CAMERA.z);
}

export function getPilotFocal(width: number, height: number) {
  // 시험장과 기체가 기존보다 약 8% 가까이 보이도록 시야를 살짝 당깁니다.
  // 전체 코스가 화면 안에 남도록 과도한 줌은 피합니다.
  return Math.min(width * 0.54, height * 0.96);
}

function toViewSpace(x: number, z: number) {
  const worldX = x - VIEW_EYE_X;
  const worldZ = z - PILOT_CAMERA.z;

  return {
    cameraX:
      worldX * VIEW_YAW_COSINE - worldZ * VIEW_YAW_SINE,
    depth:
      worldX * VIEW_YAW_SINE + worldZ * VIEW_YAW_COSINE,
  };
}

function projectWorld(
  x: number,
  altitude: number,
  z: number,
  width: number,
  height: number,
): ProjectedPoint {
  const { cameraX, depth } = toViewSpace(x, z);
  const safeDepth = Math.max(0.75, depth);
  // 16:9 화면에서 약 90° 수평, 59° 수직 시야각이 되도록 한 실제 카메라형
  // 투영입니다. 가로·세로 초점거리를 같게 유지해 화면 비율에 따른 왜곡도
  // 방지합니다.
  const focal = getPilotFocal(width, height);
  // 배경 사진의 평탄한 잔디밭 소실선(약 61%)에 맞춰 카메라가 아주 약하게
  // 아래를 향하도록 두면 가까운 H와 먼 E가 세로로도 분리됩니다.
  const horizon = height * VIEW_HORIZON_RATIO;

  return {
    x: width / 2 + (cameraX / safeDepth) * focal,
    y:
      horizon -
      ((altitude - VIEW_EYE_HEIGHT) / safeDepth) * focal,
    depth,
    focal,
    visible: depth > 1.5,
  };
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

function drawGroundEllipse(
  context: CanvasRenderingContext2D,
  point: ProjectedPoint,
  radiusMeters: number,
  color: string,
  active = false,
  pulse = 1,
) {
  if (!point.visible) return;
  const radiusX = clamp(
    (radiusMeters * point.focal * 0.38) / point.depth,
    9,
    145,
  );
  const radiusY = clamp(radiusX * 0.2, 3, 29);

  context.save();
  context.translate(point.x, point.y);
  context.scale(pulse, pulse);
  context.strokeStyle = color;
  context.fillStyle = active
    ? "rgba(255, 210, 74, 0.12)"
    : "rgba(255, 255, 255, 0.025)";
  context.lineWidth = active ? 3 : 1.4;
  context.beginPath();
  context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.setLineDash([4, 5]);
  context.beginPath();
  context.ellipse(
    0,
    0,
    radiusX * 0.58,
    radiusY * 0.58,
    0,
    0,
    Math.PI * 2,
  );
  context.stroke();
  context.restore();
}

function drawPerspectiveGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(236, 248, 239, 0.13)";

  for (
    let x = Math.ceil(FIELD_LIMITS.minX / 5) * 5;
    x <= FIELD_LIMITS.maxX;
    x += 5
  ) {
    const near = projectWorld(
      x,
      0,
      FIELD_LIMITS.minZ + 4,
      width,
      height,
    );
    const far = projectWorld(
      x,
      0,
      FIELD_LIMITS.maxZ,
      width,
      height,
    );
    context.beginPath();
    context.moveTo(near.x, near.y);
    context.lineTo(far.x, far.y);
    context.stroke();
  }

  for (
    let z = Math.ceil((FIELD_LIMITS.minZ + 4) / 5) * 5;
    z <= FIELD_LIMITS.maxZ;
    z += 5
  ) {
    const left = projectWorld(FIELD_LIMITS.minX, 0, z, width, height);
    const right = projectWorld(FIELD_LIMITS.maxX, 0, z, width, height);
    context.beginPath();
    context.moveTo(left.x, left.y);
    context.lineTo(right.x, right.y);
    context.stroke();
  }

  const corners = [
    projectWorld(
      FIELD_LIMITS.minX,
      0,
      FIELD_LIMITS.minZ + 4,
      width,
      height,
    ),
    projectWorld(
      FIELD_LIMITS.maxX,
      0,
      FIELD_LIMITS.minZ + 4,
      width,
      height,
    ),
    projectWorld(FIELD_LIMITS.maxX, 0, FIELD_LIMITS.maxZ, width, height),
    projectWorld(FIELD_LIMITS.minX, 0, FIELD_LIMITS.maxZ, width, height),
  ];
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 2;
  context.setLineDash([9, 8]);
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.stroke();
  context.restore();
}

function drawGroundPolyline(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: Array<{ x: number; z: number }>,
  color: string,
  lineWidth = 1.5,
  dashed = false,
) {
  const projected = points
    .map((point) => projectWorld(point.x, 0.015, point.z, width, height))
    .filter((point) => point.visible);
  if (projected.length < 2) return;

  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (dashed) context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(projected[0].x, projected[0].y);
  projected.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.stroke();
  context.restore();
}

function drawGroundPad(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  x: number,
  z: number,
  size: number,
  label: string,
  fill: string,
  stroke: string,
) {
  const half = size / 2;
  const corners = [
    projectWorld(x - half, 0.025, z - half, width, height),
    projectWorld(x + half, 0.025, z - half, width, height),
    projectWorld(x + half, 0.025, z + half, width, height),
    projectWorld(x - half, 0.025, z + half, width, height),
  ];
  if (corners.some((point) => !point.visible)) return;

  context.save();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 1.8;
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.fill();
  context.stroke();

  const center = projectWorld(x, 0.04, z, width, height);
  const fontSize = clamp((center.focal / center.depth) * 0.28, 8, 19);
  context.fillStyle = "rgba(5, 24, 30, 0.9)";
  context.font = `900 ${fontSize}px Pretendard, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, center.x, center.y - fontSize * 0.12);
  context.restore();
}

function drawCourseInfrastructure(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  drawGroundPolyline(
    context,
    width,
    height,
    [COURSE_POINTS.H, COURSE_POINTS.A, COURSE_POINTS.C, COURSE_POINTS.E],
    "rgba(247, 250, 241, 0.64)",
    1.6,
  );
  drawGroundPolyline(
    context,
    width,
    height,
    [COURSE_POINTS.B, COURSE_POINTS.A, COURSE_POINTS.D],
    "rgba(247, 250, 241, 0.5)",
    1.4,
  );

  const circlePoints = Array.from({ length: 49 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 48;
    return {
      x: COURSE_CIRCLE.centerX + Math.cos(angle) * COURSE_CIRCLE.radius,
      z: COURSE_CIRCLE.centerZ + Math.sin(angle) * COURSE_CIRCLE.radius,
    };
  });
  drawGroundPolyline(
    context,
    width,
    height,
    circlePoints,
    "rgba(245, 249, 239, 0.46)",
    1.5,
    true,
  );

  EMERGENCY_PADS.forEach((pad) => {
    drawGroundPad(
      context,
      width,
      height,
      pad.x,
      pad.z,
      2,
      "F",
      "rgba(245, 77, 47, 0.78)",
      "rgba(255, 242, 205, 0.82)",
    );
  });
  drawGroundPad(
    context,
    width,
    height,
    COURSE_POINTS.H.x,
    COURSE_POINTS.H.z,
    3.8,
    "H",
    "rgba(246, 204, 71, 0.8)",
    "rgba(255, 249, 220, 0.9)",
  );
}

function drawDownwashGround(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PilotFlightState,
) {
  if (!state.motorsArmed) return;

  const ground = projectWorld(state.x, 0.035, state.z, width, height);
  if (!ground.visible) return;

  const footprint = downwashFootprint(state.altitude);
  const side = projectWorld(
    state.x + footprint,
    0.035,
    state.z,
    width,
    height,
  );
  const far = projectWorld(
    state.x,
    0.035,
    state.z + footprint,
    width,
    height,
  );
  const near = projectWorld(
    state.x,
    0.035,
    state.z - footprint,
    width,
    height,
  );
  const radiusX = clamp(Math.abs(side.x - ground.x), 12, 148);
  const radiusY = clamp(
    Math.max(Math.abs(far.y - ground.y), Math.abs(near.y - ground.y)),
    4,
    38,
  );
  const descentBoost = clamp(-state.vy * 0.11, 0, 0.26);
  const strength = clamp(
    1 - Math.max(0, state.altitude) / 14 + descentBoost,
    0.14,
    1,
  );

  context.save();
  context.translate(ground.x, ground.y);
  context.scale(radiusX, radiusY);
  const wash = context.createRadialGradient(0, 0, 0.05, 0, 0, 1);
  wash.addColorStop(0, `rgba(203, 231, 170, ${0.035 + strength * 0.09})`);
  wash.addColorStop(0.48, `rgba(72, 111, 55, ${0.08 + strength * 0.12})`);
  wash.addColorStop(1, "rgba(39, 76, 36, 0)");
  context.fillStyle = wash;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.strokeStyle = `rgba(196, 230, 168, ${0.12 + strength * 0.24})`;
  context.lineWidth = 0.8 + strength * 0.8;
  context.setLineDash([4, 7]);
  for (let ring = 0; ring < 2; ring += 1) {
    const phase =
      (state.elapsed * (0.48 + ring * 0.08) + ring * 0.42) % 1;
    context.beginPath();
    context.ellipse(
      ground.x,
      ground.y,
      radiusX * (0.38 + phase * 0.58),
      radiusY * (0.38 + phase * 0.58),
      0,
      Math.PI * 1.04,
      Math.PI * 1.96,
    );
    context.stroke();
  }
  context.restore();

  const horizontalSpeed = Math.hypot(state.vx, state.vz);
  const velocityX = horizontalSpeed > 0.12 ? state.vx / horizontalSpeed : 0;
  const velocityZ = horizontalSpeed > 0.12 ? state.vz / horizontalSpeed : 0;
  const bladeLineWidth = clamp(
    (ground.focal / ground.depth) * 0.035,
    0.65,
    1.7,
  );

  context.save();
  context.lineCap = "round";
  for (let index = 0; index < 42; index += 1) {
    const angle = index * 2.399963 + (index % 3) * 0.07;
    const radialProgress = 0.24 + ((index * 7) % 29) / 39;
    const radialDistance = footprint * radialProgress;
    const flutter =
      Math.sin(
        state.elapsed * (5.1 + (index % 4) * 0.48) + index * 1.73,
      ) *
      0.16 *
      strength;
    const radialX = Math.cos(angle + flutter);
    const radialZ = Math.sin(angle + flutter);
    let flowX = radialX + velocityX * clamp(horizontalSpeed * 0.13, 0, 0.38);
    let flowZ = radialZ + velocityZ * clamp(horizontalSpeed * 0.13, 0, 0.38);
    const flowLength = Math.hypot(flowX, flowZ) || 1;
    flowX /= flowLength;
    flowZ /= flowLength;

    const baseX = state.x + radialX * radialDistance;
    const baseZ = state.z + radialZ * radialDistance;
    const bendLength =
      0.34 + strength * (0.46 + (index % 5) * 0.07);
    const base = projectWorld(baseX, 0.045, baseZ, width, height);
    const tip = projectWorld(
      baseX + flowX * bendLength,
      0.05,
      baseZ + flowZ * bendLength,
      width,
      height,
    );
    if (!base.visible || !tip.visible) continue;

    context.globalAlpha =
      (0.2 + strength * 0.55) * (0.7 + (index % 4) * 0.08);
    context.strokeStyle =
      index % 3 === 0 ? "#d4e4aa" : index % 3 === 1 ? "#769653" : "#adc47b";
    context.lineWidth = bladeLineWidth;
    context.beginPath();
    context.moveTo(base.x, base.y);
    context.quadraticCurveTo(
      base.x + (tip.x - base.x) * 0.34,
      base.y - 1.2 - strength * 1.3,
      tip.x,
      tip.y,
    );
    context.stroke();
  }
  context.restore();
}

function drawCourseCone(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  marker: (typeof COURSE_CONES)[number],
  state: PilotFlightState,
  markerIndex: number,
) {
  const base = projectWorld(marker.x, 0.02, marker.z, width, height);
  // 실제 시험장에서 식별하기 쉬운 세장형 라바콘 비율을 반영합니다.
  // 바닥 폭은 그대로 두고 높이만 키워 원거리에서도 겹치지 않게 합니다.
  const tip = projectWorld(marker.x, 1.18, marker.z, width, height);
  if (!base.visible || !tip.visible) return;

  const left = projectWorld(marker.x - 0.38, 0.02, marker.z, width, height);
  const right = projectWorld(marker.x + 0.38, 0.02, marker.z, width, height);
  const coneWidth = clamp(Math.abs(right.x - left.x), 5, 34);
  const coneHeight = clamp(base.y - tip.y, 10, 82);
  const baseHeight = clamp(coneWidth * 0.22, 2.2, 8);
  const intensity = getDownwashIntensity(state, marker);

  context.save();
  if (intensity > 0.03) {
    const ringWidth = coneWidth * (1.1 + intensity * 1.35);
    context.strokeStyle = `rgba(92, 223, 238, ${0.18 + intensity * 0.52})`;
    context.lineWidth = 1 + intensity * 1.5;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.ellipse(
      base.x,
      base.y + 1,
      ringWidth,
      Math.max(2, ringWidth * 0.16),
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.setLineDash([]);
  }

  context.fillStyle = "rgba(29, 32, 32, 0.92)";
  roundedRect(
    context,
    base.x - coneWidth * 0.58,
    base.y - baseHeight * 0.55,
    coneWidth * 1.16,
    baseHeight,
    Math.max(1, baseHeight * 0.22),
  );
  context.fill();

  const bodyBottomY = base.y - baseHeight * 0.45;
  const bodyHalf = coneWidth * 0.38;
  const topHalf = coneWidth * 0.065;
  context.fillStyle = "#f45b2e";
  context.strokeStyle = "rgba(255, 207, 169, 0.88)";
  context.lineWidth = clamp(coneWidth * 0.045, 0.8, 1.7);
  context.beginPath();
  context.moveTo(base.x - bodyHalf, bodyBottomY);
  context.lineTo(tip.x - topHalf, tip.y);
  context.lineTo(tip.x + topHalf, tip.y);
  context.lineTo(base.x + bodyHalf, bodyBottomY);
  context.closePath();
  context.fill();
  context.stroke();

  const bodySlice = (progress: number) => {
    const centerX = base.x + (tip.x - base.x) * progress;
    const centerY = bodyBottomY + (tip.y - bodyBottomY) * progress;
    const halfWidth =
      bodyHalf * (1 - progress) + topHalf * progress;
    return { centerX, centerY, halfWidth };
  };
  const stripeBottom = bodySlice(0.4);
  const stripeTop = bodySlice(0.58);
  context.fillStyle = "rgba(255, 250, 231, 0.98)";
  context.beginPath();
  context.moveTo(
    stripeBottom.centerX - stripeBottom.halfWidth,
    stripeBottom.centerY,
  );
  context.lineTo(
    stripeTop.centerX - stripeTop.halfWidth,
    stripeTop.centerY,
  );
  context.lineTo(
    stripeTop.centerX + stripeTop.halfWidth,
    stripeTop.centerY,
  );
  context.lineTo(
    stripeBottom.centerX + stripeBottom.halfWidth,
    stripeBottom.centerY,
  );
  context.closePath();
  context.fill();

  const horizontalDistance = Math.hypot(
    marker.x - state.x,
    marker.z - state.z,
  );
  const fallbackAngle = markerIndex * 2.399;
  const awayAngle =
    horizontalDistance > 0.18
      ? Math.atan2(marker.z - state.z, marker.x - state.x)
      : fallbackAngle;
  const centeredBlend = clamp(
    1 - horizontalDistance / 0.8,
    0,
    1,
  );
  const ribbonColors = [
    "#31b7e6",
    "#f8d24e",
    "#ef4a41",
    "#f6f1dc",
    "#47c8e8",
    "#f4bd3f",
    "#ed6b51",
    "#f8f7e9",
    "#249fd1",
    "#ffe072",
    "#e94747",
    "#d8f5f4",
  ];
  const middleRibbon = (ribbonColors.length - 1) / 2;
  ribbonColors.forEach((color, ribbonIndex) => {
    const lane =
      (ribbonIndex - middleRibbon) /
      Math.max(1, middleRibbon);
    const directionalAngle = awayAngle + lane * 0.1;
    const radialAngle =
      fallbackAngle +
      (Math.PI * 2 * ribbonIndex) / ribbonColors.length;
    let flowX =
      Math.cos(directionalAngle) * (1 - centeredBlend) +
      Math.cos(radialAngle) * centeredBlend;
    let flowZ =
      Math.sin(directionalAngle) * (1 - centeredBlend) +
      Math.sin(radialAngle) * centeredBlend;
    const worldFlowLength = Math.hypot(flowX, flowZ) || 1;
    flowX /= worldFlowLength;
    flowZ /= worldFlowLength;

    const flowPoint = projectWorld(
      marker.x + flowX * 1.6,
      0.76,
      marker.z + flowZ * 1.6,
      width,
      height,
    );
    const screenFlowLength =
      Math.hypot(flowPoint.x - tip.x, flowPoint.y - tip.y) || 1;
    const screenFlowX = (flowPoint.x - tip.x) / screenFlowLength;
    const screenFlowY = (flowPoint.y - tip.y) / screenFlowLength;
    const windWeight =
      intensity > 0 ? 0.22 + intensity * 0.78 : 0;
    const droopWeight = 0.88 * (1 - intensity);
    let ribbonDirectionX = screenFlowX * windWeight;
    let ribbonDirectionY =
      screenFlowY * windWeight + droopWeight;
    const directionLength =
      Math.hypot(ribbonDirectionX, ribbonDirectionY) || 1;
    ribbonDirectionX /= directionLength;
    ribbonDirectionY /= directionLength;

    const flutter =
      Math.sin(
        state.elapsed * (11 + (ribbonIndex % 4) * 1.45) +
          markerIndex * 2.31 +
          ribbonIndex * 1.71,
      ) *
        0.68 +
      Math.sin(
        state.elapsed * (20.5 + (ribbonIndex % 3) * 1.9) +
          markerIndex * 0.83 +
          ribbonIndex * 2.19,
      ) *
        0.32;
    const perpendicularX = -ribbonDirectionY;
    const perpendicularY = ribbonDirectionX;
    const ribbonLength = clamp(
      coneHeight *
        (0.42 + intensity * 1.08) *
        (0.84 + (ribbonIndex % 4) * 0.055),
      5,
      48,
    );
    const flutterOffset =
      (lane * (0.07 + intensity * 0.23) +
        flutter * intensity * 0.28) *
      ribbonLength;
    const anchorX = tip.x + lane * coneWidth * 0.08;
    const anchorY = tip.y + 1 + Math.abs(lane) * 0.3;
    const endX =
      anchorX +
      ribbonDirectionX * ribbonLength +
      perpendicularX * flutterOffset;
    const endY =
      anchorY +
      ribbonDirectionY * ribbonLength +
      perpendicularY * flutterOffset;
    const firstControlX =
      anchorX +
      ribbonDirectionX * ribbonLength * 0.3 -
      perpendicularX * flutterOffset * 0.32;
    const firstControlY =
      anchorY +
      ribbonDirectionY * ribbonLength * 0.3 -
      perpendicularY * flutterOffset * 0.32;
    const secondControlX =
      anchorX +
      ribbonDirectionX * ribbonLength * 0.68 +
      perpendicularX * flutterOffset * 0.58;
    const secondControlY =
      anchorY +
      ribbonDirectionY * ribbonLength * 0.68 +
      perpendicularY * flutterOffset * 0.58;

    context.strokeStyle = color;
    context.globalAlpha = 0.82 + (ribbonIndex % 3) * 0.06;
    context.lineWidth = clamp(coneHeight * 0.032, 0.65, 1.6);
    context.lineCap = "round";
    context.shadowColor =
      intensity > 0.35 ? "rgba(219, 250, 255, 0.56)" : "transparent";
    context.shadowBlur = intensity > 0.35 ? 3 : 0;
    context.beginPath();
    context.moveTo(anchorX, anchorY);
    context.bezierCurveTo(
      firstControlX,
      firstControlY,
      secondControlX,
      secondControlY,
      endX,
      endY,
    );
    context.stroke();
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.fillStyle = "rgba(244, 239, 214, 0.96)";
  context.beginPath();
  context.arc(
    tip.x,
    tip.y + 1,
    clamp(coneWidth * 0.1, 1.2, 3.1),
    0,
    Math.PI * 2,
  );
  context.fill();

  if (intensity > 0.35) {
    context.strokeStyle = `rgba(221, 239, 207, ${0.2 + intensity * 0.35})`;
    context.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      const phase =
        state.elapsed * (3.8 + index * 0.35) +
        markerIndex * 1.47 +
        index;
      const drift = Math.sin(phase) * coneWidth * 0.45;
      context.beginPath();
      context.arc(
        base.x + drift,
        base.y - index * 1.5,
        coneWidth * (0.55 + index * 0.2),
        Math.PI * 1.08,
        Math.PI * 1.86,
      );
      context.stroke();
    }
  }

  const badgeRadius = clamp(coneWidth * 0.28, 4.5, 9);
  context.fillStyle =
    intensity > 0.22 ? "#0d8092" : "rgba(6, 35, 41, 0.94)";
  context.strokeStyle =
    intensity > 0.22 ? "#a7f2f7" : "rgba(255, 255, 255, 0.76)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(
    base.x,
    base.y + badgeRadius * 0.9,
    badgeRadius,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(7, badgeRadius * 1.15)}px Pretendard, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    marker.id,
    base.x,
    base.y + badgeRadius * 0.93,
  );
  context.restore();
}

function drawCourseRoute(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mission: PilotWaypoint[],
  currentIndex: number,
) {
  context.save();
  context.lineWidth = 2;
  context.setLineDash([7, 8]);
  context.lineCap = "round";

  for (let index = 1; index < mission.length; index += 1) {
    const previous = projectWorld(
      mission[index - 1].x,
      mission[index - 1].landing ? 0 : mission[index - 1].altitude,
      mission[index - 1].z,
      width,
      height,
    );
    const current = projectWorld(
      mission[index].x,
      mission[index].landing ? 0 : mission[index].altitude,
      mission[index].z,
      width,
      height,
    );
    if (!previous.visible || !current.visible) continue;

    context.strokeStyle =
      index <= currentIndex
        ? "rgba(108, 210, 142, 0.58)"
        : "rgba(255, 255, 255, 0.28)";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.stroke();
  }
  context.restore();
}

function drawTargetGate(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  point: PilotWaypoint,
  index: number,
  currentIndex: number,
  elapsed: number,
) {
  const ground = projectWorld(point.x, 0, point.z, width, height);
  const air = projectWorld(
    point.x,
    point.altitude,
    point.z,
    width,
    height,
  );
  if (!ground.visible || !air.visible) return;

  const active = index === currentIndex;
  const completed = index < currentIndex;
  const future = index > currentIndex;
  const targetPoint = point.landing ? ground : air;
  const safeLeft = 72;
  const safeRight = width - 72;
  const safeTop = 82;
  const safeBottom = height - 62;
  const targetOnScreen =
    targetPoint.x >= safeLeft &&
    targetPoint.x <= safeRight &&
    targetPoint.y >= safeTop &&
    targetPoint.y <= safeBottom;
  const color = completed
    ? "rgba(108, 218, 146, 0.82)"
    : active
      ? "#72e5f5"
      : "rgba(239, 248, 250, 0.52)";
  const pulse = active ? 1 + Math.sin(elapsed * 5) * 0.07 : 1;
  let guideTopY = air.y;

  if (active && !targetOnScreen) {
    const cueX = clamp(targetPoint.x, safeLeft, safeRight);
    const cueY = clamp(targetPoint.y, safeTop, safeBottom);
    const angle = Math.atan2(
      targetPoint.y - height / 2,
      targetPoint.x - width / 2,
    );

    context.save();
    context.translate(cueX, cueY);
    context.rotate(angle + Math.PI / 2);
    context.fillStyle = "#72e5f5";
    context.shadowColor = "rgba(114, 229, 245, 0.72)";
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(0, -17);
    context.lineTo(11, 9);
    context.lineTo(-11, 9);
    context.closePath();
    context.fill();
    context.restore();

    context.save();
    context.fillStyle = "#dffcff";
    context.font = "700 10px Pretendard, sans-serif";
    context.textAlign = "center";
    context.fillText(
      `목표 ${point.altitude.toFixed(1)}m`,
      cueX,
      clamp(cueY + 29, 22, height - 16),
    );
    context.restore();
    return;
  }

  context.save();
  context.globalAlpha = active ? 1 : completed ? 0.5 : future ? 0.34 : 1;

  if (point.landing || point.altitude <= 0.05) {
    drawGroundEllipse(
      context,
      ground,
      point.radius ?? 5,
      color,
      active,
      pulse,
    );
  } else {
    const halfWidth = clamp((point.radius ?? 4) * 0.55, 1.2, 3.4) * pulse;
    const halfDepth = halfWidth * 0.66;
    const halfHeight = clamp(halfWidth * 0.7, 0.9, 2.35);
    const bottomAltitude = Math.max(0.25, point.altitude - halfHeight);
    const topAltitude = point.altitude + halfHeight;
    const guideCorners = [
      projectWorld(
        point.x - halfWidth,
        bottomAltitude,
        point.z - halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x + halfWidth,
        bottomAltitude,
        point.z - halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x + halfWidth,
        topAltitude,
        point.z - halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x - halfWidth,
        topAltitude,
        point.z - halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x - halfWidth,
        bottomAltitude,
        point.z + halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x + halfWidth,
        bottomAltitude,
        point.z + halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x + halfWidth,
        topAltitude,
        point.z + halfDepth,
        width,
        height,
      ),
      projectWorld(
        point.x - halfWidth,
        topAltitude,
        point.z + halfDepth,
        width,
        height,
      ),
    ];
    guideTopY = Math.min(...guideCorners.map((corner) => corner.y));
    const drawFace = (indices: number[]) => {
      context.beginPath();
      context.moveTo(
        guideCorners[indices[0]].x,
        guideCorners[indices[0]].y,
      );
      indices.slice(1).forEach((cornerIndex) => {
        context.lineTo(
          guideCorners[cornerIndex].x,
          guideCorners[cornerIndex].y,
        );
      });
      context.closePath();
    };

    context.strokeStyle = color;
    context.lineWidth = active ? 2.4 : 1.35;
    context.setLineDash([5, 6]);
    context.beginPath();
    context.moveTo(ground.x, ground.y);
    context.lineTo(
      (guideCorners[0].x + guideCorners[1].x) / 2,
      (guideCorners[0].y + guideCorners[1].y) / 2,
    );
    context.stroke();

    context.globalAlpha = active ? 0.14 : completed ? 0.06 : 0.025;
    context.fillStyle = active
      ? "rgba(73, 212, 239, 0.82)"
      : completed
        ? "rgba(80, 190, 120, 0.52)"
        : "rgba(235, 249, 251, 0.25)";
    // 먼 면부터 깔고 가까운 면을 마지막에 강조해야 투명 상자가 올바른
    // 깊이 순서로 보입니다.
    drawFace([4, 5, 6, 7]);
    context.fill();

    context.globalAlpha = active ? 0.54 : completed ? 0.3 : 0.2;
    context.setLineDash([4, 5]);
    drawFace([4, 5, 6, 7]);
    context.stroke();

    context.globalAlpha = active ? 1 : completed ? 0.48 : 0.3;
    context.setLineDash([]);
    [0, 1, 2, 3].forEach((cornerIndex) => {
      context.beginPath();
      context.moveTo(
        guideCorners[cornerIndex].x,
        guideCorners[cornerIndex].y,
      );
      context.lineTo(
        guideCorners[cornerIndex + 4].x,
        guideCorners[cornerIndex + 4].y,
      );
      context.stroke();
    });

    context.globalAlpha = active ? 0.1 : completed ? 0.035 : 0.018;
    drawFace([0, 1, 2, 3]);
    context.fill();

    context.globalAlpha = active ? 1 : completed ? 0.52 : 0.32;
    drawFace([0, 1, 2, 3]);
    context.stroke();

    if (active) {
      context.strokeStyle = "rgba(220, 252, 255, 0.82)";
      context.lineWidth = 1.2;
      context.setLineDash([3, 4]);
      context.beginPath();
      context.moveTo(guideCorners[0].x, guideCorners[0].y);
      context.lineTo(guideCorners[2].x, guideCorners[2].y);
      context.moveTo(guideCorners[1].x, guideCorners[1].y);
      context.lineTo(guideCorners[3].x, guideCorners[3].y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#e7fdff";
      context.shadowColor = "rgba(114, 229, 245, 0.9)";
      context.shadowBlur = 9;
      context.beginPath();
      context.arc(air.x, air.y, 3.2, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();

  if (!active) return;

  const labelX = clamp(air.x, 104, width - 104);
  const labelY = clamp(
    (point.landing ? ground.y - 38 : guideTopY - 35),
    78,
    height - 70,
  );
  const compactMobile = width <= 520;
  const labelWidth = compactMobile
    ? Math.min(124, width * 0.35)
    : Math.min(210, Math.max(138, width * 0.15));
  const labelHeight = compactMobile ? 24 : 29;

  context.save();
  roundedRect(
    context,
    labelX - labelWidth / 2,
    labelY,
    labelWidth,
    labelHeight,
    compactMobile ? 7 : 9,
  );
  context.fillStyle = "rgba(5, 31, 40, 0.92)";
  context.fill();
  context.strokeStyle = "rgba(114, 229, 245, 0.72)";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = "#e1fbff";
  context.font = `700 ${
    compactMobile ? 8 : Math.max(10, width * 0.0082)
  }px Pretendard, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const text =
    point.altitude > 0
      ? `${point.label} · ${point.altitude.toFixed(1)}m`
      : point.label;
  context.fillText(
    text,
    labelX,
    labelY + labelHeight / 2,
    labelWidth - 10,
  );
  context.restore();
}

function drawDroneShadow(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PilotFlightState,
) {
  const ground = projectWorld(state.x, 0, state.z, width, height);
  if (!ground.visible) return;

  // 태양이 조종자의 왼쪽 뒤에 있는 것으로 두어 고도가 높아질수록
  // 그림자가 우측 전방으로 멀어집니다. 위치 자체가 고도·거리 단서가 됩니다.
  const shadow = projectWorld(
    state.x + state.altitude * 0.42,
    0.03,
    state.z + state.altitude * 0.15,
    width,
    height,
  );
  if (!shadow.visible) return;

  const shadowWidth = clamp((ground.focal / ground.depth) * 0.84, 7, 48);
  const shadowOpacity = clamp(
    0.34 - state.altitude * 0.022,
    0.07,
    0.3,
  );
  const shadowBlur = clamp(1.2 + state.altitude * 0.62, 1.2, 10);
  const worldYaw = (state.yaw * Math.PI) / 180 - VIEW_YAW;
  const screenYaw = Math.atan2(
    0.55 * Math.sin(worldYaw),
    Math.cos(worldYaw),
  );

  context.save();
  context.translate(shadow.x, shadow.y);
  context.rotate(screenYaw);
  context.filter = `blur(${shadowBlur}px)`;
  context.globalAlpha = shadowOpacity;
  context.strokeStyle = "#07110d";
  context.lineWidth = Math.max(2, shadowWidth * 0.12);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-shadowWidth * 0.86, 0);
  context.lineTo(shadowWidth * 0.86, 0);
  context.moveTo(-shadowWidth * 0.57, -shadowWidth * 0.13);
  context.lineTo(shadowWidth * 0.57, shadowWidth * 0.13);
  context.moveTo(shadowWidth * 0.57, -shadowWidth * 0.13);
  context.lineTo(-shadowWidth * 0.57, shadowWidth * 0.13);
  context.stroke();
  context.fillStyle = "#07110d";
  context.beginPath();
  context.ellipse(
    0,
    0,
    shadowWidth * 0.34,
    shadowWidth * 0.12,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawDrone(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PilotFlightState,
  droneImage?: HTMLImageElement | null,
  showAltitudeLine = true,
  droneLayer?: PilotDroneLayer | null,
) {
  const drone = projectWorld(
    state.x,
    state.altitude,
    state.z,
    width,
    height,
  );
  const ground = projectWorld(state.x, 0, state.z, width, height);
  const marginX = 70;
  const marginTop = 78;
  const marginBottom = 58;
  const onScreen =
    drone.visible &&
    drone.x >= marginX &&
    drone.x <= width - marginX &&
    drone.y >= marginTop &&
    drone.y <= height - marginBottom;

  if (
    showAltitudeLine &&
    drone.visible &&
    ground.visible &&
    state.altitude > 0.15
  ) {
    context.save();
    context.strokeStyle = "rgba(231, 244, 247, 0.38)";
    context.lineWidth = 1.2;
    context.setLineDash([4, 5]);
    context.beginPath();
    context.moveTo(ground.x, ground.y);
    context.lineTo(drone.x, drone.y);
    context.stroke();
    context.restore();
  }

  if (!onScreen) {
    const targetX = drone.visible ? drone.x : width / 2;
    const targetY = drone.visible ? drone.y : height;
    const cueX = clamp(targetX, marginX, width - marginX);
    const cueY = clamp(targetY, marginTop, height - marginBottom);
    const angle = Math.atan2(targetY - height / 2, targetX - width / 2);

    context.save();
    context.translate(cueX, cueY);
    context.rotate(angle + Math.PI / 2);
    context.fillStyle = "#ffd24a";
    context.shadowColor = "rgba(255, 210, 74, 0.7)";
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(0, -16);
    context.lineTo(10, 8);
    context.lineTo(-10, 8);
    context.closePath();
    context.fill();
    context.restore();

    context.save();
    context.fillStyle = "#fff4c3";
    context.font = "700 10px Pretendard, sans-serif";
    context.textAlign = "center";
    context.fillText("기체", cueX, clamp(cueY + 28, 22, height - 18));
    context.restore();
    return;
  }

  if (
    droneLayer &&
    droneLayer.canvas.width > 0 &&
    droneLayer.canvas.height > 0
  ) {
    try {
      context.save();
      context.globalCompositeOperation = "source-over";
      context.drawImage(
        droneLayer.canvas,
        0,
        0,
        droneLayer.canvas.width,
        droneLayer.canvas.height,
        droneLayer.x,
        droneLayer.y,
        droneLayer.width,
        droneLayer.height,
      );
      context.restore();
      return;
    } catch {
      context.restore();
      // WebGL 컨텍스트가 프레임 사이에 손실되면 아래의 2D 기체로 대체합니다.
    }
  }

  // 이미지 폭이 실제 약 2.9m 기체의 각크기와 맞도록 원근 비례를 사용합니다.
  // 먼 지점에서 강제로 크게 보이던 최소 크기를 낮춰 40~60m 거리감이 유지됩니다.
  const droneSize = clamp((drone.focal / drone.depth) * 1.32, 13, 112);
  const yawRadians = (state.yaw * Math.PI) / 180 - VIEW_YAW;
  const yawCosine = Math.cos(yawRadians);
  const yawSine = Math.sin(yawRadians);
  const groundPlaneSquash = 0.55;
  const yawPoint = (x: number, y: number) => ({
    x:
      yawCosine * x -
      (yawSine / groundPlaneSquash) * y,
    y:
      groundPlaneSquash * yawSine * x +
      yawCosine * y,
  });

  context.save();
  context.translate(drone.x, drone.y);
  context.lineCap = "round";

  if (droneImage?.complete && droneImage.naturalWidth > 0) {
    const imageWidth = droneSize * 2.5;
    const imageHeight =
      imageWidth * (droneImage.naturalHeight / droneImage.naturalWidth);
    context.save();
    context.transform(
      yawCosine,
      groundPlaneSquash * yawSine,
      -yawSine / groundPlaneSquash,
      yawCosine,
      0,
      0,
    );
    context.shadowColor = "rgba(2, 12, 16, 0.62)";
    context.shadowBlur = Math.max(4, droneSize * 0.12);
    context.drawImage(
      droneImage,
      -imageWidth / 2,
      -imageHeight / 2,
      imageWidth,
      imageHeight,
    );
    context.restore();

    const rotorPositions = [
      [-0.19, -0.43],
      [0.18, -0.43],
      [-0.452, -0.16],
      [0.454, -0.16],
      [-0.327, 0.37],
      [0.36, 0.37],
    ];
    const rotorRadius = imageWidth * 0.078;
    rotorPositions.forEach(([relativeX, relativeY], rotorIndex) => {
      const rotor = yawPoint(
        relativeX * imageWidth,
        relativeY * imageHeight,
      );
      const direction = rotorIndex % 2 === 0 ? 1 : -1;
      const rotation = state.motorsArmed
        ? state.elapsed * 31 * direction
        : (rotorIndex % 2 === 0 ? -1 : 1) * 0.32;

      context.save();
      context.translate(rotor.x, rotor.y);
      context.scale(1, 0.26);
      context.rotate(rotation);
      context.lineCap = "round";
      context.strokeStyle = state.motorsArmed
        ? "rgba(235, 249, 252, 0.78)"
        : "rgba(218, 232, 235, 0.74)";
      context.lineWidth = Math.max(1, droneSize * 0.027);
      context.shadowColor = state.motorsArmed
        ? "rgba(216, 246, 252, 0.9)"
        : "transparent";
      context.shadowBlur = state.motorsArmed
        ? Math.max(3, droneSize * 0.09)
        : 0;
      context.beginPath();
      context.moveTo(-rotorRadius, 0);
      context.lineTo(rotorRadius, 0);
      context.moveTo(0, -rotorRadius);
      context.lineTo(0, rotorRadius);
      context.stroke();
      if (state.motorsArmed) {
        context.strokeStyle = "rgba(224, 246, 250, 0.32)";
        context.lineWidth = Math.max(2, droneSize * 0.05);
        context.beginPath();
        context.arc(0, 0, rotorRadius * 0.92, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    });

    const navigationLight = yawPoint(0, -imageHeight * 0.14);
    context.fillStyle = state.motorsArmed ? "#ffd24a" : "#8a979a";
    context.shadowColor = state.motorsArmed
      ? "rgba(255, 210, 74, 0.95)"
      : "transparent";
    context.shadowBlur = state.motorsArmed
      ? Math.max(4, droneSize * 0.12)
      : 0;
    context.beginPath();
    context.arc(
      navigationLight.x,
      navigationLight.y,
      Math.max(1.4, droneSize * 0.027),
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
    return;
  }

  context.strokeStyle = "#dce9eb";
  context.lineWidth = Math.max(2.4, droneSize * 0.095);
  const armSegments = [
    [-0.33, -0.22, 0.33, 0.22],
    [0.33, -0.22, -0.33, 0.22],
    [-0.48, 0.02, 0.48, 0.02],
  ];
  armSegments.forEach(([fromX, fromY, toX, toY]) => {
    const from = yawPoint(fromX * droneSize, fromY * droneSize);
    const to = yawPoint(toX * droneSize, toY * droneSize);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  });

  const rotorPositions = [
    [-0.35, -0.24],
    [0.35, -0.24],
    [-0.5, 0.02],
    [0.5, 0.02],
    [-0.35, 0.25],
    [0.35, 0.25],
  ];
  rotorPositions.forEach(([x, y], rotorIndex) => {
    const rotor = yawPoint(x * droneSize, y * droneSize);
    context.fillStyle = "rgba(8, 29, 35, 0.9)";
    context.strokeStyle = rotorIndex % 2 === 0 ? "#ff8d79" : "#74d89a";
    context.lineWidth = Math.max(1, droneSize * 0.025);
    context.beginPath();
    context.ellipse(
      rotor.x,
      rotor.y,
      droneSize * 0.13,
      droneSize * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.strokeStyle = "rgba(238, 249, 250, 0.55)";
    context.beginPath();
    context.ellipse(
      rotor.x,
      rotor.y,
      droneSize * 0.18,
      droneSize * 0.025,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  });

  context.save();
  context.transform(
    yawCosine,
    groundPlaneSquash * yawSine,
    -yawSine / groundPlaneSquash,
    yawCosine,
    0,
    0,
  );
  roundedRect(
    context,
    -droneSize * 0.12,
    -droneSize * 0.12,
    droneSize * 0.24,
    droneSize * 0.4,
    droneSize * 0.07,
  );
  context.fillStyle = "#0a2c38";
  context.fill();
  context.strokeStyle = "rgba(244, 251, 252, 0.9)";
  context.lineWidth = Math.max(1, droneSize * 0.025);
  context.stroke();
  context.restore();

  const navigationLight = yawPoint(0, -droneSize * 0.18);
  context.fillStyle = "#ffd24a";
  context.shadowColor = "rgba(255, 210, 74, 0.85)";
  context.shadowBlur = Math.max(3, droneSize * 0.08);
  context.beginPath();
  context.arc(
    navigationLight.x,
    navigationLight.y,
    Math.max(1.4, droneSize * 0.032),
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawPilotReference(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const centerX = width / 2;
  const baseY = height - 16;
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.56)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(centerX - 34, baseY - 6);
  context.lineTo(centerX - 13, baseY - 6);
  context.moveTo(centerX + 13, baseY - 6);
  context.lineTo(centerX + 34, baseY - 6);
  context.moveTo(centerX, baseY - 17);
  context.lineTo(centerX, baseY + 1);
  context.stroke();
  context.fillStyle = "rgba(239, 248, 250, 0.72)";
  context.font = "700 9px Pretendard, sans-serif";
  context.textAlign = "center";
  context.fillText("조종자 위치", centerX, baseY - 23);
  context.restore();
}

export function drawPilotScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PilotFlightState,
  mission: PilotWaypoint[],
  windActive: boolean,
  options: PilotSceneOptions = {},
) {
  const {
    droneImage,
    droneLayer,
    guideMode = "full",
  } = options;
  context.clearRect(0, 0, width, height);

  context.save();
  const horizonShade = context.createLinearGradient(0, 0, 0, height);
  horizonShade.addColorStop(0, "rgba(5, 23, 31, 0.08)");
  horizonShade.addColorStop(0.46, "rgba(5, 23, 31, 0)");
  horizonShade.addColorStop(1, "rgba(3, 17, 22, 0.28)");
  context.fillStyle = horizonShade;
  context.fillRect(0, 0, width, height);
  context.restore();

  if (guideMode === "full") {
    drawPerspectiveGrid(context, width, height);
  }
  drawCourseInfrastructure(context, width, height);
  drawDownwashGround(context, width, height, state);
  drawDroneShadow(context, width, height, state);
  if (guideMode === "full") {
    drawCourseRoute(context, width, height, mission, state.waypointIndex);
  }

  const markerStart =
    guideMode === "target"
      ? state.waypointIndex
      : Math.max(0, state.waypointIndex - 1);
  const markerEnd =
    guideMode === "target"
      ? Math.min(mission.length, state.waypointIndex + 1)
      : Math.min(mission.length, state.waypointIndex + 5);
  const activeMarker = mission[state.waypointIndex];
  if (guideMode !== "off") {
    for (let index = markerEnd - 1; index >= markerStart; index -= 1) {
      const point = mission[index];
      const overlapsActive =
        index !== state.waypointIndex &&
        activeMarker &&
        Math.abs(point.x - activeMarker.x) < 0.05 &&
        Math.abs(point.z - activeMarker.z) < 0.05 &&
        Math.abs(point.altitude - activeMarker.altitude) < 0.05;
      if (overlapsActive) continue;

      drawTargetGate(
        context,
        width,
        height,
        point,
        index,
        state.waypointIndex,
        state.elapsed,
      );
    }
  }

  if (windActive) {
    context.save();
    context.strokeStyle = "rgba(105, 215, 242, 0.7)";
    context.fillStyle = "rgba(105, 215, 242, 0.8)";
    context.lineWidth = 2;
    for (let index = 0; index < 4; index += 1) {
      const x = width * (0.66 + index * 0.075);
      const y = height * (0.33 + (index % 2) * 0.035);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 36, y - 8);
      context.stroke();
      context.beginPath();
      context.moveTo(x + 36, y - 8);
      context.lineTo(x + 27, y - 13);
      context.lineTo(x + 29, y - 3);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  const droneDepth = toViewSpace(state.x, state.z).depth;
  const coneLayers = COURSE_CONES.map((marker, index) => ({
    marker,
    index,
    depth: toViewSpace(marker.x, marker.z).depth,
  })).sort((left, right) => right.depth - left.depth);
  coneLayers
    .filter(({ depth }) => depth >= droneDepth)
    .forEach(({ marker, index }) => {
      drawCourseCone(context, width, height, marker, state, index);
    });

  drawDrone(
    context,
    width,
    height,
    state,
    droneImage,
    guideMode !== "off",
    droneLayer,
  );
  coneLayers
    .filter(({ depth }) => depth < droneDepth)
    .forEach(({ marker, index }) => {
      drawCourseCone(context, width, height, marker, state, index);
    });
  drawPilotReference(context, width, height);

  const vignette = context.createRadialGradient(
    width / 2,
    height * 0.52,
    Math.min(width, height) * 0.34,
    width / 2,
    height * 0.52,
    Math.max(width, height) * 0.74,
  );
  vignette.addColorStop(0, "rgba(2, 14, 20, 0)");
  vignette.addColorStop(1, "rgba(2, 14, 20, 0.24)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  drawFieldMiniMap(context, width, height, state, mission, guideMode);
}
