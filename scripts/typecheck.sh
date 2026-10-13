#!/usr/bin/env bash
# Type-check both the backend (src/) and the SvelteKit frontend (web/).
#
# Why two invocations: the root tsconfig excludes web/, but src/__tests__
# files transitively import `+server.ts` handlers from web/ routes, which
# pulls those files into root tsc's graph without SvelteKit's generated
# `./$types` or the `$server`/`$lib` path aliases from `.svelte-kit/tsconfig.json`.
# That produced ~700 spurious Cannot-find-module errors.
#
# Scoping tsc to each workspace with its own tsconfig (and running
# `svelte-kit sync` first so `./$types` exists) cuts the error count from
# ~730 to the real ~90.

set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ROOT_FAIL=0
WEB_FAIL=0
TESTS_FAIL=0
PACKAGES_FAIL=0
PYTHON_FAIL=0

echo "→ Typechecking backend (src/)..."
cd "$ROOT"
bun x tsc --noEmit -p tsconfig.typecheck.json || ROOT_FAIL=1

echo ""
echo "→ Typechecking web (SvelteKit)..."
cd "$ROOT/web"
bunx --bun svelte-kit sync > /dev/null 2>&1 || true
bun x tsc --noEmit || WEB_FAIL=1

echo ""
# Wave-3 legs: backend test files + web/e2e — previously typechecked by
# NOTHING. scripts/typecheck-tests.ts rejects any entry in its committed
# exclusion JSON, then composes temp child configs of tsconfig.tests.json /
# web/tsconfig.e2e.json. Needs
# the svelte-kit sync above (aliases + generated $types).
cd "$ROOT"
bun scripts/typecheck-tests.ts || TESTS_FAIL=1

echo ""
# Package legs: each packages/@ezcorp/<pkg>/tsconfig.json covers that
# package's src AND its tests. The legs above exclude packages/**/*.test.ts,
# so before this loop package tests were typechecked by NOTHING. A package
# without a tsconfig.json has no leg: a new package must be made clean and
# given one, never skipped by an exclusion here.
echo "→ Typechecking packages (src + tests)..."
for config in "$ROOT"/packages/@ezcorp/*/tsconfig.json; do
  echo "  ${config#"$ROOT"/}"
  bun x tsc --noEmit -p "$config" || PACKAGES_FAIL=1
done

echo ""
# Biome and tsc cannot see Python. Without this leg every line of the locked
# Python distribution is untyped in a repository that calls itself typechecked.
# scripts/python-quality.sh fails closed when uv, the lock, or the pinned
# interpreter is missing, so an absent toolchain reds this leg rather than
# silently reducing its scope.
echo "→ Typechecking the locked Python distribution (mypy --strict)..."
bash "$ROOT/scripts/python-quality.sh" typecheck || PYTHON_FAIL=1

echo ""
if [ "$ROOT_FAIL" -eq 0 ] && [ "$WEB_FAIL" -eq 0 ] && [ "$TESTS_FAIL" -eq 0 ] && [ "$PACKAGES_FAIL" -eq 0 ] && [ "$PYTHON_FAIL" -eq 0 ]; then
  echo "✓ Typecheck passed."
  exit 0
fi
[ "$ROOT_FAIL" -ne 0 ] && echo "✗ Backend (src/) typecheck failed."
[ "$WEB_FAIL" -ne 0 ] && echo "✗ Web typecheck failed."
[ "$TESTS_FAIL" -ne 0 ] && echo "✗ Tests/e2e typecheck failed (see scripts/typecheck-tests.ts output)."
[ "$PACKAGES_FAIL" -ne 0 ] && echo "✗ Package (src + tests) typecheck failed."
[ "$PYTHON_FAIL" -ne 0 ] && echo "✗ Python typecheck failed (see scripts/python-quality.sh typecheck output)."
exit 1
