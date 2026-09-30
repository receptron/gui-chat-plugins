<template>
  <div class="present3d-container" data-testid="shapescript-view">
    <!-- Title on its own line, then the toolbar: side by side, a long title
         (CJK titles have no break opportunities) squeezed into a one-glyph
         column and pushed the buttons off the edge. The toolbar follows the
         chrome-row sizing in docs/ui-controls.md (32px controls, 8px gaps,
         8/12px row padding). -->
    <div class="header">
      <h1 class="title" :title="selectedResult.title || t.untitled">
        {{ selectedResult.title || t.untitled }}
      </h1>
      <div ref="toolbarRef" class="toolbar" data-testid="shapescript-toolbar">
        <button class="control-btn" @click="resetCamera">
          <span class="material-icons">refresh</span>
          {{ t.resetCamera }}
        </button>
        <button class="control-btn" @click="toggleWireframe">
          <span class="material-icons">{{
            showWireframe ? "grid_off" : "grid_on"
          }}</span>
          {{ t.wireframe }}
        </button>
        <button class="control-btn" @click="toggleGrid">
          <span class="material-icons">{{
            showGrid ? "visibility_off" : "visibility"
          }}</span>
          {{ t.grid }}
        </button>
        <!-- One Download menu instead of a button per format: three
             "Download X" buttons were most of the toolbar. Disabled while the
             source panel holds unapplied edits: the export is built from the
             APPLIED script, which is also what the viewport renders, so a
             dirty editor would otherwise download a model the user is no
             longer looking at. -->
        <!-- A disclosure, not an ARIA `menu`: `role="menu"` promises
             arrow-key focus movement this does not implement (codex on
             #3187). As a disclosure the items are plain buttons next in
             tab order, and Escape closes the panel and returns focus to
             the trigger. -->
        <div
          ref="downloadMenuRef"
          class="download-menu"
          @keydown.escape="closeDownloadMenu"
        >
          <button
            ref="downloadTriggerRef"
            class="control-btn"
            :disabled="!canExport"
            :aria-expanded="downloadMenuOpen"
            :aria-controls="downloadPanelId"
            data-testid="shapescript-download-menu"
            @click="downloadMenuOpen = !downloadMenuOpen"
          >
            <span class="material-icons">download</span>
            {{ t.download }}
            <span class="material-icons">{{
              downloadMenuOpen ? "expand_less" : "expand_more"
            }}</span>
          </button>
          <div
            v-if="downloadMenuOpen"
            :id="downloadPanelId"
            ref="downloadPanelRef"
            class="download-menu-panel"
            :style="{ left: `${downloadPanelShift}px` }"
            data-testid="shapescript-download-menu-panel"
          >
            <button
              v-for="format in DOWNLOAD_FORMATS"
              :key="format.extension"
              class="download-menu-item"
              :disabled="!canExport"
              :data-testid="`shapescript-download-${format.testId}`"
              @click="downloadModel(format)"
            >
              <span class="download-menu-format">{{ format.name }}</span>
              <span class="download-menu-hint">{{ t[format.label] }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="parseError" class="error" data-testid="shapescript-parse-error">
      <strong>{{ t.parseError }}</strong> {{ parseError }}
    </div>

    <div v-if="saveError" class="error" data-testid="shapescript-save-error">
      <strong>{{ t.saveError }}</strong> {{ saveError }}
    </div>

    <div
      v-if="exportError"
      class="error"
      data-testid="shapescript-export-error"
    >
      <strong>{{ t.exportError }}</strong> {{ exportError }}
    </div>

    <div
      v-if="sceneWarnings.length"
      class="notice"
      data-testid="shapescript-warnings"
    >
      <strong>{{ t.sceneWarnings }}</strong> {{ sceneWarnings.join(" · ") }}
    </div>

    <pre
      v-if="printOutput.length"
      class="notice output"
      data-testid="shapescript-output"
    ><strong>{{ t.printOutput }}</strong> {{ printOutput.join("\n") }}</pre>

    <div ref="viewport" class="viewport" data-testid="shapescript-viewport" />

    <details class="script-source">
      <!-- The Copy button sits at the right end of the bar. A click inside a
           <summary> toggles the panel, so it is stopped here: copying the
           source must not open or close the editor. -->
      <summary>
        <span>{{ t.editSource }}</span>
        <button
          class="control-btn copy-btn"
          data-testid="shapescript-copy-script"
          @click.prevent.stop="copyScript"
        >
          <span class="material-icons">{{
            copied ? "check" : "content_copy"
          }}</span>
          {{ copied ? t.copied : t.copyScript }}
        </button>
      </summary>
      <!-- `aria-label`, because the only visible text near this control is the
           <summary> that toggles the panel — a screen reader otherwise
           announces an unlabelled text area. -->
      <textarea
        v-model="editableScript"
        class="script-editor"
        spellcheck="false"
        :aria-label="t.scriptEditorLabel"
        @input="handleScriptEdit"
      />
      <button class="apply-btn" :disabled="!hasChanges" @click="applyScript">
        {{ t.applyChanges }}
      </button>
    </details>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  useId,
} from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResult } from "gui-chat-protocol";
import type { PresentShapeScriptData } from "../core/types";
import { readLoadShapeResult, readSaveShapeResult } from "../core/contract";
import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS, sceneInfoOf } from "../shapescript/toThreeJS";
import { removeAndDispose, disposeObject3D } from "../shapescript/dispose";
import {
  shapeScriptToUsdz,
  USDZ_EXTENSION,
  USDZ_MIME_TYPE,
} from "../export/usdz";
import { shapeScriptToGlb, GLB_EXTENSION, GLB_MIME_TYPE } from "../export/glb";
import { shapeScriptToStl, STL_EXTENSION, STL_MIME_TYPE } from "../export/stl";
import type { Messages } from "../lang/messages";
import { slugify } from "../core/paths";
import { useT } from "../lang";

interface CameraState {
  position?: { x: number; y: number; z: number };
  target?: { x: number; y: number; z: number };
}

/** `viewState` is rehydrated from a session's JSONL, which nothing validates on
 *  the way in: a legacy or hand-edited entry can carry a missing axis or a
 *  string. `camera.position.set(undefined, …)` yields NaN coordinates, and a
 *  NaN camera renders an empty viewport with no error to explain it. */
function readVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, z } = value as Record<string, unknown>;
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  return finite(x) && finite(y) && finite(z) ? { x, y, z } : null;
}

const props = defineProps<{
  selectedResult: ToolResult<PresentShapeScriptData>;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult<PresentShapeScriptData>];
}>();

const t = useT();

const { dispatch } = useRuntime();

const editableScript = ref(props.selectedResult.data?.script ?? "");

// State
const viewport = ref<HTMLDivElement | null>(null);
const parseError = ref<string | null>(null);
/** Commands the script used that this viewer does not draw (`texture`, `camera`, …). */
const sceneWarnings = ref<string[]>([]);
/** The script's `print` lines. */
const printOutput = ref<string[]>([]);
const saveError = ref<string | null>(null);
const exportError = ref<string | null>(null);
const exporting = ref(false);
/** True for a moment after a successful copy, so the button can confirm it. */
const copied = ref(false);
let copiedTimeout: number | null = null;
/** Set by `cleanup()`, so a clipboard write still pending at unmount does not
 *  set state or start a timer on a component that is gone. */
let disposed = false;
/** Bumped by every operation that establishes what the source now IS, so an
 *  older in-flight read can tell that it has been superseded. Not a ref: no
 *  template reads it, and reactivity would only invite a watcher. */
let sourceGeneration = 0;
const showWireframe = ref(false);
const showGrid = ref(true);

// Check if script has been modified
const hasChanges = computed(() => {
  return editableScript.value !== props.selectedResult.data?.script;
});

/** One downloadable format: how it is built, and how the file is named. */
interface DownloadFormat {
  /** The format's name as shown in the menu; not translated. */
  name: string;
  /** What the format is for — the menu item's hint. */
  label: keyof Messages;
  testId: string;
  extension: string;
  mimeType: string;
  serialise: (script: string) => Promise<Uint8Array<ArrayBuffer>>;
}

/** The formats the Download menu offers, in menu order: USDZ for AR Quick
 *  Look, GLB for the web and game engines, STL for slicers. */
const DOWNLOAD_FORMATS: readonly DownloadFormat[] = [
  {
    name: "USDZ",
    label: "downloadUsdz",
    testId: "usdz",
    extension: USDZ_EXTENSION,
    mimeType: USDZ_MIME_TYPE,
    serialise: shapeScriptToUsdz,
  },
  {
    name: "GLB",
    label: "downloadGlb",
    testId: "glb",
    extension: GLB_EXTENSION,
    mimeType: GLB_MIME_TYPE,
    serialise: shapeScriptToGlb,
  },
  {
    name: "STL",
    label: "downloadStl",
    testId: "stl",
    extension: STL_EXTENSION,
    mimeType: STL_MIME_TYPE,
    serialise: shapeScriptToStl,
  },
];

/** Download is offered only for a model there is something to export
 *  from: an applied, non-empty, valid script with no unapplied edits. An
 *  empty script is a valid way to clear the scene, but an empty USDZ helps
 *  nobody, so the button disables rather than clicking through to nothing
 *  (CodeRabbit on #3065). */
const canExport = computed(
  () =>
    !exporting.value &&
    !parseError.value &&
    !hasChanges.value &&
    Boolean(props.selectedResult.data?.script),
);

/** The Download menu: open state plus the wrapper that holds the trigger and
 *  the panel. A document `mousedown` listener closes it from outside, tested
 *  with `composedPath()` rather than `contains()`: a plugin mounted in
 *  MulmoTerminal's PluginFrame lives in a shadow root, where `event.target`
 *  is retargeted to the shadow host. The listener exists only while open. */
const downloadMenuOpen = ref(false);
const downloadMenuRef = ref<HTMLElement | null>(null);
const downloadTriggerRef = ref<HTMLButtonElement | null>(null);

/** Escape and a picked format: close, and put focus back on the trigger so
 *  a keyboard user is not left on an item that no longer exists. */
function closeDownloadMenu() {
  if (!downloadMenuOpen.value) return;
  downloadMenuOpen.value = false;
  downloadTriggerRef.value?.focus();
}

function closeDownloadMenuFromOutside(event: MouseEvent) {
  if (
    downloadMenuRef.value &&
    event.composedPath().includes(downloadMenuRef.value)
  )
    return;
  downloadMenuOpen.value = false;
}

watch(downloadMenuOpen, async (isOpen) => {
  if (isOpen)
    document.addEventListener("mousedown", closeDownloadMenuFromOutside);
  else document.removeEventListener("mousedown", closeDownloadMenuFromOutside);
  downloadPanelShift.value = 0;
  if (!isOpen) return;
  await nextTick();
  fitDownloadPanel();
});

/** Per instance: the stack layout mounts every result's view at once, and
 *  `aria-controls` must name THIS view's panel, not the first one's (codex on
 *  #3187). */
const downloadPanelId = `shapescript-download-panel-${useId()}`;
const toolbarRef = ref<HTMLElement | null>(null);
const downloadPanelRef = ref<HTMLElement | null>(null);
/** How far left of the trigger the panel is drawn, in px (0 or negative). */
const downloadPanelShift = ref(0);
/** The toolbar's side padding — the same 12px as `.toolbar` in the styles. */
const TOOLBAR_SIDE_PADDING_PX = 12;

/** The panel hangs off the trigger's left edge, and the trigger is the last
 *  control in a row that wraps, so in a narrow pane the panel can run past
 *  the canvas, which clips it (CodeRabbit on #3187). Its width is already
 *  capped to the toolbar's, so pulling it left by the overrun always fits. */
function fitDownloadPanel() {
  const panel = downloadPanelRef.value;
  const toolbar = toolbarRef.value;
  if (!panel || !toolbar) return;
  const overrun =
    panel.getBoundingClientRect().right -
    (toolbar.getBoundingClientRect().right - TOOLBAR_SIDE_PADDING_PX);
  downloadPanelShift.value = overrun > 0 ? -overrun : 0;
}

/** Measure again from the trigger's own edge: the shift that fitted the old
 *  width is wrong for the new one in both directions (codex on #3187). */
async function refitDownloadPanel() {
  if (!downloadMenuOpen.value) return;
  downloadPanelShift.value = 0;
  await nextTick();
  fitDownloadPanel();
}

// An edit or a parse error while the menu is open takes the export away;
// close rather than leave a panel of items that can no longer be clicked.
watch(canExport, (ok) => {
  if (!ok) downloadMenuOpen.value = false;
});

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let animationId: number;
let gridHelper: THREE.GridHelper;
let sceneObjects: THREE.Object3D[] = [];
let cameraChangeTimeout: number | null = null;
let resizeObserver: ResizeObserver | null = null;

// Lifecycle
onMounted(() => {
  initScene();
  loadShapeScript();
  animate();
  // Restore camera state after everything is initialized
  nextTick(() => {
    restoreCameraState();
  });
  void refreshFromDisk();
});

/** Re-read a file-backed source, so an edit made outside this view — by the
 *  agent, or in an editor — is what gets rendered rather than the copy frozen
 *  into the tool result when it was created. Only the drift case emits: an
 *  unchanged file must not rewrite conversation state on every open.
 *
 *  A failure is deliberately silent. The result already carries a renderable
 *  script, so the view works; raising a banner for a file the user did not
 *  just ask to save would report a problem they cannot act on. */
async function refreshFromDisk(): Promise<void> {
  const filePath = props.selectedResult.data?.filePath;
  if (!filePath) return;
  // The read is in flight while the user can still hit Apply. Without this
  // token a load that started BEFORE the save resolves after it, and the
  // pre-save script is emitted over the freshly-written one — the edit
  // silently reverts in the session (CodeRabbit on #3056).
  const token = ++sourceGeneration;
  try {
    const { script } = await dispatch(
      { kind: "loadShape", path: filePath },
      readLoadShapeResult,
    );
    // Superseded by an edit or an Apply while the read was in flight.
    if (token !== sourceGeneration) return;
    if (script === props.selectedResult.data?.script) return;
    editableScript.value = script;
    emit("updateResult", {
      ...props.selectedResult,
      data: { script, filePath },
    });
  } catch {
    // Keep the script the result carries.
  }
}

onUnmounted(() => {
  cleanup();
});

// Watch for script changes
watch(
  () => props.selectedResult.data?.script,
  () => {
    loadShapeScript();
  },
);

// Watch for wireframe toggle - reload scene with new setting
watch(showWireframe, () => {
  loadShapeScript();
});

// Watch for grid toggle
watch(showGrid, (value) => {
  if (gridHelper) {
    gridHelper.visible = value;
  }
});

// Methods
function initScene() {
  if (!viewport.value) return;

  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_BACKGROUND);

  // Create camera
  const width = viewport.value.clientWidth;
  const height = viewport.value.clientHeight;
  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(5, 5, 10);
  camera.lookAt(0, 0, 0);

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  viewport.value.appendChild(renderer.domElement);

  // Add controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Save camera state when user moves the camera
  controls.addEventListener("change", handleCameraChange);

  // Add lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  // Add grid helper
  gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
  gridHelper.visible = showGrid.value;
  scene.add(gridHelper);

  // Handle window resize
  window.addEventListener("resize", handleResize);

  // Watch for viewport size changes (e.g., when details panel opens/closes)
  resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  resizeObserver.observe(viewport.value);
}

function handleResize() {
  if (!viewport.value) return;

  const width = viewport.value.clientWidth;
  const height = viewport.value.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  // The viewport is as wide as the toolbar, so this fires for every pane
  // resize (window, sidebar toggle) while the Download panel is open.
  void refitDownloadPanel();
}

// `scene.remove` only drops the reference; the GPU buffers live until each
// geometry and material is disposed, and this runs again on every script edit
// and wireframe toggle, so the leak ends in a lost WebGL context.
function clearScene() {
  sceneObjects.forEach((obj) => removeAndDispose(scene, obj));
  sceneObjects = [];
}

const DEFAULT_BACKGROUND = 0x1a1a1a;

function renderScript(script: string) {
  const group = astToThreeJS(parseShapeScript(script), {
    wireframe: showWireframe.value,
  });
  scene.add(group);
  sceneObjects.push(group);
  const info = sceneInfoOf(group);
  sceneWarnings.value = info.warnings;
  printOutput.value = info.logs;
  // `background r g b` from the script, else the viewer's own dark ground.
  scene.background = info.background
    ? new THREE.Color(
        info.background[0],
        info.background[1],
        info.background[2],
      )
    : new THREE.Color(DEFAULT_BACKGROUND);
}

function loadShapeScript() {
  try {
    clearScene();
    sceneWarnings.value = [];
    printOutput.value = [];
    // An empty or invalid script must not keep the previous script's background.
    scene.background = new THREE.Color(DEFAULT_BACKGROUND);
    const script = props.selectedResult.data?.script;
    // An empty script is valid and clears the scene — reached when a result
    // moves from an INVALID script to an empty one, where leaving the previous
    // error on screen described geometry that is no longer there.
    if (script) renderScript(script);
    parseError.value = null;
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : "Unknown error";
    console.error("ShapeScript parse error:", error);
  }
}

function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function resetCamera() {
  camera.position.set(5, 5, 10);
  camera.lookAt(0, 0, 0);
  controls.reset();
}

function restoreCameraState() {
  if (!camera || !controls) {
    return;
  }

  if (!props.selectedResult?.viewState?.cameraState) {
    return;
  }

  const state = props.selectedResult.viewState.cameraState as CameraState;

  const position = readVec3(state.position);
  if (position) {
    camera.position.set(position.x, position.y, position.z);
  }

  const target = readVec3(state.target);
  if (target) {
    controls.target.set(target.x, target.y, target.z);
  }

  camera.updateProjectionMatrix();
  controls.update();
}

function saveCameraState() {
  const cameraState = {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    target: {
      x: controls.target.x,
      y: controls.target.y,
      z: controls.target.z,
    },
  };

  return cameraState;
}

function handleCameraChange() {
  // Debounce camera state updates to avoid excessive emits
  if (cameraChangeTimeout !== null) {
    clearTimeout(cameraChangeTimeout);
  }

  cameraChangeTimeout = window.setTimeout(() => {
    updateCameraState();
  }, 500); // Wait 500ms after user stops moving camera
}

function updateCameraState() {
  const updatedResult: ToolResult<PresentShapeScriptData> = {
    ...props.selectedResult,
    viewState: {
      // Spread first: `viewState` is a free-form bag, so replacing it outright
      // would drop whatever else the host or a future feature persisted there.
      ...props.selectedResult.viewState,
      cameraState: saveCameraState(),
    },
  };

  emit("updateResult", updatedResult);
}

/** How long the object URL outlives the click. The download is started
 *  asynchronously by the browser, and revoking the URL before it has opened
 *  the blob cancels it in some engines (codex on #3065); a minute is far past
 *  any such window and the blob is a few hundred kilobytes. */
const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

/** Hand the browser a file to save. */
function triggerBlobDownload(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  mimeType: string,
) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

/** Build the file in the browser from the script the viewport is rendering —
 *  the APPLIED one — with no round trip and no file layer, so it works on a
 *  host with neither. The buttons are disabled unless `canExport`, and this
 *  re-checks so a stale click cannot export a model that differs from the one
 *  on screen. The scene is rebuilt solid rather than reusing the on-screen
 *  objects, which may be wireframe. */
async function downloadModel(format: DownloadFormat) {
  // The same close as Escape: picking a format removes the focused item, so
  // focus goes back to the trigger rather than to the document body.
  closeDownloadMenu();
  const script = props.selectedResult.data?.script;
  if (!script || !canExport.value) return;
  exporting.value = true;
  exportError.value = null;
  try {
    const bytes = await format.serialise(script);
    triggerBlobDownload(
      bytes,
      `${slugify(props.selectedResult.title)}${format.extension}`,
      format.mimeType,
    );
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    exporting.value = false;
  }
}

/** How long the Copy button reads "Copied" before reverting. */
const COPIED_FEEDBACK_MS = 1500;

/** Copy the source as shown in the editor — unapplied edits included, since
 *  that is the text the user is looking at. Success feedback is local (the
 *  label and icon swap for a moment); a rejected write (blocked clipboard,
 *  unfocused document) simply shows no confirmation. */
async function copyScript() {
  try {
    await navigator.clipboard.writeText(editableScript.value);
  } catch {
    return;
  }
  if (disposed) return;
  copied.value = true;
  if (copiedTimeout !== null) clearTimeout(copiedTimeout);
  copiedTimeout = window.setTimeout(() => {
    copied.value = false;
    copiedTimeout = null;
  }, COPIED_FEEDBACK_MS);
}

function toggleWireframe() {
  showWireframe.value = !showWireframe.value;
}

function toggleGrid() {
  showGrid.value = !showGrid.value;
}

function cleanup() {
  disposed = true;
  document.removeEventListener("mousedown", closeDownloadMenuFromOutside);
  if (cameraChangeTimeout !== null) {
    clearTimeout(cameraChangeTimeout);
  }
  if (copiedTimeout !== null) {
    clearTimeout(copiedTimeout);
  }
  sceneObjects.forEach((obj) => removeAndDispose(scene, obj));
  sceneObjects = [];
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  if (renderer) {
    renderer.dispose();
  }
  if (controls) {
    controls.removeEventListener("change", handleCameraChange);
    controls.dispose();
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  window.removeEventListener("resize", handleResize);
}

function handleScriptEdit() {
  // The edit itself is not applied — that is the Apply button's job. What this
  // does do is take ownership of the buffer: a `loadShape` started at mount can
  // still be in flight, and without invalidating it here the disk copy lands on
  // top of whatever the user has just typed (codex on #3056).
  sourceGeneration++;
}

async function applyScript() {
  const script = editableScript.value;
  try {
    // Run the same semantic/geometry validation as the tool before saving.
    disposeObject3D(astToThreeJS(parseShapeScript(script)));
  } catch (error) {
    parseError.value =
      error instanceof Error ? error.message : "Invalid ShapeScript";
    console.error("Script validation failed:", error);
    return;
  }
  parseError.value = null;

  // Persist BEFORE updating the result: the file is the source of truth for a
  // file-backed model, so a result that advanced past a failed write would
  // render a script the next `loadShape` cannot find. A host with no file
  // layer leaves `filePath` unset and the result stays the only copy.
  const filePath = props.selectedResult.data?.filePath;
  const token = ++sourceGeneration;
  if (filePath) {
    try {
      await dispatch(
        { kind: "saveShape", path: filePath, script },
        readSaveShapeResult,
      );
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
      return;
    }
  }
  // Another apply (or a refresh) landed while this one was writing — that one
  // owns the result now.
  if (token !== sourceGeneration) return;
  saveError.value = null;

  // Update the result (preserve existing viewState); the watch re-renders.
  const updatedResult: ToolResult<PresentShapeScriptData> = {
    ...props.selectedResult,
    data: filePath ? { script, filePath } : { script },
  };
  emit("updateResult", updatedResult);
}

// Watch for external changes to selectedResult (when user clicks different result)
watch(
  () => props.selectedResult.data?.script,
  (newScript) => {
    // `undefined` means "no data yet" and keeps whatever is in the box; an
    // empty STRING is a valid script that cleared the scene, and leaving the
    // old source visible invited the user to re-apply what they just removed.
    if (newScript !== undefined) editableScript.value = newScript;
  },
);

// Watch for selectedResult changes to restore camera state
watch(
  () => props.selectedResult,
  () => {
    nextTick(() => {
      restoreCameraState();
    });
  },
);
</script>

<style scoped>
.present3d-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #ffffff;
}

.header {
  background: #2a2a2a;
  border-bottom: 1px solid #444;
  display: flex;
  flex-direction: column;
}

/* One line, ellipsised: the title must never dictate the toolbar's width. */
.title {
  margin: 0;
  padding: 8px 12px 0;
  min-width: 0;
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Chrome row per docs/ui-controls.md: 8px between groups, 12/8 outer padding,
   32px-tall controls. Wraps rather than overflows when the pane is narrow. */
.toolbar {
  container-type: inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  background: #3a3a3a;
  color: #ffffff;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  transition: background 0.2s;
}

.control-btn:hover {
  background: #4a4a4a;
}

.control-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.control-btn:disabled:hover {
  background: #3a3a3a;
}

.control-btn .material-icons {
  font-size: 1.2rem;
}

.download-menu {
  position: relative;
}

.download-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  width: max-content;
  /* Never wider than the toolbar's inner width, so the shift computed in
     fitDownloadPanel() can always bring it fully into view. */
  max-width: min(18rem, calc(100cqw - 24px));
  padding: 4px;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.download-menu-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  text-align: left;
}

.download-menu-item:hover {
  background: #4a4a4a;
}

.download-menu-item:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.download-menu-format {
  font-weight: 600;
  min-width: 3.5em;
}

.download-menu-hint {
  color: #aaa;
  font-size: 0.8rem;
}

.viewport {
  flex: 1;
  min-height: 0;
  position: relative;
}

.error {
  padding: 1rem;
  background: #ff000020;
  color: #ff6666;
  font-family: monospace;
  border-bottom: 1px solid #ff000040;
}

.notice {
  padding: 0.5rem 1rem;
  background: #ffaa0020;
  color: #e0b060;
  font-family: monospace;
  font-size: 0.85rem;
  border-bottom: 1px solid #ffaa0040;
}

.output {
  margin: 0;
  background: #ffffff10;
  color: #cccccc;
  white-space: pre-wrap;
}

.script-source {
  padding: 0.5rem;
  background: #00000040;
  border-top: 1px solid #444;
  font-family: monospace;
  font-size: 0.85rem;
}

.script-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #2a2a2a;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

/* A flex <summary> loses the disclosure marker in Chromium and Safari; draw
   one so the bar still reads as a toggle. */
.script-source summary::before {
  content: "▸";
  margin-right: 0.5rem;
}

.script-source[open] summary::before {
  content: "▾";
}

.script-source summary > span {
  flex: 1;
}

.copy-btn {
  height: 28px;
  padding: 0 10px;
  font-family: inherit;
}

.script-source[open] summary {
  margin-bottom: 0.5rem;
}

.script-source summary:hover {
  background: #3a3a3a;
}

.script-editor {
  width: 100%;
  min-height: 150px;
  padding: 1rem;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #aaa;
  font-family: "Courier New", monospace;
  font-size: 0.9rem;
  resize: vertical;
  margin-bottom: 0.5rem;
}

.script-editor:focus {
  outline: none;
  border-color: #666;
  background: #222;
}

.apply-btn {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
}

.apply-btn:hover {
  background: #45a049;
}

.apply-btn:active {
  background: #3d8b40;
}

.apply-btn:disabled {
  background: #cccccc;
  color: #666666;
  cursor: not-allowed;
  opacity: 0.6;
}

.apply-btn:disabled:hover {
  background: #cccccc;
}
</style>
