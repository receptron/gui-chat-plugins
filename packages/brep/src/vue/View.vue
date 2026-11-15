<template>
  <!-- The layout (the model, the bar the user drags, the part that scrolls)
       is in this file's own CSS, at the end, not in Tailwind classes. See
       the note there. -->
  <div
    ref="root"
    class="brep-view bg-white text-sm text-slate-800"
    data-testid="brep-view"
  >
    <div
      ref="header"
      class="brep-header flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2"
    >
      <h1
        class="mr-auto min-w-0 truncate text-base font-semibold text-slate-900"
        :title="title"
      >
        {{ title }}
      </h1>
      <div class="flex items-center gap-1" data-testid="brep-toolbar">
        <button
          v-for="view in VIEWS"
          :key="view"
          type="button"
          class="h-8 rounded border px-2.5"
          :class="
            view === activeView
              ? 'border-slate-800 bg-slate-800 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          "
          :aria-pressed="view === activeView"
          :data-testid="`brep-view-${view}`"
          @click="lookFrom(view)"
        >
          {{ t[VIEW_LABELS[view]] }}
        </button>
        <label
          class="ml-2 flex h-8 cursor-pointer items-center gap-1.5 text-slate-700"
        >
          <input v-model="showEdges" type="checkbox" data-testid="brep-edges" />
          {{ t.edges }}
        </label>
      </div>
    </div>

    <div
      class="brep-model bg-slate-100"
      :style="{ height: `${height}px` }"
      data-testid="brep-model"
    >
      <div
        ref="viewport"
        class="absolute inset-0"
        data-testid="brep-viewport"
      />
      <p
        v-if="viewportMessage"
        class="absolute inset-0 flex items-center justify-center p-4 text-center text-slate-500"
        data-testid="brep-viewport-message"
      >
        {{ viewportMessage }}
      </p>
    </div>

    <!-- The bar between the model and what scrolls below it. A separator
         that takes focus is a slider to a screen reader: arrows move it. -->
    <div
      ref="bar"
      class="brep-bar"
      :class="{ 'brep-bar-dragging': dragging }"
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      :aria-label="t.resizeModel"
      :aria-valuenow="height"
      :aria-valuemin="0"
      :aria-valuemax="Math.max(available, 0)"
      data-testid="brep-bar"
      @pointerdown="startDrag"
      @pointermove="drag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @keydown="nudge"
      @dblclick="resetHeight"
    >
      <span class="brep-bar-grip" />
    </div>

    <div class="brep-below" data-testid="brep-below">
      <section v-if="report" class="p-3" data-testid="brep-report">
        <div
          v-if="report.warnings.length"
          class="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900"
          data-testid="brep-warnings"
        >
          <h2 class="font-semibold">{{ t.warnings }}</h2>
          <ul class="mt-1 list-disc pl-4">
            <li v-for="warning in report.warnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt class="text-slate-500">{{ t.size }}</dt>
          <dd class="tabular-nums" data-testid="brep-size">
            {{ report.size.join(" × ") }} mm
          </dd>
          <dt class="text-slate-500">{{ t.volume }}</dt>
          <dd class="tabular-nums">{{ number(report.volume) }} mm³</dd>
          <dt class="text-slate-500">{{ t.surface }}</dt>
          <dd class="tabular-nums">{{ number(report.area) }} mm²</dd>
          <dt class="text-slate-500">{{ t.solids }}</dt>
          <dd class="tabular-nums">{{ report.solids }}</dd>
          <dt class="text-slate-500">{{ t.faces }}</dt>
          <dd data-testid="brep-faces">{{ kinds(report.faces) }}</dd>
          <dt class="text-slate-500">{{ t.edgeKinds }}</dt>
          <dd>{{ kinds(report.edges) }}</dd>
        </dl>

        <template v-if="report.parts">
          <h2 class="mt-4 font-semibold text-slate-900">{{ t.parts }}</h2>
          <ul class="mt-1 space-y-0.5">
            <li
              v-for="(part, index) in report.parts"
              :key="index"
              class="tabular-nums"
            >
              {{ part.name ?? index + 1 }}: {{ part.size.join(" × ") }} mm,
              {{ number(part.volume) }} mm³
            </li>
          </ul>
        </template>

        <template v-if="report.operations.length">
          <h2 class="mt-4 font-semibold text-slate-900">{{ t.operations }}</h2>
          <ol class="mt-1 space-y-1" data-testid="brep-operations">
            <li
              v-for="(operation, index) in report.operations"
              :key="index"
              class="flex flex-wrap items-baseline gap-x-2"
            >
              <span
                v-if="operation.line !== undefined"
                class="w-12 shrink-0 text-xs tabular-nums text-slate-400"
              >
                {{ t.line }} {{ operation.line }}
              </span>
              <code class="font-mono text-slate-900"
                >{{ operation.op }}({{ operation.size ?? "" }}){{
                  operation.count > 1 ? ` ×${operation.count}` : ""
                }}</code
              >
              <span v-if="picked(operation)" class="text-slate-600">
                {{ picked(operation) }}
              </span>
              <span
                v-if="operation.volumeChange !== undefined"
                class="ml-auto tabular-nums text-slate-500"
              >
                {{ signed(operation.volumeChange) }} mm³
              </span>
            </li>
          </ol>
        </template>

        <h2 class="mt-4 font-semibold text-slate-900">{{ t.files }}</h2>
        <ul class="mt-1 flex flex-wrap gap-2" data-testid="brep-files">
          <li v-for="row in fileRows" :key="row.kind">
            <button
              type="button"
              class="rounded border border-slate-300 px-2.5 py-1 hover:bg-slate-100"
              :title="row.fileName"
              :data-testid="`brep-download-${row.kind}`"
              @click="download(row)"
            >
              {{ t.download }} {{ row.label }}
            </button>
          </li>
        </ul>
      </section>

      <details
        v-if="script"
        class="border-t border-slate-200"
        data-testid="brep-script"
      >
        <!-- A click inside a <summary> toggles the panel, so the Copy button
             stops it: copying must not open or close the source. -->
        <summary
          class="flex cursor-pointer items-center gap-2 px-3 py-2 text-slate-700"
        >
          <span class="mr-auto">{{ t.script }}</span>
          <button
            type="button"
            class="rounded border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-100"
            @click.prevent.stop="copy(script, 'script')"
          >
            {{ copiedKey === "script" ? t.copied : t.copy }}
          </button>
        </summary>
        <pre
          class="overflow-x-auto bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800"
        ><code>{{ script }}</code></pre>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ToolResult } from "gui-chat-protocol";
import { decodeMesh, isBrepMesh } from "../core/mesh";
import { unpack } from "../core/packed";
import type { PresentBrepData } from "../core/types";
import type { OperationSummary } from "../kernel/report";
import { useT, type Messages } from "../lang";
import {
  buildObjects,
  placeCamera,
  type ModelObjects,
  type ViewName,
} from "./scene";
import {
  KEY_STEP,
  modelHeight,
  readStoredHeight,
  STORAGE_KEY,
  storeHeight,
} from "./split";

const props = defineProps<{
  selectedResult: ToolResult<PresentBrepData>;
}>();

const t = useT();

const VIEWS: ViewName[] = ["iso", "top", "front", "right"];
const VIEW_LABELS: Record<ViewName, keyof Messages> = {
  iso: "viewIso",
  top: "viewTop",
  front: "viewFront",
  right: "viewRight",
};

const title = computed(() => props.selectedResult.title || t.value.untitled);
const report = computed(() => props.selectedResult.data?.report);
const script = computed(() => props.selectedResult.data?.script ?? "");
/** The mesh, when the result carries one this View can decode. */
const mesh = computed(() => {
  const candidate = props.selectedResult.data?.mesh;
  return isBrepMesh(candidate) ? candidate : null;
});

interface FileRow {
  kind: "script" | "step" | "stl" | "views";
  label: string;
  fileName: string;
  type: string;
  /** The file's content: text as it is, or packed bytes to unpack. */
  content: { text: string } | { packed: string };
}

/** What can be downloaded: the script always, the exports when the result
 *  carries them (one from before the View had downloads does not). */
const fileRows = computed<FileRow[]>(() => {
  const downloads = props.selectedResult.data?.downloads;
  const name = downloads?.name ?? "model";
  const rows: FileRow[] = [];
  if (script.value)
    rows.push({
      kind: "script",
      label: t.value.fileScript,
      fileName: `${name}.replicad.js`,
      type: "text/javascript",
      content: { text: script.value },
    });
  if (downloads)
    rows.push(
      {
        kind: "step",
        label: t.value.fileStep,
        fileName: `${name}.step`,
        type: "model/step",
        content: { packed: downloads.step },
      },
      {
        kind: "stl",
        label: t.value.fileStl,
        fileName: `${name}.stl`,
        type: "model/stl",
        content: { packed: downloads.stl },
      },
      {
        kind: "views",
        label: t.value.fileDrawings,
        fileName: `${name}.svg`,
        type: "image/svg+xml",
        content: { packed: downloads.views },
      },
    );
  return rows;
});

/** Hand the file to the browser to save: a link with `download`, clicked. */
async function download(row: FileRow): Promise<void> {
  let part: BlobPart;
  try {
    part =
      "text" in row.content
        ? row.content.text
        : await unpack(row.content.packed);
  } catch {
    return;
  }
  const url = URL.createObjectURL(new Blob([part], { type: row.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = row.fileName;
  link.click();
  // After the click has been handled: revoking at once can cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const number = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString("en-US") : "–";

const signed = (value: number): string =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value))}`;

const kinds = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");

/** "selected 4 of 12" for one call; only the total for several, which each
 *  had their own number to pick from. */
function picked(operation: OperationSummary): string {
  if (operation.selected === undefined) return "";
  const selected = String(operation.selected);
  if (operation.count === 1 && operation.available !== undefined)
    return t.value.selectedOf
      .replace("{selected}", selected)
      .replace("{available}", String(operation.available));
  return t.value.selected.replace("{selected}", selected);
}

// ── Copy ────────────────────────────────────────────────────────────

const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Set at unmount, so a clipboard write still pending then starts no timer. */
let unmounted = false;

async function copy(text: string, key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  if (unmounted) return;
  copiedKey.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copiedKey.value = null), 1500);
}

// ── The bar under the model ─────────────────────────────────────────

const root = ref<HTMLDivElement | null>(null);
const header = ref<HTMLDivElement | null>(null);
const bar = ref<HTMLDivElement | null>(null);
/** Where the user left the bar, px; null until they move it. */
const wanted = ref<number | null>(readStoredHeight());
/** What the model and the part below it share, px. */
const available = ref(0);
const height = computed(() => modelHeight(wanted.value, available.value));
const dragging = ref(false);
let rootObserver: ResizeObserver | null = null;
/** Pointer y and model height when the drag began. */
let dragFrom: { y: number; height: number } | null = null;

function measure(): void {
  if (!root.value) return;
  available.value =
    root.value.clientHeight -
    (header.value?.offsetHeight ?? 0) -
    (bar.value?.offsetHeight ?? 0);
}

/** Put the bar at `value`, as far as it fits, and remember where it ended. */
function setHeight(value: number): void {
  wanted.value = modelHeight(value, available.value);
  storeHeight(wanted.value);
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragFrom = { y: event.clientY, height: height.value };
  dragging.value = true;
  // The bar keeps the pointer when it leaves it, over the canvas included.
  bar.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function drag(event: PointerEvent): void {
  if (!dragFrom) return;
  setHeight(dragFrom.height + event.clientY - dragFrom.y);
}

function endDrag(): void {
  dragFrom = null;
  dragging.value = false;
}

function nudge(event: KeyboardEvent): void {
  const moves: Record<string, number> = {
    ArrowUp: height.value - KEY_STEP,
    ArrowDown: height.value + KEY_STEP,
    Home: 0,
    End: available.value,
  };
  const target = moves[event.key];
  if (target === undefined) return;
  event.preventDefault();
  setHeight(target);
}

/** Back to the share the View starts with. */
function resetHeight(): void {
  wanted.value = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was kept.
  }
}

// ── The 3D view ─────────────────────────────────────────────────────

const viewport = ref<HTMLDivElement | null>(null);
const showEdges = ref(true);
const activeView = ref<ViewName | null>("iso");
/** True once creating the WebGL renderer has failed. */
const webglFailed = ref(false);

const viewportMessage = computed(() => {
  if (!mesh.value) return t.value.noMesh;
  if (webglFailed.value) return t.value.noWebgl;
  return "";
});

const FIELD_OF_VIEW = 35;
const BACKGROUND = 0xf1f5f9;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let objects: ModelObjects | null = null;
let resizeObserver: ResizeObserver | null = null;
/** A frame already asked for, so several changes in one tick draw once. */
let frame = 0;

/** Draw now. The scene only changes when the user moves the camera or the
 *  result changes, so there is no render loop.
 *
 *  Now, not on the next frame, for everything but a drag: resizing a canvas
 *  clears it, and a cleared canvas left for a frame shows as a black flash;
 *  a tab in the background gets no frames at all, and would stay empty. */
function draw(): void {
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

/** Draw on the next frame: a drag raises many changes between two frames. */
function drawSoon(): void {
  if (frame || !renderer) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function initScene(): void {
  const element = viewport.value;
  if (!element || renderer) return;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    webglFailed.value = true;
    return;
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(BACKGROUND);
  element.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000);
  // The model's own axes: Z is up, as in the script.
  camera.up.set(0, 0, 1);
  // The light travels with the camera, so a face turned toward the viewer is
  // always lit, wherever the model has been turned.
  const headlight = new THREE.DirectionalLight(0xffffff, 1.5);
  headlight.position.set(-0.5, 0.8, 1);
  camera.add(headlight);
  scene.add(camera);
  // From above, brighter than from below: the top of a part reads as its top.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x77808c, 2.2));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener("change", drawSoon);
  // A view button stays lit until the user turns the model away from it.
  controls.addEventListener("start", () => (activeView.value = null));

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  resize();
}

function resize(): void {
  const element = viewport.value;
  if (!element || !renderer || !camera) return;
  const width = element.clientWidth;
  const height = element.clientHeight;
  if (width === 0 || height === 0) return;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  draw();
}

function lookFrom(view: ViewName): void {
  activeView.value = view;
  const current = mesh.value;
  if (!current || !camera || !controls) return;
  const placement = placeCamera(
    current.min,
    current.max,
    view,
    FIELD_OF_VIEW,
    camera.aspect,
  );
  camera.position.set(...placement.position);
  camera.near = placement.distance / 100;
  camera.far = placement.distance + placement.radius * 10;
  camera.updateProjectionMatrix();
  controls.target.set(...placement.target);
  controls.update();
  draw();
}

/** Replace the model in the scene with the result's mesh. */
function showModel(): void {
  if (!scene) return;
  if (objects) {
    scene.remove(objects.faces, objects.edges);
    objects.dispose();
    objects = null;
  }
  const current = mesh.value;
  if (!current) {
    draw();
    return;
  }
  objects = buildObjects(decodeMesh(current));
  objects.edges.visible = showEdges.value;
  scene.add(objects.faces, objects.edges);
  lookFrom("iso");
}

onMounted(() => {
  if (root.value) {
    rootObserver = new ResizeObserver(measure);
    rootObserver.observe(root.value);
    if (header.value) rootObserver.observe(header.value);
  }
  measure();
  initScene();
  showModel();
});

watch(mesh, showModel);

watch(showEdges, (visible) => {
  if (objects) objects.edges.visible = visible;
  draw();
});

onUnmounted(() => {
  unmounted = true;
  clearTimeout(copiedTimer);
  if (frame) cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  rootObserver?.disconnect();
  controls?.dispose();
  objects?.dispose();
  if (renderer) {
    renderer.dispose();
    // Browsers allow a page only a few WebGL contexts; give this one back.
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  renderer = null;
});
</script>

<style scoped>
/* The layout, in this View's own rules.
 *
 * It was Tailwind classes, with a side-by-side layout as width-dependent
 * variants (`@3xl:flex-row` over `flex-col`). That holds only while this
 * package's stylesheet is the last word. MulmoChat loads every plugin's
 * stylesheet, 36 of them, and each one that also uses `flex-col` or
 * `shrink-0` declares it again, AFTER this package's variant, with the same
 * weight: the later rule wins, and the layout comes out half applied.
 *
 * These rules are scoped to this component and outside any cascade layer, so
 * no utility class from any stylesheet outranks them. Colours and spacing
 * stay Tailwind: nothing overrides those by width.
 */

/* Three rows that fill the host's box and never overflow it: the header, the
 * model at the height the user gave it (set inline, from `split.ts`), the bar,
 * and below it everything else, which takes what is left and scrolls. A host
 * mounts the View in a box of its own size that clips (MulmoChat:
 * `overflow-hidden`), so the part that scrolls has to be in here. */
.brep-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.brep-header {
  display: flex;
  flex: none;
}

/* `flex: none`: its height is the user's, not what a flex column would
 * squeeze it to. */
.brep-model {
  position: relative;
  flex: none;
  width: 100%;
  min-width: 0;
}

.brep-bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 0.75rem;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  cursor: row-resize;
  /* A touch on the bar drags it; it does not scroll the page. */
  touch-action: none;
  user-select: none;
}

.brep-bar:hover,
.brep-bar:focus-visible,
.brep-bar-dragging {
  background: #e2e8f0;
  outline: none;
}

.brep-bar-grip {
  width: 2.5rem;
  height: 0.1875rem;
  border-radius: 9999px;
  background: #94a3b8;
}

.brep-bar:focus-visible .brep-bar-grip,
.brep-bar-dragging .brep-bar-grip {
  background: #334155;
}

/* `min-height: 0` lets it be shorter than its content, which is what makes
 * it the thing that scrolls. */
.brep-below {
  flex: 1 1 0%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
</style>
