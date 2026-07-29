/* ============================================================
   EarthVerse — game.js
   Chapter One: Bahrain
   ============================================================
   Sections:
   1. Configuration
   2. State
   3. Init / Bootstrapping
   4. Map / Terrain / Buildings setup
   5. Vehicle creation & physics
   6. Desktop keyboard controls
   7. Mobile touch controls
   8. Camera (third-person follow)
   9. Missions / discovery detection
   10. UI (HUD, overlays, toasts)
   11. Save / Load (localStorage)
   12. Day / Night toggle
   13. Main loop
   ============================================================ */

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// Paste your own Cesium ion token here. Never commit a real token to a
// public repo long-term without understanding that browser tokens are
// visible to anyone who views page source — use a token scoped to only
// the assets this app needs (world terrain + Bing/OSM imagery).
const CESIUM_ION_TOKEN = "PASTE_YOUR_CESIUM_TOKEN_HERE";

const START_POSITION = {
  longitude: 50.5876,
  latitude: 26.2235,
  height: 150 // meters above ground, starting altitude
};

const MIN_ALTITUDE = 15;      // meters — vehicle cannot descend below this
const MAX_ALTITUDE = 3000;    // meters — soft ceiling
const BASE_MOVE_SPEED = 25;   // meters/second at speed slider = 5
const BASE_TURN_RATE = 60;    // degrees/second at sensitivity = 5
const BOOST_MULTIPLIER = 2.2;
const DISCOVERY_RADIUS = 120; // meters — distance to trigger discovery

// --- Drone feel & animation tuning (Stage 1) ---
const ACCEL_RATE = 1.8;        // throttle units/sec toward target (higher = snappier)
const DECEL_RATE = 2.4;        // throttle units/sec back toward 0 (slightly faster than accel)
const MAX_BANK_DEGREES = 28;   // max roll angle while turning
const BANK_SMOOTH_RATE = 4.5;  // how quickly bank eases toward target
const CAMERA_SMOOTH_RATE = 4.0; // how quickly camera heading catches up to the drone
const HOVER_AMPLITUDE = 0.6;   // meters of idle bob
const HOVER_SPEED = 1.6;       // idle bob cycles per ~second

const LOCATIONS = [
  {
    id: "bab-al-bahrain",
    name: "Bab Al Bahrain",
    longitude: 50.5758,
    latitude: 26.2320,
    height: 5
  },
  {
    id: "bahrain-bay",
    name: "Bahrain Bay",
    longitude: 50.5731,
    latitude: 26.2415,
    height: 5
  },
  {
    id: "bahrain-national-museum",
    name: "Bahrain National Museum",
    longitude: 50.5893,
    latitude: 26.2472,
    height: 5
  }
];

const SAVE_KEY = "earthverse_bahrain_save_v1";

/* ============================================================
   2. STATE
   ============================================================ */

let viewer = null;
let vehicleEntity = null;

const vehicleState = {
  longitude: START_POSITION.longitude,
  latitude: START_POSITION.latitude,
  height: START_POSITION.height,
  heading: 0,      // radians
  speed: 0,        // current km/h for display
  isBoosting: false,
  throttle: 0,     // -1..1, eased toward input target — drives smooth accel/decel
  bankRadians: 0,  // current roll angle, eased toward a turn-based target
  hoverOffset: 0   // small visual-only vertical bob while idle
};

const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  ascend: false,
  descend: false,
  boost: false
};

const gameState = {
  paused: false,
  started: false,
  discovered: {},        // { locationId: true }
  discoveredCount: 0,
  isNight: false,
  settings: {
    sound: true,
    interface: true,
    sensitivity: 5,
    moveSpeed: 5
  }
};

let lastFrameTime = null;
let animationFrameId = null;

/* ============================================================
   3. INIT / BOOTSTRAPPING
   ============================================================ */

window.addEventListener("load", () => {
  try {
    loadSavedData();
    initCesium();
  } catch (err) {
    console.error("EarthVerse initialization error:", err);
    showLoadingStatus("An unexpected error occurred. Check the console for details.");
  }
});

function initCesium() {
  if (!CESIUM_ION_TOKEN || CESIUM_ION_TOKEN === "PASTE_YOUR_CESIUM_TOKEN_HERE") {
    showTokenError();
    return;
  }

  try {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

    viewer = new Cesium.Viewer("cesiumContainer", {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true
    });

    // Keep Cesium + OSM attribution visible (required, do not remove)
    viewer.cesiumWidget.creditContainer.style.display = "block";

    // Disable default mouse/touch camera controls — they conflict with our
    // custom third-person follow camera (updateCamera), which fully replaces
    // them every frame via camera.lookAt().
    viewer.scene.screenSpaceCameraController.enableInputs = false;

    setupTerrainAndBuildings();
    createVehicle();
    createLocationBeacons();
    flyToStart();
    setupKeyboardControls();
    setupMobileControls();
    setupUIHandlers();
    detectMobileAndToggleControls();

    // Restore discovered locations visually
    applySavedDiscoveries();
    updateDiscoveryCounterUI();

    showStartButton();
  } catch (err) {
    console.error("Cesium initialization failed:", err);
    showLoadingStatus("Failed to initialize the 3D engine. See console for details.");
  }
}

async function setupTerrainAndBuildings() {
  try {
    showLoadingStatus("Loading world terrain…");
    const terrainProvider = await Cesium.createWorldTerrainAsync({
      requestWaterMask: true,
      requestVertexNormals: true
    });
    viewer.terrainProvider = terrainProvider;

    showLoadingStatus("Loading buildings…");
    const buildingsTileset = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(buildingsTileset);

    showLoadingStatus("World ready.");
  } catch (err) {
    console.error("Terrain/buildings loading error:", err);
    showLoadingStatus("Terrain or buildings failed to load. Exploring may be limited.");
  }
}

function flyToStart() {
  try {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        START_POSITION.longitude,
        START_POSITION.latitude,
        800
      ),
      duration: 3
    });
  } catch (err) {
    console.error("flyTo error:", err);
  }
}

/* ============================================================
   5. VEHICLE CREATION
   ============================================================ */

// Scale factor for the whole flying figure (meters). Bumped up significantly —
// at typical follow-camera distance a scale of 1.0 was nearly invisible.
const VEHICLE_SCALE = 6.0;

// Computes a world-space position offset from the vehicle's current
// location, expressed in the vehicle's own local heading frame.
// dx = right/left, dy = forward/backward, dz = up/down (matches the
// Y-forward convention used in updateVehiclePhysics).
function localOffsetPosition(dx, dy, dz) {
  return new Cesium.CallbackProperty(() => {
    const origin = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height
    );
    const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
      origin,
      new Cesium.HeadingPitchRoll(vehicleState.heading, 0, 0)
    );
    const local = new Cesium.Cartesian3(dx * VEHICLE_SCALE, dy * VEHICLE_SCALE, dz * VEHICLE_SCALE);
    return Cesium.Matrix4.multiplyByPoint(transform, local, new Cesium.Cartesian3());
  }, false);
}

function vehicleOrientationProperty() {
  return new Cesium.CallbackProperty(() => {
    return Cesium.Transforms.headingPitchRollQuaternion(
      Cesium.Cartesian3.fromDegrees(
        vehicleState.longitude,
        vehicleState.latitude,
        vehicleState.height + vehicleState.hoverOffset
      ),
      new Cesium.HeadingPitchRoll(vehicleState.heading, 0, vehicleState.bankRadians)
    );
  }, false);
}

// Same as localOffsetPosition, but also applies the current hover bob and
// bank roll so every drone part moves and tilts together as one rigid body.
function droneOffsetPosition(dx, dy, dz) {
  return new Cesium.CallbackProperty(() => {
    const origin = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height + vehicleState.hoverOffset
    );
    const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
      origin,
      new Cesium.HeadingPitchRoll(vehicleState.heading, 0, vehicleState.bankRadians)
    );
    const local = new Cesium.Cartesian3(dx * VEHICLE_SCALE, dy * VEHICLE_SCALE, dz * VEHICLE_SCALE);
    return Cesium.Matrix4.multiplyByPoint(transform, local, new Cesium.Cartesian3());
  }, false);
}

function createVehicle() {
  try {
    const orientation = vehicleOrientationProperty();
    const hullBlue = Cesium.Color.fromCssColorString("#1c6fe0");
    const hullBlueDark = Cesium.Color.fromCssColorString("#0c2d5c");
    const gold = Cesium.Color.fromCssColorString("#f2b84b");
    const goldBright = Cesium.Color.fromCssColorString("#ffd77a");

    // Main hull — elongated core body
    viewer.entities.add({
      position: droneOffsetPosition(0, 0, 0),
      orientation: orientation,
      ellipsoid: {
        radii: new Cesium.Cartesian3(1.1, 2.0, 0.75),
        material: hullBlue.withAlpha(0.96),
        outline: true,
        outlineColor: goldBright.withAlpha(0.8)
      }
    });

    // Golden trim ring near the nose (cockpit accent)
    viewer.entities.add({
      position: droneOffsetPosition(0, 1.0, 0),
      orientation: orientation,
      cylinder: {
        length: 0.25,
        topRadius: 1.05,
        bottomRadius: 1.05,
        material: gold.withAlpha(0.9)
      }
    });

    // Two side wings, swept back slightly
    [-1, 1].forEach((side) => {
      viewer.entities.add({
        position: droneOffsetPosition(side * 1.9, -0.2, 0),
        orientation: orientation,
        box: {
          dimensions: new Cesium.Cartesian3(2.4, 0.9, 0.12),
          material: hullBlueDark.withAlpha(0.95),
          outline: true,
          outlineColor: goldBright.withAlpha(0.7)
        }
      });

      // Golden wingtip accent
      viewer.entities.add({
        position: droneOffsetPosition(side * 3.0, -0.5, 0),
        orientation: orientation,
        box: {
          dimensions: new Cesium.Cartesian3(0.3, 0.6, 0.14),
          material: gold
        }
      });
    });

    // Animated engine glow — two rear thrusters that pulse, brighter under boost
    const engineStartTime = performance.now();
    [-0.6, 0.6].forEach((side) => {
      viewer.entities.add({
        position: droneOffsetPosition(side, -2.1, 0),
        point: {
          pixelSize: new Cesium.CallbackProperty(() => {
            const t = (performance.now() - engineStartTime) / 260;
            const pulse = 10 + Math.sin(t) * 3;
            return vehicleState.isBoosting ? pulse * 1.6 : pulse;
          }, false),
          color: new Cesium.CallbackProperty(() => {
            return vehicleState.isBoosting
              ? Cesium.Color.fromCssColorString("#ffefc2").withAlpha(0.95)
              : goldBright.withAlpha(0.85);
          }, false),
          outlineColor: Cesium.Color.fromCssColorString("#ff8c00").withAlpha(0.5),
          outlineWidth: 3
        }
      });
    });

    // Soft ambient glow around the whole hull
    vehicleEntity = viewer.entities.add({
      position: droneOffsetPosition(0, 0, 0),
      point: {
        pixelSize: 50,
        color: hullBlue.withAlpha(0.15)
      }
    });

    // Ground shadow — clamped to terrain, shrinks/fades with altitude
    viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        return Cesium.Cartesian3.fromDegrees(vehicleState.longitude, vehicleState.latitude);
      }, false),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          const altitudeFactor = Cesium.Math.clamp(vehicleState.height / 200, 0.3, 1.4);
          return 2.2 / altitudeFactor;
        }, false),
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          const altitudeFactor = Cesium.Math.clamp(vehicleState.height / 200, 0.3, 1.4);
          return 3.6 / altitudeFactor;
        }, false),
        material: Cesium.Color.BLACK.withAlpha(0.35),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });
  } catch (err) {
    console.error("createVehicle error:", err);
  }
}

/* ============================================================
   BEACON MARKERS — glowing pillars of light at each location,
   visible from a distance so players know where to explore.
   Turn green + stop pulsing once discovered.
   ============================================================ */

const beaconEntities = {};

function createLocationBeacons() {
  LOCATIONS.forEach((loc) => {
    const basePosition = Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, loc.height);
    const startTime = performance.now();

    const isDiscovered = () => !!gameState.discovered[loc.id];

    // Pulsing vertical beam
    const beam = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, loc.height + 60),
      cylinder: {
        length: 120,
        topRadius: new Cesium.CallbackProperty(() => {
          const t = (performance.now() - startTime) / 700;
          return isDiscovered() ? 3 : 3 + Math.sin(t) * 1.5;
        }, false),
        bottomRadius: 0.5,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            return isDiscovered()
              ? Cesium.Color.LIME.withAlpha(0.35)
              : Cesium.Color.GOLD.withAlpha(0.45);
          }, false)
        ),
        outline: false
      }
    });

    // Glowing marker sphere near ground level + floating label
    const marker = viewer.entities.add({
      position: basePosition,
      point: {
        pixelSize: new Cesium.CallbackProperty(() => {
          const t = (performance.now() - startTime) / 350;
          return isDiscovered() ? 16 : 14 + Math.sin(t) * 4;
        }, false),
        color: new Cesium.CallbackProperty(() => {
          return isDiscovered() ? Cesium.Color.LIME : Cesium.Color.GOLD;
        }, false),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      label: {
        text: loc.name,
        font: "bold 16px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    beaconEntities[loc.id] = { beam, marker };
  });
}

/* ============================================================
   6. DESKTOP KEYBOARD CONTROLS
   ============================================================ */

function setupKeyboardControls() {
  window.addEventListener("keydown", (e) => {
    if (gameState.paused || !gameState.started) return;
    setInputFromKey(e.code, true);
    // Prevent page scroll from WASD/space/arrow keys
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    setInputFromKey(e.code, false);
  });
}

function setInputFromKey(code, isDown) {
  switch (code) {
    case "KeyW": inputState.forward = isDown; break;
    case "KeyS": inputState.backward = isDown; break;
    case "KeyA": inputState.left = isDown; break;
    case "KeyD": inputState.right = isDown; break;
    case "KeyQ": inputState.descend = isDown; break;
    case "KeyE": inputState.ascend = isDown; break;
    case "ShiftLeft":
    case "ShiftRight":
      inputState.boost = isDown;
      break;
  }
}

/* ============================================================
   7. MOBILE TOUCH CONTROLS
   ============================================================ */

function setupMobileControls() {
  bindHoldButton("btnForward", "forward");
  bindHoldButton("btnBackward", "backward");
  bindHoldButton("btnLeft", "left");
  bindHoldButton("btnRight", "right");
  bindHoldButton("btnAscend", "ascend");
  bindHoldButton("btnDescend", "descend");
  bindHoldButton("btnBoost", "boost");
}

function bindHoldButton(elementId, inputKey) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const start = (e) => { e.preventDefault(); inputState[inputKey] = true; };
  const end = (e) => { e.preventDefault(); inputState[inputKey] = false; };

  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  el.addEventListener("touchcancel", end, { passive: false });
  // Also support mouse for testing on desktop
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", end);
  el.addEventListener("mouseleave", end);
}

function detectMobileAndToggleControls() {
  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  const mobileControls = document.getElementById("mobileControls");
  if (mobileControls) {
    mobileControls.classList.toggle("hidden", !isTouch);
  }
}

/* ============================================================
   VEHICLE PHYSICS UPDATE (called every frame)
   ============================================================ */

function updateVehiclePhysics(deltaSeconds) {
  const sensitivityFactor = gameState.settings.sensitivity / 5; // 5 = neutral
  const speedFactor = gameState.settings.moveSpeed / 5;

  const turnRate = Cesium.Math.toRadians(BASE_TURN_RATE * sensitivityFactor);
  let moveSpeed = BASE_MOVE_SPEED * speedFactor;

  if (inputState.boost) {
    moveSpeed *= BOOST_MULTIPLIER;
  }

  // --- Smooth acceleration / deceleration ---
  // Instead of snapping straight to full speed, ease the throttle toward
  // the input target each frame. Accelerates faster than it decelerates
  // feels punchy without feeling twitchy.
  let throttleTarget = 0;
  if (inputState.forward) throttleTarget += 1;
  if (inputState.backward) throttleTarget -= 1;

  const throttleRate = Math.abs(throttleTarget) > Math.abs(vehicleState.throttle) ? ACCEL_RATE : DECEL_RATE;
  const throttleDiff = throttleTarget - vehicleState.throttle;
  const throttleStep = Cesium.Math.sign(throttleDiff) * Math.min(Math.abs(throttleDiff), throttleRate * deltaSeconds);
  vehicleState.throttle += throttleStep;

  // Turning
  if (inputState.left) vehicleState.heading -= turnRate * deltaSeconds;
  if (inputState.right) vehicleState.heading += turnRate * deltaSeconds;

  // --- Smooth banking ---
  // Roll into turns like a real aircraft/drone instead of staying flat.
  let bankTarget = 0;
  if (inputState.left) bankTarget = Cesium.Math.toRadians(-MAX_BANK_DEGREES);
  if (inputState.right) bankTarget = Cesium.Math.toRadians(MAX_BANK_DEGREES);

  const bankDiff = bankTarget - vehicleState.bankRadians;
  vehicleState.bankRadians += bankDiff * Math.min(1, BANK_SMOOTH_RATE * deltaSeconds);

  // Forward/backward movement along heading, driven by eased throttle
  const moveDistance = moveSpeed * vehicleState.throttle * deltaSeconds;

  if (Math.abs(moveDistance) > 0.0001) {
    const startCartesian = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height
    );

    const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
      startCartesian,
      new Cesium.HeadingPitchRoll(vehicleState.heading, 0, 0)
    );

    const localOffset = new Cesium.Cartesian3(0, moveDistance, 0); // Y = forward in ENU
    const worldOffset = Cesium.Matrix4.multiplyByPointAsVector(
      transform,
      localOffset,
      new Cesium.Cartesian3()
    );

    const newPosition = Cesium.Cartesian3.add(startCartesian, worldOffset, new Cesium.Cartesian3());
    const carto = Cesium.Cartographic.fromCartesian(newPosition);

    vehicleState.longitude = Cesium.Math.toDegrees(carto.longitude);
    vehicleState.latitude = Cesium.Math.toDegrees(carto.latitude);
  }

  // Vertical movement
  let verticalDelta = 0;
  if (inputState.ascend) verticalDelta += moveSpeed * deltaSeconds;
  if (inputState.descend) verticalDelta -= moveSpeed * deltaSeconds;

  vehicleState.height += verticalDelta;
  vehicleState.height = Cesium.Math.clamp(vehicleState.height, MIN_ALTITUDE, MAX_ALTITUDE);

  // --- Idle hover bob ---
  // When nearly stationary and not actively climbing/descending, add a
  // small sine-wave bob for a "hovering drone" feel. Purely visual — it
  // never affects vehicleState.height used for altitude/discovery checks.
  const isNearlyIdle = Math.abs(vehicleState.throttle) < 0.05 && verticalDelta === 0;
  if (isNearlyIdle) {
    const t = (performance.now() / 1000) * HOVER_SPEED;
    vehicleState.hoverOffset = Math.sin(t) * HOVER_AMPLITUDE;
  } else {
    vehicleState.hoverOffset += (0 - vehicleState.hoverOffset) * Math.min(1, 6 * deltaSeconds);
  }

  // Display speed (km/h) — based on eased throttle, not raw input
  const instSpeed = Math.abs(moveDistance) / Math.max(deltaSeconds, 0.0001); // m/s
  vehicleState.speed = instSpeed * 3.6; // km/h
  vehicleState.isBoosting = inputState.boost && Math.abs(vehicleState.throttle) > 0.1;
}

/* ============================================================
   SPEED TRAIL — glowing dots spawned behind the player while
   boosting, fading out and cleaning themselves up automatically.
   ============================================================ */

let lastTrailSpawn = 0;

function spawnTrailParticle() {
  const now = performance.now();
  if (now - lastTrailSpawn < 60) return; // throttle spawn rate
  lastTrailSpawn = now;

  const position = Cesium.Cartesian3.fromDegrees(
    vehicleState.longitude,
    vehicleState.latitude,
    vehicleState.height
  );
  const spawnTime = now;
  const lifetimeMs = 600;

  const particle = viewer.entities.add({
    position: position,
    point: {
      pixelSize: 10,
      color: new Cesium.CallbackProperty(() => {
        const age = performance.now() - spawnTime;
        const alpha = Math.max(0, 1 - age / lifetimeMs);
        return Cesium.Color.ORANGE.withAlpha(alpha * 0.8);
      }, false)
    }
  });

  setTimeout(() => {
    viewer.entities.remove(particle);
  }, lifetimeMs);
}

/* ============================================================
   8. THIRD-PERSON CAMERA
   ============================================================ */

let cameraSmoothedHeading = vehicleState.heading;

function updateCamera(deltaSeconds) {
  if (!viewer) return;
  try {
    const target = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height + vehicleState.hoverOffset
    );

    // Smoothly ease the camera's tracked heading toward the drone's actual
    // heading rather than snapping instantly — gives a cinematic "catch up"
    // feel through turns instead of a rigid, robotic follow.
    const dt = deltaSeconds || 0.016;
    let headingDiff = vehicleState.heading - cameraSmoothedHeading;
    // Normalize to the shortest rotation direction (-PI..PI)
    headingDiff = Cesium.Math.negativePiToPi(headingDiff);
    cameraSmoothedHeading += headingDiff * Math.min(1, CAMERA_SMOOTH_RATE * dt);

    // Offset behind and above the vehicle based on heading
    const followDistance = 24;
    const followHeight = 10;

    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(
        cameraSmoothedHeading + Math.PI, // camera behind vehicle
        Cesium.Math.toRadians(-18),
        followDistance + followHeight
      )
    );
    // Release lookAt transform lock so camera controls don't get stuck
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch (err) {
    // Non-fatal; skip this frame's camera update
  }
}

/* ============================================================
   9. MISSIONS / DISCOVERY DETECTION
   ============================================================ */

function checkDiscoveries() {
  LOCATIONS.forEach((loc) => {
    if (gameState.discovered[loc.id]) return;

    const distance = haversineDistanceMeters(
      vehicleState.latitude, vehicleState.longitude,
      loc.latitude, loc.longitude
    );

    if (distance <= DISCOVERY_RADIUS) {
      markDiscovered(loc);
    }
  });
}

function markDiscovered(loc) {
  gameState.discovered[loc.id] = true;
  gameState.discoveredCount = Object.keys(gameState.discovered).length;
  updateDiscoveryCounterUI();
  showDiscoveryToast(loc.name);
  saveGameData();

  if (gameState.discoveredCount >= LOCATIONS.length) {
    setTimeout(showCompletionScreen, 1500);
  }
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Cesium.Math.toRadians;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function applySavedDiscoveries() {
  gameState.discoveredCount = Object.keys(gameState.discovered).length;
}

/* ============================================================
   10. UI HANDLING
   ============================================================ */

function showLoadingStatus(message) {
  const el = document.getElementById("loadingStatus");
  if (el) el.textContent = message;
}

function showTokenError() {
  const errorEl = document.getElementById("tokenError");
  const statusEl = document.getElementById("loadingStatus");
  if (errorEl) errorEl.classList.remove("hidden");
  if (statusEl) statusEl.classList.add("hidden");
}

function showStartButton() {
  const btn = document.getElementById("startButton");
  const status = document.getElementById("loadingStatus");
  if (status) status.classList.add("hidden");
  if (btn) btn.classList.remove("hidden");
}

function setupUIHandlers() {
  const startButton = document.getElementById("startButton");
  if (startButton) {
    startButton.addEventListener("click", () => {
      document.getElementById("loadingScreen").classList.add("hidden");
      document.getElementById("hud").classList.remove("hidden");
      gameState.started = true;
      applyInterfaceVisibility();
      startMainLoop();
    });
  }

  const resetButton = document.getElementById("resetButton");
  if (resetButton) resetButton.addEventListener("click", resetPosition);

  const pauseButton = document.getElementById("pauseButton");
  if (pauseButton) pauseButton.addEventListener("click", pauseGame);

  const resumeButton = document.getElementById("resumeButton");
  if (resumeButton) resumeButton.addEventListener("click", resumeGame);

  const dayNightButton = document.getElementById("dayNightButton");
  if (dayNightButton) dayNightButton.addEventListener("click", toggleDayNight);

  const settingsButton = document.getElementById("settingsButton");
  if (settingsButton) settingsButton.addEventListener("click", openSettings);

  const closeSettingsButton = document.getElementById("closeSettingsButton");
  if (closeSettingsButton) closeSettingsButton.addEventListener("click", closeSettings);

  const closeCompletionButton = document.getElementById("closeCompletionButton");
  if (closeCompletionButton) {
    closeCompletionButton.addEventListener("click", () => {
      document.getElementById("completionScreen").classList.add("hidden");
    });
  }

  // Settings inputs
  const soundToggle = document.getElementById("soundToggle");
  const interfaceToggle = document.getElementById("interfaceToggle");
  const sensitivitySlider = document.getElementById("sensitivitySlider");
  const speedSlider = document.getElementById("speedSlider");

  if (soundToggle) {
    soundToggle.checked = gameState.settings.sound;
    soundToggle.addEventListener("change", (e) => {
      gameState.settings.sound = e.target.checked;
      saveGameData();
    });
  }

  if (interfaceToggle) {
    interfaceToggle.checked = gameState.settings.interface;
    interfaceToggle.addEventListener("change", (e) => {
      gameState.settings.interface = e.target.checked;
      applyInterfaceVisibility();
      saveGameData();
    });
  }

  if (sensitivitySlider) {
    sensitivitySlider.value = gameState.settings.sensitivity;
    sensitivitySlider.addEventListener("input", (e) => {
      gameState.settings.sensitivity = Number(e.target.value);
      saveGameData();
    });
  }

  if (speedSlider) {
    speedSlider.value = gameState.settings.moveSpeed;
    speedSlider.addEventListener("input", (e) => {
      gameState.settings.moveSpeed = Number(e.target.value);
      saveGameData();
    });
  }
}

function applyInterfaceVisibility() {
  const topBar = document.getElementById("topBar");
  const compassPanel = document.getElementById("compassPanel");
  const statsPanel = document.getElementById("statsPanel");
  const visible = gameState.settings.interface;

  [topBar, compassPanel, statsPanel].forEach((el) => {
    if (el) el.style.visibility = visible ? "visible" : "hidden";
  });
}

function resetPosition() {
  vehicleState.longitude = START_POSITION.longitude;
  vehicleState.latitude = START_POSITION.latitude;
  vehicleState.height = START_POSITION.height;
  vehicleState.heading = 0;
}

function pauseGame() {
  gameState.paused = true;
  document.getElementById("pauseOverlay").classList.remove("hidden");
}

function resumeGame() {
  gameState.paused = false;
  document.getElementById("pauseOverlay").classList.add("hidden");
  lastFrameTime = null; // avoid a large deltaTime jump after resuming
}

function openSettings() {
  document.getElementById("settingsPanel").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settingsPanel").classList.add("hidden");
}

function showCompletionScreen() {
  document.getElementById("completionScreen").classList.remove("hidden");
}

let toastTimeout = null;
function showDiscoveryToast(name) {
  const toast = document.getElementById("discoveryToast");
  const nameEl = document.getElementById("toastLocationName");
  if (!toast || !nameEl) return;

  nameEl.textContent = name;
  toast.classList.remove("hidden");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function updateDiscoveryCounterUI() {
  const el = document.getElementById("discoveryCounter");
  if (el) {
    el.textContent = `Locations Discovered: ${gameState.discoveredCount}/${LOCATIONS.length}`;
  }
}

function updateStatsUI() {
  const speedEl = document.getElementById("speedValue");
  const altEl = document.getElementById("altitudeValue");
  if (speedEl) speedEl.textContent = Math.round(vehicleState.speed);
  if (altEl) altEl.textContent = Math.round(vehicleState.height);
}

function updateCompassUI() {
  const needle = document.getElementById("compassNeedle");
  if (needle) {
    const degrees = Cesium.Math.toDegrees(vehicleState.heading);
    needle.style.transform = `rotate(${degrees}deg)`;
  }
}

/* ============================================================
   12. DAY / NIGHT TOGGLE
   ============================================================ */

function toggleDayNight() {
  gameState.isNight = !gameState.isNight;
  const btn = document.getElementById("dayNightButton");

  try {
    if (gameState.isNight) {
      viewer.scene.globe.enableLighting = true;
      // Set clock to a nighttime hour (UTC) for a simple day/night effect
      const date = Cesium.JulianDate.fromDate(new Date());
      viewer.clock.currentTime = Cesium.JulianDate.addHours(date, 12, new Cesium.JulianDate());
      if (btn) btn.textContent = "🌙 Night";
    } else {
      viewer.scene.globe.enableLighting = false;
      if (btn) btn.textContent = "☀ Day";
    }
  } catch (err) {
    console.error("toggleDayNight error:", err);
  }
}

/* ============================================================
   11. SAVE / LOAD (localStorage)
   ============================================================ */

function saveGameData() {
  try {
    const data = {
      discovered: gameState.discovered,
      settings: gameState.settings
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("saveGameData error:", err);
  }
}

function loadSavedData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (data.discovered) gameState.discovered = data.discovered;
    if (data.settings) gameState.settings = { ...gameState.settings, ...data.settings };
  } catch (err) {
    console.error("loadSavedData error:", err);
  }
}

/* ============================================================
   13. MAIN LOOP
   ============================================================ */

function startMainLoop() {
  if (animationFrameId !== null) return; // prevent duplicate loops
  lastFrameTime = null;
  animationFrameId = requestAnimationFrame(mainLoop);
}

function mainLoop(timestamp) {
  animationFrameId = requestAnimationFrame(mainLoop);

  if (!gameState.started || gameState.paused) {
    lastFrameTime = timestamp;
    return;
  }

  if (lastFrameTime === null) lastFrameTime = timestamp;
  const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.1); // clamp to avoid jumps
  lastFrameTime = timestamp;

  try {
    updateVehiclePhysics(deltaSeconds);
    updateCamera(deltaSeconds);
    checkDiscoveries();
    updateStatsUI();
    updateCompassUI();
    if (vehicleState.isBoosting) {
      spawnTrailParticle();
    }
  } catch (err) {
    console.error("mainLoop error:", err);
  }
}
