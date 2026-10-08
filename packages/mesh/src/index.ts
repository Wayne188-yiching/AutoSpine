export {
  generateMesh,
  generateMeshWithDiagnostics,
  referenceRectangleFits,
  type MeshGenerationOptions,
} from "./generate.js";
export { MeshError, validateMeshSpec } from "./validation.js";
export { constrainMeshEdges } from "./constraints.js";
export { generateSurfaceMesh } from "./surface.js";
export { generateFeatureMesh, type FeatureMesh, type FeatureMeshOptions } from "./feature.js";
export { fitRasterRegion, type RasterRegion } from "./raster-region.js";
export {
  fillEnclosedHoles,
  prepareAlphaForMesh,
  repairCornerPinches,
  selectPrimaryComponent,
  traceContour,
} from "./contour.js";
