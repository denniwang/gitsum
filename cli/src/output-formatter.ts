import { ChangeAnalysis } from "./analyzer";
import { APIAnalysis } from "./api-analyzer";
import { ImpactAnalysis } from "./impact-analyzer";

export type OutputMode = "compact" | "normal" | "verbose";

export interface OutputMetrics {
  fileCount: number;
  apiChangeCount: number;
  totalLinesChanged: number;
  hasBreakingChanges: boolean;
}

export interface StructuredOutput {
  summary: {
    totalFiles: number;
    totalLinesAdded: number;
    totalLinesDeleted: number;
    categories: Record<string, number>;
  };
  apiChanges?: {
    added: number;
    removed: number;
    modified: number;
    breaking: number;
    changes: Array<{
      type: string;
      name: string;
      file: string;
      change: string;
      severity?: string;
    }>;
  };
  breakingChanges?: Array<{
    type: string;
    name: string;
    file: string;
    severity: string;
  }>;
  impact?: {
    affectedFiles: number;
    affectedModules: string[];
    scope: string;
    importers: Array<{
      symbol: string;
      file: string;
      importers: string[];
    }>;
  };
  files: Array<{
    file: string;
    status: string;
    linesAdded: number;
    linesDeleted: number;
    categories: Array<{
      type: string;
      confidence: number;
      description: string;
    }>;
  }>;
}

export class OutputFormatter {
  /**
   * Determine output mode based on change metrics
   */
  public determineOutputMode(
    metrics: OutputMetrics,
    forceMode?: OutputMode
  ): OutputMode {
    if (forceMode) {
      return forceMode;
    }

    // Auto-detect based on size
    const { fileCount, apiChangeCount, totalLinesChanged, hasBreakingChanges } = metrics;

    // Small changes: default to compact mode (more aggressive threshold)
    // Default to compact for small file counts regardless of API changes
    if (fileCount <= 2 && totalLinesChanged <= 50) {
      return "compact";
    }

    // Large changes: verbose mode
    if (fileCount > 10 || apiChangeCount > 20 || totalLinesChanged > 100) {
      return "verbose";
    }

    // Medium changes: normal mode
    return "normal";
  }

  /**
   * Format analysis results as JSON
   */
  public formatJSON(
    changeAnalysis: ChangeAnalysis,
    apiAnalysis?: APIAnalysis,
    impactAnalysis?: ImpactAnalysis
  ): string {
    const output: StructuredOutput = {
      summary: changeAnalysis.summary,
      files: changeAnalysis.files.map(file => ({
        file: file.file,
        status: file.status,
        linesAdded: file.linesAdded,
        linesDeleted: file.linesDeleted,
        categories: file.categories.map(cat => ({
          type: cat.type,
          confidence: cat.confidence,
          description: cat.description,
        })),
      })),
    };

    if (apiAnalysis) {
      output.apiChanges = {
        added: apiAnalysis.summary.added,
        removed: apiAnalysis.summary.removed,
        modified: apiAnalysis.summary.modified,
        breaking: apiAnalysis.summary.breaking,
        changes: apiAnalysis.changes.map(change => ({
          type: change.type,
          name: change.name,
          file: change.file,
          change: change.change,
          severity: change.severity,
        })),
      };

      if (apiAnalysis.breakingChanges.length > 0) {
        output.breakingChanges = apiAnalysis.breakingChanges.map(change => ({
          type: change.type,
          name: change.name,
          file: change.file,
          severity: change.severity || "unknown",
        }));
      }
    }

    if (impactAnalysis) {
      output.impact = {
        affectedFiles: impactAnalysis.affectedFiles.length,
        affectedModules: impactAnalysis.affectedModules,
        scope: impactAnalysis.scope,
        importers: impactAnalysis.importers,
      };
    }

    return JSON.stringify(output, null, 2);
  }

  /**
   * Generate human-readable semantic summary
   */
  public generateSummary(
    changeAnalysis: ChangeAnalysis,
    apiAnalysis?: APIAnalysis,
    impactAnalysis?: ImpactAnalysis,
    mode: OutputMode = "normal"
  ): string {
    if (mode === "compact") {
      return this.generateCompactSummary(changeAnalysis, apiAnalysis, impactAnalysis);
    } else if (mode === "verbose") {
      return this.generateVerboseSummary(changeAnalysis, apiAnalysis, impactAnalysis);
    }
    return this.generateNormalSummary(changeAnalysis, apiAnalysis, impactAnalysis);
  }

  /**
   * Generate compact summary (minimal output for small changes)
   */
  private generateCompactSummary(
    changeAnalysis: ChangeAnalysis,
    apiAnalysis?: APIAnalysis,
    impactAnalysis?: ImpactAnalysis
  ): string {
    const lines: string[] = [];
    const summary = changeAnalysis.summary;

    // Minimal summary - skip if files changed is 0 (bug in analyzer)
    if (summary.totalFiles > 0 || summary.totalLinesAdded > 0 || summary.totalLinesDeleted > 0) {
      lines.push(`📊 ${summary.totalFiles || 1} file(s) changed, +${summary.totalLinesAdded}/-${summary.totalLinesDeleted} lines`);
    }

    // API changes summary only
    if (apiAnalysis && apiAnalysis.changes.length > 0) {
      const apiSummary = [];
      if (apiAnalysis.summary.added > 0) apiSummary.push(`+${apiAnalysis.summary.added}`);
      if (apiAnalysis.summary.removed > 0) apiSummary.push(`-${apiAnalysis.summary.removed}`);
      if (apiAnalysis.summary.modified > 0) apiSummary.push(`~${apiAnalysis.summary.modified}`);
      if (apiSummary.length > 0) {
        lines.push(`🔌 API: ${apiSummary.join(", ")}`);
      }
    }

    // Breaking changes (compact list)
    if (apiAnalysis && apiAnalysis.breakingChanges.length > 0) {
      const breakingList = apiAnalysis.breakingChanges
        .slice(0, 5)
        .map(c => `${c.name} (${c.file}${c.oldLineNumber ? `:${c.oldLineNumber}` : c.lineNumber ? `:${c.lineNumber}` : ""})`)
        .join(", ");
      lines.push(`⚠️  Breaking: ${breakingList}${apiAnalysis.breakingChanges.length > 5 ? ` +${apiAnalysis.breakingChanges.length - 5} more` : ""}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate normal summary (current behavior, but consolidated)
   */
  private generateNormalSummary(
    changeAnalysis: ChangeAnalysis,
    apiAnalysis?: APIAnalysis,
    impactAnalysis?: ImpactAnalysis
  ): string {
    const lines: string[] = [];
    const summary = changeAnalysis.summary;

    // Overall summary
    lines.push(`📊 Change Summary:`);
    lines.push(`  Files changed: ${summary.totalFiles}`);
    lines.push(`  Lines added: ${summary.totalLinesAdded}`);
    lines.push(`  Lines deleted: ${summary.totalLinesDeleted}`);

    // Categories
    if (Object.keys(summary.categories).length > 0) {
      lines.push(`\n📁 Change Categories:`);
      for (const [category, count] of Object.entries(summary.categories)) {
        lines.push(`  ${this.formatCategoryName(category)}: ${count} file(s)`);
      }
    }

    // API changes
    if (apiAnalysis && apiAnalysis.changes.length > 0) {
      lines.push(`\n🔌 API Changes:`);
      lines.push(`  Added: ${apiAnalysis.summary.added}`);
      lines.push(`  Removed: ${apiAnalysis.summary.removed}`);
      lines.push(`  Modified: ${apiAnalysis.summary.modified}`);
      
      // Show detailed API changes grouped by file (non-breaking only)
      const nonBreakingChanges = apiAnalysis.changes.filter(
        c => !apiAnalysis.breakingChanges.some(bc => 
          bc.name === c.name && bc.file === c.file && bc.type === c.type
        )
      );
      
      if (nonBreakingChanges.length > 0) {
        const changesByFile: Record<string, Array<{type: string, name: string, change: string, signature?: string, lineNumber?: number, oldLineNumber?: number}>> = {};
        nonBreakingChanges.forEach(change => {
          if (!changesByFile[change.file]) {
            changesByFile[change.file] = [];
          }
          changesByFile[change.file].push({
            type: change.type,
            name: change.name,
            change: change.change,
            signature: change.signature,
            lineNumber: change.lineNumber,
            oldLineNumber: change.oldLineNumber
          });
        });
        
        lines.push(`\n  Detailed Changes:`);
        for (const [file, changes] of Object.entries(changesByFile).slice(0, 10)) {
          lines.push(`    ${file}:`);
          changes.forEach(change => {
            const changeIcon = change.change === "added" ? "+" : change.change === "removed" ? "-" : "~";
            const changeLabel = change.change === "added" ? "Added" : change.change === "removed" ? "Removed" : "Modified";
            const lineInfo = change.lineNumber 
              ? ` (line ${change.lineNumber})`
              : change.oldLineNumber 
              ? ` (was line ${change.oldLineNumber})`
              : "";
            lines.push(`      ${changeIcon} ${changeLabel} ${change.type} ${change.name}${lineInfo}`);
            if (change.signature) {
              lines.push(`        Signature: ${change.signature}`);
            }
          });
        }
        if (Object.keys(changesByFile).length > 10) {
          lines.push(`    ... and ${Object.keys(changesByFile).length - 10} more file(s)`);
        }
      }
      
      // Breaking changes (consolidated - only show once)
      if (apiAnalysis.breakingChanges.length > 0) {
        lines.push(`\n⚠️  Breaking Changes (${apiAnalysis.breakingChanges.length}):`);
        for (const change of apiAnalysis.breakingChanges.slice(0, 10)) {
          const severity = change.severity || "unknown";
          const lineInfo = change.lineNumber 
            ? ` (line ${change.lineNumber})`
            : change.oldLineNumber 
            ? ` (was line ${change.oldLineNumber})`
            : "";
          lines.push(`  [${severity.toUpperCase()}] ${change.type} ${change.name}${lineInfo}`);
          lines.push(`    File: ${change.file}`);
          if (change.signature) {
            lines.push(`    Signature: ${change.signature}`);
          }
        }
        if (apiAnalysis.breakingChanges.length > 10) {
          lines.push(`  ... and ${apiAnalysis.breakingChanges.length - 10} more`);
        }
      }
    }

    // Impact analysis
    if (impactAnalysis && impactAnalysis.affectedFiles.length > 0) {
      lines.push(`\n📈 Impact Analysis:`);
      lines.push(`  Affected files: ${impactAnalysis.affectedFiles.length}`);
      lines.push(`  Scope: ${impactAnalysis.scope}`);
      if (impactAnalysis.affectedModules.length > 0) {
        lines.push(`  Affected modules: ${impactAnalysis.affectedModules.join(", ")}`);
      }
      
      if (impactAnalysis.importers.length > 0) {
        lines.push(`\n  Files using changed symbols:`);
        for (const importer of impactAnalysis.importers.slice(0, 5)) {
          lines.push(`    ${importer.symbol} (${importer.importers.length} file(s))`);
        }
        if (impactAnalysis.importers.length > 5) {
          lines.push(`    ... and ${impactAnalysis.importers.length - 5} more`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate verbose summary (full details)
   */
  private generateVerboseSummary(
    changeAnalysis: ChangeAnalysis,
    apiAnalysis?: APIAnalysis,
    impactAnalysis?: ImpactAnalysis
  ): string {
    // Verbose mode shows everything, including all signatures and details
    const lines: string[] = [];
    const summary = changeAnalysis.summary;

    // Overall summary
    lines.push(`📊 Change Summary:`);
    lines.push(`  Files changed: ${summary.totalFiles}`);
    lines.push(`  Lines added: ${summary.totalLinesAdded}`);
    lines.push(`  Lines deleted: ${summary.totalLinesDeleted}`);

    // Categories
    if (Object.keys(summary.categories).length > 0) {
      lines.push(`\n📁 Change Categories:`);
      for (const [category, count] of Object.entries(summary.categories)) {
        lines.push(`  ${this.formatCategoryName(category)}: ${count} file(s)`);
      }
    }

    // API changes - show ALL with full details
    if (apiAnalysis && apiAnalysis.changes.length > 0) {
      lines.push(`\n🔌 API Changes:`);
      lines.push(`  Added: ${apiAnalysis.summary.added}`);
      lines.push(`  Removed: ${apiAnalysis.summary.removed}`);
      lines.push(`  Modified: ${apiAnalysis.summary.modified}`);
      
      const changesByFile: Record<string, Array<{type: string, name: string, change: string, signature?: string, lineNumber?: number, oldLineNumber?: number}>> = {};
      apiAnalysis.changes.forEach(change => {
        if (!changesByFile[change.file]) {
          changesByFile[change.file] = [];
        }
        changesByFile[change.file].push({
          type: change.type,
          name: change.name,
          change: change.change,
          signature: change.signature,
          lineNumber: change.lineNumber,
          oldLineNumber: change.oldLineNumber
        });
      });
      
      lines.push(`\n  Detailed Changes:`);
      for (const [file, changes] of Object.entries(changesByFile)) {
        lines.push(`    ${file}:`);
        changes.forEach(change => {
          const changeIcon = change.change === "added" ? "+" : change.change === "removed" ? "-" : "~";
          const changeLabel = change.change === "added" ? "Added" : change.change === "removed" ? "Removed" : "Modified";
          const lineInfo = change.lineNumber 
            ? ` (line ${change.lineNumber})`
            : change.oldLineNumber 
            ? ` (was line ${change.oldLineNumber})`
            : "";
          lines.push(`      ${changeIcon} ${changeLabel} ${change.type} ${change.name}${lineInfo}`);
          if (change.signature) {
            lines.push(`        Signature: ${change.signature}`);
          }
        });
      }
      
      // Breaking changes with full details
      if (apiAnalysis.breakingChanges.length > 0) {
        lines.push(`\n⚠️  Breaking Changes (${apiAnalysis.breakingChanges.length}):`);
        for (const change of apiAnalysis.breakingChanges) {
          const severity = change.severity || "unknown";
          const lineInfo = change.lineNumber 
            ? ` (line ${change.lineNumber})`
            : change.oldLineNumber 
            ? ` (was line ${change.oldLineNumber})`
            : "";
          lines.push(`  [${severity.toUpperCase()}] ${change.type} ${change.name}${lineInfo}`);
          lines.push(`    File: ${change.file}`);
          if (change.signature) {
            lines.push(`    Signature: ${change.signature}`);
          }
        }
      }
    }

    // Impact analysis - full details
    if (impactAnalysis && impactAnalysis.affectedFiles.length > 0) {
      lines.push(`\n📈 Impact Analysis:`);
      lines.push(`  Affected files: ${impactAnalysis.affectedFiles.length}`);
      lines.push(`  Scope: ${impactAnalysis.scope}`);
      if (impactAnalysis.affectedModules.length > 0) {
        lines.push(`  Affected modules: ${impactAnalysis.affectedModules.join(", ")}`);
      }
      
      if (impactAnalysis.importers.length > 0) {
        lines.push(`\n  Files using changed symbols:`);
        for (const importer of impactAnalysis.importers) {
          lines.push(`    ${importer.symbol} (${importer.importers.length} file(s))`);
          importer.importers.forEach(file => {
            lines.push(`      - ${file}`);
          });
        }
      }
    }

    return lines.join("\n");
  }

  private formatCategoryName(category: string): string {
    const names: Record<string, string> = {
      feature: "Features",
      bugfix: "Bug Fixes",
      refactoring: "Refactoring",
      breaking: "Breaking Changes",
      documentation: "Documentation",
      test: "Tests",
      config: "Configuration",
      other: "Other",
    };
    return names[category] || category;
  }
}

