#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command="${1:-serve}"
if [ "$#" -gt 0 ]; then shift; fi
case "$command" in
  serve) exec node --env-file-if-exists=.env src/server.js "$@" ;;
  verify) exec node scripts/import-corpus.js --verify ;;
  test) exec npm test -- "$@" ;;
  browser) exec npm run test:e2e -- "$@" ;;
  evaluate) exec node --env-file-if-exists=.env scripts/evaluate.js "$@" ;;
  baseline) exec node --env-file-if-exists=.env scripts/evaluate.js --retrieval baseline "$@" ;;
  heldout) exec node --env-file-if-exists=.env scripts/evaluate.js --split heldout "$@" ;;
  freshness) exec node scripts/freshness.js ;;
  benchmark) exec node --env-file-if-exists=.env scripts/benchmark.js "$@" ;;
  bootstrap) exec node scripts/import-corpus.js "$@" ;;
  *) printf 'Usage: bash scripts/reproduce.sh {serve|verify|test|browser|evaluate|baseline|heldout|freshness|benchmark|bootstrap}\n' >&2; exit 2 ;;
esac
