import type { Program } from "@typespec/compiler";
import {
  compile,
  NodeHost,
  discoverResources,
  path,
  type ResourceDef,
  type V1Extension,
} from "./lib.js";
import {
  discoverV1WorkspacePermissionDeclarations,
  v1ExtensionsFromDeclarations,
} from "./declarative-extensions.js";

export async function compileAndDiscover(mainFile: string): Promise<{
  resources: ResourceDef[];
  extensions: V1Extension[];
  program: Program;
}> {
  const resolvedMain = path.resolve(mainFile);
  const program = await compile(NodeHost, resolvedMain, { noEmit: true });

  const hasErrors = program.diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    const msgs = program.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.message);
    throw new Error(`Compilation failed:\n${msgs.join("\n")}`);
  }

  const { resources } = discoverResources(program);
  const declared = discoverV1WorkspacePermissionDeclarations(program);
  const extensions = v1ExtensionsFromDeclarations(declared);
  return { resources, extensions, program };
}
