#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import pkg from "../package.json";

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
        diffCommand = `git diff ${options.branch}`;
        description = `Changes compared to ${options.branch}`;
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

      spinner.succeed("Diff generated successfully");

      if (diff.trim() === "") {
        console.log(chalk.green(`✓ No ${description.toLowerCase()} found`));
        return;
      }

      console.log(chalk.bold(`\n📋 ${description}:\n`));
      console.log(this.formatDiffOutput(diff, options));

      // Show summary
      const status = this.getGitStatus();
      if (status.length > 0) {
        console.log(chalk.bold("\n📊 File Status Summary:"));
        let modifiedCount = 0;
        let addedCount = 0;
        let deletedCount = 0;
        let renamedCount = 0;
        let unmergedCount = 0;
        let untrackedCount = 0;

        status.forEach((fileStatus) => {
          const status = fileStatus.substring(0, 2);
          const filename = fileStatus.substring(3);

          if (status.includes("M")) {
            console.log(chalk.yellow(`  Modified: ${filename}`));
            modifiedCount++;
          } else if (status.includes("A")) {
            console.log(chalk.green(`  Added: ${filename}`));
            addedCount++;
          } else if (status.includes("D")) {
            console.log(chalk.red(`  Deleted: ${filename}`));
            deletedCount++;
          } else if (status.includes("R")) {
            console.log(chalk.blue(`  Renamed: ${filename}`));
            renamedCount++;
          } else if (status.includes("U")) {
            console.log(chalk.magenta(`  Unmerged: ${filename}`));
            unmergedCount++;
          } else if (status === "??") {
            console.log(chalk.gray(`  Untracked: ${filename}`));
            untrackedCount++;
          }
        });

        console.log(chalk.bold("\n🧾 Summary:"));
        const parts: string[] = [];
        parts.push(`Modified: ${modifiedCount}`);
        parts.push(`Added: ${addedCount}`);
        parts.push(`Deleted: ${deletedCount}`);
        if (renamedCount > 0) parts.push(`Renamed: ${renamedCount}`);
        if (unmergedCount > 0) parts.push(`Unmerged: ${unmergedCount}`);
        if (untrackedCount > 0) parts.push(`Untracked: ${untrackedCount}`);
        console.log("  " + parts.join(", "));

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
}

// CLI Setup
program
  .name("gitsum")
  .description("A terminal interface for checking git diff of repositories")
  .version(pkg.version);

program
  .command("diff")
  .description("Show git diff")
  .option("-s, --staged", "Show staged changes only")
  .option("-u, --unstaged", "Show unstaged changes only")
  .option("-a, --all", "Show all changes (staged + unstaged)")
  .option("-b, --branch <branch>", "Compare with specific branch")
  .option("-c, --commit <commit>", "Compare with specific commit")
  .option("-f, --file <file>", "Show diff for specific file")
  .option("-C, --context <lines>", "Number of context lines", "3")
  .option("--no-color", "Disable colored output")
  .option("-w, --word-diff", "Show word-level diff")
  .action(async (options) => {
    const context = parseInt(options.context);
    const checker = new GitDiffChecker();
    await checker.checkDiff({
      ...options,
      context: isNaN(context) ? 3 : context,
    });
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

// Default command
program.action(async () => {
  console.log(chalk.bold.blue("🔍 GitSum - Git Diff Checker\n"));
  console.log("Available commands:");
  console.log("  gitsum diff     - Show git diff with various options");
  console.log("  gitsum status   - Show repository status");
  console.log("  gitsum info     - Show repository information");
  console.log("\nUse --help for more information on each command.");
});

program.parse();
