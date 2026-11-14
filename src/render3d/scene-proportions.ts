/** Geometry and picking use tile coordinates; these sizes express model units per tile.
 * Expanding a tile therefore converts unchanged mob models into fewer tile units.
 * Static props grow too, but leave a little more free ground around their footprints.
 * Ground elevation is also converted by /tile, preserving its original model-unit height.
 */
export interface SceneProportions {
  readonly tile: number;
  readonly buildings: number;
  readonly vegetation: number;
}

export const BASE_SCENE: SceneProportions = { tile: 1, buildings: 1, vegetation: 1 };
/** First roomier art-review pass; tuning remains subject to visual review. */
export const ROOMIER_SCENE: SceneProportions = { tile: 2.4, buildings: 1.4, vegetation: 1.5 };
