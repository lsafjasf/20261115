import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HEIGHT_SCALE, WORLD_SIZE } from "./terrain.js";

const SCENE_HEIGHT = 430;
const CAMERA_HOME = new THREE.Vector3(1060, 760, 1110);
const TARGET_HOME = new THREE.Vector3(0, 92, 0);

function makeBackgroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#10252b");
  gradient.addColorStop(0.36, "#0a171b");
  gradient.addColorStop(0.72, "#061014");
  gradient.addColorStop(1, "#03090b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 16, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFlagLabel(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(5, 15, 17, 0.84)";
  context.strokeStyle = "rgba(255, 174, 130, 0.42)";
  context.lineWidth = 3;
  context.roundRect(4, 4, 504, 120, 24);
  context.fill();
  context.stroke();
  context.fillStyle = "#ffb187";
  context.font = '500 32px "Noto Sans SC", sans-serif';
  context.fillText("CAVE / 洞穴", 36, 55);
  context.fillStyle = "#8ca6a3";
  context.font = '400 22px "Noto Sans SC", sans-serif';
  context.fillText(name.toUpperCase(), 36, 91);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(118, 29.5, 1);
  sprite.position.y = 112;
  return sprite;
}

function createFlagMesh(flag) {
  const group = new THREE.Group();
  group.userData.flagId = flag.id;
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0xc7d7d1,
    roughness: 0.55,
    metalness: 0.6,
  });
  const clothMaterial = new THREE.MeshStandardMaterial({
    color: 0xff9663,
    roughness: 0.72,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff9663,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.5, 82, 6), poleMaterial);
  pole.position.y = 41;
  pole.castShadow = true;
  group.add(pole);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(43, -13);
  flagShape.lineTo(0, -26);
  flagShape.lineTo(0, 0);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), clothMaterial);
  cloth.position.set(1.6, 79, 0);
  cloth.castShadow = true;
  group.add(cloth);

  const ring = new THREE.Mesh(new THREE.RingGeometry(8, 15, 32), glowMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.6;
  group.add(ring);

  const pin = new THREE.Mesh(new THREE.SphereGeometry(2.5, 10, 10), clothMaterial);
  pin.position.y = 1.8;
  group.add(pin);

  group.add(makeFlagLabel(flag.name));
  group.userData.clothMaterial = clothMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.ring = ring;
  group.userData.submerged = false;
  return group;
}

function createGeometry(grid) {
  const count = grid * grid;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices = new Uint32Array((grid - 1) * (grid - 1) * 6);
  let offset = 0;
  for (let z = 0; z < grid - 1; z += 1) {
    for (let x = 0; x < grid - 1; x += 1) {
      const a = z * grid + x;
      const b = a + 1;
      const c = a + grid;
      const d = c + 1;
      indices[offset] = a;
      indices[offset + 1] = c;
      indices[offset + 2] = b;
      indices[offset + 3] = b;
      indices[offset + 4] = c;
      indices[offset + 5] = d;
      offset += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

const palette = {
  deepBed: new THREE.Color("#152f35"),
  bed: new THREE.Color("#31504a"),
  sand: new THREE.Color("#b6a274"),
  grass: new THREE.Color("#667b4e"),
  meadow: new THREE.Color("#7d8c5b"),
  rock: new THREE.Color("#777b74"),
  snow: new THREE.Color("#d8ddd3"),
};

function applyTerrainColors(geometry, heights, grid, seaLevel) {
  const colorAttribute = geometry.getAttribute("color");
  const normalAttribute = geometry.getAttribute("normal");
  const colors = colorAttribute.array;
  const temp = new THREE.Color();
  const rockTemp = new THREE.Color();
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index];
    const normalY = normalAttribute.getY(index);
    if (height <= seaLevel) {
      const depth = Math.min(1, (seaLevel - height) / Math.max(0.12, 1 - seaLevel));
      temp.copy(palette.bed).lerp(palette.deepBed, Math.pow(depth, 0.7));
    } else {
      const t = Math.min(1, (height - seaLevel) / Math.max(0.12, 1 - seaLevel));
      if (t < 0.06) {
        temp.copy(palette.sand);
      } else if (t < 0.37) {
        temp.copy(palette.sand).lerp(palette.grass, (t - 0.06) / 0.31);
      } else if (t < 0.55) {
        temp.copy(palette.grass).lerp(palette.rock, (t - 0.37) / 0.18);
      } else {
        temp.copy(palette.rock).lerp(palette.snow, Math.min(1, (t - 0.55) / 0.16));
      }
      temp.lerp(palette.meadow, Math.max(0, 0.16 - t) * 2.2);
      const slope = 1 - normalY;
      if (slope > 0.38) {
        rockTemp.copy(palette.rock).multiplyScalar(0.82);
        temp.lerp(rockTemp, Math.min(0.72, (slope - 0.38) * 1.4));
      }
      const light = 0.9 + Math.min(0.12, height * 0.14);
      temp.multiplyScalar(light);
    }
    colors[index * 3] = temp.r;
    colors[index * 3 + 1] = temp.g;
    colors[index * 3 + 2] = temp.b;
  }
  colorAttribute.needsUpdate = true;
}

function makeWaterMaterial(heightTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHeightMap: { value: heightTexture },
      uSeaLevel: { value: 0.4 },
      uTime: { value: 0 },
      uWorldSize: { value: WORLD_SIZE },
      uShallow: { value: new THREE.Color("#63d5d6") },
      uDeep: { value: new THREE.Color("#0d6475") },
      uOpacity: { value: 0.88 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uHeightMap;
      uniform float uSeaLevel;
      uniform float uTime;
      uniform float uWorldSize;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uOpacity;
      varying vec3 vWorldPosition;

      void main() {
        vec2 uv = clamp(vec2(
          vWorldPosition.x / uWorldSize + 0.5,
          vWorldPosition.z / uWorldSize + 0.5
        ), vec2(0.002), vec2(0.998));
        float terrain = texture2D(uHeightMap, uv).r;
        float depth = uSeaLevel - terrain;
        if (depth <= 0.0004) discard;

        float shore = smoothstep(0.0, 0.018, depth);
        float deep = smoothstep(0.015, 0.22, depth);
        vec3 color = mix(uShallow, uDeep, deep * 0.82);
        float ripple =
          sin(vWorldPosition.x * 0.017 + uTime * 0.75) *
          sin(vWorldPosition.z * 0.014 - uTime * 0.58);
        color += vec3(0.018, 0.05, 0.045) * (ripple * 0.5 + 0.5) * (1.0 - deep);

        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float specular = pow(max(0.0, viewDirection.y), 22.0);
        color += vec3(0.15, 0.24, 0.22) * specular * shore;
        float alpha = mix(0.5, 0.9, deep) * shore * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class TerrainScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = makeBackgroundTexture();
    this.scene.fog = new THREE.FogExp2(0x071216, 0.00016);
    this.camera = new THREE.PerspectiveCamera(38, 1, 2, 8000);
    this.camera.position.copy(CAMERA_HOME);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(TARGET_HOME);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.72;
    this.controls.minDistance = 450;
    this.controls.maxDistance = 3400;
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = Math.PI * 0.475;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.RIGHT = null;

    this.grid = 0;
    this.heights = null;
    this.seaLevel = 0.4;
    this.flags = new Map();
    this.cameraTween = null;
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.flagCount = 0;
    this.onFlagPlace = null;

    this.setupLights();
    this.setupMarkers();
    this.setupInteraction();
    this.resize();
    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  setupLights() {
    const hemisphere = new THREE.HemisphereLight(0xb9d9d1, 0x29372d, 1.45);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff0ca, 2.25);
    sun.position.set(-620, 980, -540);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.camera.left = -1300;
    sun.shadow.camera.right = 1300;
    sun.shadow.camera.top = 1300;
    sun.shadow.camera.bottom = -1300;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 3000;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7dbbbf, 0.42);
    fill.position.set(900, 300, 600);
    this.scene.add(fill);
  }

  setupMarkers() {
    this.hoverMarker = new THREE.Mesh(
      new THREE.RingGeometry(10, 15, 32),
      new THREE.MeshBasicMaterial({
        color: 0xd9f277,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.hoverMarker.rotation.x = -Math.PI / 2;
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);
    this.flagsGroup = new THREE.Group();
    this.scene.add(this.flagsGroup);
  }

  setupInteraction() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 2) return;
      event.preventDefault();
      const hit = this.pick(event.clientX, event.clientY);
      if (!hit) return;
      const elevation = hit.y / SCENE_HEIGHT * HEIGHT_SCALE;
      this.onFlagPlace?.({
        x: hit.x,
        y: elevation,
        z: hit.z,
      });
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.buttons !== 0 || event.pointerType === "touch") return;
      const hit = this.pick(event.clientX, event.clientY);
      if (!hit) {
        this.hoverMarker.visible = false;
        return;
      }
      this.hoverMarker.visible = true;
      this.hoverMarker.position.set(hit.x, hit.y + 1.4, hit.z);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverMarker.visible = false;
    });
    window.addEventListener("resize", () => this.resize());
  }

  pick(clientX, clientY) {
    if (!this.terrainMesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    return hits[0]?.point ?? null;
  }

  setTerrain(heights, grid, seaLevel) {
    if (grid !== this.grid) {
      this.grid = grid;
      this.heights = new Float32Array(heights);
      this.geometry?.dispose();
      this.geometry = createGeometry(grid);
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.02,
        envMapIntensity: 0.35,
      });
      this.terrainMesh = new THREE.Mesh(this.geometry, material);
      this.terrainMesh.castShadow = true;
      this.terrainMesh.receiveShadow = true;
      this.scene.add(this.terrainMesh);
      this.setupWater(grid);
    }
    this.heights.set(heights);
    this.seaLevel = seaLevel;
    this.updateGeometry(seaLevel);
  }

  setupWater(grid) {
    const data = new Float32Array(grid * grid);
    this.heightTexture = new THREE.DataTexture(data, grid, grid, THREE.RedFormat, THREE.FloatType);
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.unpackAlignment = 1;
    this.heightTexture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    geometry.rotateX(-Math.PI / 2);
    this.waterMaterial = makeWaterMaterial(this.heightTexture);
    this.waterMesh = new THREE.Mesh(geometry, this.waterMaterial);
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);
  }

  updateGeometry(seaLevel) {
    this.seaLevel = seaLevel;
    const position = this.geometry.getAttribute("position");
    const grid = this.grid;
    for (let z = 0; z < grid; z += 1) {
      for (let x = 0; x < grid; x += 1) {
        const index = z * grid + x;
        position.setXYZ(
          index,
          (x / (grid - 1) - 0.5) * WORLD_SIZE,
          this.heights[index] * SCENE_HEIGHT,
          (z / (grid - 1) - 0.5) * WORLD_SIZE,
        );
      }
    }
    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    applyTerrainColors(this.geometry, this.heights, grid, seaLevel);
    const textureData = this.heightTexture.image.data;
    textureData.set(this.heights);
    this.heightTexture.needsUpdate = true;
    this.waterMaterial.uniforms.uSeaLevel.value = seaLevel;
    this.waterMesh.position.y = seaLevel * SCENE_HEIGHT;
  }

  syncFlags(flags, waterElevation) {
    const ids = new Set(flags.map((flag) => flag.id));
    for (const [id, mesh] of this.flags) {
      if (!ids.has(id)) {
        this.flagsGroup.remove(mesh);
        this.flags.delete(id);
      }
    }
    flags.forEach((flag, index) => {
      let mesh = this.flags.get(flag.id);
      if (!mesh) {
        mesh = createFlagMesh(flag);
        this.flags.set(flag.id, mesh);
        this.flagsGroup.add(mesh);
      }
      mesh.position.set(flag.world.x, flag.world.y / HEIGHT_SCALE * SCENE_HEIGHT, flag.world.z);
      const submerged = flag.world.y < waterElevation;
      mesh.userData.submerged = submerged;
      mesh.userData.clothMaterial.color.set(submerged ? "#58d5df" : "#ff9663");
      mesh.userData.glowMaterial.color.set(submerged ? "#58d5df" : "#ff9663");
      mesh.userData.ring.scale.setScalar(1 + (index % 3) * 0.08);
    });
    this.flagCount = flags.length;
  }

  resetView() {
    this.cameraTween = {
      start: performance.now(),
      duration: 620,
      fromPosition: this.camera.position.clone(),
      toPosition: CAMERA_HOME.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: TARGET_HOME.clone(),
    };
  }

  animate(now) {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();
    if (this.waterMaterial) this.waterMaterial.uniforms.uTime.value = elapsed;
    if (this.cameraTween) {
      const t = Math.min(1, (now - this.cameraTween.start) / this.cameraTween.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.cameraTween.fromPosition, this.cameraTween.toPosition, ease);
      this.controls.target.lerpVectors(this.cameraTween.fromTarget, this.cameraTween.toTarget, ease);
      if (t >= 1) this.cameraTween = null;
    }
    if (this.hoverMarker.visible) {
      this.hoverMarker.material.opacity = 0.55 + Math.sin(elapsed * 4) * 0.16;
    }
    for (const flag of this.flags.values()) {
      flag.userData.glowMaterial.opacity = 0.28 + Math.sin(elapsed * 2.4) * 0.1;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  renderNow() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
