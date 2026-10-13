#!/bin/bash
# Syntax check for every ES-module .js file of the app. `node --check file.js` silently passes ES modules
# (Node 22 module detection), so each file is checked as an .mjs copy. Usage: tools/qa/syncheck.sh
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0; n=0
while IFS= read -r f; do
  n=$((n + 1))
  cp "$f" "$TMP/check.mjs"
  if ! out=$(node --check "$TMP/check.mjs" 2>&1); then echo "SYNTAX ERROR in ${f#$ROOT/}:"; echo "$out" | sed -n '1,6p'; fail=1; fi
done < <(find "$ROOT" -name '*.js' -not -path '*/node_modules/*' -not -path '*/tools/*' -not -path '*/lib/vendor/*')
echo "$n files checked"; exit $fail
