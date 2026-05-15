// ResourceGraph — mutation-friendly wrapper around ResourceDef[]
//
// Providers use this instead of raw arrays + findResource/cloneResources.
// Modeled on the TS POC runtime (get_relation, add_relation) and
// Starlark runtime (add_member, has_member).

import type { ResourceDef, RelationDef, RelationBody } from "./types.js";

export class ResourceHandle {
  private readonly _boolRelationsSeen: Set<string>;

  constructor(public readonly resource: ResourceDef) {
    this._boolRelationsSeen = new Set<string>();
    for (const rel of resource.relations) {
      if (rel.body.kind === "bool") this._boolRelationsSeen.add(rel.name);
    }
  }

  addRelation(name: string, body: RelationBody): void {
    this.resource.relations.push({ name, body });
  }

  /** Adds a bool relation only if one with this name hasn't been added yet. */
  addBoolRelation(name: string, target: string): void {
    if (this._boolRelationsSeen.has(name)) return;
    this._boolRelationsSeen.add(name);
    this.resource.relations.push({ name, body: { kind: "bool", target } });
  }

  hasRelation(name: string): boolean {
    return this.resource.relations.some((r) => r.name === name);
  }

  getRelation(name: string): RelationDef | undefined {
    return this.resource.relations.find((r) => r.name === name);
  }
}

export class ResourceGraph {
  private readonly _resources: ResourceDef[];
  private readonly _warnings: string[] = [];

  constructor(resources: ResourceDef[]) {
    this._resources = resources.map((r) => ({
      ...r,
      relations: [...r.relations],
    }));
  }

  get(namespace: string, name: string): ResourceHandle | null {
    const res = this._resources.find(
      (r) => r.namespace === namespace && r.name === name,
    );
    return res ? new ResourceHandle(res) : null;
  }

  /** Returns an existing resource or creates an empty one. */
  ensure(namespace: string, name: string): ResourceHandle {
    let res = this._resources.find(
      (r) => r.namespace === namespace && r.name === name,
    );
    if (!res) {
      res = { name, namespace, relations: [] };
      this._resources.unshift(res);
    }
    return new ResourceHandle(res);
  }

  warn(message: string): void {
    this._warnings.push(message);
  }

  get warnings(): string[] {
    return this._warnings;
  }

  toResources(): ResourceDef[] {
    return this._resources;
  }
}
