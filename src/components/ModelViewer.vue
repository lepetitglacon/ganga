<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isLocked = ref(false)
const showInstructions = ref(true)

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let rafId: number

// Bird state
let bird: THREE.Group
let leftWing: THREE.Mesh
let rightWing: THREE.Mesh
const birdSpeed = 0.15
const turnSpeed = 0.002
const maxPitch = Math.PI / 3 // 60 degrees max pitch

// Wing animation
let wingTime = 0
const wingFlapSpeed = 8
const wingFlapAmount = 0.4

// Wind trails
const trailParticles: THREE.Points[] = []
const trailPositions: THREE.Vector3[][] = []
const trailLength = 30

// Camera offset for third person view
const cameraOffset = new THREE.Vector3(0, 2, 8)
const cameraLookOffset = new THREE.Vector3(0, 0, -10)

// Mouse movement accumulator
let mouseX = 0
let mouseY = 0

// Bird rotation (euler angles)
let yaw = 0
let pitch = 0

// Sun light reference for shadow following
let sunLight: THREE.DirectionalLight

function init() {
  const canvas = canvasRef.value!

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // Scene
  scene = new THREE.Scene()

  // Sky gradient background
  const skyColor = new THREE.Color(0x87ceeb)
  const horizonColor = new THREE.Color(0xffeedd)
  scene.background = skyColor
  scene.fog = new THREE.Fog(horizonColor, 50, 500)

  // Camera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000)

  // Lighting
  setupLighting()

  // Create bird
  createBird()

  // Create ground placeholder (will be replaced with Sahara desert)
  createGround()

  // Event listeners
  window.addEventListener('resize', onResize)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  document.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('click', requestPointerLock)

  animate()
}

function setupLighting() {
  // Sun light
  sunLight = new THREE.DirectionalLight(0xfffacd, 2)
  sunLight.position.set(50, 80, 30)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.width = 2048
  sunLight.shadow.mapSize.height = 2048
  sunLight.shadow.camera.near = 1
  sunLight.shadow.camera.far = 200
  sunLight.shadow.camera.left = -30
  sunLight.shadow.camera.right = 30
  sunLight.shadow.camera.top = 30
  sunLight.shadow.camera.bottom = -30
  sunLight.shadow.bias = -0.001
  scene.add(sunLight)
  scene.add(sunLight.target)

  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x88aaff, 0.5)
  scene.add(ambientLight)

  // Hemisphere light for sky/ground color blending
  const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0xc2a366, 0.6)
  scene.add(hemiLight)
}

function updateSunLight() {
  // Make sun light follow the bird for consistent shadows
  if (bird && sunLight) {
    sunLight.position.set(
      bird.position.x + 50,
      bird.position.y + 80,
      bird.position.z + 30
    )
    sunLight.target.position.copy(bird.position)
  }
}

function createBird() {
  bird = new THREE.Group()

  // Body
  const bodyGeometry = new THREE.ConeGeometry(0.3, 1.2, 8)
  bodyGeometry.rotateX(Math.PI / 2)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.6,
    metalness: 0.1,
  })
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.castShadow = true
  body.receiveShadow = true
  bird.add(body)

  // Wing material
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.7,
    metalness: 0.05,
  })

  // Left wing (separate for animation)
  const leftWingGeometry = new THREE.BoxGeometry(1.4, 0.05, 0.6)
  leftWingGeometry.translate(-0.7, 0, 0) // Pivot at root
  leftWing = new THREE.Mesh(leftWingGeometry, wingMaterial)
  leftWing.position.set(0, 0, 0.1)
  leftWing.castShadow = true
  leftWing.receiveShadow = true
  bird.add(leftWing)

  // Right wing (separate for animation)
  const rightWingGeometry = new THREE.BoxGeometry(1.4, 0.05, 0.6)
  rightWingGeometry.translate(0.7, 0, 0) // Pivot at root
  rightWing = new THREE.Mesh(rightWingGeometry, wingMaterial)
  rightWing.position.set(0, 0, 0.1)
  rightWing.castShadow = true
  rightWing.receiveShadow = true
  bird.add(rightWing)

  // Tail
  const tailGeometry = new THREE.BoxGeometry(0.6, 0.03, 0.4)
  const tail = new THREE.Mesh(tailGeometry, wingMaterial)
  tail.position.z = 0.7
  tail.rotation.x = 0.1
  tail.castShadow = true
  tail.receiveShadow = true
  bird.add(tail)

  // Head
  const headGeometry = new THREE.SphereGeometry(0.15, 8, 8)
  const head = new THREE.Mesh(headGeometry, bodyMaterial)
  head.position.z = -0.6
  head.position.y = 0.05
  head.castShadow = true
  head.receiveShadow = true
  bird.add(head)

  // Beak
  const beakGeometry = new THREE.ConeGeometry(0.05, 0.15, 4)
  beakGeometry.rotateX(-Math.PI / 2)
  const beakMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa500,
    roughness: 0.5,
  })
  const beak = new THREE.Mesh(beakGeometry, beakMaterial)
  beak.position.z = -0.75
  beak.position.y = 0.02
  beak.castShadow = true
  bird.add(beak)

  // Initial position
  bird.position.set(0, 30, 0)

  scene.add(bird)

  // Create wind trails for each wing
  createWindTrails()
}

function createWindTrails() {
  const trailMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.15,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  // Create two trails, one for each wingtip
  for (let t = 0; t < 2; t++) {
    const positions = new Float32Array(trailLength * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const trail = new THREE.Points(geometry, trailMaterial.clone())
    trail.frustumCulled = false
    scene.add(trail)
    trailParticles.push(trail)
    trailPositions.push([])
  }
}

function updateWindTrails() {
  if (!bird || trailParticles.length < 2) return

  // Get wingtip positions in world space
  const leftTipLocal = new THREE.Vector3(-1.4, 0, 0.1)
  const rightTipLocal = new THREE.Vector3(1.4, 0, 0.1)

  const leftTipWorld = leftTipLocal.clone()
  bird.localToWorld(leftTipWorld)

  const rightTipWorld = rightTipLocal.clone()
  bird.localToWorld(rightTipWorld)

  const tips = [leftTipWorld, rightTipWorld]

  for (let t = 0; t < 2; t++) {
    const trail = trailPositions[t]
    const particle = trailParticles[t]
    const tip = tips[t]
    if (!trail || !particle || !tip) continue

    // Add new position
    trail.unshift(tip.clone())

    // Remove old positions
    while (trail.length > trailLength) {
      trail.pop()
    }

    // Update geometry
    const positionAttribute = particle.geometry.getAttribute('position') as THREE.BufferAttribute | null
    if (positionAttribute) {
      for (let i = 0; i < trailLength; i++) {
        const trailPos = trail[i]
        if (i < trail.length && trailPos) {
          positionAttribute.setXYZ(i, trailPos.x, trailPos.y, trailPos.z)
        } else {
          positionAttribute.setXYZ(i, 0, -1000, 0) // Hide unused points
        }
      }
      positionAttribute.needsUpdate = true
    }

    // Fade based on position in trail
    const material = particle.material as THREE.PointsMaterial | null
    if (material) {
      material.opacity = isLocked.value ? 0.5 : 0.2
    }
  }
}

function updateWings(delta: number) {
  wingTime += delta * wingFlapSpeed

  // Sinusoidal wing flap
  const flapAngle = Math.sin(wingTime) * wingFlapAmount

  // Left wing rotates around Z axis (positive = up)
  leftWing.rotation.z = flapAngle

  // Right wing rotates opposite
  rightWing.rotation.z = -flapAngle
}

function createGround() {
  // Simple ground plane (placeholder for Sahara desert)
  const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100)
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0xc2a366,
    roughness: 1,
    metalness: 0,
  })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // Add some variation to ground vertices for dunes (basic)
  const positionAttribute = groundGeometry.getAttribute('position')
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i)
    const y = positionAttribute.getY(i)
    const z = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 5 +
              Math.sin(x * 0.05) * Math.cos(y * 0.03) * 3
    positionAttribute.setZ(i, z)
  }
  positionAttribute.needsUpdate = true
  groundGeometry.computeVertexNormals()
}

function requestPointerLock() {
  canvasRef.value?.requestPointerLock()
}

function onPointerLockChange() {
  isLocked.value = document.pointerLockElement === canvasRef.value
  if (isLocked.value) {
    showInstructions.value = false
  }
}

function onMouseMove(event: MouseEvent) {
  if (!isLocked.value) return

  mouseX += event.movementX * turnSpeed
  mouseY += event.movementY * turnSpeed
}

function updateBird() {
  // Apply mouse movement to bird rotation
  yaw -= mouseX
  pitch -= mouseY

  // Clamp pitch
  pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch))

  // Reset mouse accumulators
  mouseX = 0
  mouseY = 0

  // Create rotation quaternion from euler angles
  const quaternion = new THREE.Quaternion()
  quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
  bird.quaternion.copy(quaternion)

  // Calculate forward direction
  const forward = new THREE.Vector3(0, 0, -1)
  forward.applyQuaternion(bird.quaternion)

  // Move bird forward continuously
  bird.position.add(forward.multiplyScalar(birdSpeed))

  // Add slight banking based on yaw change (visual effect)
  const targetRoll = -mouseX * 20
  bird.rotation.z = THREE.MathUtils.lerp(bird.rotation.z, targetRoll, 0.1)

  // Keep bird above ground
  if (bird.position.y < 2) {
    bird.position.y = 2
    if (pitch > 0) pitch = 0
  }

  // Limit altitude
  if (bird.position.y > 200) {
    bird.position.y = 200
    if (pitch < 0) pitch = 0
  }
}

function updateCamera() {
  // Calculate camera position behind and above bird
  const offset = cameraOffset.clone()
  offset.applyQuaternion(bird.quaternion)

  const targetCameraPos = bird.position.clone().add(offset)

  // Smooth camera follow
  camera.position.lerp(targetCameraPos, 0.1)

  // Calculate look target (ahead of bird)
  const lookOffset = cameraLookOffset.clone()
  lookOffset.applyQuaternion(bird.quaternion)
  const lookTarget = bird.position.clone().add(lookOffset)

  // Smooth look at
  const currentLookAt = new THREE.Vector3()
  camera.getWorldDirection(currentLookAt)
  const targetDirection = lookTarget.clone().sub(camera.position).normalize()
  currentLookAt.lerp(targetDirection, 0.15)

  camera.lookAt(bird.position.clone().add(new THREE.Vector3(0, 0.5, 0)))
}

let lastTime = performance.now()

function animate() {
  rafId = requestAnimationFrame(animate)

  const currentTime = performance.now()
  const delta = (currentTime - lastTime) / 1000
  lastTime = currentTime

  if (isLocked.value) {
    updateBird()
  }

  // Always animate wings and trails
  updateWings(delta)
  updateWindTrails()
  updateSunLight()

  updateCamera()

  renderer.render(scene, camera)
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

onMounted(init)
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  renderer.dispose()
  window.removeEventListener('resize', onResize)
  document.removeEventListener('pointerlockchange', onPointerLockChange)
  document.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
  <div class="viewer-root">
    <canvas ref="canvasRef" />

    <!-- Instructions overlay -->
    <Transition name="fade">
      <div v-if="showInstructions && !isLocked" class="instructions-overlay" @click="requestPointerLock">
        <div class="instructions-box">
          <h2>Vol d'Oiseau</h2>
          <p class="main-instruction">Cliquez pour commencer</p>
          <div class="controls-list">
            <p><strong>Souris</strong> - Contrôler la direction</p>
            <p><strong>ESC</strong> - Quitter le mode vol</p>
          </div>
          <p class="hint">L'oiseau avance continuellement</p>
        </div>
      </div>
    </Transition>

    <!-- HUD when flying -->
    <div v-if="isLocked" class="hud">
      <div class="crosshair">+</div>
      <div class="exit-hint">Appuyez sur ESC pour quitter</div>
    </div>

    <!-- Paused state -->
    <Transition name="fade">
      <div v-if="!isLocked && !showInstructions" class="paused-overlay" @click="requestPointerLock">
        <div class="paused-box">
          <p>Pause</p>
          <p class="resume-hint">Cliquez pour reprendre le vol</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.viewer-root {
  position: fixed;
  inset: 0;
  cursor: none;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Instructions overlay */
.instructions-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: pointer;
}

.instructions-box {
  text-align: center;
  color: #fff;
  background: rgba(20, 20, 40, 0.9);
  padding: 3rem 4rem;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
}

.instructions-box h2 {
  font-size: 2.5rem;
  margin-bottom: 1.5rem;
  color: #87ceeb;
  font-weight: 300;
  letter-spacing: 0.1em;
}

.main-instruction {
  font-size: 1.3rem;
  margin-bottom: 2rem;
  color: #ffd700;
}

.controls-list {
  text-align: left;
  margin: 1.5rem 0;
  padding: 1rem 1.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.controls-list p {
  margin: 0.5rem 0;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.8);
}

.controls-list strong {
  color: #87ceeb;
  margin-right: 0.5rem;
}

.hint {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1.5rem;
}

/* HUD */
.hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

.crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 100;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.exit-hint {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem 1rem;
  border-radius: 20px;
}

/* Paused overlay */
.paused-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  cursor: pointer;
}

.paused-box {
  text-align: center;
  color: #fff;
  background: rgba(20, 20, 40, 0.9);
  padding: 2rem 3rem;
  border-radius: 16px;
  backdrop-filter: blur(10px);
}

.paused-box p:first-child {
  font-size: 1.8rem;
  margin-bottom: 0.5rem;
}

.resume-hint {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.6);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
