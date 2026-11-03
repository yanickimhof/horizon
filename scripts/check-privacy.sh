#!/usr/bin/env bash
# Vérifie qu'aucune donnée personnelle n'est sur le point d'être versionnée.
# Usage: npm run check (ou automatiquement avant chaque commit, après `npm run hooks`).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

# 1. Fichiers qui ne doivent jamais partir: données, dépôt de documents, bases, secrets.
bad=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/)(data|inbox|extracted)/|\.db$|\.db-journal$|\.local\.|(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$bad" ]; then
  echo "Fichiers personnels dans l'index:"
  echo "$bad"
  fail=1
fi

# 2. Mots sensibles que tu as listés dans data/sensitive-terms.txt (un par ligne, fichier local).
if [ -f data/sensitive-terms.txt ] && grep -qv '^[[:space:]]*$' data/sensitive-terms.txt; then
  hits=$(git diff --cached -U0 | grep -E '^\+' | grep -v '^+++' | grep -iFf <(grep -v '^[[:space:]]*$' data/sensitive-terms.txt) || true)
  if [ -n "$hits" ]; then
    echo "Termes sensibles trouvés dans les changements:"
    echo "$hits" | head -20
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Commit bloqué. Retire ces éléments de l'index (git restore --staged <fichier>)."
  exit 1
fi
echo "Rien de personnel dans l'index."
