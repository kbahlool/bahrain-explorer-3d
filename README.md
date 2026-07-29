# EarthVerse — Chapter One: Bahrain

A browser-based 3D exploration game built with [CesiumJS](https://cesium.com/platform/cesiumjs/). No installs, no build tools — just HTML, CSS, and vanilla JavaScript, deployable directly on GitHub Pages.

Explore a small area of **Manama, Bahrain** in a glowing flying vehicle, discover three real-world landmarks, and complete Chapter One.

---

## 🎮 Live Demo

Once GitHub Pages is enabled (see below), your game will be live at:

```
https://kbahlool.github.io/bahrain-explorer-3d/
```

---

## 🕹️ Controls

### Desktop
| Key | Action |
|-----|--------|
| `W` | Move forward |
| `S` | Move backward |
| `A` | Turn left |
| `D` | Turn right |
| `Q` | Descend |
| `E` | Ascend |
| `Shift` | Speed boost |

### Mobile
On-screen touch buttons appear automatically on touch devices:
- Directional pad (forward / back / left / right)
- Ascend / Descend buttons
- Boost button

---

## 📍 Discovery Locations (Chapter One)

1. **Bab Al Bahrain**
2. **Bahrain Bay**
3. **Bahrain National Museum**

Fly close to each location to trigger a discovery notification. Discover all three to unlock the completion screen. Progress is saved automatically in your browser (`localStorage`), so it persists across sessions on the same device/browser.

---

## ⚙️ Features

- Cinematic loading screen with EarthVerse branding
- Full-screen CesiumJS 3D world with real terrain and OpenStreetMap buildings
- Glowing flying explorer vehicle (no external 3D models required)
- Third-person follow camera
- Compass, speed indicator, and altitude indicator
- Reset Position and Pause buttons
- Day/Night lighting toggle
- Settings panel: sound on/off, interface on/off, camera sensitivity, movement speed
- Fully responsive desktop + mobile layout
- Local save system for discovered locations and settings

---

## 🚀 Setup & Deployment

### 1. Get a free Cesium ion token
1. Create a free account at [ion.cesium.com](https://ion.cesium.com)
2. Go to **Access Tokens** → copy your token (or create a new scoped one)
3. **Recommended:** scope the token to **Asset Access only** (terrain + imagery), not full account access

### 2. Add your token
Open `game.js` and find this line near the top:

```javascript
const CESIUM_ION_TOKEN = "PASTE_YOUR_CESIUM_TOKEN_HERE";
```

Replace the placeholder with your token, keeping the quotes.

> ⚠️ **Security note:** Any token placed in client-side JavaScript is visible to anyone who views the page source. This is normal for browser-based Cesium apps — just make sure your token's scope is limited (asset access only) so exposure has minimal impact. Never paste account passwords, payment details, or GitHub tokens into this file.

### 3. Deploy on GitHub Pages
1. Push `index.html`, `style.css`, `game.js`, and `README.md` to the root of your repository's `main` branch
2. Go to **Settings → Pages**
3. Under **Source**, select **Deploy from a branch**
4. Branch: `main`, folder: `/ (root)`
5. Save — your game will be live at `https://kbahlool.github.io/bahrain-explorer-3d/` within a minute or two

---

## 🗂️ Project Structure

```
bahrain-explorer-3d/
├── index.html      # Page structure, loading screen, HUD markup
├── style.css        # All visual styling (cinematic UI, HUD, responsive layout)
├── game.js          # Cesium setup, vehicle physics, controls, missions, save system
└── README.md        # This file
```

---

## 🛠️ Built With

- [CesiumJS](https://cesium.com/platform/cesiumjs/) (via official CDN)
- Cesium World Terrain
- OpenStreetMap Buildings (via Cesium ion)
- Vanilla HTML / CSS / JavaScript — no frameworks, no build step

---

## 📌 Known Limitations (Version 1)

- Single chapter (Bahrain) with three discovery locations
- No multiplayer, accounts, or payments
- Vehicle is built from Cesium primitives (no custom 3D model)
- Requires an internet connection (streams terrain/imagery from Cesium ion)

---

## 🗺️ Roadmap Ideas (Future Chapters)

- Additional chapters/regions with new discovery locations
- Custom 3D vehicle models
- More detailed mission objectives
- Achievements and sound design

---

## 📄 License & Attribution

This project uses Cesium World Terrain and OpenStreetMap building data via Cesium ion. Attribution is displayed in-app per Cesium's terms of service — do not remove the credit/attribution container.

Built as a learning project — Chapter One: Bahrain.
