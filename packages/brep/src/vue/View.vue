<template>
  <div
    class="flex h-full min-h-0 w-full flex-col bg-white text-sm text-slate-800"
    data-testid="brep-view"
  >
    <div
      class="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2"
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

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <div class="relative min-h-64 min-w-0 flex-1 bg-slate-100">
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

      <aside
        v-if="report"
        class="max-h-[45%] w-full shrink-0 overflow-y-auto border-t border-slate-200 p-3 md:max-h-none md:w-80 md:border-l md:border-t-0"
        data-testid="brep-report"
      >
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
        <ul
          v-if="fileRows.length"
          class="mt-1 space-y-1"
          data-testid="brep-files"
        >
          <li
            v-for="row in fileRows"
            :key="row.path"
            class="flex items-center gap-2"
          >
            <span class="w-20 shrink-0 whitespace-nowrap text-slate-500">{{
              row.label
            }}</span>
            <code
              class="min-w-0 flex-1 truncate font-mono text-xs"
              :title="row.path"
              >{{ row.path }}</code
            >
            <button
              type="button"
              class="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-100"
              @click="copy(row.path, row.path)"
            >
              {{ copiedKey === row.path ? t.copied : t.copy }}
            </button>
          </li>
        </ul>
        <p v-else class="mt-1 text-slate-500">{{ t.notSaved }}</p>
      </aside>
    </div>

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
        class="max-h-72 overflow-auto bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800"
      ><code>{{ script }}</code></pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ToolResult } from "gui-chat-protocol";
import { decodeMesh, isBrepMesh } from "../core/mesh";
import type { PresentBrepData } from "../core/types";
import type { OperationSummary } from "../kernel/report";
import { useT, type Messages } from "../lang";
import {
  buildObjects,
  placeCamera,
  type ModelObjects,
  type ViewName,
} from "./scene";

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

const fileRows = computed(() => {
  const files = props.selectedResult.data?.files;
  if (!files) return [];
  return [
    { label: t.value.fileScript, path: files.script },
    { label: t.value.fileStep, path: files.step },
    { label: t.value.fileStl, path: files.stl },
    { label: t.value.fileDrawings, path: files.views },
  ];
});

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
