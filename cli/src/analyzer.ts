export interface ChangeCategory {
  type: "feature" | "bugfix" | "refactoring" | "breaking" | "documentation" | "test" | "config" | "other";
  confidence: number; // 0-1
  description: string;
}

export interface FileChange {
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
  categories: ChangeCategory[];
  linesAdded: number;
  linesDeleted: number;
}

export interface ChangeAnalysis {
  files: FileChange[];
  summary: {
    totalFiles: number;
    totalLinesAdded: number;
    totalLinesDeleted: number;
    categories: Record<string, number>;
  };
}

export class ChangeAnalyzer {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Analyze a diff string and categorize changes
   */
  public analyzeDiff(diff: string): ChangeAnalysis {
    const files: FileChange[] = [];
    const fileDiffs = this.parseDiffFiles(diff);

    for (const fileDiff of fileDiffs) {
      const categories = this.categorizeFileChanges(fileDiff);
      const stats = this.countLines(fileDiff.content);
      
      files.push({
        file: fileDiff.file,
        status: fileDiff.status,
        categories,
        linesAdded: stats.added,
        linesDeleted: stats.deleted,
      });
    }

    // Generate summary
    const summary = this.generateSummary(files);

    return { files, summary };
  }

  private parseDiffFiles(diff: string): Array<{ file: string; status: "added" | "modified" | "deleted" | "renamed"; content: string }> {
    const files: Array<{ file: string; status: "added" | "modified" | "deleted" | "renamed"; content: string }> = [];
    const lines = diff.split("\n");
    let currentFile: string | null = null;
    let currentStatus: "added" | "modified" | "deleted" | "renamed" = "modified";
    let currentContent: string[] = [];
    let inFileBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("diff --git")) {
        // Save previous file if exists
        if (currentFile && currentContent.length > 0) {
          files.push({
            file: currentFile,
            status: currentStatus,
            content: currentContent.join("\n"),
          });
        }

        // Extract file path
        const match = line.match(/diff --git a\/(.+?)\s+b\/(.+?)$/);
        if (match) {
          const oldPath = match[1];
          const newPath = match[2];
          currentFile = newPath !== "/dev/null" ? newPath : oldPath;
          currentStatus = oldPath === "/dev/null" ? "added" : newPath === "/dev/null" ? "deleted" : "modified";
          currentContent = [];
          inFileBlock = true;
        }
      } else if (line.startsWith("rename from") || line.startsWith("rename to")) {
        currentStatus = "renamed";
      } else if (inFileBlock && (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
        currentContent.push(line);
      } else if (inFileBlock && !line.startsWith("\\")) {
        // End of file block
        inFileBlock = false;
      }
    }

    // Save last file
    if (currentFile && currentContent.length > 0) {
      files.push({
        file: currentFile,
        status: currentStatus,
        content: currentContent.join("\n"),
      });
    }

    return files;
  }

  private categorizeFileChanges(fileDiff: { file: string; status: string; content: string }): ChangeCategory[] {
    const categories: ChangeCategory[] = [];
    const fileName = fileDiff.file.toLowerCase();
    const content = fileDiff.content.toLowerCase();

    // Test files
    if (fileName.includes("test") || fileName.includes("spec") || fileName.match(/\.(test|spec)\./)) {
      categories.push({
        type: "test",
        confidence: 0.9,
        description: "Test file changes",
      });
    }

    // Documentation files
    if (fileName.match(/\.(md|txt|rst)$/) || fileName.includes("readme") || fileName.includes("docs/") || fileName.includes("documentation")) {
      categories.push({
        type: "documentation",
        confidence: 0.9,
        description: "Documentation changes",
      });
    }

    // Configuration files
    if (fileName.match(/\.(json|yaml|yml|toml|ini|config|conf)$/) || 
        fileName.includes("package.json") || 
        fileName.includes("tsconfig") || 
        fileName.includes("webpack") ||
        fileName.includes(".env")) {
      categories.push({
        type: "config",
        confidence: 0.85,
        description: "Configuration file changes",
      });
    }

    // Analyze content patterns
    const addedLines = fileDiff.content.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).length;
    const deletedLines = fileDiff.content.split("\n").filter(l => l.startsWith("-") && !l.startsWith("---")).length;

    // Refactoring indicators
    if (addedLines > 0 && deletedLines > 0 && Math.abs(addedLines - deletedLines) < addedLines * 0.3) {
      // Similar number of additions and deletions suggests refactoring
      if (content.includes("function") || content.includes("class") || content.includes("export")) {
        categories.push({
          type: "refactoring",
          confidence: 0.7,
          description: "Possible refactoring (similar additions/deletions)",
        });
      }
    }

    // Feature addition (mostly additions)
    if (addedLines > deletedLines * 2 && addedLines > 10) {
      categories.push({
        type: "feature",
        confidence: 0.7,
        description: "Likely feature addition (significant new code)",
      });
    }

    // Bug fix (small changes, mostly deletions or small modifications)
    if (addedLines + deletedLines < 20 && deletedLines >= addedLines) {
      categories.push({
        type: "bugfix",
        confidence: 0.6,
        description: "Possible bug fix (small focused change)",
      });
    }

    // If no specific category found, mark as other
    if (categories.length === 0) {
      categories.push({
        type: "other",
        confidence: 0.5,
        description: "General changes",
      });
    }

    return categories;
  }

  private countLines(content: string): { added: number; deleted: number } {
    const lines = content.split("\n");
    let added = 0;
    let deleted = 0;

    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        added++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deleted++;
      }
    }

    return { added, deleted };
  }

  private generateSummary(files: FileChange[]): ChangeAnalysis["summary"] {
    const categories: Record<string, number> = {};
    let totalLinesAdded = 0;
    let totalLinesDeleted = 0;

    for (const file of files) {
      totalLinesAdded += file.linesAdded;
      totalLinesDeleted += file.linesDeleted;

      for (const category of file.categories) {
        categories[category.type] = (categories[category.type] || 0) + 1;
      }
    }

    return {
      totalFiles: files.length,
      totalLinesAdded,
      totalLinesDeleted,
      categories,
    };
  }
}

