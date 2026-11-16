<template>
  <div
    class="flex flex-col gap-0.5 rounded bg-slate-100 p-2 text-slate-800"
    data-testid="brep-preview"
  >
    <div class="truncate text-sm font-semibold" :title="title">
      {{ title }}
    </div>
    <div v-if="report" class="text-xs tabular-nums text-slate-600">
      {{ report.size.join(" × ") }} mm
    </div>
    <div
      v-if="report?.warnings.length"
      class="text-xs text-amber-700"
      data-testid="brep-preview-warnings"
    >
      {{ t.warnings }}: {{ report.warnings.length }}
    </div>
  </div>
</template>

<script setup lang="ts">
// A card of text, not a small 3D view: a page is allowed only a few WebGL
// contexts, and a conversation lists every result at once.
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import type { PresentBrepData } from "../core/types";
import { useT } from "../lang";

const props = defineProps<{
  result: ToolResult<PresentBrepData>;
}>();

const t = useT();

const title = computed(() => props.result.title || t.value.untitled);
const report = computed(() => props.result.data?.report);
</script>
