import {
  COURSE_CIRCLE,
  COURSE_CONES,
  COURSE_POINTS,
  EMERGENCY_PADS,
  FIELD_BOUNDS,
  MAP_BOUNDS,
  downwashFootprint,
  getDownwashIntensity,
} from "./CourseGeometry";

type MapWaypoint = {
  x: number;
  z: number;
  altitude: number;
  label: string;
  targetYaw?: number;
};

type MapFlightState = {
  x: number;
  z: number;
  altitude: number;
  yaw: number;
  waypointIndex: number;
  vy: number;
  motorsArmed: boolean;
};

type MapGuideMode = "full" | "target" | "off";

const FIELD = FIELD_BOUNDS;
const MAP = MAP_BOUNDS;
const PILOT = COURSE_POINTS.P;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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

export function drawFieldMiniMap(
  context: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  state: MapFlightState,
  mission: MapWaypoint[],
  guideMode: MapGuideMode = "full",
) {
  const shortLandscape = viewportHeight <= 520 && viewportWidth > 520;
  const compactMobile = viewportWidth <= 520 || shortLandscape;
  const panelWidth = compactMobile
    ? shortLandscape
      ? 112
      : clamp(viewportWidth * 0.33, 112, 126)
    : clamp(viewportWidth * 0.17, 148, 220);
  const panelHeight = compactMobile
    ? shortLandscape
      ? 132
      : clamp(panelWidth * 1.16, 132, 146)
    : clamp(panelWidth * 1.18, 174, 260);
  const panelX =
    viewportWidth - panelWidth - (viewportWidth <= 760 ? 10 : 24);
  const panelY =
    shortLandscape
      ? 100
      : compactMobile
      ? 126
      : viewportWidth <= 760
        ? 148
        : 164;
  const headerHeight = compactMobile ? 22 : 25;
  const footerHeight = compactMobile ? 24 : 31;
  const mapX = panelX + 9;
  const mapY = panelY + headerHeight;
  const mapWidth = panelWidth - 18;
  const mapHeight = panelHeight - headerHeight - footerHeight - 7;
  const worldWidth = MAP.maxX - MAP.minX;
  const worldHeight = MAP.maxZ - MAP.minZ;
  const scale = Math.min(mapWidth / worldWidth, mapHeight / worldHeight);
  const worldPixelWidth = worldWidth * scale;
  const worldPixelHeight = worldHeight * scale;
  const offsetX = mapX + (mapWidth - worldPixelWidth) / 2;
  const offsetY = mapY + (mapHeight - worldPixelHeight) / 2;

  const mapPoint = (x: number, z: number) => ({
    x: offsetX + (x - MAP.minX) * scale,
    y: offsetY + (MAP.maxZ - z) * scale,
  });

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.42)";
  context.shadowBlur = 20;
  roundedRect(
    context,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    14,
  );
  context.fillStyle = "rgba(3, 23, 30, 0.9)";
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(255, 255, 255, 0.32)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#edf7f8";
  context.font = `800 ${viewportWidth <= 520 ? 8 : 10}px Pretendard, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("전체 비행장", panelX + 11, panelY + 13);
  context.fillStyle = "#ffd24a";
  context.textAlign = "right";
  context.fillText("N ↑", panelX + panelWidth - 11, panelY + 13);

  roundedRect(context, mapX, mapY, mapWidth, mapHeight, 8);
  context.save();
  context.clip();
  const mapGradient = context.createLinearGradient(0, mapY, 0, mapY + mapHeight);
  mapGradient.addColorStop(0, "rgba(38, 94, 72, 0.98)");
  mapGradient.addColorStop(1, "rgba(17, 57, 49, 0.98)");
  context.fillStyle = mapGradient;
  context.fillRect(mapX, mapY, mapWidth, mapHeight);

  context.strokeStyle = "rgba(222, 244, 229, 0.14)";
  context.lineWidth = 0.75;
  for (
    let x = Math.ceil(FIELD.minX / 5) * 5;
    x <= FIELD.maxX;
    x += 5
  ) {
    const near = mapPoint(x, FIELD.minZ);
    const far = mapPoint(x, FIELD.maxZ);
    context.beginPath();
    context.moveTo(near.x, near.y);
    context.lineTo(far.x, far.y);
    context.stroke();
  }
  for (
    let z = Math.ceil(FIELD.minZ / 5) * 5;
    z <= FIELD.maxZ;
    z += 5
  ) {
    const left = mapPoint(FIELD.minX, z);
    const right = mapPoint(FIELD.maxX, z);
    context.beginPath();
    context.moveTo(left.x, left.y);
    context.lineTo(right.x, right.y);
    context.stroke();
  }

  const fieldTopLeft = mapPoint(FIELD.minX, FIELD.maxZ);
  const fieldBottomRight = mapPoint(FIELD.maxX, FIELD.minZ);
  context.strokeStyle = "rgba(255, 255, 255, 0.72)";
  context.lineWidth = 1.2;
  context.setLineDash([4, 3]);
  context.strokeRect(
    fieldTopLeft.x,
    fieldTopLeft.y,
    fieldBottomRight.x - fieldTopLeft.x,
    fieldBottomRight.y - fieldTopLeft.y,
  );
  context.setLineDash([]);

  const mapLine = (
    points: Array<{ x: number; z: number }>,
    color: string,
    dashed = false,
  ) => {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1;
    if (dashed) context.setLineDash([3, 3]);
    context.beginPath();
    points.forEach((point, index) => {
      const mapped = mapPoint(point.x, point.z);
      if (index === 0) context.moveTo(mapped.x, mapped.y);
      else context.lineTo(mapped.x, mapped.y);
    });
    context.stroke();
    context.restore();
  };

  mapLine(
    [COURSE_POINTS.H, COURSE_POINTS.A, COURSE_POINTS.C, COURSE_POINTS.E],
    "rgba(246, 248, 236, 0.65)",
  );
  mapLine(
    [COURSE_POINTS.B, COURSE_POINTS.A, COURSE_POINTS.D],
    "rgba(246, 248, 236, 0.5)",
  );
  const courseCircle = Array.from({ length: 33 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 32;
    return {
      x: COURSE_CIRCLE.centerX + Math.cos(angle) * COURSE_CIRCLE.radius,
      z: COURSE_CIRCLE.centerZ + Math.sin(angle) * COURSE_CIRCLE.radius,
    };
  });
  mapLine(
    courseCircle,
    "rgba(246, 248, 236, 0.52)",
    true,
  );

  EMERGENCY_PADS.forEach((pad) => {
    const topLeft = mapPoint(pad.x - 1, pad.z + 1);
    const bottomRight = mapPoint(pad.x + 1, pad.z - 1);
    context.fillStyle = "rgba(242, 77, 49, 0.9)";
    context.strokeStyle = "rgba(255, 244, 218, 0.88)";
    context.lineWidth = 0.8;
    context.fillRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
    context.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
    context.fillStyle = "#ffffff";
    context.font = "900 6px Pretendard, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "F",
      (topLeft.x + bottomRight.x) / 2,
      (topLeft.y + bottomRight.y) / 2 + 0.4,
    );
  });

  if (state.motorsArmed) {
    const droneGround = mapPoint(state.x, state.z);
    const footprint = downwashFootprint(state.altitude) * scale;
    context.fillStyle = "rgba(88, 218, 235, 0.09)";
    context.strokeStyle = "rgba(88, 218, 235, 0.52)";
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.arc(
      droneGround.x,
      droneGround.y,
      footprint,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.setLineDash([]);
  }

  const activeWaypoint =
    mission[Math.min(state.waypointIndex, mission.length - 1)];

  if (guideMode === "full") {
    for (let index = 1; index < mission.length; index += 1) {
      const previous = mapPoint(mission[index - 1].x, mission[index - 1].z);
      const current = mapPoint(mission[index].x, mission[index].z);
      context.strokeStyle =
        index <= state.waypointIndex
          ? "rgba(103, 214, 143, 0.9)"
          : "rgba(238, 247, 248, 0.44)";
      context.lineWidth = index === state.waypointIndex ? 2 : 1.2;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    }

    mission.forEach((waypoint, index) => {
      const point = mapPoint(waypoint.x, waypoint.z);
      const active = index === state.waypointIndex;
      const complete = index < state.waypointIndex;
      const duplicateOffset =
        mission.slice(0, index).filter(
          (candidate) =>
            Math.abs(candidate.x - waypoint.x) < 0.1 &&
            Math.abs(candidate.z - waypoint.z) < 0.1,
        ).length * 2.5;

      context.beginPath();
      context.arc(
        point.x + duplicateOffset,
        point.y - duplicateOffset,
        active ? 4.2 : 2.2,
        0,
        Math.PI * 2,
      );
      context.fillStyle = complete
        ? "#67d68f"
        : active
          ? "#ffd24a"
          : "rgba(239, 248, 250, 0.68)";
      context.fill();
      if (active) {
        context.strokeStyle = "rgba(255, 210, 74, 0.55)";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(point.x, point.y, 7, 0, Math.PI * 2);
        context.stroke();
      }
    });
  } else if (guideMode === "target" && activeWaypoint) {
    const point = mapPoint(activeWaypoint.x, activeWaypoint.z);
    context.fillStyle = "#ffd24a";
    context.beginPath();
    context.arc(point.x, point.y, 4.2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255, 210, 74, 0.58)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.stroke();
  }

  COURSE_CONES.forEach((marker) => {
    const point = mapPoint(marker.x, marker.z);
    const intensity = getDownwashIntensity(state, marker);
    const markerSize = intensity > 0.35 ? 4 : 3.1;
    const droneDistance = Math.hypot(
      marker.x - state.x,
      marker.z - state.z,
    );

    if (intensity > 0.03) {
      context.strokeStyle = `rgba(104, 230, 239, ${0.35 + intensity * 0.55})`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        markerSize + 3 + intensity * 2,
        0,
        Math.PI * 2,
      );
      context.stroke();

      if (droneDistance > 0.2) {
        const tailLength = 1.5 + intensity * 2.6;
        const tail = mapPoint(
          marker.x +
            ((marker.x - state.x) / droneDistance) * tailLength,
          marker.z +
            ((marker.z - state.z) / droneDistance) * tailLength,
        );
        context.lineWidth = 1 + intensity;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(tail.x, tail.y);
        context.stroke();
      }
    }

    context.fillStyle = intensity > 0.35 ? "#ffd24a" : "#f26735";
    context.beginPath();
    context.moveTo(point.x, point.y - markerSize);
    context.lineTo(point.x + markerSize, point.y + markerSize);
    context.lineTo(point.x - markerSize, point.y + markerSize);
    context.closePath();
    context.fill();
    context.fillStyle = "#fff7e7";
    context.font = "900 6px Pretendard, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(marker.id, point.x + markerSize + 1.5, point.y);
  });

  const home = mapPoint(FIELD.homeX, FIELD.homeZ);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "800 7px Pretendard, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.beginPath();
  context.arc(home.x, home.y, 5.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#143440";
  context.fillText("H", home.x, home.y + 0.5);

  const pilot = mapPoint(PILOT.x, PILOT.z);
  context.fillStyle = "#63cfed";
  context.beginPath();
  context.arc(pilot.x, pilot.y, 4.8, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#062430";
  context.font = "900 7px Pretendard, sans-serif";
  context.fillText("P", pilot.x, pilot.y + 0.5);

  const drone = mapPoint(state.x, state.z);
  if (guideMode !== "off" && activeWaypoint) {
    const target = mapPoint(activeWaypoint.x, activeWaypoint.z);
    context.strokeStyle = "rgba(255, 210, 74, 0.5)";
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(drone.x, drone.y);
    context.lineTo(target.x, target.y);
    context.stroke();
    context.setLineDash([]);

    if (activeWaypoint.targetYaw !== undefined) {
      const yawRadians = (activeWaypoint.targetYaw * Math.PI) / 180;
      const heading = mapPoint(
        activeWaypoint.x + Math.sin(yawRadians) * 6,
        activeWaypoint.z + Math.cos(yawRadians) * 6,
      );
      const headingAngle = Math.atan2(
        heading.y - target.y,
        heading.x - target.x,
      );
      context.save();
      context.strokeStyle = "#ffd24a";
      context.fillStyle = "#ffd24a";
      context.lineWidth = compactMobile ? 1.5 : 2;
      context.beginPath();
      context.moveTo(target.x, target.y);
      context.lineTo(heading.x, heading.y);
      context.stroke();
      context.translate(heading.x, heading.y);
      context.rotate(headingAngle);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-5, -3);
      context.lineTo(-5, 3);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  context.save();
  context.translate(drone.x, drone.y);
  context.rotate((state.yaw * Math.PI) / 180);
  context.shadowColor = "rgba(99, 207, 237, 0.9)";
  context.shadowBlur = 9;
  context.fillStyle = "#f7fdff";
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(5.5, 5.5);
  context.lineTo(0, 3.2);
  context.lineTo(-5.5, 5.5);
  context.closePath();
  context.fill();
  context.restore();
  context.restore();

  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.fillRect(
    panelX + 1,
    panelY + panelHeight - footerHeight,
    panelWidth - 2,
    footerHeight - 1,
  );
  context.fillStyle = "#dcebed";
  context.font = `700 ${viewportWidth <= 520 ? 7 : 8}px Pretendard, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  const goalNumber = Math.min(state.waypointIndex + 1, mission.length);
  const footer =
    guideMode === "off"
      ? `실전 · 기체 ${state.altitude.toFixed(1)}m`
      : activeWaypoint
        ? `기체 ${state.altitude.toFixed(1)}m · 목표 ${goalNumber}/${mission.length} ${activeWaypoint.label}`
        : `기체 ${state.altitude.toFixed(1)}m · 코스 완료`;
  context.fillText(
    footer,
    panelX + 10,
    panelY + panelHeight - footerHeight / 2,
    panelWidth - 20,
  );
  context.restore();
}
