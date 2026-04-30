// Extension Template Registry
//
// Single source of truth for all extension template definitions.
// Maps template names to their parameter names so discover.ts and expand.ts
// don't need to duplicate this knowledge as string literals.

export interface ExtensionTemplateDef {
  templateName: string;
  paramNames: string[];
  namespace: string;
}

export const EXTENSION_TEMPLATES: readonly ExtensionTemplateDef[] = [
  { templateName: "V1WorkspacePermission", paramNames: ["application", "resource", "verb", "v2Perm"], namespace: "Kessel" },
  { templateName: "ResourceAnnotation",    paramNames: ["application", "resource", "key", "value"], namespace: "Kessel" },
  { templateName: "CascadeDeletePolicy",   paramNames: ["childApplication", "childResource", "parentRelation"], namespace: "Kessel" },
];
