#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import pkg from "../package.json";
import { ChangeAnalyzer } from "./analyzer";
import { APIAnalyzer } from "./api-analyzer";
import { ImpactAnalyzer } from "./impact-analyzer";
import { OutputFormatter, OutputMode, OutputMetrics } from "./output-formatter";

const program = new Command();

interface GitDiffOptions {
  staged?: boolean;
  unstaged?: boolean;
  all?: boolean;
  branch?: string;
  commit?: string;
  file?: string;
  context?: number;
  color?: boolean;
  wordDiff?: boolean;
  json?: boolean;
  semantic?: boolean;
  breakingChanges?: boolean;
  impact?: boolean;
}

interface BranchCompareOptions {
  baseBranch?: string;
  compareBranch?: string;
  summary?: boolean;
  context?: number;
  color?: boolean;
  file?: string;
  json?: boolean;
  semantic?: boolean;
  breakingChanges?: boolean;
  impact?: boolean;
  compact?: boolean;
  verbose?: boolean;
  noDiff?: boolean;
  diffOnly?: boolean;
}

class GitDiffChecker {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  private isGitRepository(): boolean {
    return existsSync(path.join(this.cwd, ".git"));
  }

  private executeGitCommand(command: string): string {
    try {
      return execSync(command, {
        cwd: this.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024 * 50,
        env: { ...process.env, GIT_PAGER: "cat" },
      });
    } catch (error: any) {
      const stderr = error && error.stderr ? String(error.stderr) : "";
      const stdout = error && error.stdout ? String(error.stdout) : "";
      const message =
        `Git command failed: ${command}` +
        (stderr || stdout ? `\n${stderr || stdout}` : "");
      throw new Error(message);
    }
  }

  private getGitStatus(): string[] {
    const status = this.executeGitCommand("git status --porcelain");
    const lines = status
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    // Filter out files that are ignored by git
    return lines.filter((line) => {
      const filename = line.substring(3);
      try {
        // Check if file is ignored - if check-ignore returns the path, it's ignored
        const result = execSync(`git check-ignore "${filename}"`, {
          cwd: this.cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        // If check-ignore returns something, the file is ignored
        return false;
      } catch {
        // If check-ignore fails (no match), the file is not ignored
        return true;
      }
    });
  }

  private isPathIgnored(filepath: string): boolean {
    try {
      execSync(`git check-ignore "${filepath}"`, {
        cwd: this.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return true; // File is ignored
    } catch {
      return false; // File is not ignored
    }
  }

  private filterIgnoredFilesFromDiff(diff: string): string {
    const lines = diff.split("\n");
    const filtered: string[] = [];
    let skipCurrentFile = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect file header - extract file path from "diff --git a/path b/path"
      if (line.startsWith("diff --git")) {
        // Try to extract the "b" path (destination/new file)
        // Format: "diff --git a/path b/path" or "diff --git a/path b/dev/null" (deleted)
        const match = line.match(/diff --git a\/(.+?)\s+b\/(.+?)$/);
        if (match) {
          const oldPath = match[1];
          const newPath = match[2];
          // Use new path if not /dev/null, otherwise use old path
          const filePath = newPath !== "/dev/null" ? newPath : oldPath;
          skipCurrentFile = this.isPathIgnored(filePath);

          // If file is ignored, skip this entire file block
          if (skipCurrentFile) {
            // Skip until next "diff --git" line
            i++;
            while (i < lines.length && !lines[i].startsWith("diff --git")) {
              i++;
            }
            i--; // Adjust for loop increment
            continue;
          }
        }
      }

      // Skip lines if current file is ignored (shouldn't reach here due to above logic, but safety check)
      if (skipCurrentFile) {
        continue;
      }

      filtered.push(line);
    }

    return filtered.join("\n");
  }

  private formatDiffOutput(diff: string, options: GitDiffOptions): string {
    // First filter out ignored files
    let filteredDiff = this.filterIgnoredFilesFromDiff(diff);

    if (!options.color) {
      return filteredDiff;
    }

    return filteredDiff
      .split("\n")
      .map((line) => {
        if (line.startsWith("+")) {
          return chalk.green(line);
        } else if (line.startsWith("-")) {
          return chalk.red(line);
        } else if (line.startsWith("@@")) {
          return chalk.blue(line);
        } else if (line.startsWith("diff --git")) {
          return chalk.yellow(line);
        } else if (line.startsWith("index")) {
          return chalk.gray(line);
        }
        return line;
      })
      .join("\n");
  }

  public async checkDiff(options: GitDiffOptions): Promise<void> {
    const spinner = ora("Checking git diff...").start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail("Not a git repository");
        console.log(
          chalk.red("Error: Current directory is not a git repository")
        );
        return;
      }

      spinner.text = "Analyzing repository...";

      let diffCommand = "git diff";
      let description = "Working directory changes";

      // Build the diff command based on options
      if (options.staged) {
        diffCommand = "git diff --cached";
        description = "Staged changes";
      } else if (options.unstaged) {
        diffCommand = "git diff";
        description = "Unstaged changes";
      } else if (options.all) {
        diffCommand = "git diff HEAD";
        description = "All changes (staged + unstaged)";
      } else if (options.branch) {
        const currentBranch = this.executeGitCommand(
          "git branch --show-current"
        ).trim();
        if (!this.branchExists(options.branch)) {
          spinner.fail(`Branch not found: ${options.branch}`);
          console.log(
            chalk.red(`Error: Branch "${options.branch}" does not exist`)
          );
          return;
        }
        diffCommand = `git diff ${options.branch}`;
        description = `Changes in ${currentBranch} compared to ${options.branch}`;
      } else if (options.commit) {
        diffCommand = `git diff ${options.commit}`;
        description = `Changes compared to ${options.commit}`;
      }

      // Add context lines
      if (options.context !== undefined) {
        diffCommand += ` -U${options.context}`;
      }

      // Add word diff
      if (options.wordDiff) {
        diffCommand += " --word-diff=color";
      }

      // Exclude ignored files and submodules
      diffCommand += " --ignore-submodules=all";

      // Add file filter
      if (options.file) {
        diffCommand += ` -- ${options.file}`;
      }

      spinner.text = "Generating diff...";

      const diff = this.executeGitCommand(diffCommand);

      // Perform semantic analysis if requested
      let changeAnalysis;
      let apiAnalysis;
      let impactAnalysis;

      if (
        options.semantic ||
        options.breakingChanges ||
        options.impact ||
        options.json
      ) {
        spinner.text = "Analyzing changes...";
        const changeAnalyzer = new ChangeAnalyzer(this.cwd);
        changeAnalysis = changeAnalyzer.analyzeDiff(diff);

        if (
          options.semantic ||
          options.breakingChanges ||
          options.impact ||
          options.json
        ) {
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);

          if (options.impact || options.json) {
            const impactAnalyzer = new ImpactAnalyzer(this.cwd);
            impactAnalysis = impactAnalyzer.analyzeImpact(apiAnalysis.changes);
          }
        }
      }

      spinner.succeed("Diff generated successfully");

      // Show branch comparison header if comparing with a branch
      if (options.branch) {
        const currentBranch = this.executeGitCommand(
          "git branch --show-current"
        ).trim();
        console.log(chalk.bold("\n🔀 Branch Comparison:\n"));
        console.log(
          chalk.cyan(`  Current Branch: ${chalk.bold(currentBranch)}`)
        );
        console.log(
          chalk.magenta(`  Compare With:   ${chalk.bold(options.branch)}\n`)
        );

        // Show commit counts
        try {
          const ahead = this.executeGitCommand(
            `git rev-list --count ${options.branch}..HEAD`
          ).trim();
          const behind = this.executeGitCommand(
            `git rev-list --count HEAD..${options.branch}`
          ).trim();
          const aheadNum = parseInt(ahead) || 0;
          const behindNum = parseInt(behind) || 0;

          if (aheadNum > 0 || behindNum > 0) {
            console.log(chalk.bold("📊 Commit Statistics:"));
            if (aheadNum > 0) {
              console.log(
                chalk.green(
                  `  ${currentBranch} is ${aheadNum} commit(s) ahead of ${options.branch}`
                )
              );
            }
            if (behindNum > 0) {
              console.log(
                chalk.yellow(
                  `  ${currentBranch} is ${behindNum} commit(s) behind ${options.branch}`
                )
              );
            }
            console.log();
          }
        } catch {
          // Ignore errors in commit counting
        }
      }

      // Handle JSON output
      if (options.json) {
        if (!changeAnalysis) {
          // Need to run analysis for JSON output
          spinner.text = "Analyzing changes...";
          const changeAnalyzer = new ChangeAnalyzer(this.cwd);
          changeAnalysis = changeAnalyzer.analyzeDiff(diff);
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);
          if (options.impact) {
            const impactAnalyzer = new ImpactAnalyzer(this.cwd);
            impactAnalysis = impactAnalyzer.analyzeImpact(apiAnalysis.changes);
          }
        }
        const formatter = new OutputFormatter();
        console.log(
          formatter.formatJSON(changeAnalysis, apiAnalysis, impactAnalysis)
        );
        return;
      }

      // Handle breaking changes only mode
      if (options.breakingChanges) {
        if (!apiAnalysis) {
          // Need to run API analysis
          spinner.text = "Analyzing API changes...";
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);
        }
        if (apiAnalysis && apiAnalysis.breakingChanges.length > 0) {
          console.log(chalk.bold.red("\n⚠️  Breaking Changes Detected:\n"));
          apiAnalysis.breakingChanges.forEach((change) => {
            const severityColor =
              change.severity === "critical"
                ? chalk.red
                : change.severity === "major"
                ? chalk.yellow
                : chalk.gray;
            console.log(
              severityColor(
                `[${(change.severity || "unknown").toUpperCase()}] ${
                  change.type
                } ${change.name}`
              )
            );
            const lineInfo = change.lineNumber
              ? chalk.gray(` (line ${change.lineNumber})`)
              : change.oldLineNumber
              ? chalk.gray(` (was line ${change.oldLineNumber})`)
              : "";
            console.log(chalk.cyan(`  📁 ${change.file}${lineInfo}`));
            if (change.signature) {
              console.log(chalk.gray(`  Signature: ${change.signature}`));
            }
            console.log();
          });
        } else {
          console.log(chalk.green("✓ No breaking changes detected"));
        }
        return;
      }

      // Show semantic summary if requested
      if (options.semantic && changeAnalysis) {
        const formatter = new OutputFormatter();
        console.log(
          chalk.bold(
            "\n" +
              formatter.generateSummary(
                changeAnalysis,
                apiAnalysis,
                impactAnalysis
              )
          )
        );
        console.log();
      }

      if (diff.trim() === "") {
        console.log(chalk.green(`✓ No ${description.toLowerCase()} found`));
        return;
      }

      console.log(chalk.bold(`\n📋 ${description}:\n`));
      console.log(this.formatDiffOutput(diff, options));

      // Show summary - filter based on what diff we're showing
      const allStatus = this.getGitStatus();
      let filteredStatus = allStatus;

      // Filter status based on diff type
      // Git status porcelain format: XY filename
      // X = staged status, Y = unstaged status
      // "??" = untracked (unstaged only)
      if (options.staged) {
        // Only show staged files (first column has changes, not space)
        filteredStatus = allStatus.filter((s) => {
          const statusCode = s.substring(0, 2);
          return statusCode[0] !== " " && statusCode !== "??";
        });
      } else if (options.unstaged) {
        // Only show unstaged files (second column has changes or is untracked)
        filteredStatus = allStatus.filter((s) => {
          const statusCode = s.substring(0, 2);
          return statusCode === "??" || statusCode[1] !== " ";
        });
      } else if (options.all) {
        // Show all files (both staged and unstaged)
        filteredStatus = allStatus;
      } else if (!options.branch && !options.commit) {
        // Default: show unstaged files (matching the default diff)
        filteredStatus = allStatus.filter((s) => {
          const statusCode = s.substring(0, 2);
          return statusCode === "??" || statusCode[1] !== " ";
        });
      } else {
        // Branch/commit comparison: don't show file status summary
        filteredStatus = [];
      }

      if (filteredStatus.length > 0) {
        console.log(chalk.bold("\n📊 File Status Summary:"));
        let modifiedCount = 0;
        let addedCount = 0;
        let deletedCount = 0;
        let renamedCount = 0;
        let unmergedCount = 0;
        let untrackedCount = 0;

        filteredStatus.forEach((fileStatus) => {
          const status = fileStatus.substring(0, 2);
          const filename = fileStatus.substring(3);

          // Determine which status column to check based on diff type
          let relevantStatus: string;
          if (options.staged) {
            // Check first column (staged)
            relevantStatus = status[0];
          } else {
            // Check second column (unstaged), or first if second is space
            relevantStatus =
              status === "??" ? "?" : status[1] !== " " ? status[1] : status[0];
          }

          if (status === "??") {
            console.log(chalk.gray(`  Untracked: ${filename}`));
            untrackedCount++;
          } else if (relevantStatus === "M") {
            console.log(chalk.yellow(`  Modified: ${filename}`));
            modifiedCount++;
          } else if (relevantStatus === "A") {
            console.log(chalk.green(`  Added: ${filename}`));
            addedCount++;
          } else if (relevantStatus === "D") {
            console.log(chalk.red(`  Deleted: ${filename}`));
            deletedCount++;
          } else if (relevantStatus === "R") {
            console.log(chalk.blue(`  Renamed: ${filename}`));
            renamedCount++;
          } else if (relevantStatus === "U") {
            console.log(chalk.magenta(`  Unmerged: ${filename}`));
            unmergedCount++;
          }
        });

        console.log(chalk.bold("\n🧾 Summary:"));
        const parts: string[] = [];
        if (modifiedCount > 0) parts.push(`Modified: ${modifiedCount}`);
        if (addedCount > 0) parts.push(`Added: ${addedCount}`);
        if (deletedCount > 0) parts.push(`Deleted: ${deletedCount}`);
        if (renamedCount > 0) parts.push(`Renamed: ${renamedCount}`);
        if (unmergedCount > 0) parts.push(`Unmerged: ${unmergedCount}`);
        if (untrackedCount > 0) parts.push(`Untracked: ${untrackedCount}`);
        if (parts.length > 0) {
          console.log("  " + parts.join(", "));
        }

        // Append line-change summary using git shortstat for the same selection
        let shortstatCommand = "git diff";
        if (options.staged) {
          shortstatCommand = "git diff --cached";
        } else if (options.unstaged) {
          shortstatCommand = "git diff";
        } else if (options.all) {
          shortstatCommand = "git diff HEAD";
        } else if (options.branch) {
          shortstatCommand = `git diff ${options.branch}`;
        } else if (options.commit) {
          shortstatCommand = `git diff ${options.commit}`;
        }
        if (options.file) {
          shortstatCommand += ` -- ${options.file}`;
        }
        shortstatCommand += " --shortstat --ignore-submodules=all";

        const shortstat = this.executeGitCommand(shortstatCommand).trim();
        if (shortstat) {
          console.log(chalk.bold("\n📈 Changes:"));
          console.log("  " + shortstat);
        }
      }
    } catch (error) {
      spinner.fail("Failed to generate diff");
      console.log(
        chalk.red(`
       Error: ${error instanceof Error ? error.message : String(error)}
 `)
      );
    }
  }

  public showRepositoryInfo(): void {
    const spinner = ora("Gathering repository information...").start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail("Not a git repository");
        return;
      }

      const branch = this.executeGitCommand("git branch --show-current").trim();
      let remote = "";
      try {
        remote = this.executeGitCommand("git remote get-url origin").trim();
      } catch {
        remote = "No remote origin set";
      }
      const lastCommit = this.executeGitCommand("git log -1 --oneline").trim();
      const status = this.getGitStatus();

      spinner.succeed("Repository information gathered");

      console.log(chalk.bold("\n📁 Repository Information:"));
      console.log(chalk.blue(`  Branch: ${branch}`));
      console.log(chalk.blue(`  Remote: ${remote}`));
      console.log(chalk.blue(`  Last commit: ${lastCommit}`));
      console.log(chalk.blue(`  Modified files: ${status.length}`));
    } catch (error) {
      spinner.fail("Failed to gather repository information");
      console.log(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  public listBranches(): void {
    const spinner = ora("Listing branches...").start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail("Not a git repository");
        return;
      }

      const currentBranch = this.executeGitCommand(
        "git branch --show-current"
      ).trim();

      // Get local branches
      const localBranches = this.executeGitCommand("git branch")
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
        .map((b) => b.replace(/^\*\s+/, ""));

      // Get remote branches
      let remoteBranches: string[] = [];
      try {
        remoteBranches = this.executeGitCommand("git branch -r")
          .split("\n")
          .map((b) => b.trim())
          .filter((b) => b.length > 0 && !b.includes("HEAD"))
          .map((b) => b.replace(/^[^/]+\//, ""));
      } catch {
        // No remote branches
      }

      spinner.succeed("Branches listed");

      console.log(chalk.bold("\n🌿 Branches:\n"));

      if (localBranches.length > 0) {
        console.log(chalk.bold("Local:"));
        localBranches.forEach((branch) => {
          if (branch === currentBranch) {
            console.log(chalk.green(`  * ${branch} (current)`));
          } else {
            console.log(`    ${branch}`);
          }
        });
        console.log();
      }

      if (remoteBranches.length > 0) {
        console.log(chalk.bold("Remote:"));
        remoteBranches.forEach((branch) => {
          console.log(`    ${branch}`);
        });
        console.log();
      }

      console.log(
        chalk.gray(
          "💡 Tip: Use 'gitsum compare --base <branch1> --compare <branch2>' to compare branches"
        )
      );
    } catch (error) {
      spinner.fail("Failed to list branches");
      console.log(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  public listCommits(count: number = 10): void {
    const spinner = ora("Listing commits...").start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail("Not a git repository");
        return;
      }

      const commits = this.executeGitCommand(
        `git log --oneline -${count} --decorate`
      )
        .split("\n")
        .filter((line) => line.trim().length > 0);

      spinner.succeed("Commits listed");

      console.log(chalk.bold(`\n📜 Recent Commits (last ${count}):\n`));

      commits.forEach((commit, index) => {
        const parts = commit.split(" ");
        const hash = parts[0];
        const message = parts.slice(1).join(" ");

        // Get commit date
        let date = "";
        try {
          date = this.executeGitCommand(
            `git log -1 --format=%ad --date=short ${hash}`
          ).trim();
        } catch {
          // Ignore
        }

        const dateStr = date ? chalk.gray(` (${date})`) : "";
        console.log(`${chalk.cyan(hash.substring(0, 8))} ${message}${dateStr}`);
      });

      console.log();
      console.log(
        chalk.gray(
          "💡 Tip: Use 'gitsum diff --commit <hash>' or 'gitsum diff --commit HEAD~1' to see changes"
        )
      );
    } catch (error) {
      spinner.fail("Failed to list commits");
      console.log(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  private getBranchList(): string[] {
    try {
      const branches = this.executeGitCommand("git branch -a");
      return branches
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.startsWith("*"))
        .map((b) => b.replace(/^remotes\/[^/]+\//, "").replace(/^[* ]+/, ""));
    } catch {
      return [];
    }
  }

  private branchExists(branch: string): boolean {
    try {
      this.executeGitCommand(`git rev-parse --verify ${branch}`);
      return true;
    } catch {
      return false;
    }
  }

  private getBranchInfo(branch: string): {
    commit: string;
    author: string;
    date: string;
    message: string;
  } {
    try {
      const commit = this.executeGitCommand(
        `git log -1 --format=%H ${branch}`
      ).trim();
      const author = this.executeGitCommand(
        `git log -1 --format=%an ${branch}`
      ).trim();
      const date = this.executeGitCommand(
        `git log -1 --format=%ad --date=short ${branch}`
      ).trim();
      const message = this.executeGitCommand(
        `git log -1 --format=%s ${branch}`
      ).trim();
      return { commit, author, date, message };
    } catch {
      return {
        commit: "unknown",
        author: "unknown",
        date: "unknown",
        message: "unknown",
      };
    }
  }

  private getCommitCount(
    branch1: string,
    branch2: string
  ): {
    ahead: number;
    behind: number;
  } {
    try {
      const ahead = this.executeGitCommand(
        `git rev-list --count ${branch2}..${branch1}`
      ).trim();
      const behind = this.executeGitCommand(
        `git rev-list --count ${branch1}..${branch2}`
      ).trim();
      return {
        ahead: parseInt(ahead) || 0,
        behind: parseInt(behind) || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  private getChangedFiles(
    branch1: string,
    branch2: string
  ): {
    added: string[];
    modified: string[];
    deleted: string[];
    renamed: string[];
  } {
    try {
      const diff = this.executeGitCommand(
        `git diff --name-status ${branch1}..${branch2}`
      );
      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];
      const renamed: string[] = [];

      diff.split("\n").forEach((line) => {
        if (!line.trim()) return;
        const status = line[0];
        const file = line.substring(1).trim().split(/\s+/)[0];
        if (status === "A") added.push(file);
        else if (status === "M") modified.push(file);
        else if (status === "D") deleted.push(file);
        else if (status === "R" || status === "C") renamed.push(file);
      });

      return { added, modified, deleted, renamed };
    } catch {
      return { added: [], modified: [], deleted: [], renamed: [] };
    }
  }

  public async compareBranches(options: BranchCompareOptions): Promise<void> {
    const spinner = ora("Comparing branches...").start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail("Not a git repository");
        console.log(
          chalk.red("Error: Current directory is not a git repository")
        );
        return;
      }

      const currentBranch = this.executeGitCommand(
        "git branch --show-current"
      ).trim();

      const baseBranch = options.baseBranch || currentBranch;
      const compareBranch = options.compareBranch || currentBranch;

      if (!this.branchExists(baseBranch)) {
        spinner.fail(`Branch not found: ${baseBranch}`);
        console.log(chalk.red(`Error: Branch "${baseBranch}" does not exist`));
        return;
      }

      if (!this.branchExists(compareBranch)) {
        spinner.fail(`Branch not found: ${compareBranch}`);
        console.log(
          chalk.red(`Error: Branch "${compareBranch}" does not exist`)
        );
        return;
      }

      if (baseBranch === compareBranch) {
        spinner.fail("Cannot compare branch with itself");
        console.log(
          chalk.yellow(
            `Warning: Both branches are the same (${baseBranch}). No differences to show.`
          )
        );
        return;
      }

      spinner.text = "Analyzing branch differences...";

      // Get branch information
      const baseInfo = this.getBranchInfo(baseBranch);
      const compareInfo = this.getBranchInfo(compareBranch);
      const commitCounts = this.getCommitCount(baseBranch, compareBranch);
      const changedFiles = this.getChangedFiles(baseBranch, compareBranch);

      // Calculate basic metrics for early output mode detection
      const totalFiles =
        changedFiles.added.length +
        changedFiles.modified.length +
        changedFiles.deleted.length +
        changedFiles.renamed.length;

      // Auto-enable semantic for compact mode if not explicitly disabled
      if (options.compact && options.semantic === undefined && !options.json) {
        options.semantic = true;
      } else if (
        !options.compact &&
        !options.verbose &&
        totalFiles <= 2 &&
        options.semantic === undefined &&
        !options.json
      ) {
        // Auto-enable semantic for small changes (auto-detected compact mode)
        options.semantic = true;
      }

      spinner.text = "Generating diff statistics...";

      // Get diff statistics
      let diffStats = "";
      try {
        const statsCommand = `git diff --shortstat ${baseBranch}..${compareBranch} --ignore-submodules=all`;
        diffStats = this.executeGitCommand(statsCommand).trim();
      } catch {
        diffStats = "No statistics available";
      }

      // Get full diff for analysis
      let diffCommand = `git diff ${baseBranch}..${compareBranch}`;
      if (options.context !== undefined) {
        diffCommand += ` -U${options.context}`;
      } else {
        diffCommand += " -U3";
      }
      if (options.file) {
        diffCommand += ` -- ${options.file}`;
      }
      diffCommand += " --ignore-submodules=all";

      const diff = this.executeGitCommand(diffCommand);

      // Perform semantic analysis if requested
      let changeAnalysis;
      let apiAnalysis;
      let impactAnalysis;

      if (
        options.semantic ||
        options.breakingChanges ||
        options.impact ||
        options.json
      ) {
        spinner.text = "Analyzing changes...";
        const changeAnalyzer = new ChangeAnalyzer(this.cwd);
        changeAnalysis = changeAnalyzer.analyzeDiff(diff);

        if (
          options.semantic ||
          options.breakingChanges ||
          options.impact ||
          options.json
        ) {
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);

          if (options.impact || options.json) {
            const impactAnalyzer = new ImpactAnalyzer(this.cwd);
            impactAnalysis = impactAnalyzer.analyzeImpact(apiAnalysis.changes);
          }
        }
      }

      spinner.succeed("Branch comparison complete");

      // Calculate full metrics for output mode detection (totalFiles already calculated above)
      const apiChangeCount = apiAnalysis ? apiAnalysis.changes.length : 0;
      const totalLinesChanged = changeAnalysis
        ? changeAnalysis.summary.totalLinesAdded +
          changeAnalysis.summary.totalLinesDeleted
        : 0;
      const hasBreakingChanges = apiAnalysis
        ? apiAnalysis.breakingChanges.length > 0
        : false;

      const metrics: OutputMetrics = {
        fileCount: totalFiles,
        apiChangeCount,
        totalLinesChanged,
        hasBreakingChanges,
      };

      // Determine final output mode
      const formatter = new OutputFormatter();
      let outputMode: OutputMode = "normal";
      if (options.compact) {
        outputMode = "compact";
      } else if (options.verbose) {
        outputMode = "verbose";
      } else {
        outputMode = formatter.determineOutputMode(metrics);
      }

      // Handle diff-only mode
      if (options.diffOnly) {
        if (diff.trim() === "") {
          console.log(chalk.green("✓ No differences found"));
        } else {
          const color = options.color !== false;
          console.log(this.formatDiffOutput(diff, { color }));
        }
        return;
      }

      // Display comparison header
      console.log(chalk.bold("\n🔀 Branch Comparison:\n"));
      console.log(chalk.cyan(`  Base Branch:    ${chalk.bold(baseBranch)}`));
      console.log(
        chalk.magenta(`  Compare Branch: ${chalk.bold(compareBranch)}\n`)
      );

      // Display branch info (skip in compact mode)
      if (outputMode !== "compact") {
        console.log(chalk.bold("📋 Branch Information:"));
        console.log(chalk.cyan(`\n  ${baseBranch}:`));
        console.log(`    Commit:  ${baseInfo.commit.substring(0, 8)}`);
        console.log(`    Author:  ${baseInfo.author}`);
        console.log(`    Date:    ${baseInfo.date}`);
        console.log(`    Message: ${baseInfo.message}`);

        console.log(chalk.magenta(`\n  ${compareBranch}:`));
        console.log(`    Commit:  ${compareInfo.commit.substring(0, 8)}`);
        console.log(`    Author:  ${compareInfo.author}`);
        console.log(`    Date:    ${compareInfo.date}`);
        console.log(`    Message: ${compareInfo.message}`);
      }

      // Display commit counts (skip in compact mode)
      if (outputMode !== "compact") {
        console.log(chalk.bold("\n📊 Commit Statistics:"));
        if (commitCounts.ahead > 0) {
          console.log(
            chalk.green(
              `  ${compareBranch} is ${commitCounts.ahead} commit(s) ahead of ${baseBranch}`
            )
          );
        }
        if (commitCounts.behind > 0) {
          console.log(
            chalk.yellow(
              `  ${compareBranch} is ${commitCounts.behind} commit(s) behind ${baseBranch}`
            )
          );
        }
        if (commitCounts.ahead === 0 && commitCounts.behind === 0) {
          console.log(chalk.gray("  Branches are at the same commit"));
        }
      }

      // Display file changes (skip in compact mode)
      if (outputMode !== "compact" && totalFiles > 0) {
        console.log(chalk.bold("\n📁 File Changes:"));
        if (changedFiles.added.length > 0) {
          console.log(chalk.green(`\n  Added (${changedFiles.added.length}):`));
          changedFiles.added.slice(0, 20).forEach((file) => {
            console.log(`    + ${file}`);
          });
          if (changedFiles.added.length > 20) {
            console.log(
              chalk.gray(`    ... and ${changedFiles.added.length - 20} more`)
            );
          }
        }
        if (changedFiles.modified.length > 0) {
          console.log(
            chalk.yellow(`\n  Modified (${changedFiles.modified.length}):`)
          );
          changedFiles.modified.slice(0, 20).forEach((file) => {
            console.log(`    ~ ${file}`);
          });
          if (changedFiles.modified.length > 20) {
            console.log(
              chalk.gray(
                `    ... and ${changedFiles.modified.length - 20} more`
              )
            );
          }
        }
        if (changedFiles.deleted.length > 0) {
          console.log(
            chalk.red(`\n  Deleted (${changedFiles.deleted.length}):`)
          );
          changedFiles.deleted.slice(0, 20).forEach((file) => {
            console.log(`    - ${file}`);
          });
          if (changedFiles.deleted.length > 20) {
            console.log(
              chalk.gray(`    ... and ${changedFiles.deleted.length - 20} more`)
            );
          }
        }
        if (changedFiles.renamed.length > 0) {
          console.log(
            chalk.blue(`\n  Renamed (${changedFiles.renamed.length}):`)
          );
          changedFiles.renamed.slice(0, 10).forEach((file) => {
            console.log(`    → ${file}`);
          });
          if (changedFiles.renamed.length > 10) {
            console.log(
              chalk.gray(`    ... and ${changedFiles.renamed.length - 10} more`)
            );
          }
        }
      }

      // Handle JSON output
      if (options.json) {
        if (!changeAnalysis) {
          // Need to run analysis for JSON output
          spinner.text = "Analyzing changes...";
          const changeAnalyzer = new ChangeAnalyzer(this.cwd);
          changeAnalysis = changeAnalyzer.analyzeDiff(diff);
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);
          if (options.impact) {
            const impactAnalyzer = new ImpactAnalyzer(this.cwd);
            impactAnalysis = impactAnalyzer.analyzeImpact(apiAnalysis.changes);
          }
        }
        const formatter = new OutputFormatter();
        console.log(
          formatter.formatJSON(changeAnalysis, apiAnalysis, impactAnalysis)
        );
        return;
      }

      // Handle breaking changes only mode
      if (options.breakingChanges) {
        if (!apiAnalysis) {
          // Need to run API analysis
          spinner.text = "Analyzing API changes...";
          const apiAnalyzer = new APIAnalyzer(this.cwd);
          apiAnalysis = apiAnalyzer.analyzeAPIChanges(diff);
        }
        if (apiAnalysis && apiAnalysis.breakingChanges.length > 0) {
          console.log(chalk.bold.red("\n⚠️  Breaking Changes Detected:\n"));
          apiAnalysis.breakingChanges.forEach((change) => {
            const severityColor =
              change.severity === "critical"
                ? chalk.red
                : change.severity === "major"
                ? chalk.yellow
                : chalk.gray;
            console.log(
              severityColor(
                `[${(change.severity || "unknown").toUpperCase()}] ${
                  change.type
                } ${change.name}`
              )
            );
            const lineInfo = change.lineNumber
              ? chalk.gray(` (line ${change.lineNumber})`)
              : change.oldLineNumber
              ? chalk.gray(` (was line ${change.oldLineNumber})`)
              : "";
            console.log(chalk.cyan(`  📁 ${change.file}${lineInfo}`));
            if (change.signature) {
              console.log(chalk.gray(`  Signature: ${change.signature}`));
            }
            console.log();
          });
        } else {
          console.log(chalk.green("✓ No breaking changes detected"));
        }
        return;
      }

      // Show semantic summary if requested
      if (options.semantic && changeAnalysis) {
        const formatter = new OutputFormatter();
        console.log(
          chalk.bold(
            "\n" +
              formatter.generateSummary(
                changeAnalysis,
                apiAnalysis,
                impactAnalysis,
                outputMode
              )
          )
        );
        console.log();
      } else if (outputMode === "compact") {
        // In compact mode without semantic, show minimal summary
        if (diffStats) {
          console.log(chalk.bold(`\n📊 ${diffStats}`));
        } else if (totalFiles > 0) {
          const fileSummary = [];
          if (changedFiles.added.length > 0)
            fileSummary.push(`+${changedFiles.added.length} added`);
          if (changedFiles.modified.length > 0)
            fileSummary.push(`~${changedFiles.modified.length} modified`);
          if (changedFiles.deleted.length > 0)
            fileSummary.push(`-${changedFiles.deleted.length} deleted`);
          if (fileSummary.length > 0) {
            console.log(
              chalk.bold(
                `\n📊 ${totalFiles} file(s): ${fileSummary.join(", ")}`
              )
            );
          }
        }
      }

      // Display diff statistics (skip in compact mode, already shown above)
      if (diffStats && outputMode !== "compact") {
        console.log(chalk.bold("\n📈 Diff Statistics:"));
        console.log(`  ${diffStats}`);
      }

      // Show full diff based on mode and options
      const shouldShowDiff =
        !options.noDiff &&
        !options.summary &&
        (outputMode === "verbose" ||
          (outputMode === "normal" && !options.compact) ||
          options.verbose);

      if (shouldShowDiff) {
        console.log(chalk.bold("\n🔍 Full Diff:\n"));

        if (diff.trim() === "") {
          console.log(chalk.green("✓ No differences found"));
        } else {
          const color = options.color !== false;
          console.log(this.formatDiffOutput(diff, { color }));
        }
      } else if (options.summary) {
        console.log(
          chalk.gray(
            "\n💡 Tip: Use without --summary to see the full diff output"
          )
        );
      } else if (outputMode === "compact") {
        console.log(
          chalk.gray("\n💡 Tip: Use --verbose to see full diff and details")
        );
      }
    } catch (error) {
      spinner.fail("Failed to compare branches");
      console.log(
        chalk.red(
          `\nError: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }
}

// CLI Setup
program
  .name("gitsum")
  .description("A terminal interface for checking git diff of repositories")
  .version(pkg.version);

program
  .command("diff")
  .description("Show git diff")
  .argument(
    "[branch1] [branch2]",
    "Compare two branches/commits (like git diff)"
  )
  .option("-s, --staged", "Show staged changes only")
  .option("-u, --unstaged", "Show unstaged changes only")
  .option("-a, --all", "Show all changes (staged + unstaged)")
  .option("-b, --branch <branch>", "Compare with specific branch")
  .option("-c, --commit <commit>", "Compare with specific commit")
  .option("-f, --file <file>", "Show diff for specific file")
  .option("-C, --context <lines>", "Number of context lines", "3")
  .option("--no-color", "Disable colored output")
  .option("-w, --word-diff", "Show word-level diff")
  .option("--json", "Output as JSON")
  .option("--semantic", "Show semantic analysis of changes")
  .option("--breaking-changes", "Show only breaking changes")
  .option("--impact", "Show impact analysis (requires --semantic)")
  .allowUnknownOption()
  .action(async (...args) => {
    // Parse arguments manually since Commander.js can be tricky with optional args
    const allArgs = process.argv.slice(process.argv.indexOf("diff") + 1);
    const positionalArgs: string[] = [];
    const opts: any = {};

    // Separate positional args from options
    for (let i = 0; i < allArgs.length; i++) {
      const arg = allArgs[i];
      if (arg.startsWith("-")) {
        // It's an option
        if (arg.includes("=")) {
          // Option with value like --context=5
          const [key, value] = arg.split("=");
          const optKey = key.replace(/^--?/, "").replace(/-/g, "");
          opts[optKey] = value;
          continue;
        }

        // Boolean flags
        if (arg === "--semantic" || (arg === "-s" && i === 0)) {
          opts.semantic = true;
        } else if (arg === "--breaking-changes") {
          opts.breakingChanges = true;
        } else if (arg === "--impact") {
          opts.impact = true;
        } else if (arg === "--json") {
          opts.json = true;
        } else if (arg === "--compact" || arg === "--brief") {
          opts.compact = true;
        } else if (arg === "--verbose") {
          opts.verbose = true;
        } else if (arg === "--no-diff") {
          opts.noDiff = true;
        } else if (arg === "--diff-only") {
          opts.diffOnly = true;
        } else if (arg === "--staged" || arg === "-s") {
          opts.staged = true;
        } else if (arg === "--unstaged" || arg === "-u") {
          opts.unstaged = true;
        } else if (arg === "--all" || arg === "-a") {
          opts.all = true;
        } else if (arg === "--word-diff" || arg === "-w") {
          opts.wordDiff = true;
        } else if (arg === "--no-color") {
          opts.color = false;
        } else if (arg === "--branch" || arg === "-b") {
          // Option with value
          if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith("-")) {
            opts.branch = allArgs[i + 1];
            i++; // Skip the value
          }
        } else if (arg === "--commit" || arg === "-c") {
          if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith("-")) {
            opts.commit = allArgs[i + 1];
            i++;
          }
        } else if (arg === "--file" || arg === "-f") {
          if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith("-")) {
            opts.file = allArgs[i + 1];
            i++;
          }
        } else if (arg === "--context" || arg === "-C") {
          if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith("-")) {
            opts.context = allArgs[i + 1];
            i++;
          }
        }
      } else {
        // It's a positional argument
        positionalArgs.push(arg);
      }
    }

    // Get options from the last argument (Commander.js passes it)
    const commanderOptions = args[args.length - 1] || {};
    Object.assign(opts, commanderOptions);

    const context = parseInt(opts.context || "3");
    const checker = new GitDiffChecker();

    // Handle positional arguments (git diff style)
    if (positionalArgs.length >= 2) {
      // Two branches/commits: compare branch1 to branch2
      await checker.compareBranches({
        baseBranch: positionalArgs[0],
        compareBranch: positionalArgs[1],
        context: isNaN(context) ? 3 : context,
        color: opts.color !== false,
        json: opts.json,
        semantic: opts.semantic,
        breakingChanges: opts.breakingChanges,
        impact: opts.impact,
        compact: opts.compact,
        verbose: opts.verbose,
        noDiff: opts.noDiff,
        diffOnly: opts.diffOnly,
      });
    } else if (positionalArgs.length === 1) {
      // Single branch/commit: compare current branch to branch1
      await checker.checkDiff({
        ...opts,
        branch: positionalArgs[0],
        context: isNaN(context) ? 3 : context,
      });
    } else {
      // No positional args: use options as before
      await checker.checkDiff({
        ...opts,
        context: isNaN(context) ? 3 : context,
      });
    }
  });

program
  .command("status")
  .description("Show repository status and information")
  .action(() => {
    const checker = new GitDiffChecker();
    checker.showRepositoryInfo();
  });

program
  .command("info")
  .description("Show repository information")
  .action(() => {
    const checker = new GitDiffChecker();
    checker.showRepositoryInfo();
  });

program
  .command("list")
  .description("List branches and recent commits")
  .option("-b, --branches", "List branches only")
  .option("-c, --commits", "List commits only")
  .option("-n, --count <number>", "Number of commits to show", "10")
  .action((options) => {
    const checker = new GitDiffChecker();
    if (options.commits) {
      const count = parseInt(options.count) || 10;
      checker.listCommits(count);
    } else if (options.branches) {
      checker.listBranches();
    } else {
      // Show both
      checker.listBranches();
      const count = parseInt(options.count) || 10;
      checker.listCommits(count);
    }
  });

program
  .command("branches")
  .description("List all branches")
  .action(() => {
    const checker = new GitDiffChecker();
    checker.listBranches();
  });

program
  .command("commits")
  .description("List recent commits")
  .option("-n, --count <number>", "Number of commits to show", "10")
  .action((options) => {
    const checker = new GitDiffChecker();
    const count = parseInt(options.count) || 10;
    checker.listCommits(count);
  });

program
  .command("compare")
  .description("Compare two branches and visualize the differences")
  .option(
    "-b, --base <branch>",
    "Base branch to compare from (default: current branch)"
  )
  .option(
    "-c, --compare <branch>",
    "Branch to compare against (default: current branch)"
  )
  .option("-s, --summary", "Show only summary without full diff")
  .option("-C, --context <lines>", "Number of context lines in diff", "3")
  .option("--no-color", "Disable colored output")
  .option("-f, --file <file>", "Show diff for specific file only")
  .option("--json", "Output as JSON")
  .option("--semantic", "Show semantic analysis of changes")
  .option("--breaking-changes", "Show only breaking changes")
  .option("--impact", "Show impact analysis (requires --semantic)")
  .action(async (options) => {
    const context = parseInt(options.context);
    const checker = new GitDiffChecker();
    await checker.compareBranches({
      baseBranch: options.base,
      compareBranch: options.compare,
      summary: options.summary,
      context: isNaN(context) ? 3 : context,
      color: options.color !== false,
      file: options.file,
      json: options.json,
      semantic: options.semantic,
      breakingChanges: options.breakingChanges,
      impact: options.impact,
    });
  });

// Default command
program.action(async () => {
  console.log(chalk.bold.blue("🔍 GitSum - Git Diff Checker\n"));
  console.log("Available commands:");
  console.log("  gitsum diff     - Show git diff with various options");
  console.log(
    "  gitsum compare  - Compare two branches and visualize differences"
  );
  console.log("  gitsum list     - List branches and recent commits");
  console.log("  gitsum branches - List all branches");
  console.log("  gitsum commits  - List recent commits");
  console.log("  gitsum status   - Show repository status");
  console.log("  gitsum info     - Show repository information");
  console.log("\nUse --help for more information on each command.");
});

program.parse();
