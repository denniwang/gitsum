# GitSum

A powerful terminal interface for checking git diff of repositories. GitSum provides an intuitive CLI tool to analyze git changes with beautiful colored output and comprehensive diff options.

## Features

- 🎨 **Colored Output**: Beautiful colored diff output for better readability
- 📊 **Multiple Diff Types**: Check staged, unstaged, or all changes
- 🔍 **Branch Comparison**: Compare with any branch or commit
- 🔀 **Visual Branch Diff**: Dedicated command to visualize differences between two branches
- 📁 **File Filtering**: Show diff for specific files
- 📈 **Status Summary**: Get overview of repository changes
- 📊 **Commit Statistics**: See how many commits ahead/behind branches are
- ⚡ **Fast & Lightweight**: Quick execution with minimal dependencies

## Installation

### Global Installation
```bash
npm install -g gitsum
```

### Local Installation
```bash
npm install gitsum
```

### Development Installation
```bash
git clone <repository-url>
cd gitsum
pnpm install
pnpm build
```

## Usage

### Basic Commands

```bash
# Show default diff (unstaged changes)
gitsum diff

# Show staged changes
gitsum diff --staged

# Show all changes (staged + unstaged)
gitsum diff --all

# Compare with a specific branch
gitsum diff --branch main

# Compare with a specific commit
gitsum diff --commit HEAD~1

# Show diff for a specific file
gitsum diff --file src/index.ts

# Compare two branches (visualize differences)
gitsum compare --base main --compare feature-branch

# Compare current branch with another branch
gitsum compare --compare main

# Show only summary without full diff
gitsum compare --base main --compare feature-branch --summary

# Show repository status
gitsum status

# Show repository information
gitsum info
```

### Advanced Options

```bash
# Show word-level diff
gitsum diff --word-diff

# Set number of context lines
gitsum diff --context 5

# Disable colored output
gitsum diff --no-color

# Combine multiple options
gitsum diff --staged --context 10 --word-diff
```

### Command Options

#### `gitsum diff`
- `-s, --staged`: Show staged changes only
- `-u, --unstaged`: Show unstaged changes only  
- `-a, --all`: Show all changes (staged + unstaged)
- `-b, --branch <branch>`: Compare with specific branch
- `-c, --commit <commit>`: Compare with specific commit
- `-f, --file <file>`: Show diff for specific file
- `-C, --context <lines>`: Number of context lines (default: 3)
- `--no-color`: Disable colored output
- `-w, --word-diff`: Show word-level diff

#### `gitsum status`
Shows repository status and information including:
- Current branch
- Remote URL
- Last commit
- Number of modified files

#### `gitsum compare`
Compare two branches and visualize the differences with detailed statistics.

- `-b, --base <branch>`: Base branch to compare from (default: current branch)
- `-c, --compare <branch>`: Branch to compare against (default: current branch)
- `-s, --summary`: Show only summary without full diff
- `-C, --context <lines>`: Number of context lines in diff (default: 3)
- `--no-color`: Disable colored output
- `-f, --file <file>`: Show diff for specific file only

The compare command shows:
- Branch information (commit, author, date, message)
- Commit statistics (ahead/behind counts)
- File changes (added, modified, deleted, renamed)
- Diff statistics (lines changed)
- Full diff output (unless `--summary` is used)

#### `gitsum info`
Same as `status` command - shows repository information.

## Examples

### Check what you're about to commit
```bash
gitsum diff --staged
```

### See all changes since last commit
```bash
gitsum diff --all
```

### Compare current branch with main
```bash
gitsum diff --branch main
```

### Visualize differences between two branches
```bash
# Compare feature-branch with main
gitsum compare --base main --compare feature-branch

# Compare current branch with main (summary only)
gitsum compare --compare main --summary
```

### See changes in a specific file
```bash
gitsum diff --file package.json
```

### Get repository overview
```bash
gitsum status
```

## Development

### Building
```bash
pnpm build
```

### Running in Development
```bash
pnpm dev
```

### Testing
```bash
# Run the CLI tool in any git repository
cd /path/to/git/repo
gitsum diff
```

## Requirements

- Node.js 14+
- Git repository (for diff operations)

## License

ISC
# GitSum CLI Tool
