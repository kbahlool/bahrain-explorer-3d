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
  isBoosting: false
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

    setupTerrainAndBuildings();
    createVehicle();
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

function createVehicle() {
  try {
    const position = new Cesium.CallbackProperty(() => {
      return Cesium.Cartesian3.fromDegrees(
        vehicleState.longitude,
        vehicleState.latitude,
        vehicleState.height
      );
    }, false);

    const orientation = new Cesium.CallbackProperty(() => {
      return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(
          vehicleState.longitude,
          vehicleState.latitude,
          vehicleState.height
        ),
        new Cesium.HeadingPitchRoll(vehicleState.heading, 0, 0)
      );
    }, false);

    vehicleEntity = viewer.entities.add({
      position: position,
      orientation: orientation,
      ellipsoid: {
        radii: new Cesium.Cartesian3(6, 6, 3),
        material: Cesium.Color.CYAN.withAlpha(0.85),
        outline: true,
        outlineColor: Cesium.Color.WHITE
      },
      // A glowing "core" point to sell the explorer-vehicle look
      point: {
        pixelSize: 14,
        color: Cesium.Color.CYAN.withAlpha(0.9),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.NONE
      }
    });

    // Simple glow trail using a second, larger translucent point
    viewer.entities.add({
      position: position,
      point: {
        pixelSize: 30,
        color: Cesium.Color.CYAN.withAlpha(0.25)
      }
    });
  } catch (err) {
    console.error("createVehicle error:", err);
  }
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

  // Turning
  if (inputState.left) vehicleState.heading -= turnRate * deltaSeconds;
  if (inputState.right) vehicleState.heading += turnRate * deltaSeconds;

  // Forward/backward movement along heading
  let moveDistance = 0;
  if (inputState.forward) moveDistance += moveSpeed * deltaSeconds;
  if (inputState.backward) moveDistance -= moveSpeed * deltaSeconds;

  if (moveDistance !== 0) {
    const startCartesian = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height
    );

    // Move along the local east-north plane based on heading
    const headingDeg = Cesium.Math.toDegrees(vehicleState.heading);
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

  // Display speed (km/h) — approximate from moveDistance this frame
  const instSpeed = Math.abs(moveDistance) / Math.max(deltaSeconds, 0.0001); // m/s
  vehicleState.speed = instSpeed * 3.6; // km/h
  vehicleState.isBoosting = inputState.boost && (inputState.forward || inputState.backward);
}

/* ============================================================
   8. THIRD-PERSON CAMERA
   ============================================================ */

function updateCamera() {
  if (!viewer) return;
  try {
    const target = Cesium.Cartesian3.fromDegrees(
      vehicleState.longitude,
      vehicleState.latitude,
      vehicleState.height
    );

    // Offset behind and above the vehicle based on heading
    const followDistance = 45;
    const followHeight = 20;

    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(
        vehicleState.heading + Math.PI, // camera behind vehicle
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
    updateCamera();
    checkDiscoveries();
    updateStatsUI();
    updateCompassUI();
  } catch (err) {
    console.error("mainLoop error:", err);
  }
}
