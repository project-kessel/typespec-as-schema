import type { DecoratorContext, Model } from "@typespec/compiler";
import { useStateMap } from "@typespec/compiler/utils";
import { KesselStateKeys } from "./tsp-lib.js";

const [, setProviderMetadata] = useStateMap<Model, Record<string, unknown>>(
  KesselStateKeys.provider,
);

const [, setAnnotationMetadata] = useStateMap<Model, Array<{ key: string; value: string }>>(
  KesselStateKeys.annotation,
);

const [, setCascadeDeleteMetadata] = useStateMap<Model, string[]>(
  KesselStateKeys.cascadeDelete,
);

export function $provider(
  context: DecoratorContext,
  target: Model,
  id: string,
  ownedNamespace?: string,
  costPerInstance?: number,
  applicationParam?: string,
  permissionParam?: string,
): void {
  setProviderMetadata(context.program, target, {
    id,
    ownedNamespace,
    costPerInstance,
    applicationParam,
    permissionParam,
  });
}

export function $annotation(
  context: DecoratorContext,
  target: Model,
  key: string,
  value: string,
): void {
  const existing = context.program.stateMap(KesselStateKeys.annotation).get(target) as Array<{ key: string; value: string }> | undefined;
  const list = existing ?? [];
  list.push({ key, value });
  setAnnotationMetadata(context.program, target, list);
}

export function $cascadeDelete(
  context: DecoratorContext,
  target: Model,
  parentRelation: string,
): void {
  const existing = context.program.stateMap(KesselStateKeys.cascadeDelete).get(target) as string[] | undefined;
  const list = existing ?? [];
  list.push(parentRelation);
  setCascadeDeleteMetadata(context.program, target, list);
}
