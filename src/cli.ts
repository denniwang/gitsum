#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

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
    return existsSync(path.join(this.cwd, '.git'));
  }

  private executeGitCommand(command: string): string {
    try {
      return execSync(command, { 
        cwd: this.cwd, 
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Git command failed: ${command}`);
    }
  }

  private getGitStatus(): string[] {
    const status = this.executeGitCommand('git status --porcelain');
    return status.trim().split('\n').filter(line => line.length > 0);
  }

  private formatDiffOutput(diff: string, options: GitDiffOptions): string {
    if (!options.color) {
      return diff;
    }

    return diff
      .split('\n')
      .map(line => {
        if (line.startsWith('+')) {
          return chalk.green(line);
        } else if (line.startsWith('-')) {
          return chalk.red(line);
        } else if (line.startsWith('@@')) {
          return chalk.blue(line);
        } else if (line.startsWith('diff --git')) {
          return chalk.yellow(line);
        } else if (line.startsWith('index')) {
          return chalk.gray(line);
        }
        return line;
      })
      .join('\n');
  }

  public async checkDiff(options: GitDiffOptions): Promise<void> {
    const spinner = ora('Checking git diff...').start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail('Not a git repository');
        console.log(chalk.red('Error: Current directory is not a git repository'));
        return;
      }

      spinner.text = 'Analyzing repository...';

      let diffCommand = 'git diff';
      let description = 'Working directory changes';

      // Build the diff command based on options
      if (options.staged) {
        diffCommand = 'git diff --cached';
        description = 'Staged changes';
      } else if (options.unstaged) {
        diffCommand = 'git diff';
        description = 'Unstaged changes';
      } else if (options.all) {
        diffCommand = 'git diff HEAD';
        description = 'All changes (staged + unstaged)';
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
        diffCommand += ' --word-diff=color';
      }

      // Add file filter
      if (options.file) {
        diffCommand += ` -- ${options.file}`;
      }

      spinner.text = 'Generating diff...';
      
      const diff = this.executeGitCommand(diffCommand);
      
      spinner.succeed('Diff generated successfully');

      if (diff.trim() === '') {
        console.log(chalk.green(`✓ No ${description.toLowerCase()} found`));
        return;
      }

      console.log(chalk.bold(`\n📋 ${description}:\n`));
      console.log(this.formatDiffOutput(diff, options));

      // Show summary
      const status = this.getGitStatus();
      if (status.length > 0) {
        console.log(chalk.bold('\n📊 File Status Summary:'));
        status.forEach(fileStatus => {
          const status = fileStatus.substring(0, 2);
          const filename = fileStatus.substring(3);
          
          if (status.includes('M')) {
            console.log(chalk.yellow(`  Modified: ${filename}`));
          } else if (status.includes('A')) {
            console.log(chalk.green(`  Added: ${filename}`));
          } else if (status.includes('D')) {
            console.log(chalk.red(`  Deleted: ${filename}`));
          } else if (status.includes('R')) {
            console.log(chalk.blue(`  Renamed: ${filename}`));
          } else if (status.includes('U')) {
            console.log(chalk.magenta(`  Unmerged: ${filename}`));
          }
        });
      }

    } catch (error) {
      spinner.fail('Failed to generate diff');
      console.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  public showRepositoryInfo(): void {
    const spinner = ora('Gathering repository information...').start();

    try {
      if (!this.isGitRepository()) {
        spinner.fail('Not a git repository');
        return;
      }

      const branch = this.executeGitCommand('git branch --show-current').trim();
      let remote = '';
      try {
        remote = this.executeGitCommand('git remote get-url origin').trim();
      } catch {
        remote = 'No remote origin set';
      }
      const lastCommit = this.executeGitCommand('git log -1 --oneline').trim();
      const status = this.getGitStatus();

      spinner.succeed('Repository information gathered');

      console.log(chalk.bold('\n📁 Repository Information:'));
      console.log(chalk.blue(`  Branch: ${branch}`));
      console.log(chalk.blue(`  Remote: ${remote}`));
      console.log(chalk.blue(`  Last commit: ${lastCommit}`));
      console.log(chalk.blue(`  Modified files: ${status.length}`));

    } catch (error) {
      spinner.fail('Failed to gather repository information');
      console.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

// CLI Setup
program
  .name('gitsum')
  .description('A terminal interface for checking git diff of repositories')
  .version('1.0.0');

program
  .command('diff')
  .description('Show git diff')
  .option('-s, --staged', 'Show staged changes only')
  .option('-u, --unstaged', 'Show unstaged changes only')
  .option('-a, --all', 'Show all changes (staged + unstaged)')
  .option('-b, --branch <branch>', 'Compare with specific branch')
  .option('-c, --commit <commit>', 'Compare with specific commit')
  .option('-f, --file <file>', 'Show diff for specific file')
  .option('-C, --context <lines>', 'Number of context lines', '3')
  .option('--no-color', 'Disable colored output')
  .option('-w, --word-diff', 'Show word-level diff')
  .action(async (options) => {
    const context = parseInt(options.context);
    const checker = new GitDiffChecker();
    await checker.checkDiff({
      ...options,
      context: isNaN(context) ? 3 : context
    });
  });

program
  .command('status')
  .description('Show repository status and information')
  .action(() => {
    const checker = new GitDiffChecker();
    checker.showRepositoryInfo();
  });

program
  .command('info')
  .description('Show repository information')
  .action(() => {
    const checker = new GitDiffChecker();
    checker.showRepositoryInfo();
  });

// Default command
program
  .action(async () => {
    console.log(chalk.bold.blue('🔍 GitSum - Git Diff Checker\n'));
    console.log('Available commands:');
    console.log('  gitsum diff     - Show git diff with various options');
    console.log('  gitsum status   - Show repository status');
    console.log('  gitsum info     - Show repository information');
    console.log('\nUse --help for more information on each command.');
  });

program.parse();
