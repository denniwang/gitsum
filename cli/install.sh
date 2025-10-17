#!/bin/bash

# GitSum Installation Script
echo "🔍 Installing GitSum CLI tool..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Install globally
echo "📦 Installing GitSum globally..."
npm install -g .

if [ $? -eq 0 ]; then
    echo "✅ GitSum installed successfully!"
    echo ""
    echo "Usage:"
    echo "  gitsum diff     - Show git diff with various options"
    echo "  gitsum status   - Show repository status"
    echo "  gitsum info     - Show repository information"
    echo ""
    echo "Run 'gitsum --help' for more information."
else
    echo "❌ Installation failed. Please check the error messages above."
    exit 1
fi
