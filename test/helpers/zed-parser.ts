/**
 * Parses SpiceDB/Zed definition blocks from a text output for structural comparison.
 */
export interface DefinitionBlock {
  name: string;
  permissions: string[];
  relations: string[];
}

export function parseZedDefinitions(zedText: string): Map<string, DefinitionBlock> {
  const blocks = new Map<string, DefinitionBlock>();
  const lines = zedText.split("\n");
  let current: DefinitionBlock | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("//") || line === "") continue;

    const defMatch = line.match(/^definition\s+(\S+)\s*\{/);
    if (defMatch) {
      current = { name: defMatch[1], permissions: [], relations: [] };
      blocks.set(defMatch[1], current);
      continue;
    }

    if (line === "}" || line === "{}") {
      if (line === "{}" && current) {
        // empty definition like `definition rbac/principal {}`
      }
      current = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("permission ")) {
      current.permissions.push(line);
    } else if (line.startsWith("relation ")) {
      current.relations.push(line);
    }
  }

  return blocks;
}
