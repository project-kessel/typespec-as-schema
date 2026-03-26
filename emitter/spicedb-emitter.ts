// SpiceDB/Zed Schema Emitter for TypeSpec
// Walks the compiled TypeSpec type graph to produce SpiceDB schema output.
// Uses the TypeSpec compiler API to discover models, relations, and permissions.
//
// Output conventions:
//   - Assignable relations use t_ prefix (e.g. t_workspace, t_binding)
//   - Permissions wrap relations (e.g. permission binding = t_binding)
//   - Wildcards use "any" (e.g. any_any_any, inventory_any_any)
//   - Workspace binding is "binding"
//   - view_metadata accumulates all read-verb v2 permissions
//
// Usage: npx tsx emitter/spicedb-emitter.ts [main.tsp] [--metadata]

import {
  compileAndDiscover,
  buildSchemaFromTypeGraph,
  generateSpiceDB,
  generateMetadata,
  generateUnifiedJsonSchemas,
  path,
} from "./lib.js";

async function main() {
  const args = process.argv.slice(2);
  const emitMetadata = args.includes("--metadata");
  const emitUnifiedJsonSchema = args.includes("--unified-jsonschema");
  const mainFile = args.find((a) => !a.startsWith("--")) || path.resolve(import.meta.dirname ?? ".", "../main.tsp");
  const resolvedMain = path.resolve(mainFile);

  console.error(`Compiling ${resolvedMain}...`);

  const { resources, extensions } = await compileAndDiscover(resolvedMain);

  console.error(
    `Discovered ${resources.length} resources and ${extensions.length} V1BasedPermission extensions from type graph.`
  );

  if (emitMetadata) {
    const metadata = generateMetadata(resources, extensions);
    console.log(JSON.stringify(metadata, null, 2));
  } else if (emitUnifiedJsonSchema) {
    const schemas = generateUnifiedJsonSchemas(resources);
    console.log(JSON.stringify(schemas, null, 2));
  } else {
    const fullSchema = buildSchemaFromTypeGraph(resources, extensions);
    const output = generateSpiceDB(fullSchema);

    console.log("// Generated SpiceDB/Zed Schema from TypeSpec type graph");
    console.log("// Produced by walking the compiled TypeSpec program.");
    console.log("");
    console.log(output);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
