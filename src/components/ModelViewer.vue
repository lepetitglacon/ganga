<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDragging = ref(false)
const modelInfo = ref('')
const envInfo = ref('')
const loading = ref(false)
const loadingLabel = ref('')

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let rafId: number
let currentModel: THREE.Object3D | null = null
let defaultMesh: THREE.Mesh | null = null

function init() {
  const canvas = canvasRef.value!

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0d1a)

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000)
  camera.position.set(0, 1.2, 3.5)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 0.1
  controls.maxDistance = 200

  // Default environment lighting (no external file needed)
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTexture
  pmrem.dispose()

  // Default placeholder mesh
  addDefaultMesh()

  window.addEventListener('resize', onResize)
  animate()
}

function addDefaultMesh() {
  const geo = new THREE.TorusKnotGeometry(0.8, 0.28, 200, 48)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7c5cbf,
    roughness: 0.15,
    metalness: 0.85,
  })
  defaultMesh = new THREE.Mesh(geo, mat)
  scene.add(defaultMesh)
  currentModel = defaultMesh
  modelInfo.value = 'Torus Knot (par défaut)'
}

function animate() {
  rafId = requestAnimationFrame(animate)
  // Slow auto-rotation on default mesh only
  if (defaultMesh && currentModel === defaultMesh) {
    defaultMesh.rotation.y += 0.004
    defaultMesh.rotation.x += 0.001
  }
  controls.update()
  renderer.render(scene, camera)
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function fitCameraToObject(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  object.position.sub(center)

  const fov = (camera.fov * Math.PI) / 180
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.8

  camera.position.set(0, maxDim * 0.25, dist)
  controls.target.set(0, 0, 0)
  controls.minDistance = maxDim * 0.05
  controls.maxDistance = maxDim * 15
  controls.update()
}

function loadGLTF(file: File) {
  loading.value = true
  loadingLabel.value = 'Chargement du modèle…'
  const url = URL.createObjectURL(file)
  const loader = new GLTFLoader()

  loader.load(
    url,
    (gltf) => {
      if (currentModel) scene.remove(currentModel)
      if (defaultMesh) defaultMesh = null

      currentModel = gltf.scene
      scene.add(currentModel)
      fitCameraToObject(currentModel)

      modelInfo.value = file.name
      URL.revokeObjectURL(url)
      loading.value = false
    },
    undefined,
    (err) => {
      console.error(err)
      loading.value = false
    },
  )
}

function loadHDR(file: File) {
  loading.value = true
  loadingLabel.value = "Chargement de l'environnement…"
  const url = URL.createObjectURL(file)
  const loader = new RGBELoader()

  loader.load(
    url,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      const pmrem = new THREE.PMREMGenerator(renderer)
      const envMap = pmrem.fromEquirectangular(texture).texture

      scene.environment = envMap
      scene.background = texture

      pmrem.dispose()
      URL.revokeObjectURL(url)
      envInfo.value = file.name
      loading.value = false
    },
    undefined,
    (err) => {
      console.error(err)
      loading.value = false
    },
  )
}

function loadEquirectImage(file: File) {
  loading.value = true
  loadingLabel.value = 'Chargement du fond 360°…'
  const url = URL.createObjectURL(file)
  const loader = new THREE.TextureLoader()

  loader.load(
    url,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace

      const pmrem = new THREE.PMREMGenerator(renderer)
      const envMap = pmrem.fromEquirectangular(texture).texture

      scene.environment = envMap
      scene.background = texture

      pmrem.dispose()
      URL.revokeObjectURL(url)
      envInfo.value = file.name
      loading.value = false
    },
    undefined,
    (err) => {
      console.error(err)
      loading.value = false
    },
  )
}

function handleFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'glb' || ext === 'gltf') {
    loadGLTF(file)
  } else if (ext === 'hdr') {
    loadHDR(file)
  } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext ?? '')) {
    loadEquirectImage(file)
  }
}

function onModelInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onEnvInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) Array.from(files).forEach(handleFile)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as Element)?.contains(e.relatedTarget as Node)) {
    isDragging.value = false
  }
}

onMounted(init)
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  renderer.dispose()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div
    class="viewer-root"
    @drop="onDrop"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
  >
    <canvas ref="canvasRef" />

    <!-- Drop overlay -->
    <Transition name="fade">
      <div v-if="isDragging" class="drop-overlay">
        <div class="drop-message">
          <span class="drop-icon">⬇</span>
          Déposer le modèle (GLB/GLTF) ou l'environnement (HDR/JPG/PNG)
        </div>
      </div>
    </Transition>

    <!-- Loading indicator -->
    <Transition name="fade">
      <div v-if="loading" class="loading-overlay">
        <div class="spinner" />
        <span>{{ loadingLabel }}</span>
      </div>
    </Transition>

    <!-- Controls panel -->
    <div class="panel">
      <p class="panel-title">3D Viewer</p>

      <div class="control-group">
        <span class="label">Modèle 3D</span>
        <label class="file-btn">
          Charger GLB / GLTF
          <input type="file" accept=".glb,.gltf" @change="onModelInput" />
        </label>
        <span v-if="modelInfo" class="file-name">{{ modelInfo }}</span>
      </div>

      <div class="control-group">
        <span class="label">Environnement 360°</span>
        <label class="file-btn">
          Charger HDR / Image
          <input type="file" accept=".hdr,.jpg,.jpeg,.png,.webp" @change="onEnvInput" />
        </label>
        <span v-if="envInfo" class="file-name">{{ envInfo }}</span>
      </div>

      <div class="hints">
        <p>Glisser-déposer les fichiers ici</p>
        <p>Clic gauche · Scroll · Clic droit</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewer-root {
  position: fixed;
  inset: 0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Drop overlay */
.drop-overlay {
  position: fixed;
  inset: 0;
  background: rgba(108, 99, 255, 0.15);
  border: 2px dashed rgba(168, 156, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
}

.drop-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
  font-size: 1.2rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.65);
  padding: 1.5rem 2.5rem;
  border-radius: 16px;
  backdrop-filter: blur(8px);
}

.drop-icon {
  font-size: 2rem;
}

/* Loading */
.loading-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  background: rgba(13, 13, 26, 0.85);
  color: #a89cff;
  padding: 1.25rem 2rem;
  border-radius: 14px;
  border: 1px solid rgba(168, 156, 255, 0.2);
  backdrop-filter: blur(12px);
  z-index: 50;
  font-size: 0.9rem;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(168, 156, 255, 0.2);
  border-top-color: #a89cff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Panel */
.panel {
  position: fixed;
  top: 1.5rem;
  left: 1.5rem;
  background: rgba(13, 13, 26, 0.8);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 1.25rem 1.5rem;
  color: #fff;
  min-width: 230px;
  z-index: 10;
}

.panel-title {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #a89cff;
  margin-bottom: 1.25rem;
}

.control-group {
  margin-bottom: 1rem;
}

.label {
  display: block;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.45rem;
}

.file-btn {
  display: inline-block;
  background: rgba(108, 99, 255, 0.18);
  border: 1px solid rgba(108, 99, 255, 0.45);
  color: #a89cff;
  padding: 0.4rem 0.9rem;
  border-radius: 8px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  user-select: none;
}

.file-btn:hover {
  background: rgba(108, 99, 255, 0.35);
  border-color: rgba(168, 156, 255, 0.7);
}

.file-btn input {
  display: none;
}

.file-name {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.35);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.hints {
  margin-top: 1.1rem;
  padding-top: 0.9rem;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.hints p {
  margin: 0.2rem 0;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.25);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
