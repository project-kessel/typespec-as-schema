import { $provider, $annotation, $cascadeDelete } from "./decorators.js";

export { $lib } from "./tsp-lib.js";

export const $decorators = {
  Kessel: {
    provider: $provider,
    annotation: $annotation,
    cascadeDelete: $cascadeDelete,
  },
};
