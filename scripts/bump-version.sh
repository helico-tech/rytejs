#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
	echo "Usage: $0 <version>"
	echo "Example: $0 0.5.0"
	exit 1
fi

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Bump all packages
for pkg in "$ROOT"/packages/*/package.json; do
	node -e "
		const fs = require('fs');
		const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
		pkg.version = '$VERSION';
		fs.writeFileSync('$pkg', JSON.stringify(pkg, null, '\t') + '\n');
	"
	echo "  $(node -p "require('$pkg').name") → $VERSION"
done

# Patch @rytejs/* dependencies in e2e/package.json
E2E="$ROOT/e2e/package.json"
if [ -f "$E2E" ]; then
	node -e "
		const fs = require('fs');
		const pkg = JSON.parse(fs.readFileSync('$E2E', 'utf8'));
		for (const section of ['dependencies', 'devDependencies']) {
			if (!pkg[section]) continue;
			for (const name of Object.keys(pkg[section])) {
				if (name.startsWith('@rytejs/')) {
					pkg[section][name] = '$VERSION';
				}
			}
		}
		fs.writeFileSync('$E2E', JSON.stringify(pkg, null, '\t') + '\n');
	"
	echo "  e2e/package.json @rytejs/* → $VERSION"
fi

echo "Done."
