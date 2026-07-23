export type CoursePointId =
  | "P"
  | "H"
  | "F_LEFT"
  | "F_RIGHT"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E";

export type CoursePoint = {
  id: CoursePointId;
  label: string;
  x: number;
  z: number;
};

// 첨부된 1종 실기시험장 도면의 치수를 실제 미터 좌표로 옮긴 값입니다.
// +z는 조종자에게서 전방, +x는 조종자의 오른쪽입니다.
export const COURSE_POINTS = {
  P: { id: "P", label: "조종자", x: 0, z: -44 },
  H: { id: "H", label: "이착륙장", x: 0, z: -29 },
  F_LEFT: {
    id: "F_LEFT",
    label: "좌측 비상착륙장",
    x: -7.5,
    z: -29,
  },
  F_RIGHT: {
    id: "F_RIGHT",
    label: "우측 비상착륙장",
    x: 7.5,
    z: -29,
  },
  A: { id: "A", label: "호버링 위치", x: 0, z: -21.5 },
  B: { id: "B", label: "좌측 기준점", x: -7.5, z: -21.5 },
  C: { id: "C", label: "원주 전방점", x: 0, z: -14 },
  D: { id: "D", label: "우측 기준점", x: 7.5, z: -21.5 },
  E: { id: "E", label: "직진 전방점", x: 0, z: 18.5 },
} as const satisfies Record<CoursePointId, CoursePoint>;

export const COURSE_CONES = [
  COURSE_POINTS.A,
  COURSE_POINTS.B,
  COURSE_POINTS.C,
  COURSE_POINTS.D,
  COURSE_POINTS.E,
] as const;

export const EMERGENCY_PADS = [
  COURSE_POINTS.F_LEFT,
  COURSE_POINTS.F_RIGHT,
] as const;

export const FIELD_BOUNDS = {
  minX: -24,
  maxX: 24,
  minZ: COURSE_POINTS.P.z,
  maxZ: 27,
  homeX: COURSE_POINTS.H.x,
  homeZ: COURSE_POINTS.H.z,
} as const;

export const MAP_BOUNDS = {
  minX: -26,
  maxX: 26,
  minZ: -46,
  maxZ: 29,
} as const;

export const COURSE_CIRCLE = {
  centerX: COURSE_POINTS.A.x,
  centerZ: COURSE_POINTS.A.z,
  radius: 7.5,
} as const;

export const HOVER_ALTITUDE = 3.5;
export const TRIANGLE_RISE = 7.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
};

export type DownwashState = {
  x: number;
  z: number;
  altitude: number;
  vy: number;
  motorsArmed: boolean;
};

export function downwashFootprint(altitude: number) {
  // 영향권은 고도에 따라 넓어지며, 지상 시동 상태에서도 기체 근처의
  // 수술이 약하게 반응하도록 최소 반경을 확보합니다.
  return clamp(3.2 + Math.max(0, altitude) * 1.15, 3.2, 10.5);
}

export function getDownwashIntensity(
  state: DownwashState,
  marker: Pick<CoursePoint, "x" | "z">,
) {
  if (!state.motorsArmed) return 0;

  const altitude = Math.max(0, state.altitude);
  const horizontalDistance = Math.hypot(
    state.x - marker.x,
    state.z - marker.z,
  );
  const footprint = downwashFootprint(altitude);
  const penetration = clamp(
    1 - horizontalDistance / footprint,
    0,
    1,
  );
  // 영향권 경계에 들어온 직후부터 수술의 움직임이 보이도록 완만한 곡선 사용.
  const radial = Math.pow(penetration, 0.5);
  const rotorWash =
    0.48 + smoothstep(0, 0.8, altitude) * 0.52;
  const highAltitudeFalloff = clamp(
    1 - Math.max(altitude - 7, 0) / 20,
    0.55,
    1,
  );
  const thrust = clamp(0.9 + Math.abs(state.vy) * 0.08, 0.9, 1.15);

  return clamp(
    radial * rotorWash * highAltitudeFalloff * thrust,
    0,
    1,
  );
}
