import * as THREE from "three";
import { OrbitControls } from "./OrbitControls.js";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { RoomEnvironment } from "./vendor/environments/RoomEnvironment.js";
import { DOORS, LIDS, WHEELS, OPEN_ANGLE, WINDOW_DROP, WINDOW_INSET, windowSillPlane } from "./car-model.mjs";
import { wheelAngleForDistance } from "./drive-cycle.mjs";
import { autopilot, motionSource } from "./autopilot-sim.mjs";
import { createDrivingRoad, MODEL_UNITS_PER_M } from "./road-scene.mjs";
import { t } from "./i18n.mjs";

const host = document.getElementById("car-view");
const status = document.getElementById("model-status");
let vehicleState = null;
document.addEventListener("vehicle-state", (event) => { vehicleState = event.detail; });

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.localClippingEnabled = true;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x101923, 75, 230);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 350);
  camera.position.set(12, 16, -22);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 9);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 12;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => {
      const cockpit = button.dataset.view === "cockpit";
      const views = { drive: [12, 16, -22], front: [14, 9, 17], side: [22, 6, 0], rear: [14, 9, -17], cockpit: [.6, 3.55, .5] };
      controls.minDistance = cockpit ? .5 : 12;
      camera.fov = cockpit ? 64 : 36;
      camera.updateProjectionMatrix();
      camera.position.set(...views[button.dataset.view]);
      controls.target.set(...(cockpit ? [.1, 2.75, 2.9] : button.dataset.view === "drive" ? [0, 1.5, 9] : [0, 2, 0]));
      controls.update();
    });
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x344451, 1.4));
  for (const [position, intensity] of [[[10, 16, 10], 2], [[-10, 8, -10], 1.2]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(...position);
    scene.add(light);
  }
  const model = await new GLTFLoader().loadAsync("/static/vehicle-doors.glb");
  const required = (name) => {
    const node = model.scene.getObjectByName(name);
    if (!node) throw new Error(`The modified model is missing ${name}.`);
    return node;
  };
  const hinges = DOORS.map((door) => {
    const node = required(door.id), glass = required(`window_${door.id}`);
    const [x, y, z, constant] = windowSillPlane(door);
    const sill = new THREE.Plane(new THREE.Vector3(x, y, z), constant).normalize();
    sill.constant += sill.normal.dot(new THREE.Vector3(...door.hinge));
    const clip = new THREE.Plane();
    glass.traverse((object) => {
      if (!object.isMesh) return;
      object.material = object.material.clone();
      object.material.clippingPlanes = [clip];
    });
    return { ...door, node, glass, sill, clip };
  });
  const lids = LIDS.map((lid) => ({ ...lid, node: required(lid.id) }));
  const wheels = WHEELS.map((wheel) => ({ ...wheel, node: required(wheel.id) }));
  scene.add(model.scene);
  const road = createDrivingRoad(crypto.getRandomValues(new Uint32Array(1))[0]);
  scene.add(road.group);
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Could not load local door state.");
  if (!vehicleState) vehicleState = (await response.json()).state;
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  status.textContent = "Pearl white / drag to orbit / scroll to zoom";
  host.dataset.modelReady = "true";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let previous = performance.now(), trafficElapsedSeconds = 0;
  const resetFrameTime = () => { previous = performance.now(); };
  document.addEventListener("visibilitychange", resetFrameTime);
  renderer.setAnimationLoop((time) => {
    const frameSeconds = Math.max(0, (time - previous) / 1000);
    const delta = Math.min(frameSeconds, 0.1);
    previous = time;
    if (!document.hidden && !reducedMotion.matches) trafficElapsedSeconds += frameSeconds;
    let animating = false;
    const simulated = autopilot.snapshot();
    const reference = motionSource.value === "reference";
    const drive = { speedKmh: simulated.actual_speed_kmh, distanceM: simulated.distance_m };
    if (!reducedMotion.matches) model.scene.position.x = reference ? 0 : simulated.lane_offset * MODEL_UNITS_PER_M;
    const animate = (current, target) => {
      const next = reducedMotion.matches ? target : THREE.MathUtils.damp(current, target, 8, delta);
      const value = Math.abs(next - target) < 0.001 ? target : next;
      if (value !== target) animating = true;
      return value;
    };
    for (const door of hinges) {
      const target = vehicleState.doors[door.id] ? -door.side * OPEN_ANGLE : 0;
      door.node.rotation.y = animate(door.node.rotation.y, target);
      door.node.updateMatrix();
      door.glass.position.y = animate(door.glass.position.y, vehicleState.windows[door.id] ? -WINDOW_DROP : 0);
      door.glass.position.x = -door.side * WINDOW_INSET * (-door.glass.position.y / WINDOW_DROP);
      door.glass.updateMatrix();
      door.node.updateWorldMatrix(true, true);
      door.clip.copy(door.sill).applyMatrix4(door.node.matrixWorld);
      host.dataset[door.id] = door.node.rotation.y.toFixed(4);
      host.dataset[`window_${door.id}`] = door.glass.position.y.toFixed(4);
    }
    for (const lid of lids) {
      lid.node.rotation.x = animate(lid.node.rotation.x, vehicleState.lids[lid.id] ? lid.angle : 0);
      lid.node.updateMatrix();
      host.dataset[lid.id] = lid.node.rotation.x.toFixed(4);
    }
    const roadConditions = reference
      ? { mode: "disengaged", lane_visible: true, lead_distance_m: Infinity } : simulated;
    const roadState = road.update(drive.distanceM, roadConditions, reducedMotion.matches, trafficElapsedSeconds);
    for (const wheel of wheels) {
      if (drive && !reducedMotion.matches) {
        wheel.node.rotation.x = wheelAngleForDistance(drive.distanceM);
        wheel.node.updateMatrix();
      }
      host.dataset[wheel.id] = wheel.node.rotation.x.toFixed(4);
    }
    host.dataset.wheelsRolling = String(Boolean(drive && drive.speedKmh > 0 && !reducedMotion.matches));
    host.dataset.speedKmh = drive ? drive.speedKmh.toFixed(4) : "0";
    host.dataset.distanceM = drive ? drive.distanceM.toFixed(4) : "0";
    host.dataset.motionReduced = String(reducedMotion.matches);
    host.dataset.roadPhase = roadState.phase.toFixed(4);
    host.dataset.roadDistanceM = roadState.distanceM.toFixed(4);
    host.dataset.trafficCount = String(roadState.trafficCount);
    host.dataset.trafficKinds = roadState.kinds;
    host.dataset.trafficZ = roadState.trafficZ;
    host.dataset.trafficSeconds = trafficElapsedSeconds.toFixed(4);
    host.dataset.motionSource = motionSource.value;
    host.dataset.egoLaneOffset = model.scene.position.x.toFixed(4);
    const caption = drive && reducedMotion.matches
      ? "Reduced motion / road, traffic and wheels held still"
      : "Virtual road / drag to orbit / scroll to zoom";
    if (status.textContent !== t(caption)) status.textContent = t(caption);
    host.dataset.animating = String(animating);
    controls.update();
    renderer.render(scene, camera);
  });
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    status.textContent = t("3D graphics context lost. Reload the cockpit to restore the model.");
    status.classList.add("model-error");
  });
  window.addEventListener("pagehide", () => {
    renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", resetFrameTime);
    controls.dispose();
    road.dispose();
    environment.dispose();
    renderer.dispose();
  }, { once: true });
}

start().catch((error) => {
  status.textContent = `3D vehicle unavailable: ${error.message}`;
  status.classList.add("model-error");
  console.error("Vehicle model failed", error);
});
