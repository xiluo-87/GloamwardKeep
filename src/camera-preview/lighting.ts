import { AmbientLight, DirectionalLight, HemisphereLight } from 'three';

export const LIGHTING_LABEL = 'Crisp neutral daylight';

export function createStudyLighting() {
  return {
    sky: new HemisphereLight('#eef4ff', '#303a36', 1.35),
    ambient: new AmbientLight('#ffffff', 0.2),
    sun: new DirectionalLight('#fffaf4', 3.1),
  };
}
