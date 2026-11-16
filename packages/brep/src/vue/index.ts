import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import { TOOL_DEFINITION, TOOL_NAME } from "../core/definition";
import type { PresentBrepArgs, PresentBrepData } from "../core/types";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const SYSTEM_PROMPT = `Use the ${TOOL_NAME} tool for a part that will be made or that must fit: brackets, enclosures, flanges, jigs, anything with fillets, chamfers, holes to a size, or a STEP file to hand on. It builds a replicad script with a CAD kernel and returns a report to check the result against. For a model that is only looked at, use ShapeScript. Z is up and the user looks from -Y: put the side they should see first at -Y (a chair's seat front at -Y, its backrest at +Y).`;

/** The plugin for a page: the View and the Preview, and the tool's
 *  definition. Its `execute` refuses, on purpose: the model is built by the
 *  CAD kernel in Node, and this entry imports nothing that reaches it, so a
 *  host's browser bundle carries neither `node:vm` nor 22 MB of WebAssembly.
 *  A host runs the tool on its server, with `executePresentBrep` from
 *  `@gui-chat-plugin/brep`. */
export const plugin: ToolPlugin<PresentBrepData, unknown, PresentBrepArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: async () => ({
    message:
      "presentBrep runs on the host's server (executePresentBrep from @gui-chat-plugin/brep), not in the page.",
  }),
  generatingMessage: "Building the solid model...",
  waitingMessage:
    "Tell the user that the solid model is being built and will be shown shortly.",
  isEnabled: () => true,
  viewComponent: View,
  previewComponent: Preview,
  systemPrompt: SYSTEM_PROMPT,
};

export type {
  BrepDiagnostic,
  BrepFiles,
  ModelReport,
  PresentBrepArgs,
  PresentBrepData,
  PresentBrepResult,
} from "../core/types";
export { decodeMesh, isBrepMesh } from "../core/mesh";
export type { BrepMesh } from "../core/mesh";
export { TOOL_NAME, TOOL_DEFINITION };
export { View, Preview };

export default { plugin };
