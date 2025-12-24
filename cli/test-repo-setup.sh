#!/bin/bash

# Setup script for creating a test repository
# This creates a git repo with sample code to test gitsum features

set -e

TEST_REPO_DIR="test-repo"

# Clean up if exists
if [ -d "$TEST_REPO_DIR" ]; then
  echo "Cleaning up existing test repo..."
  rm -rf "$TEST_REPO_DIR"
fi

echo "Creating test repository..."

# Create directory structure
mkdir -p "$TEST_REPO_DIR/src"
mkdir -p "$TEST_REPO_DIR/tests"
mkdir -p "$TEST_REPO_DIR/docs"

cd "$TEST_REPO_DIR"

# Initialize git repo
git init
git config user.name "Test User"
git config user.email "test@example.com"

# Create initial files on main branch
cat > src/utils.ts << 'EOF'
/**
 * Utility functions for the application
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export const PI = 3.14159;
EOF

cat > src/api.ts << 'EOF'
/**
 * API client
 */

export class APIClient {
  constructor(private baseUrl: string) {}

  async get(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`);
    return response.json();
  }

  async post(endpoint: string, data: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.json();
  }
}

export function createClient(baseUrl: string): APIClient {
  return new APIClient(baseUrl);
}
EOF

cat > src/index.ts << 'EOF'
import { add, subtract } from './utils';
import { createClient } from './api';

export function main() {
  console.log('Hello from main');
  console.log(add(1, 2));
}

export default main;
EOF

cat > tests/utils.test.ts << 'EOF'
import { add, subtract } from '../src/utils';

describe('utils', () => {
  test('add', () => {
    expect(add(1, 2)).toBe(3);
  });

  test('subtract', () => {
    expect(subtract(5, 2)).toBe(3);
  });
});
EOF

cat > README.md << 'EOF'
# Test Repository

This is a test repository for gitsum.
EOF

cat > package.json << 'EOF'
{
  "name": "test-repo",
  "version": "1.0.0",
  "type": "module"
}
EOF

# Initial commit
git add .
git commit -m "Initial commit: basic utility functions and API client"

# Create feature branch with various changes
git checkout -b feature/new-features

# Add new function (feature addition)
cat >> src/utils.ts << 'EOF'

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}
EOF

# Remove an export (breaking change)
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' '/export const PI = 3.14159;/d' src/utils.ts
  sed -i '' 's/async get(endpoint: string): Promise<any>/async get(endpoint: string, options?: RequestInit): Promise<any>/' src/api.ts
else
  # Linux
  sed -i '/export const PI = 3.14159;/d' src/utils.ts
  sed -i 's/async get(endpoint: string): Promise<any>/async get(endpoint: string, options?: RequestInit): Promise<any>/' src/api.ts
fi

# Add new export
cat >> src/api.ts << 'EOF'

export async function deleteRequest(endpoint: string): Promise<void> {
  await fetch(endpoint, { method: 'DELETE' });
}
EOF

# Add new file
cat > src/auth.ts << 'EOF'
export interface User {
  id: string;
  name: string;
  email: string;
}

export function login(email: string, password: string): Promise<User> {
  // Implementation
  return Promise.resolve({ id: '1', name: 'User', email });
}

export function logout(): void {
  // Implementation
}
EOF

# Modify existing file (refactoring)
cat > src/index.ts << 'EOF'
import { add, subtract, divide } from './utils';
import { createClient } from './api';
import { login } from './auth';

export function main() {
  console.log('Hello from main');
  console.log(add(1, 2));
  console.log(divide(10, 2));
}

export default main;
EOF

# Add test file
cat > tests/auth.test.ts << 'EOF'
import { login, logout } from '../src/auth';

describe('auth', () => {
  test('login', async () => {
    const user = await login('test@example.com', 'password');
    expect(user.email).toBe('test@example.com');
  });
});
EOF

# Update documentation
cat > docs/API.md << 'EOF'
# API Documentation

## Utils

- `add(a, b)` - Adds two numbers
- `subtract(a, b)` - Subtracts two numbers
- `divide(a, b)` - Divides two numbers

## API Client

- `APIClient` - Main API client class
- `createClient(baseUrl)` - Creates a new API client
EOF

# Stage and commit changes
git add .
git commit -m "Add new features: divide function, auth module, and breaking changes" || echo "Note: Commit may have failed, but files are staged for testing"

echo ""
echo "✅ Test repository created!"
echo ""
echo "To test gitsum, run:"
echo "  cd $TEST_REPO_DIR"
echo "  node ../dist/cli.js diff --semantic"
echo "  node ../dist/cli.js compare --base main --compare feature/new-features --semantic"
echo "  node ../dist/cli.js diff --breaking-changes"
echo "  node ../dist/cli.js compare --base main --compare feature/new-features --json"
echo ""
echo "Or from the cli directory:"
echo "  node dist/cli.js diff --semantic --cwd test-repo"
echo ""

