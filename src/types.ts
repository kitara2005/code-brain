export interface Symbol {
  name: string;
  kind: "class" | "function" | "method" | "interface" | "type" | "constant";
  file: string;
  line_start: number;
  line_end?: number;
  signature?: string;
  module?: string;
  scope?: string;
}

export interface ModuleInfo {
  name: string;
  path: string;
  fileCount: number;
  files: string[];
  symbols: Symbol[];
  dependencies: string[];
}

export interface WikiModule {
  name: string;
  path: string;
  purpose: string;
  key_files: string;
  dependencies: string;
  depended_by: string;
  gotchas: string;
  file_count: number;
}

export interface Relation {
  source: string;
  target: string;
  kind: string;
  details?: string;
}
