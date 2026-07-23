import * as THREE from "three";
import {
  PILOT_CAMERA,
  PILOT_VIEW_CONFIG,
  getPilotFocal,
} from "./PilotRenderer";
import type { PilotDroneLayer } from "./PilotRenderer";
import { COURSE_POINTS } from "./CourseGeometry";

export type DroneThreeState = {
  x: number;
  z: number;
  altitude: number;
  yaw: number;
  pitch: number;
  roll: number;
  elapsed: number;
  motorsArmed: boolean;
};

type RotorParts = {
  rotor: THREE.Group;
  blade: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  direction: number;
  phase: number;
};

const DEG_TO_RAD = Math.PI / 180;
const BODY_CLEARANCE = 0.42;
const MODEL_SPAN = 2.9;
const MODEL_VISUAL_SCALE = 1.16;

function beamBetween(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 8,
) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, length, segments),
    material,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

export class DroneThreeRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 180);
  private readonly yawRoot = new THREE.Group();
  private readonly tiltGroup = new THREE.Group();
  private readonly detailsGroup = new THREE.Group();
  private readonly rotors: RotorParts[] = [];
  private contextLost = false;
  private disposed = false;
  private lastBufferWidth = 0;
  private lastBufferHeight = 0;
  private lastPixelRatio = 0;

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    this.lastBufferWidth = 0;
    this.lastBufferHeight = 0;
  };

  constructor() {
    this.canvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
      precision: "mediump",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );

    const hemisphere = new THREE.HemisphereLight(0xe9f6ff, 0x375137, 2.25);
    const sunlight = new THREE.DirectionalLight(0xfff4da, 2.7);
    sunlight.position.set(-5, 9, 7);
    this.scene.add(hemisphere, sunlight);

    this.scene.add(this.yawRoot);
    this.yawRoot.add(this.tiltGroup);
    this.buildHexacopter();

    this.camera.position.set(
      PILOT_VIEW_CONFIG.eyeX,
      PILOT_VIEW_CONFIG.eyeHeight,
      -PILOT_VIEW_CONFIG.eyeZ,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(
      COURSE_POINTS.C.x,
      PILOT_VIEW_CONFIG.eyeHeight,
      -COURSE_POINTS.C.z,
    );
  }

  private buildHexacopter() {
    const carbon = new THREE.MeshStandardMaterial({
      color: 0x151c1f,
      metalness: 0.25,
      roughness: 0.55,
    });
    const motorMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d1215,
      metalness: 0.58,
      roughness: 0.32,
    });
    const blue = new THREE.MeshStandardMaterial({
      color: 0x167fd5,
      metalness: 0.18,
      roughness: 0.36,
    });
    const deepBlue = new THREE.MeshStandardMaterial({
      color: 0x0d497f,
      metalness: 0.22,
      roughness: 0.4,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xdce4e8,
      metalness: 0.06,
      roughness: 0.54,
    });
    const propeller = new THREE.MeshStandardMaterial({
      color: 0x20282d,
      metalness: 0.28,
      roughness: 0.34,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const lowerBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.42, 0.23, 8),
      white,
    );
    lowerBody.scale.set(0.84, 1, 1.08);
    lowerBody.position.y = -0.05;
    this.tiltGroup.add(lowerBody);

    const bodyBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.37, 0.1, 8),
      deepBlue,
    );
    bodyBand.scale.set(0.85, 1, 1.05);
    bodyBand.position.y = 0.105;
    this.tiltGroup.add(bodyBand);

    const upperBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.37, 0.23, 8),
      blue,
    );
    upperBody.scale.set(0.86, 1, 1.07);
    upperBody.position.y = 0.25;
    this.tiltGroup.add(upperBody);

    const nosePanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.09, 0.045),
      new THREE.MeshStandardMaterial({
        color: 0x0b3559,
        metalness: 0.18,
        roughness: 0.42,
      }),
    );
    nosePanel.position.set(0, 0.23, -0.39);
    this.tiltGroup.add(nosePanel);

    const armRadius = 1.05;
    const armStartRadius = 0.26;
    const armAngles = [-150, -90, -30, 30, 90, 150];
    const bladeGeometry = new THREE.BoxGeometry(0.86, 0.012, 0.052);
    const discGeometry = new THREE.CircleGeometry(0.43, 24);

    armAngles.forEach((angleDegrees, index) => {
      const angle = angleDegrees * DEG_TO_RAD;
      const radialX = Math.sin(angle);
      const radialZ = -Math.cos(angle);
      const armStart = new THREE.Vector3(
        radialX * armStartRadius,
        0.16,
        radialZ * armStartRadius,
      );
      const motorPoint = new THREE.Vector3(
        radialX * armRadius,
        0.18,
        radialZ * armRadius,
      );
      this.tiltGroup.add(
        beamBetween(armStart, motorPoint, 0.038, carbon, 8),
      );

      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.095, 0.12, 12),
        motorMaterial,
      );
      motor.position.copy(motorPoint);
      motor.position.y += 0.04;
      this.tiltGroup.add(motor);

      const rotor = new THREE.Group();
      rotor.position.copy(motorPoint);
      rotor.position.y += 0.125;
      const blade = new THREE.Mesh(bladeGeometry, propeller);
      rotor.add(blade);

      const discMaterial = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0xdff8ff : 0xcddfe5,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(discGeometry, discMaterial);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = -0.008;
      rotor.add(disc);
      this.tiltGroup.add(rotor);
      this.rotors.push({
        rotor,
        blade,
        disc,
        direction: index % 2 === 0 ? 1 : -1,
        phase: index * (Math.PI / 6),
      });
    });

    const strutTopY = -0.08;
    const skidY = -BODY_CLEARANCE;
    [-0.29, 0.29].forEach((x) => {
      [-0.22, 0.23].forEach((z) => {
        this.detailsGroup.add(
          beamBetween(
            new THREE.Vector3(x * 0.78, strutTopY, z),
            new THREE.Vector3(x, skidY + 0.03, z),
            0.024,
            carbon,
            7,
          ),
        );
      });
      this.detailsGroup.add(
        beamBetween(
          new THREE.Vector3(x, skidY, -0.43),
          new THREE.Vector3(x, skidY, 0.43),
          0.026,
          carbon,
          7,
        ),
      );
    });

    const puckGeometry = new THREE.CylinderGeometry(0.065, 0.065, 0.035, 14);
    [-0.16, 0.16].forEach((x) => {
      const puck = new THREE.Mesh(puckGeometry, white);
      puck.position.set(x, 0.4, -0.04);
      this.detailsGroup.add(puck);
    });
    this.tiltGroup.add(this.detailsGroup);

    const frontLedMaterial = new THREE.MeshStandardMaterial({
      color: 0xff5e4f,
      emissive: 0xff2d20,
      emissiveIntensity: 3.2,
    });
    const rearLedMaterial = new THREE.MeshStandardMaterial({
      color: 0x62e69a,
      emissive: 0x20c66a,
      emissiveIntensity: 2.8,
    });
    const ledGeometry = new THREE.SphereGeometry(0.035, 8, 6);
    [-0.14, 0.14].forEach((x) => {
      const frontLed = new THREE.Mesh(ledGeometry, frontLedMaterial);
      frontLed.position.set(x, 0.17, -0.38);
      this.tiltGroup.add(frontLed);
      const rearLed = new THREE.Mesh(ledGeometry, rearLedMaterial);
      rearLed.position.set(x, 0.16, 0.37);
      this.tiltGroup.add(rearLed);
    });
  }

  private configureView(
    fullWidth: number,
    fullHeight: number,
    cropX: number,
    cropY: number,
    cropWidth: number,
    cropHeight: number,
  ) {
    const mobile = fullWidth <= 760;
    // 메인 2D 캔버스에 확대 합성해도 기체가 흐려지지 않도록 모바일은
    // 1.5배까지 렌더합니다. 작은 crop만 그리므로 전체 화면 WebGL보다
    // 버퍼가 훨씬 작고, 고밀도 기기에서도 상한을 둬 GPU 부하를 제한합니다.
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      mobile ? 1.5 : 1.35,
    );
    if (
      cropWidth !== this.lastBufferWidth ||
      cropHeight !== this.lastBufferHeight ||
      pixelRatio !== this.lastPixelRatio
    ) {
      this.lastBufferWidth = cropWidth;
      this.lastBufferHeight = cropHeight;
      this.lastPixelRatio = pixelRatio;
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(cropWidth, cropHeight, false);
    }

    const focal = getPilotFocal(fullWidth, fullHeight);
    this.camera.aspect = fullWidth / Math.max(1, fullHeight);
    this.camera.fov =
      (2 * Math.atan(fullHeight / Math.max(1, 2 * focal))) / DEG_TO_RAD;
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[9] =
      2 * PILOT_VIEW_CONFIG.horizonRatio - 1;

    // 전체 조종자 시점의 투영을 유지한 채 기체 주변 사각형만 렌더합니다.
    // WebGL 전체 화면을 2D 캔버스로 복사할 때 생기는 GPU 동기화 비용을
    // 모바일 기준 약 1/8 이하로 줄입니다.
    const scaleX = fullWidth / cropWidth;
    const scaleY = fullHeight / cropHeight;
    const shiftX =
      (fullWidth - 2 * cropX - cropWidth) / cropWidth;
    const shiftY =
      (2 * cropY + cropHeight - fullHeight) / cropHeight;
    const matrix = this.camera.projectionMatrix.elements;
    for (let column = 0; column < 4; column += 1) {
      const rowOffset = column * 4;
      const clipW = matrix[rowOffset + 3];
      matrix[rowOffset] = scaleX * matrix[rowOffset] + shiftX * clipW;
      matrix[rowOffset + 1] =
        scaleY * matrix[rowOffset + 1] + shiftY * clipW;
    }
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
  }

  render(
    state: DroneThreeState,
    width: number,
    height: number,
  ): PilotDroneLayer | null {
    if (this.disposed || this.contextLost || width < 1 || height < 1) {
      return null;
    }

    const dx = state.x - PILOT_VIEW_CONFIG.eyeX;
    const dz = state.z - PILOT_CAMERA.z;
    const cameraX =
      dx * Math.cos(PILOT_VIEW_CONFIG.yaw) -
      dz * Math.sin(PILOT_VIEW_CONFIG.yaw);
    const depth =
      dx * Math.sin(PILOT_VIEW_CONFIG.yaw) +
      dz * Math.cos(PILOT_VIEW_CONFIG.yaw);
    const focal = getPilotFocal(width, height);
    const projectedSpan = depth > 0 ? (MODEL_SPAN * focal) / depth : 0;
    const visualProjectedSpan = projectedSpan * MODEL_VISUAL_SCALE;
    const mobile = width <= 760;
    const minimumSpan = mobile ? 14 : 18;
    const maximumBoost = mobile ? 1.6 : 1.28;
    const farBoost =
      visualProjectedSpan > 0 && visualProjectedSpan < minimumSpan
        ? Math.min(maximumBoost, minimumSpan / visualProjectedSpan)
        : 1;
    const renderAltitude = Math.max(BODY_CLEARANCE, state.altitude);
    const centerX = width / 2 + (cameraX / Math.max(0.75, depth)) * focal;
    const centerY =
      height * PILOT_VIEW_CONFIG.horizonRatio -
      ((renderAltitude - PILOT_VIEW_CONFIG.eyeHeight) /
        Math.max(0.75, depth)) *
        focal;
    // FHD/QHD에서는 384px, 4K 또는 시험구역보다 가까운 비행에서는
    // 512px로 한 단계만 확장해 로터 끝 잘림과 매 프레임 버퍼 재할당을
    // 동시에 방지합니다.
    const requiredCrop =
      visualProjectedSpan * farBoost * 1.25 + 48;
    // 모바일은 평소 256px crop을 유지하고, 가까운 기체가 로터까지
    // 256px을 넘길 때만 384px로 확장합니다. 1.5 DPR 기준 최대
    // 576×576 버퍼여서 선명도를 높이면서도 메모리·합성 비용을 제한합니다.
    const cropTarget = mobile
      ? requiredCrop > 256
        ? 384
        : 256
      : requiredCrop > 384
        ? 512
        : 384;
    const cropWidth = Math.min(width, cropTarget);
    const cropHeight = Math.min(height, cropTarget);
    const cropX = Math.round(
      Math.min(
        Math.max(0, centerX - cropWidth / 2),
        Math.max(0, width - cropWidth),
      ),
    );
    const cropY = Math.round(
      Math.min(
        Math.max(0, centerY - cropHeight / 2),
        Math.max(0, height - cropHeight),
      ),
    );

    this.configureView(
      width,
      height,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
    );

    this.yawRoot.visible = depth > 1.5;
    this.yawRoot.position.set(state.x, renderAltitude, -state.z);
    this.yawRoot.rotation.y = -state.yaw * DEG_TO_RAD;
    this.yawRoot.scale.setScalar(MODEL_VISUAL_SCALE * farBoost);
    this.tiltGroup.rotation.x = -state.pitch * DEG_TO_RAD;
    this.tiltGroup.rotation.z = -state.roll * DEG_TO_RAD;
    this.detailsGroup.visible = visualProjectedSpan >= 28;

    this.rotors.forEach((parts) => {
      parts.rotor.rotation.y = state.motorsArmed
        ? parts.phase + state.elapsed * 52 * parts.direction
        : parts.phase;
      parts.blade.visible =
        visualProjectedSpan >= 22 || !state.motorsArmed;
      parts.blade.material.opacity = state.motorsArmed ? 0.34 : 0.82;
      parts.disc.visible = state.motorsArmed;
      parts.disc.material.opacity = state.motorsArmed ? 0.12 : 0;
    });

    this.renderer.render(this.scene, this.camera);
    return {
      canvas: this.canvas,
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
