# Ganga — Documentation technique

Prototype de jeu d'exploration "oiseau qui vole" inspiré de *Feather* / *Journey*, bâti avec **Babylon.js 9** + **React 19** (via `react-babylonjs`) et la physique **Rapier 3D**.

---

## Goal — vision cible

L'objectif à terme est une **map open-world** mêlant **scènes Blender authoriales** (temples, ruines, oasis…) reliées entre elles par du **désert généré procéduralement**, avec une **ambiance à la Journey** (palette chaude, vent, lumière dorée, solitude contemplative).

### Briques à mettre en place

- **Fichier de map** (JSON) décrivant les îlots Blender et le terrain entre eux :
  ```json
  {
    "scenes": [
      { "id": "temple", "url": "assets/temple.glb", "position": [0,0,0], "radius": 80,
        "lod": ["temple_low.glb", "temple_mid.glb", "temple.glb"] },
      { "id": "ruines", "url": "assets/ruines.glb", "position": [800,0,400], "radius": 120,
        "lod": ["ruines_low.glb", "ruines_mid.glb", "ruines.glb"] }
    ],
    "desert": { "size": 4096, "chunkSize": 128, "seed": 42 }
  }
  ```
- **Streaming par chunks** : désert découpé en grille (ex. 128×128), chargement/déchargement selon la position caméra via `AssetContainer` + `Mesh.setEnabled`.
- **LOD pour les scènes Blender** : 3 niveaux exportés depuis Blender (decimate), `mesh.addLODLevel(distance, meshLow)`. Au-delà de ~1500m, basculer sur un **billboard impostor** pour les silhouettes très lointaines.
- **Désert procédural** :
  - heightmap par chunk via bruit de Perlin/Simplex multi-octaves (`simplex-noise`)
  - dunes = combinaison basse fréquence (grandes dunes) + haute fréquence (rides) + Worley pour casser l'uniformité
  - vertex displacement dans le shader pour les rides animées proches caméra
- **Shaders stylisés** (NodeMaterial ou ShaderMaterial) :
  - **Sable** : couleur chaude + rim light doré, spéculaire anisotrope (highlights demi-lune typiques du sable), sparkles via `step(0.98, noise(uv*200 + time))`, triplanar mapping pour éviter le stretching sur pentes
  - **Vent** : GPU particles avec flowMap, bandes de poussière au sol (plane semi-transparent + UV scrolling), tissus/drapeaux animés par vertex shader (sin-wave × vertex color mask)
- **Fog + lumière volumétrique** :
  - `scene.fogMode = FOGMODE_EXP2`, couleur chaude assortie au ciel
  - `VolumetricLightScatteringPostProcess` pour les god rays Journey
  - skybox procédural (gradient shader) plutôt que cubemap, pour permettre un cycle jour/nuit dynamique
- **Caméra cinématique** :
  - inertie (`camera.inertia = 0.9`) + lissage exponentiel (déjà en place)
  - séquences scriptées via `AnimationGroup` + courbes bezier
  - letterbox CSS dynamique en zones cinématiques
  - léger sway + breathing (sin sur position.y) en exploration
- **Stack additionnelle** envisagée : Babylon 7+ en **WebGPU** si possible, `simplex-noise`, inspecteur Babylon pour tuner.

L'**état actuel** (terrain analytique 200m, oiseau + physique Rapier + caméra orbitale) constitue la base technique sur laquelle ces briques viendront s'ajouter incrémentalement — cf. section *Limitations & pistes* en bas du document.

---

## Stack

| Couche | Choix |
|---|---|
| Rendu 3D | `@babylonjs/core` 9.7 (+ `loaders`, `gui`) |
| Intégration React | `react-babylonjs` 3.2 (réconcilier Babylon dans l'arbre React) |
| Physique | `@dimforge/rapier3d-compat` 0.19 (WASM, dynamique compile-time `RAPIER.init()`) |
| Build | Vite 8 + TS ~6.0 |
| Déploiement | Image Docker multi-stage (Node 20 → Nginx) |

Alias TS/Vite : `@/*` → `src/*`.

---

## Arborescence

```
src/
  App.tsx               # racine — monte Engine/Scene + composants logiques
  main.tsx              # bootstrap React
  index.css
  components/
    LightSetup.tsx      # HemisphericLight + DirectionalLight + ShadowGenerator
    Terrain.tsx         # mesh procédural depuis heightmap analytique
    Player.tsx          # chargement du bird.glb, contrôles, vol, trails
    CameraController.tsx# ArcRotateCamera (3rd person) + UniversalCamera (free)
    PhysicsDebug.tsx    # toggle Ctrl+D pour visualiser les colliders Rapier
  game/
    physics.ts          # wrapper PhysicsWorld autour de Rapier
    terrain.ts          # fonction de hauteur analytique + heightmap export
    gameStore.ts        # store mutable global (singleton, hors React)
  hooks/
    useKeyboard.ts      # set des touches enfoncées (ref, pas d'état React)
public/
  gltf/bird.glb         # mesh joueur
  gltf/skybox_savanna.glb
  gltf/blend/           # sources Blender
```

---

## Architecture

### React + Babylon

L'application monte un `<Engine>` et une `<Scene>` (`react-babylonjs`). Tous les autres composants retournent `null` : ils n'émettent pas de JSX Babylon, ils utilisent **`useScene()`** pour récupérer la scène impérative et créent leurs nœuds dans un `useEffect`, avec cleanup au démontage. C'est volontaire : on évite la couche réconciliateur pour les objets coûteux (mesh chargés, lights, cameras) et on garde un contrôle bas niveau sur le cycle de vie.

Le tick de jeu passe par `useBeforeRender(() => …)` (équivalent `scene.onBeforeRenderObservable`). Le `dt` est calculé manuellement avec `performance.now()` et **clampé à 50 ms** (`Math.min(.., 0.05)`) pour éviter les pas physiques explosifs en cas de tab inactif.

### `gameStore` — état impératif partagé

`src/game/gameStore.ts` est un simple objet mutable importé par tous les composants. Pas de React state, pas de context : la boucle de rendu lit/écrit directement. C'est le **carrefour entre Player, CameraController et Physics** :

- Refs Babylon : `mesh`, `arcCam`, `shadowGenerator`, `trails`
- Refs Rapier : `physics`
- État de jeu : `camMode` (`third`/`first`), `birdMode` (`grounded`/`flying`)
- **Source de vérité caméra** : `camAlpha`, `camBeta` — pilotés par la souris, lus par le contrôleur caméra ET par le Player pour dériver l'orientation de l'oiseau

Le découplage important : `CameraController` écrit `camAlpha/camBeta`, le `Player` les lit pour calculer `yaw`/`pitch`. La caméra est donc **la source de vérité de la direction**, l'oiseau suit. C'est ce qui donne la sensation Feather (l'oiseau "tombe" dans la direction du regard).

### Boucle d'une frame

1. **Input** : `useKeyboard` met à jour un `Set<string>` via listeners globaux. La souris (pointer-lock) écrit dans `gameStore.camAlpha/camBeta`.
2. **`Player.useBeforeRender`** :
   - dérive `yaw`/`pitch` depuis la caméra
   - calcule la `linvel` cible et la pousse dans `body.setLinvel(...)`
   - `physics.step(dt)` (Rapier avance d'un pas)
   - lit `body.translation()` pour positionner le `TransformNode` du carrier
   - applique le bank (roulis en virage) + le bob (sinusoïde verticale) sur le quaternion d'orientation, slerp progressif (`ORIENT_SMOOTHING`)
   - allume/éteint les `TrailMesh` selon `birdMode`
3. **`CameraController.useBeforeRender`** :
   - applique `camAlpha/camBeta` sur l'`ArcRotateCamera`
   - lerpe la cible caméra vers la position physique du joueur, **avec un lag différent selon le mode** (vol : `FOLLOW_LAG_FLYING=2.8` pour que l'oiseau "lead", sol : `FOLLOW_LAG_GROUNDED=20` pour un suivi serré).

Note : la cible caméra suit le **body Rapier**, pas le mesh visuel — ce dernier inclut le `bob` cosmétique qui ferait osciller la caméra si on le suivait.

---

## Physique (`game/physics.ts`)

- `RAPIER.init()` mémoïsé par `initPromise` — appelé une seule fois.
- **Sol** : `ColliderDesc.heightfield(N, N, heights, { x: S, y: 1, z: S })` directement à partir du `Float32Array` exporté par `terrain.ts`. La géométrie Babylon et le collider Rapier consomment **la même heightmap** → cohérence garantie.
- **Joueur** : `RigidBody.dynamic().lockRotations()` + `ColliderDesc.capsule(CAPSULE_HALF_HEIGHT=0.4, CAPSULE_RADIUS=0.3)`. Rotations lockées, c'est la couche visuelle qui s'oriente.
- **Décollage** : `body.setGravityScale(0)` quand on passe en vol → la vélocité Y est imposée par le pitch, plus de chute libre.
- **Atterrissage** : `isNearGround()` cast un rayon vers le bas sur `CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + margin`. Si touché, repasse en `grounded` et rétablit `gravityScale=1`.
- `world.timestep = dt` à chaque pas (variable, pas fixe) — pragmatique mais à surveiller si on ajoute des contacts complexes.

---

## Terrain (`game/terrain.ts` + `components/Terrain.tsx`)

- Hauteur **analytique** : somme de 4 sinusoïdes (`heightAt(x, z)`) — pas de Perlin, pas de seed. Reproductible, gratuit, suffisant pour le prototype.
- `TERRAIN_SIZE = 200`, `TERRAIN_SUBDIVISIONS = 64` → grille 65×65 vertex.
- Le mesh est construit manuellement via `VertexData` (positions, indices, normales calculées par `ComputeNormals`, UVs répétés ×12). Pas de `MeshBuilder.CreateGroundFromHeightMap` car on partage le `Float32Array` avec Rapier.
- Matériau : `StandardMaterial` couleur unie (vert savane). `receiveShadows = true`.

---

## Player (`components/Player.tsx`)

### Chargement du modèle
`SceneLoader.ImportMeshAsync('', '/gltf/', 'bird.glb', scene)`. Le `__root__` GLB a des **transforms baked** (flip de handedness Blender→glTF) qui se battent avec nos rotations → on wrappe dans un `TransformNode` propre (`birdCarrier`) qu'on possède entièrement. On manipule le carrier, l'import reste en local identité.

### Contrôles
- **Sol** : ZQSD/WASD → `setLinvel(WALK_SPEED=4)` projeté sur les axes de la caméra (flattenés en XZ).
- **Décollage** : `Space` → `birdMode='flying'`, impulsion `y=6`, gravité OFF.
- **Vol** : direction dictée par yaw/pitch caméra, vitesse `FLIGHT_SPEED=14`. Pendant `TAKEOFF_COOLDOWN=0.5s` on n'écrase pas la vitesse de décollage.

### Orientation "Feather"
- **Bank** : `targetBank = -yawRate * BANK_PER_YAW_RATE` (clampé à `MAX_BANK=π/3`). L'oiseau se penche dans le virage.
- **Bob** : `sin(t * 2π * BOB_FREQUENCY=0.6Hz) * BOB_AMPLITUDE=0.18m` ajouté sur Y visuel seulement (pas sur le body).
- Composition via `Quaternion.RotationYawPitchRoll(yaw, -pitch, bank)`, **slerp** vers la cible avec un lissage exponentiel `1 - exp(-ORIENT_SMOOTHING * dt)` (frame-rate independent).

### Trails
Deux `TrailMesh` accrochés à des `TransformNode` placés aux **bouts d'ailes**. Les offsets sont calculés depuis le `getHierarchyBoundingVectors()` du mesh importé — robuste au scale du GLB. Auto-orientation : on détecte si l'envergure est sur X ou Z en comparant `sizeX` vs `sizeZ`. Activés/désactivés selon `birdMode`.

---

## Caméra (`components/CameraController.tsx`)

Deux caméras coexistent :

- **`ArcRotateCamera`** ("third") : orbite autour du joueur, pilotée souris en **pointer lock**. `MOUSE_SENSITIVITY=0.002`, `beta` clampé `[0.05, π-0.05]` (anti-gimbal-lock). On bypass le control natif de Babylon : on écrit directement `cam.alpha/beta` depuis `gameStore`.
- **`UniversalCamera`** ("first" / free-cam debug) : WASD natif + souris. Toggle **Ctrl+C**.

Le suivi de cible utilise le **lissage exponentiel** classique : `t = 1 - exp(-k * dt)` avec `k` différent selon le mode (cf. plus haut). C'est ce qui donne la sensation de poids en vol.

---

## Debug

- **Ctrl+D** : toggle `PhysicsDebug`, qui lit `world.debugRender()` et construit un `LineSystem` mis à jour chaque frame avec `instance:` (réutilise les buffers, pas de réallocation).
- L'inspecteur Babylon n'est pas câblé mais peut être ouvert manuellement via la console : `scene.debugLayer.show()`.

---

## Build & déploiement

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve dist/
npm run lint
npm run format
```

Image Docker : build sur `node:20-alpine`, statique servi par `nginx:alpine` (cf. `nginx.conf`). `docker-compose.yml` expose le port 3000.

---

## Limitations actuelles & pistes

- **Terrain** : analytique, monolithique (200m × 200m), pas de streaming. Pour passer à un open-world avec scènes Blender intercalées et désert procédural infini, il faut introduire un système de chunks + LOD + JSON de map (cf. discussion préalable).
- **Heightmap partagée** : Rapier consomme le `Float32Array` au boot ; si on régénère le terrain, il faut recréer le collider.
- **Pas de gestion de FPS variable côté Rapier** : `world.timestep = dt` à chaque pas — pour des simulations plus lourdes, passer en pas fixe avec accumulator.
- **Pas de skybox active** : `skybox_savanna.glb` est dans `public/gltf/` mais pas chargé. La couleur de fond est un `Color4` plat sur `<Scene>`.
- **Pas de son** : `public/sound/sound.mp3` est vide.
- **`gameStore`** : pratique pour un prototype, dangereux à l'échelle (mutations partout, pas de typage des transitions d'état). À envelopper dans un state-machine si la complexité monte.