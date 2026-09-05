#!/usr/bin/env bash
# Cheap but real gate for a repo this size: every .js file must parse with `node --check`,
# every .jsx file must parse through esbuild (which ships with vite). ~1 second, no build output.
#   bash scripts/check-syntax.sh
set -u
cd "$(dirname "$0")/.."
fail=0; count=0
for f in $(find backend/src backend/scripts backend/db backend/test frontend/src -name '*.js' 2>/dev/null | sort); do
  count=$((count+1))
  if ! node --check "$f" 2>/tmp/syn.err; then echo "SYNTAX $f"; cat /tmp/syn.err; fail=1; fi
done
# JSX files are checked by esbuild instead of node --check; that needs the frontend dependencies.
if [ -f frontend/node_modules/esbuild/lib/main.js ]; then
  for f in $(find frontend/src -name '*.jsx' 2>/dev/null | sort); do
    count=$((count+1))
    if ! node -e "const fs=require('fs');const {transformSync}=require(process.cwd()+'/frontend/node_modules/esbuild/lib/main.js');transformSync(fs.readFileSync('$f','utf8'),{loader:'jsx'});" 2>/tmp/syn.err; then echo "SYNTAX $f"; head -12 /tmp/syn.err; fail=1; fi
  done
else
  echo "note: frontend/node_modules/esbuild not found — .jsx files were NOT checked (run: npm --prefix frontend install)"
fi
echo "checked $count files"
[ $fail -eq 0 ] && echo "syntax: OK" || { echo "syntax: FAILED"; exit 1; }
