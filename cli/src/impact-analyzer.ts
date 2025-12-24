import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { APIChange } from "./api-analyzer";

export interface ImpactAnalysis {
  affectedFiles: string[];
  affectedModules: string[];
  scope: "local" | "widespread";
  importers: Array<{
    symbol: string;
    file: string;
    importers: string[];
  }>;
}

export class ImpactAnalyzer {
  private cwd: string;
  private importCache: Map<string, Array<{ name: string; from: string }>> = new Map();

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Analyze the impact of API changes
   */
  public analyzeImpact(apiChanges: APIChange[]): ImpactAnalysis {
    const affectedFiles = new Set<string>();
    const affectedModules = new Set<string>();
    const importers: ImpactAnalysis["importers"] = [];

    // Find files that import/use the changed symbols
    for (const change of apiChanges) {
      if (change.change === "removed" || change.change === "modified") {
        const filesUsingSymbol = this.findFilesUsingSymbol(change.name, change.file);
        filesUsingSymbol.forEach(file => affectedFiles.add(file));
        
        // Extract module from file path
        const module = this.extractModule(change.file);
        if (module) {
          affectedModules.add(module);
        }

        if (filesUsingSymbol.length > 0) {
          importers.push({
            symbol: change.name,
            file: change.file,
            importers: filesUsingSymbol,
          });
        }
      }
    }

    // Determine scope
    const scope: "local" | "widespread" = affectedFiles.size > 10 ? "widespread" : "local";

    return {
      affectedFiles: Array.from(affectedFiles),
      affectedModules: Array.from(affectedModules),
      scope,
      importers,
    };
  }

  private findFilesUsingSymbol(symbol: string, sourceFile: string): string[] {
    const files: string[] = [];
    const allFiles = this.getAllCodeFiles();

    for (const file of allFiles) {
      if (file === sourceFile) continue; // Skip the source file itself

      try {
        const imports = this.getImports(file);
        const usesSymbol = imports.some(imp => 
          imp.name === symbol || 
          imp.name === "*" || 
          this.fileExportsSymbol(sourceFile, symbol)
        );

        if (usesSymbol) {
          files.push(file);
        } else {
          // Also check if the file directly references the symbol
          const content = readFileSync(file, "utf-8");
          // Simple check - look for the symbol being used
          const symbolRegex = new RegExp(`\\b${symbol}\\b`);
          if (symbolRegex.test(content) && !content.includes(`export.*${symbol}`)) {
            files.push(file);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return files;
  }

  private getAllCodeFiles(): string[] {
    try {
      const result = execSync("git ls-files", {
        cwd: this.cwd,
        encoding: "utf-8",
      });
      
      return result
        .split("\n")
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"].includes(ext);
        })
        .filter(file => existsSync(path.join(this.cwd, file)));
    } catch {
      return [];
    }
  }

  private getImports(filePath: string): Array<{ name: string; from: string }> {
    if (this.importCache.has(filePath)) {
      return this.importCache.get(filePath)!;
    }

    const imports: Array<{ name: string; from: string }> = [];
    
    try {
      const content = readFileSync(path.join(this.cwd, filePath), "utf-8");
      
      // import { name } from 'module'
      const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = namedImportRegex.exec(content)) !== null) {
        const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
        const from = match[2];
        names.forEach(name => {
          if (name && name !== "type") imports.push({ name, from });
        });
      }

      // import name from 'module'
      const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
      while ((match = defaultImportRegex.exec(content)) !== null) {
        imports.push({ name: match[1], from: match[2] });
      }

      // import * as name from 'module'
      const namespaceImportRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
      while ((match = namespaceImportRegex.exec(content)) !== null) {
        imports.push({ name: "*", from: match[2] });
      }
    } catch {
      // File can't be read
    }

    this.importCache.set(filePath, imports);
    return imports;
  }

  private fileExportsSymbol(filePath: string, symbol: string): boolean {
    try {
      const content = readFileSync(path.join(this.cwd, filePath), "utf-8");
      // Check if file exports the symbol
      const exportRegex = new RegExp(`export\\s+(?:.*\\s+)?${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b`);
      return exportRegex.test(content);
    } catch {
      return false;
    }
  }

  private extractModule(filePath: string): string | null {
    // Extract module name from path (e.g., src/utils -> utils, packages/foo -> foo)
    const parts = filePath.split(path.sep);
    
    // Look for common module indicators
    if (parts.includes("packages")) {
      const index = parts.indexOf("packages");
      return parts[index + 1] || null;
    }
    if (parts.includes("src")) {
      const index = parts.indexOf("src");
      return parts[index + 1] || null;
    }
    
    // Return first directory level
    return parts.length > 1 ? parts[0] : null;
  }
}

