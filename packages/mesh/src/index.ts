export {
  generateMesh,
  generateMeshWithDiagnostics,
  referenceRectangleFits,
  type MeshGenerationOptions,
} from "./generate.js";
export { MeshError, validateMeshSpec } from "./validation.js";
export { constrainMeshEdges } from "./constraints.js";
export { fitRasterRegion, type RasterRegion } from "./raster-region.js";
export {
  fillEnclosedHoles,
  prepareAlphaForMesh,
  repairCornerPinches,
  selectPrimaryComponent,
  traceContour,
} from "./contour.js";
