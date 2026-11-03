#!/bin/bash
# Enregistre ta clé d'API Anthropic dans le trousseau macOS.
# La clé n'est écrite dans aucun fichier et ne passe par aucune ligne de commande: macOS la demande
# lui-même, sans l'afficher.
set -eu
[ "$(uname)" = "Darwin" ] || { echo "Ce script est pour macOS. Ailleurs, utilise la variable ANTHROPIC_API_KEY." >&2; exit 1; }
echo "Colle ta clé d'API quand macOS la demande (elle n'apparaît pas à l'écran)."
security add-generic-password -U -a "$USER" -s horizon-anthropic -w
echo "Clé enregistrée dans le trousseau. Elle est prise en compte dans les 30 secondes."
echo "Pour la retirer: security delete-generic-password -s horizon-anthropic"
