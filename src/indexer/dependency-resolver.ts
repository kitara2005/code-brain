/** Extract module dependencies from import/require statements */
import fs from "node:fs";
import path from "node:path";
import type { ModuleInfo } from "../types.js";

/** Resolve dependencies between modules by scanning import/require patterns */
export function resolveDependencies(modules: ModuleInfo[], projectRoot: string): void {
  const moduleNames = new Set(modules.map((m) => m.name));

  for (const mod of modules) {
    const deps = new Set<string>();

    // Sample up to 10 files per module for import analysis
    const filesToScan = mod.files.slice(0, 10);

    for (const relFile of filesToScan) {
      const absFile = path.join(projectRoot, relFile);
      try {
        const content = fs.readFileSync(absFile, "utf-8");
        extractImportedModules(content, relFile, moduleNames).forEach((d) => deps.add(d));
      } catch {
        continue;
      }
    }

    // Remove self-references
    deps.delete(mod.name);
    mod.dependencies = Array.from(deps);
  }
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
