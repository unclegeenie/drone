import {
  COURSE_CIRCLE,
  COURSE_CONES,
  COURSE_POINTS,
  EMERGENCY_PADS,
  FIELD_BOUNDS,
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
const PILOT = COURSE_POINTS.P;
const LOCAL_MAP_HALF_RANGE = 10;

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
  const portraitMobile =
    viewportWidth <= 520 && viewportHeight > viewportWidth;
  const compactMobile = viewportWidth <= 520 || shortLandscape;
  const expandedMobileHud =
    portraitMobile && viewportWidth >= 341 && viewportHeight >= 691;
  const mobileMapScale = expandedMobileHud ? 1.1 : 1;
  const panelWidth = compactMobile
    ? shortLandscape
      ? clamp(viewportWidth * 0.19, 136, 150)
      : expandedMobileHud
        ? clamp(viewportWidth * 0.46, 160, 174)
        : clamp(viewportWidth * 0.42, 146, 158)
    : clamp(viewportWidth * 0.2, 176, 260);
  const panelHeight = compactMobile
    ? shortLandscape
      ? clamp(panelWidth * 1.06, 144, 158)
      : expandedMobileHud
        ? clamp(panelWidth * 1.18, 189, 209)
        : clamp(panelWidth * 1.18, 172, 190)
    : clamp(panelWidth * 1.18, 208, 306);
  const panelX =
    viewportWidth - panelWidth - (viewportWidth <= 760 ? 10 : 24);
  const panelY =
    shortLandscape
      ? 94
      : compactMobile
      ? expandedMobileHud
        ? 204
        : 178
      : viewportWidth <= 760
        ? 148
        : 164;
  const headerHeight = expandedMobileHud ? 26 : compactMobile ? 24 : 27;
  const footerHeight = expandedMobileHud ? 30 : compactMobile ? 27 : 32;
  const panelInset = expandedMobileHud ? 10 : 9;
  const mapBottomGap = expandedMobileHud ? 8 : 7;
  const mapX = panelX + panelInset;
  const mapY = panelY + headerHeight;
  const mapWidth = panelWidth - panelInset * 2;
  const mapHeight =
    panelHeight - headerHeight - footerHeight - mapBottomGap;
  const mapLabelFontSize = compactMobile
    ? 8.5 * mobileMapScale
    : 9.5;
  const localWorldSize = LOCAL_MAP_HALF_RANGE * 2;
  const scale = Math.min(
    mapWidth / localWorldSize,
    mapHeight / localWorldSize,
  );
  const mapCenterX = mapX + mapWidth / 2;
  const mapCenterY = mapY + mapHeight / 2;
  const visibleBounds = {
    minX: state.x - LOCAL_MAP_HALF_RANGE,
    maxX: state.x + LOCAL_MAP_HALF_RANGE,
    minZ: state.z - LOCAL_MAP_HALF_RANGE,
    maxZ: state.z + LOCAL_MAP_HALF_RANGE,
  };

  const mapPoint = (x: number, z: number) => ({
    x: mapCenterX + (x - state.x) * scale,
    y: mapCenterY - (z - state.z) * scale,
  });
  const pointIsVisible = (x: number, z: number, margin = 0) =>
    x >= visibleBounds.minX - margin &&
    x <= visibleBounds.maxX + margin &&
    z >= visibleBounds.minZ - margin &&
    z <= visibleBounds.maxZ + margin;

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
  context.font = `800 ${
    compactMobile ? 9 * mobileMapScale : 10.5
  }px Pretendard, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(
    "주변 지도 ±10m",
    panelX + 11 * mobileMapScale,
    panelY + headerHeight / 2,
  );
  context.fillStyle = "#ffd24a";
  context.textAlign = "right";
  context.fillText(
    "N ↑",
    panelX + panelWidth - 11 * mobileMapScale,
    panelY + headerHeight / 2,
  );

  roundedRect(context, mapX, mapY, mapWidth, mapHeight, 8);
  context.save();
  context.clip();
  context.fillStyle = "rgba(8, 36, 41, 0.98)";
  context.fillRect(mapX, mapY, mapWidth, mapHeight);

  const mapGradient = context.createLinearGradient(0, mapY, 0, mapY + mapHeight);
  mapGradient.addColorStop(0, "rgba(38, 94, 72, 0.98)");
  mapGradient.addColorStop(1, "rgba(17, 57, 49, 0.98)");
  const fieldTopLeft = mapPoint(FIELD.minX, FIELD.maxZ);
  const fieldBottomRight = mapPoint(FIELD.maxX, FIELD.minZ);
  context.fillStyle = mapGradient;
  context.fillRect(
    fieldTopLeft.x,
    fieldTopLeft.y,
    fieldBottomRight.x - fieldTopLeft.x,
    fieldBottomRight.y - fieldTopLeft.y,
  );

  const gridMinX = Math.max(visibleBounds.minX, FIELD.minX);
  const gridMaxX = Math.min(visibleBounds.maxX, FIELD.maxX);
  const gridMinZ = Math.max(visibleBounds.minZ, FIELD.minZ);
  const gridMaxZ = Math.min(visibleBounds.maxZ, FIELD.maxZ);
  const drawGrid = (
    step: number,
    color: string,
    lineWidth: number,
  ) => {
    if (gridMinX > gridMaxX || gridMinZ > gridMaxZ) return;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    for (
      let x = Math.ceil(gridMinX / step) * step;
      x <= gridMaxX;
      x += step
    ) {
      const near = mapPoint(x, gridMinZ);
      const far = mapPoint(x, gridMaxZ);
      context.beginPath();
      context.moveTo(near.x, near.y);
      context.lineTo(far.x, far.y);
      context.stroke();
    }
    for (
      let z = Math.ceil(gridMinZ / step) * step;
      z <= gridMaxZ;
      z += step
    ) {
      const left = mapPoint(gridMinX, z);
      const right = mapPoint(gridMaxX, z);
      context.beginPath();
      context.moveTo(left.x, left.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }
  };
  drawGrid(2, "rgba(222, 244, 229, 0.09)", 0.65);
  drawGrid(5, "rgba(235, 249, 239, 0.22)", 0.9);

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
    if (!pointIsVisible(pad.x, pad.z, 1.2)) return;
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
    context.font = `800 ${mapLabelFontSize}px Pretendard, sans-serif`;
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
    context.fillStyle = "rgba(88, 218, 235, 0.06)";
    context.strokeStyle = "rgba(88, 218, 235, 0.38)";
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
  const activeWaypointVisible = Boolean(
    activeWaypoint &&
      pointIsVisible(activeWaypoint.x, activeWaypoint.z),
  );

  if (guideMode === "full") {
    const routeStart = Math.max(0, state.waypointIndex - 1);
    const routeEnd = Math.min(
      mission.length - 1,
      state.waypointIndex + 2,
    );
    for (let index = routeStart + 1; index <= routeEnd; index += 1) {
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

    for (let index = routeStart; index <= routeEnd; index += 1) {
      const waypoint = mission[index];
      if (!waypoint || !pointIsVisible(waypoint.x, waypoint.z, 0.8)) continue;
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
        (active ? 4.2 : 2.2) * mobileMapScale,
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
        context.arc(
          point.x,
          point.y,
          7 * mobileMapScale,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }
  } else if (
    guideMode === "target" &&
    activeWaypoint &&
    activeWaypointVisible
  ) {
    const point = mapPoint(activeWaypoint.x, activeWaypoint.z);
    context.fillStyle = "#ffd24a";
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      4.2 * mobileMapScale,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.strokeStyle = "rgba(255, 210, 74, 0.58)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      7 * mobileMapScale,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }

  COURSE_CONES.forEach((marker) => {
    if (!pointIsVisible(marker.x, marker.z, 1)) return;
    const point = mapPoint(marker.x, marker.z);
    const intensity = getDownwashIntensity(state, marker);
    const markerSize =
      (intensity > 0.35 ? 4.8 : 3.8) * mobileMapScale;
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
        markerSize + (3 + intensity * 2) * mobileMapScale,
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
    context.font = `800 ${mapLabelFontSize}px Pretendard, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(
      marker.id,
      point.x + markerSize + 1.5 * mobileMapScale,
      point.y,
    );
  });

  const home = mapPoint(FIELD.homeX, FIELD.homeZ);
  if (pointIsVisible(FIELD.homeX, FIELD.homeZ, 0.8)) {
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.font = `800 ${mapLabelFontSize}px Pretendard, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.beginPath();
    context.arc(
      home.x,
      home.y,
      5.8 * mobileMapScale,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = "#143440";
    context.fillText("H", home.x, home.y + 0.5);
  }

  const pilot = mapPoint(PILOT.x, PILOT.z);
  if (pointIsVisible(PILOT.x, PILOT.z, 0.8)) {
    context.fillStyle = "#63cfed";
    context.beginPath();
    context.arc(
      pilot.x,
      pilot.y,
      5.2 * mobileMapScale,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = "#062430";
    context.font = `800 ${mapLabelFontSize}px Pretendard, sans-serif`;
    context.fillText("P", pilot.x, pilot.y + 0.5);
  }

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

    if (!activeWaypointVisible) {
      const deltaX = (activeWaypoint.x - state.x) * scale;
      const deltaY = -(activeWaypoint.z - state.z) * scale;
      const edgeInset = 9 * mobileMapScale;
      const edgeExtent =
        LOCAL_MAP_HALF_RANGE * scale - edgeInset;
      const edgeRatio = Math.min(
        edgeExtent / Math.max(Math.abs(deltaX), 0.001),
        edgeExtent / Math.max(Math.abs(deltaY), 0.001),
      );
      const edgeX = drone.x + deltaX * edgeRatio;
      const edgeY = drone.y + deltaY * edgeRatio;
      const directionLength = Math.max(
        Math.hypot(deltaX, deltaY),
        0.001,
      );
      const directionX = deltaX / directionLength;
      const directionY = deltaY / directionLength;
      const directionAngle = Math.atan2(deltaY, deltaX);
      const targetDistance = Math.hypot(
        activeWaypoint.x - state.x,
        activeWaypoint.z - state.z,
      );

      context.save();
      context.translate(edgeX, edgeY);
      context.rotate(directionAngle);
      context.scale(mobileMapScale, mobileMapScale);
      context.fillStyle = "#ffd24a";
      context.beginPath();
      context.moveTo(6, 0);
      context.lineTo(-4, -4);
      context.lineTo(-4, 4);
      context.closePath();
      context.fill();
      context.restore();

      context.fillStyle = "#fff0a8";
      context.font = `800 ${mapLabelFontSize}px Pretendard, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        `${Math.round(targetDistance)}m`,
        edgeX - directionX * 13 * mobileMapScale,
        edgeY - directionY * 13 * mobileMapScale,
      );
    } else if (activeWaypoint.targetYaw !== undefined) {
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
  context.scale(mobileMapScale, mobileMapScale);
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
  context.font = `700 ${mapLabelFontSize}px Pretendard, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  const goalNumber = Math.min(state.waypointIndex + 1, mission.length);
  const footer =
    guideMode === "off"
      ? `고도 ${state.altitude.toFixed(1)}m · 실전`
      : activeWaypoint
        ? `고도 ${state.altitude.toFixed(1)}m · 목표 ${goalNumber}/${mission.length}`
        : `고도 ${state.altitude.toFixed(1)}m · 완료`;
  context.fillText(
    footer,
    panelX + 10 * mobileMapScale,
    panelY + panelHeight - footerHeight / 2,
  );
  context.restore();
}
