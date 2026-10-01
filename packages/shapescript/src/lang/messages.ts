export interface Messages {
  untitled: string;
  resetCamera: string;
  wireframe: string;
  grid: string;
  parseError: string;
  editSource: string;
  scriptEditorLabel: string;
  applyChanges: string;
  saveError: string;
  /** The Download menu's trigger; the formats are its items. */
  download: string;
  /** Hint beside "USDZ" in the Download menu: what the format is for. */
  downloadUsdz: string;
  /** Hint beside "GLB" (binary glTF) in the Download menu. */
  downloadGlb: string;
  /** Hint beside "STL" in the Download menu. */
  downloadStl: string;
  exportError: string;
  /** Copies the ShapeScript source to the clipboard. */
  copyScript: string;
  /** Transient label after a successful copy. */
  copied: string;
  /** Heading for commands the script used that this viewer does not draw. */
  sceneWarnings: string;
  /** Heading for the script's `print` lines. */
  printOutput: string;
}
