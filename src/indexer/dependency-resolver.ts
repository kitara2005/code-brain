/** Extract module dependencies and typed relations from source code */
import fs from "node:fs";
import path from "node:path";
import type { ModuleInfo, Relation } from "../types.js";

/** Resolve dependencies between modules by scanning import/require patterns */
export function resolveDependencies(modules: ModuleInfo[], projectRoot: string): Relation[] {
  const moduleNames = new Set(modules.map((m) => m.name));
  const relations: Relation[] = [];

  for (const mod of modules) {
    const deps = new Set<string>();

    // Sample up to 15 files per module for import analysis
    const filesToScan = mod.files.slice(0, 15);

    for (const relFile of filesToScan) {
      const absFile = path.join(projectRoot, relFile);
      try {
        const content = fs.readFileSync(absFile, "utf-8");

        // Extract imports → depends_on
        extractImportedModules(content, relFile, moduleNames).forEach((d) => deps.add(d));

        // Extract extends/implements → typed relations
        extractTypedRelations(content, mod.name, moduleNames).forEach((r) => relations.push(r));
      } catch {
        continue;
      }
    }

    // Remove self-references
    deps.delete(mod.name);
    mod.dependencies = Array.from(deps);

    // Add depends_on relations
    for (const dep of mod.dependencies) {
      relations.push({ source: mod.name, target: dep, kind: "depends_on" });
    }
  }

  // Deduplicate relations
  const seen = new Set<string>();
  return relations.filter((r) => {
    const key = `${r.source}:${r.target}:${r.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Extract module names from import/require statements */
function extractImportedModules(content: string, filePath: string, knownModules: Set<string>): string[] {
  const found: string[] = [];

  // PHP: require_once('path/module/...')
  const phpRequires = content.matchAll(/require_once\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of phpRequires) {
    const reqPath = match[1];
    for (const mod of knownModules) {
      if (reqPath.includes(`/${mod}/`) || reqPath.includes(`\\${mod}\\`)) {
        found.push(mod);
      }
    }
  }

  // PHP: use namespace\module\Class
  const phpUses = content.matchAll(/^use\s+([^;]+);/gm);
  for (const match of phpUses) {
    const ns = match[1];
    for (const mod of knownModules) {
      if (ns.toLowerCase().includes(mod.toLowerCase())) {
        found.push(mod);
      }
    }
  }

  // JS/TS: import ... from 'path' or require('path')
  const jsImports = content.matchAll(/(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g);
  for (const match of jsImports) {
    const importPath = match[1];
    if (importPath.startsWith(".")) {
      // Relative import — resolve to module
      for (const mod of knownModules) {
        if (importPath.includes(`/${mod}/`) || importPath.includes(`/${mod}`)) {
          found.push(mod);
        }
      }
    } else if (importPath.startsWith("@")) {
      // Scoped package — check if it maps to a known module
      const pkgName = importPath.split("/").slice(0, 2).join("/");
      for (const mod of knownModules) {
        if (pkgName.includes(mod)) found.push(mod);
      }
    }
  }

  return [...new Set(found)];
}

/** Extract extends/implements relations from class declarations */
function extractTypedRelations(content: string, moduleName: string, knownModules: Set<string>): Relation[] {
  const relations: Relation[] = [];

  // PHP: class X extends Y, class X implements Y
  const phpExtends = content.matchAll(/class\s+\w+\s+extends\s+([\w\\]+)/g);
  for (const match of phpExtends) {
    const parent = match[1].split("\\").pop() || "";
    for (const mod of knownModules) {
      if (mod !== moduleName && content.includes(mod)) {
        relations.push({ source: moduleName, target: mod, kind: "extends", details: parent });
        break;
      }
    }
  }

  const phpImpl = content.matchAll(/class\s+\w+[^{]*implements\s+([\w\\,\s]+)/g);
  for (const match of phpImpl) {
    const ifaces = match[1].split(",").map((s) => s.trim().split("\\").pop() || "");
    for (const iface of ifaces) {
      for (const mod of knownModules) {
        if (mod !== moduleName && content.includes(mod)) {
          relations.push({ source: moduleName, target: mod, kind: "implements", details: iface });
          break;
        }
      }
    }
  }

  // TS: class X extends Y, class X implements Y
  const tsExtends = content.matchAll(/class\s+\w+\s+extends\s+([\w.]+)/g);
  for (const match of tsExtends) {
    for (const mod of knownModules) {
      if (mod !== moduleName && content.includes(mod)) {
        relations.push({ source: moduleName, target: mod, kind: "extends", details: match[1] });
        break;
      }
    }
  }

  return relations;
}
