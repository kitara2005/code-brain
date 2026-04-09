#!/usr/bin/env node
/** Build the code-brain index: scan modules, parse AST, store in SQLite */
import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "../config.js";
import { openDb, saveDb } from "../db.js";
import { initSchema } from "../schema.js";
import { scanModules, collectFiles } from "./module-scanner.js";
import { parseFile } from "./ast-parser.js";
import { resolveDependencies } from "./dependency-resolver.js";
import type { CodeBrainConfig } from "../config.js";

const projectRoot = process.argv[2] || process.cwd();
const config = loadConfig(projectRoot);
const dbPath = path.join(projectRoot, config.index.path);

console.error(`code-brain: Building index for ${config.name} at ${projectRoot}`);
const startTime = Date.now();

const db = await openDb(dbPath);
initSchema(db);

// Step 1: Scan modules
console.error("Step 1: Scanning modules...");
const modules = scanModules(projectRoot, config);
console.error(`  → ${modules.length} modules found`);

// Step 2: Parse all source files
console.error("Step 2: Parsing source files...");
const extensions = config.source.extensions;
let totalFiles = 0;
let totalSymbols = 0;

const insertSym = db.prepare(`
  INSERT INTO symbols (name, kind, file, line_start, line_end, signature, module, scope)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

db.run("BEGIN TRANSACTION");

for (const sourceDir of config.source.dirs) {
  const absDir = path.join(projectRoot, sourceDir);
  if (!fs.existsSync(absDir)) continue;

  const allFiles = collectFiles(absDir, Object.keys(extensions), config.source.exclude);

  for (const filePath of allFiles) {
    const ext = path.extname(filePath);
    const language = extensions[ext];
    if (!language) continue;

    try {
      const source = fs.readFileSync(filePath, "utf-8");
      const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");

      // Find which module this file belongs to
      let moduleName: string | undefined;
      for (const mod of modules) {
        if (relPath.startsWith(mod.path)) { moduleName = mod.name; break; }
      }

      const symbols = parseFile(source, relPath, language);
      for (const sym of symbols) {
        insertSym.bind([
          sym.name, sym.kind, sym.file, sym.line_start,
          sym.line_end ?? null, sym.signature ?? null,
          moduleName ?? null, sym.scope ?? null
        ]);
        insertSym.step();
        insertSym.reset();
        totalSymbols++;
      }
      totalFiles++;

      if (totalFiles % 1000 === 0) {
        db.run("COMMIT");
        db.run("BEGIN TRANSACTION");
        console.error(`  Processed ${totalFiles} files, ${totalSymbols} symbols...`);
      }
    } catch {
      // skip unparseable files
    }
  }
}

db.run("COMMIT");
insertSym.free();

// Step 3: Resolve dependencies
console.error("Step 3: Resolving dependencies...");
resolveDependencies(modules, projectRoot);

// Store module info + relations
const insertMod = db.prepare(`
  INSERT OR REPLACE INTO modules (name, path, purpose, key_files, dependencies, depended_by, gotchas, file_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertRel = db.prepare(`
  INSERT OR REPLACE INTO relations (source, target, kind, details) VALUES (?, ?, ?, ?)
`);

db.run("BEGIN TRANSACTION");
for (const mod of modules) {
  // Compute depended_by
  const dependedBy = modules
    .filter((m) => m.dependencies.includes(mod.name))
    .map((m) => m.name);

  insertMod.bind([
    mod.name, mod.path, "", // purpose filled by LLM skill
    JSON.stringify(mod.files.slice(0, 10).map((f) => ({ file: f }))),
    JSON.stringify(mod.dependencies),
    JSON.stringify(dependedBy),
    "", // gotchas filled by LLM skill
    mod.fileCount
  ]);
  insertMod.step();
  insertMod.reset();

  for (const dep of mod.dependencies) {
    insertRel.bind([mod.name, dep, "depends_on", null]);
    insertRel.step();
    insertRel.reset();
  }
}
db.run("COMMIT");
insertMod.free();
insertRel.free();

// Step 4: Import wiki data if exists
const wikiDir = path.join(projectRoot, config.wiki.dir, "modules");
if (fs.existsSync(wikiDir)) {
  console.error("Step 4: Importing wiki data...");
  const wikiFiles = fs.readdirSync(wikiDir).filter((f) => f.endsWith(".md"));
  let wikiCount = 0;

  db.run("BEGIN TRANSACTION");
  for (const file of wikiFiles) {
    const name = file.replace(".md", "");
    const content = fs.readFileSync(path.join(wikiDir, file), "utf-8");
    const purpose = extractSection(content, "Purpose");
    const gotchas = extractSection(content, "Gotchas");

    if (purpose || gotchas) {
      db.run(
        `UPDATE modules SET purpose = ?, gotchas = ? WHERE name = ?`,
        [purpose, gotchas, name]
      );
      wikiCount++;
    }
  }
  db.run("COMMIT");
  console.error(`  → ${wikiCount} wiki pages imported`);
}

// Save metadata
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["built_at", new Date().toISOString()]);
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["project", config.name]);
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["file_count", String(totalFiles)]);
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["symbol_count", String(totalSymbols)]);
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["module_count", String(modules.length)]);

// Save to disk
saveDb(db, dbPath);
db.close();

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const sizeKB = Math.round(fs.statSync(dbPath).size / 1024);

console.error(`\ncode-brain: Done in ${elapsed}s`);
console.error(`  Index: ${dbPath} (${sizeKB}KB)`);
console.error(`  Files: ${totalFiles} | Symbols: ${totalSymbols} | Modules: ${modules.length}`);

/** Extract markdown section content */
function extractSection(content: string, heading: string): string {
  const regex = new RegExp(`^##\\s+${heading}\\b.*$`, "m");
  const match = content.match(regex);
  if (!match) return "";
  const startIdx = match.index! + match[0].length;
  const rest = content.slice(startIdx);
  const next = rest.search(/^##\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
