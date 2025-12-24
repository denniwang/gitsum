export interface APIChange {
  type: "function" | "class" | "export" | "import" | "type" | "interface";
  name: string;
  file: string;
  change: "added" | "removed" | "modified";
  signature?: string;
  severity?: "critical" | "major" | "minor";
  lineNumber?: number; // Line number in the new file (for added/modified) or old file (for removed)
  oldLineNumber?: number; // Line number in the old file (for removed/modified)
}

export interface APIAnalysis {
  changes: APIChange[];
  breakingChanges: APIChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    breaking: number;
  };
}

export class APIAnalyzer {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Analyze diff for API changes
   */
  public analyzeAPIChanges(diff: string): APIAnalysis {
    const changes: APIChange[] = [];
    const fileDiffs = this.parseDiffFiles(diff);

    for (const fileDiff of fileDiffs) {
      const fileChanges = this.analyzeFileAPI(fileDiff);
      changes.push(...fileChanges);
    }

    const breakingChanges = this.identifyBreakingChanges(changes);

    return {
      changes,
      breakingChanges,
      summary: {
        added: changes.filter((c) => c.change === "added").length,
        removed: changes.filter((c) => c.change === "removed").length,
        modified: changes.filter((c) => c.change === "modified").length,
        breaking: breakingChanges.length,
      },
    };
  }

  private parseDiffFiles(
    diff: string
  ): Array<{
    file: string;
    oldContent: string;
    newContent: string;
    lineMap: Map<string, { oldLine?: number; newLine?: number }>;
  }> {
    const files: Array<{
      file: string;
      oldContent: string;
      newContent: string;
      lineMap: Map<string, { oldLine?: number; newLine?: number }>;
    }> = [];
    const lines = diff.split("\n");
    let currentFile: string | null = null;
    let oldContent: string[] = [];
    let newContent: string[] = [];
    let lineMap = new Map<string, { oldLine?: number; newLine?: number }>();
    let inFileBlock = false;
    let inHunk = false;
    let currentOldLine = 0;
    let currentNewLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("diff --git")) {
        // Save previous file
        if (currentFile) {
          files.push({
            file: currentFile,
            oldContent: oldContent.join("\n"),
            newContent: newContent.join("\n"),
            lineMap: lineMap,
          });
        }

        const match = line.match(/diff --git a\/(.+?)\s+b\/(.+?)$/);
        if (match) {
          const newPath = match[2];
          currentFile = newPath !== "/dev/null" ? newPath : match[1];
          oldContent = [];
          newContent = [];
          lineMap = new Map();
          inFileBlock = true;
          currentOldLine = 0;
          currentNewLine = 0;
        }
      } else if (line.startsWith("@@")) {
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const hunkMatch = line.match(
          /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
        );
        if (hunkMatch) {
          currentOldLine = parseInt(hunkMatch[1]) - 1; // -1 because we'll increment before using
          currentNewLine = parseInt(hunkMatch[3]) - 1;
          inHunk = true;
        }
      } else if (inFileBlock && inHunk) {
        if (line.startsWith("-") && !line.startsWith("---")) {
          currentOldLine++;
          const content = line.substring(1);
          oldContent.push(content);
          // Store line number for this content
          const key = `old:${oldContent.length - 1}`;
          lineMap.set(key, { oldLine: currentOldLine });
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
          currentNewLine++;
          const content = line.substring(1);
          newContent.push(content);
          // Store line number for this content
          const key = `new:${newContent.length - 1}`;
          lineMap.set(key, { newLine: currentNewLine });
        } else if (line.startsWith(" ") || line.match(/^[^+\-@]/)) {
          // Context line - add to both and increment both
          currentOldLine++;
          currentNewLine++;
          const context = line.startsWith(" ") ? line.substring(1) : line;
          oldContent.push(context);
          newContent.push(context);
        }
      }
    }

    // Save last file
    if (currentFile) {
      files.push({
        file: currentFile,
        oldContent: oldContent.join("\n"),
        newContent: newContent.join("\n"),
        lineMap: lineMap,
      });
    }

    return files;
  }

  private analyzeFileAPI(fileDiff: {
    file: string;
    oldContent: string;
    newContent: string;
    lineMap: Map<string, { oldLine?: number; newLine?: number }>;
  }): APIChange[] {
    const changes: APIChange[] = [];
    const ext = this.getFileExtension(fileDiff.file);

    // Only analyze code files
    if (!["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext)) {
      return changes;
    }

    // Extract exports from old and new content with line numbers
    const oldExports = this.extractExportsWithLines(
      fileDiff.oldContent,
      fileDiff.lineMap,
      "old"
    );
    const newExports = this.extractExportsWithLines(
      fileDiff.newContent,
      fileDiff.lineMap,
      "new"
    );
    const oldFunctions = this.extractFunctionsWithLines(
      fileDiff.oldContent,
      fileDiff.lineMap,
      "old"
    );
    const newFunctions = this.extractFunctionsWithLines(
      fileDiff.newContent,
      fileDiff.lineMap,
      "new"
    );
    const oldClasses = this.extractClassesWithLines(
      fileDiff.oldContent,
      fileDiff.lineMap,
      "old"
    );
    const newClasses = this.extractClassesWithLines(
      fileDiff.newContent,
      fileDiff.lineMap,
      "new"
    );
    const oldImports = this.extractImports(fileDiff.oldContent);
    const newImports = this.extractImports(fileDiff.newContent);

    // Find removed exports
    for (const oldExport of oldExports) {
      if (!newExports.find((e) => e.name === oldExport.name)) {
        changes.push({
          type: "export",
          name: oldExport.name,
          file: fileDiff.file,
          change: "removed",
          signature: oldExport.signature,
          oldLineNumber: oldExport.lineNumber,
        });
      }
    }

    // Find added exports
    for (const newExport of newExports) {
      if (!oldExports.find((e) => e.name === newExport.name)) {
        changes.push({
          type: "export",
          name: newExport.name,
          file: fileDiff.file,
          change: "added",
          signature: newExport.signature,
          lineNumber: newExport.lineNumber,
        });
      }
    }

    // Find modified exports (same name, different signature)
    for (const oldExport of oldExports) {
      const newExport = newExports.find((e) => e.name === oldExport.name);
      if (newExport && oldExport.signature !== newExport.signature) {
        changes.push({
          type: "export",
          name: oldExport.name,
          file: fileDiff.file,
          change: "modified",
          signature: newExport.signature,
          oldLineNumber: oldExport.lineNumber,
          lineNumber: newExport.lineNumber,
        });
      }
    }

    // Find removed functions
    for (const oldFunc of oldFunctions) {
      if (
        !newFunctions.find(
          (f) => f.name === oldFunc.name && f.signature === oldFunc.signature
        )
      ) {
        changes.push({
          type: "function",
          name: oldFunc.name,
          file: fileDiff.file,
          change: "removed",
          signature: oldFunc.signature,
          oldLineNumber: oldFunc.lineNumber,
        });
      }
    }

    // Find added functions
    for (const newFunc of newFunctions) {
      if (
        !oldFunctions.find(
          (f) => f.name === newFunc.name && f.signature === newFunc.signature
        )
      ) {
        changes.push({
          type: "function",
          name: newFunc.name,
          file: fileDiff.file,
          change: "added",
          signature: newFunc.signature,
          lineNumber: newFunc.lineNumber,
        });
      }
    }

    // Find removed classes
    for (const oldClass of oldClasses) {
      if (!newClasses.find((c) => c.name === oldClass.name)) {
        changes.push({
          type: "class",
          name: oldClass.name,
          file: fileDiff.file,
          change: "removed",
          oldLineNumber: oldClass.lineNumber,
        });
      }
    }

    // Find added classes
    for (const newClass of newClasses) {
      if (!oldClasses.find((c) => c.name === newClass.name)) {
        changes.push({
          type: "class",
          name: newClass.name,
          file: fileDiff.file,
          change: "added",
          lineNumber: newClass.lineNumber,
        });
      }
    }

    // Find removed imports
    for (const oldImport of oldImports) {
      if (
        !newImports.find(
          (i) => i.name === oldImport.name && i.from === oldImport.from
        )
      ) {
        changes.push({
          type: "import",
          name: oldImport.name,
          file: fileDiff.file,
          change: "removed",
        });
      }
    }

    return changes;
  }

  private extractExports(
    content: string
  ): Array<{ name: string; signature?: string }> {
    const exports: Array<{ name: string; signature?: string }> = [];

    // export function/const/class/interface/type
    const exportRegex =
      /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push({ name: match[1] });
    }

    // export { name }
    const namedExportRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const names = match[1].split(",").map((n) => n.trim().split(/\s+/)[0]);
      names.forEach((name) => {
        if (name) exports.push({ name });
      });
    }

    // export default
    const defaultExportRegex =
      /export\s+default\s+(?:function|class|const|let|var)?\s*(\w+)/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      exports.push({ name: match[1] || "default" });
    }

    return exports;
  }

  private extractExportsWithLines(
    content: string,
    lineMap: Map<string, { oldLine?: number; newLine?: number }>,
    type: "old" | "new"
  ): Array<{ name: string; signature?: string; lineNumber?: number }> {
    const exports: Array<{
      name: string;
      signature?: string;
      lineNumber?: number;
    }> = [];
    const lines = content.split("\n");

    // export function/const/class/interface/type
    const exportRegex =
      /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+(\w+)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      exportRegex.lastIndex = 0; // Reset regex
      while ((match = exportRegex.exec(line)) !== null) {
        const lineInfo = lineMap.get(`${type}:${i}`);
        exports.push({
          name: match[1],
          lineNumber: type === "old" ? lineInfo?.oldLine : lineInfo?.newLine,
        });
      }
    }

    // export { name }
    const namedExportRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      namedExportRegex.lastIndex = 0;
      while ((match = namedExportRegex.exec(line)) !== null) {
        const names = match[1].split(",").map((n) => n.trim().split(/\s+/)[0]);
        const lineInfo = lineMap.get(`${type}:${i}`);
        names.forEach((name) => {
          if (name)
            exports.push({
              name,
              lineNumber:
                type === "old" ? lineInfo?.oldLine : lineInfo?.newLine,
            });
        });
      }
    }

    // export default
    const defaultExportRegex =
      /export\s+default\s+(?:function|class|const|let|var)?\s*(\w+)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      defaultExportRegex.lastIndex = 0;
      while ((match = defaultExportRegex.exec(line)) !== null) {
        const lineInfo = lineMap.get(`${type}:${i}`);
        exports.push({
          name: match[1] || "default",
          lineNumber: type === "old" ? lineInfo?.oldLine : lineInfo?.newLine,
        });
      }
    }

    return exports;
  }

  private extractFunctions(
    content: string
  ): Array<{ name: string; signature: string }> {
    const functions: Array<{ name: string; signature: string }> = [];

    // function name(...) or const name = (...) =>
    const functionRegex =
      /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\([^)]*\)|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1] || match[2];
      if (name) {
        // Try to extract full signature
        const lineStart = content.lastIndexOf("\n", match.index) + 1;
        const lineEnd = content.indexOf("\n", match.index);
        const line = content.substring(
          lineStart,
          lineEnd > 0 ? lineEnd : content.length
        );
        functions.push({ name, signature: line.trim() });
      }
    }

    return functions;
  }

  private extractFunctionsWithLines(
    content: string,
    lineMap: Map<string, { oldLine?: number; newLine?: number }>,
    type: "old" | "new"
  ): Array<{ name: string; signature: string; lineNumber?: number }> {
    const functions: Array<{
      name: string;
      signature: string;
      lineNumber?: number;
    }> = [];
    const lines = content.split("\n");

    // function name(...) or const name = (...) =>
    const functionRegex =
      /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\([^)]*\)|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      functionRegex.lastIndex = 0;
      while ((match = functionRegex.exec(line)) !== null) {
        const name = match[1] || match[2];
        if (name) {
          const lineInfo = lineMap.get(`${type}:${i}`);
          functions.push({
            name,
            signature: line.trim(),
            lineNumber: type === "old" ? lineInfo?.oldLine : lineInfo?.newLine,
          });
        }
      }
    }

    return functions;
  }

  private extractClasses(content: string): Array<{ name: string }> {
    const classes: Array<{ name: string }> = [];

    const classRegex = /(?:export\s+)?class\s+(\w+)/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push({ name: match[1] });
    }

    return classes;
  }

  private extractClassesWithLines(
    content: string,
    lineMap: Map<string, { oldLine?: number; newLine?: number }>,
    type: "old" | "new"
  ): Array<{ name: string; lineNumber?: number }> {
    const classes: Array<{ name: string; lineNumber?: number }> = [];
    const lines = content.split("\n");

    const classRegex = /(?:export\s+)?class\s+(\w+)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      classRegex.lastIndex = 0;
      while ((match = classRegex.exec(line)) !== null) {
        const lineInfo = lineMap.get(`${type}:${i}`);
        classes.push({
          name: match[1],
          lineNumber: type === "old" ? lineInfo?.oldLine : lineInfo?.newLine,
        });
      }
    }

    return classes;
  }

  private extractImports(
    content: string
  ): Array<{ name: string; from: string }> {
    const imports: Array<{ name: string; from: string }> = [];

    // import { name } from 'module'
    const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = namedImportRegex.exec(content)) !== null) {
      const names = match[1].split(",").map((n) => n.trim().split(/\s+/)[0]);
      const from = match[2];
      names.forEach((name) => {
        if (name) imports.push({ name, from });
      });
    }

    // import name from 'module'
    const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = defaultImportRegex.exec(content)) !== null) {
      imports.push({ name: match[1], from: match[2] });
    }

    return imports;
  }

  private identifyBreakingChanges(changes: APIChange[]): APIChange[] {
    const breaking: APIChange[] = [];

    for (const change of changes) {
      // Removed exports are breaking
      if (
        change.change === "removed" &&
        (change.type === "export" ||
          change.type === "function" ||
          change.type === "class")
      ) {
        change.severity = "critical";
        breaking.push(change);
      }
      // Modified function signatures are breaking
      else if (change.change === "modified" && change.type === "function") {
        change.severity = "major";
        breaking.push(change);
      }
      // Modified exports might be breaking
      else if (change.change === "modified" && change.type === "export") {
        change.severity = "major";
        breaking.push(change);
      }
    }

    return breaking;
  }

  private getFileExtension(filename: string): string {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  }
}
