// The core entry: the three tools, host-agnostic. Their execute() runs
// wherever the host runs it (MulmoChat's server, MulmoGlass's page) and uses
// only gui-chat-protocol: context.app for pictures, context.files.artifacts
// for records, context.userSpokeAt and context.currentResult for the holds.
import type { ToolPluginCore } from "gui-chat-protocol";
import {
  DEFINE_STORYBOARD_DEFINITION,
  PRESENT_PANEL_DEFINITION,
  PRESENT_SLIDE_DEFINITION,
} from "./definitions";
import type { SequenceContext } from "./host";
import { presentSlide } from "./presentSlide";
import { defineStoryboard, presentPanel } from "./storyboard";

type SequencePluginCore = ToolPluginCore<
  unknown,
  unknown,
  Record<string, unknown>
>;

export const presentSlidePluginCore: SequencePluginCore = {
  toolDefinition: PRESENT_SLIDE_DEFINITION,
  generatingMessage: "Making the slide...",
  isEnabled: () => true,
  execute: (context, args) => presentSlide(context as SequenceContext, args),
};

export const defineStoryboardPluginCore: SequencePluginCore = {
  toolDefinition: DEFINE_STORYBOARD_DEFINITION,
  generatingMessage: "Drawing the characters...",
  isEnabled: () => true,
  execute: (context, args) =>
    defineStoryboard(context as SequenceContext, args),
};

export const presentPanelPluginCore: SequencePluginCore = {
  toolDefinition: PRESENT_PANEL_DEFINITION,
  generatingMessage: "Drawing the panel...",
  isEnabled: () => true,
  execute: (context, args) => presentPanel(context as SequenceContext, args),
};

export * from "./definitions";
export {
  MAX_SLIDE_HTML,
  SLIDE_ANIMATIONS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  slideHtmlDocument,
} from "./slideHtml";
export { SLIDESHOWS_DIR, STORYBOARDS_DIR, loadRecord } from "./records";
export type { SequenceContext } from "./host";
