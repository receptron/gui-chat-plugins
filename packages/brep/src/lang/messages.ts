export interface Messages {
  untitled: string;
  /** The four ways to look at the model. */
  viewIso: string;
  viewTop: string;
  viewFront: string;
  viewRight: string;
  /** Toggles the edge lines. */
  edges: string;
  /** Shown in place of the viewport when the result carries no mesh. */
  noMesh: string;
  /** Shown in place of the viewport when WebGL is not available. */
  noWebgl: string;
  size: string;
  volume: string;
  surface: string;
  solids: string;
  faces: string;
  edgeKinds: string;
  parts: string;
  operations: string;
  /** "line 12" */
  line: string;
  /** "selected 4 of 12", with {selected} and {available}. */
  selectedOf: string;
  /** "selected 4", with {selected}: several calls, no single total. */
  selected: string;
  warnings: string;
  files: string;
  fileScript: string;
  fileStep: string;
  fileStl: string;
  fileDrawings: string;
  notSaved: string;
  script: string;
  copy: string;
  copied: string;
}
