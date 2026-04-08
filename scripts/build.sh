#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist

echo "Compiling library to dist/lib …"
bun x tsc -p tsconfig.build.json

mkdir -p dist/skills/granola
cp skills/granola/SKILL.md dist/skills/granola/SKILL.md

echo "Bundling CLI to dist/granola.js …"
bun build src/cli.ts --outfile dist/granola.js --target node

# Prepend Node.js shebang so the file is directly executable via node or npm bin
printf '#!/usr/bin/env node\n' | cat - dist/granola.js > dist/granola.tmp
mv dist/granola.tmp dist/granola.js
chmod +x dist/granola.js

echo "Built dist/lib and dist/granola.js"
