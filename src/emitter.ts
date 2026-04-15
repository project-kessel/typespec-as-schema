import type { EmitContext } from "@typespec/compiler";
import { emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib-definition.js";
import {
  discoverResources,
  generateSpiceDB,
  generateMetadata,
  generateUnifiedJsonSchemas,
  generateIR,
} from "./lib.js";
import {
  discoverV1WorkspacePermissionDeclarations,
  v1ExtensionsFromDeclarations,
  applyDeclaredPatches,
} from "./declarative-extensions.js";
import { generatePreview } from "./preview.js";

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const program = context.program;
  const format = context.options["output-format"] ?? "spicedb";
  const lenient = context.options["lenient-extensions"] ?? false;
  const strict = !lenient;

  const { resources } = discoverResources(program);
  const declared = discoverV1WorkspacePermissionDeclarations(program);
  const extensions = v1ExtensionsFromDeclarations(declared);
  const { resources: fullSchema, jsonSchemaFields } = applyDeclaredPatches(
    resources,
    declared,
    { strict },
  );

  const outputDir = context.emitterOutputDir;

  switch (format) {
    case "spicedb": {
      const output = generateSpiceDB(fullSchema);
      await emitFile(program, {
        path: resolvePath(outputDir, "schema.zed"),
        content: `// Generated SpiceDB/Zed Schema from TypeSpec type graph\n\n${output}`,
      });
      break;
    }

    case "ir": {
      const irPath = context.options["ir-output-path"]
        ? resolvePath(context.options["ir-output-path"])
        : resolvePath(outputDir, "resources.json");
      const mainFile = program.sourceFiles.keys().next().value ?? "unknown";
      const ir = generateIR(mainFile, fullSchema, extensions, jsonSchemaFields);
      await emitFile(program, {
        path: irPath,
        content: JSON.stringify(ir, null, 2) + "\n",
      });
      break;
    }

    case "metadata": {
      const metadata = generateMetadata(fullSchema, extensions);
      await emitFile(program, {
        path: resolvePath(outputDir, "metadata.json"),
        content: JSON.stringify(metadata, null, 2) + "\n",
      });
      break;
    }

    case "unified-jsonschema": {
      const schemas = generateUnifiedJsonSchemas(fullSchema, jsonSchemaFields);
      await emitFile(program, {
        path: resolvePath(outputDir, "unified-jsonschema.json"),
        content: JSON.stringify(schemas, null, 2) + "\n",
      });
      break;
    }

    case "preview": {
      const preview = generatePreview(declared);
      await emitFile(program, {
        path: resolvePath(outputDir, "preview.txt"),
        content: preview,
      });
      break;
    }
  }
}
