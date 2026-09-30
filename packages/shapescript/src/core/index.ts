export type {
  PresentShapeScriptData,
  PresentShapeScriptArgs,
  PresentShapeScriptResult,
  PresentShapeScriptRenderedResult,
  PresentShapeScriptErrorResult,
  PresentShapeScriptExecutionResult,
  ShapeScriptDiagnostic,
} from "./types";
export { TOOL_NAME, TOOL_DEFINITION } from "./definition";
export {
  pluginCore,
  presentShapeScript,
  executePresentShapeScript,
} from "./plugin";
export type { ShapeScriptExecuteContext } from "./plugin";
export { executeShapeScriptDispatch, locateShape } from "./dispatch";
export type { ShapeScriptDispatchContext, ShapeFileOps } from "./dispatch";
export {
  isShapeScriptDispatchArgs,
  readLoadShapeResult,
  readSaveShapeResult,
} from "./contract";
export type {
  LoadShapeArgs,
  SaveShapeArgs,
  ShapeScriptDispatchArgs,
  ShapeScriptDispatchResult,
} from "./contract";
export {
  isPresentableShapePath,
  isShapeArtifactPath,
  shapeArtifactPath,
  usdzArtifactPath,
  toArtifactsRelative,
  SHAPE_EXTENSIONS,
} from "./paths";
// USDZ export: the pure serialiser (shared with the View's download button) and
// the `exportShapeScriptUsdz` tool, which needs only the generic `files`
// capability — so it lives on `.` rather than a server-only entry.
export {
  sceneToUsdz,
  shapeScriptToUsdz,
  USDZ_MIME_TYPE,
  USDZ_EXTENSION,
} from "../export/usdz";
// GLB and STL: the same pure shape, browser-side only so far (the View's
// download buttons); no tool wraps them yet.
export {
  sceneToGlb,
  shapeScriptToGlb,
  GLB_MIME_TYPE,
  GLB_EXTENSION,
} from "../export/glb";
export {
  sceneToStl,
  shapeScriptToStl,
  STL_MIME_TYPE,
  STL_EXTENSION,
} from "../export/stl";
export { exportShapeScript } from "../export/model";
export type { ExportOptions } from "../export/model";
export {
  resolveShapeSource,
  executeExportShapeScriptUsdz,
  EXPORT_USDZ_TOOL_NAME,
  EXPORT_USDZ_DESCRIPTION,
  EXPORT_USDZ_PROMPT,
  EXPORT_USDZ_SCHEMA,
  EXPORT_USDZ_TOOL_TIMEOUT_MS,
} from "../export/tool";
export type { ExportUsdzResult } from "../export/tool";
export {
  executeManageShapeScript,
  existingShapePost,
  shapePostFrom,
  shapePostPatch,
  shapePostSummary,
  shapePostUrl,
  stampOf,
  listLimitOf,
  normalizeKeywords as normalizeShapeKeywords,
  MANAGE_TOOL_NAME,
  MANAGE_ACTIONS,
  MANAGE_DESCRIPTION,
  MANAGE_PROMPT,
  MANAGE_SCHEMA,
  GET_LIST_DEFAULT_LIMIT,
  GET_LIST_MAX_LIMIT,
  SHAPE_GALLERY_URL,
  SHAPE_POST_KEYS,
  SHAPE_POST_LIMITS,
  SHAPE_SCRIPT_CONTENT_TYPE,
  SHAPE_OBJECT_CACHE_CONTROL,
  requireScriptBytes,
  licenseFor,
  expectOf,
  NOT_CONNECTED_MESSAGE,
  POST_CHANGED_MESSAGE,
  LICENSE_REQUIRED_MESSAGE,
  SHAPE_LICENSE,
  SHAPE_LICENSE_LABEL,
  SHAPE_LICENSE_URL,
} from "./manage";
export type {
  ShapeLicense,
  ManageShapeAction,
  ManageShapeScriptContext,
  ManageShapeResult,
  ShapeGalleryWriter,
  ShapePostDoc,
  ShapePostExpect,
  ShapePostPatch,
  ShapePostSummary,
} from "./manage";
export { samples } from "./samples";

// Re-export ShapeScript utilities
export { parseShapeScript } from "../shapescript/parser";
export { astToThreeJS, sceneInfoOf } from "../shapescript/toThreeJS";
export type { ShapeScriptSceneInfo } from "../shapescript/toThreeJS";
export type { SceneNode } from "../shapescript/types";
