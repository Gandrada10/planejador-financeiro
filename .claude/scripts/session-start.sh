#!/bin/bash
# SessionStart hook - runs automatically when a Claude Code session begins
# Ensures the development environment is ready (web or terminal)

set -e

echo "🔧 Setting up development environment..."

# Install dependencies if node_modules is missing or outdated
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  echo "📦 Installing dependencies..."
  npm install --no-audit --no-fund 2>&1
  echo "✅ Dependencies installed."
else
  echo "✅ Dependencies already up to date."
fi

# Run TypeScript type check to validate the project compiles
echo "🔍 Checking TypeScript compilation..."
npx tsc --noEmit 2>&1 || echo "⚠️  TypeScript errors detected (non-blocking)."

echo "✅ Environment ready!"
