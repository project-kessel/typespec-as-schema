// Package Entry Point
//
// Re-exports everything the TypeSpec compiler needs to resolve this
// package as an emitter plugin: $lib, $onEmit, and all $decorator functions.

export { $lib } from "./lib.js";
export { $onEmit } from "./emitter.js";
export {
  $kesselExtension,
  $cascadePolicy,
  $annotation,
  $v1Permission,
  $cascadeDelete,
  $resourceAnnotation,
} from "./decorators.js";
