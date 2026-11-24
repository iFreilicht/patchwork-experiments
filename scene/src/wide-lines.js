// three.js's wide lines (examples/jsm/lines): WebGL draws its own lines one pixel wide whatever
// they ask for. The viewport draws with these, and plugins get them as `api.wideLines` beside
// `api.THREE` (STAGE.md), as an object drawn in the scene must be made with the scene's three.js.

import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

export { LineMaterial, LineSegments2, LineSegmentsGeometry };

/** What `api.wideLines` is. */
export const wideLines = Object.freeze({ LineSegmentsGeometry, LineMaterial, LineSegments2 });
