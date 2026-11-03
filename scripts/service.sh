#!/bin/bash
# Horizon en arrière-plan sur macOS (launchd), accessible depuis tes appareils via Tailscale Serve.
#
#   bash scripts/service.sh install [compte-tailscale]   installe, démarre et publie sur ton réseau Tailscale
#   bash scripts/service.sh restart                      reconstruit puis redémarre (après une mise à jour du code)
#   bash scripts/service.sh status                       état du service, de la publication et de l'adresse
#   bash scripts/service.sh logs                         suit le journal
#   bash scripts/service.sh url                          affiche l'adresse Tailscale
#   bash scripts/service.sh uninstall                    arrête, supprime le service et la publication
#   bash scripts/service.sh plist                        affiche le fichier launchd sans rien installer
#
# SÉCURITÉ
#   - Le serveur n'écoute que sur 127.0.0.1. Tailscale Serve relaie les appareils de TON réseau.
#   - Seul le compte Tailscale indiqué est autorisé (variable HORIZON_ALLOWED_LOGIN). Fermé par défaut.
#   - La publication utilise le port HTTPS 8443 pour ne pas toucher à tes autres services Tailscale.
#   - N'utilise JAMAIS `tailscale funnel`: il publierait Horizon sur Internet.
#   - L'import de dossiers n'est possible que depuis le Mac lui-même.

set -eu

LABEL="ch.horizon.app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/horizon.log"
PORT="${HORIZON_PORT:-5173}"
TS_PORT="${HORIZON_TS_PORT:-8443}"

say() { printf '%s\n' "$*"; }
die() { printf 'Erreur: %s\n' "$*" >&2; exit 1; }

find_node() { command -v node 2>/dev/null || true; }

find_tailscale() {
  for c in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale /opt/homebrew/bin/tailscale /usr/local/bin/tailscale; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
    if [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
  done
  return 0
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# Compte Tailscale de ce Mac, lu auprès de Tailscale lui-même.
detect_login() {
  ts="$(find_tailscale)"; [ -n "$ts" ] || return 0
  ip="$("$ts" ip -4 2>/dev/null | head -n 1 || true)"; [ -n "$ip" ] || return 0
  "$ts" whois --json "$ip" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.UserProfile&&j.UserProfile.LoginName)||"")}catch(e){}})' || true
}

# Nom de domaine Tailscale de ce Mac (https://<nom>.ts.net).
detect_dns() {
  ts="$(find_tailscale)"; [ -n "$ts" ] || return 0
  "$ts" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(((j.Self&&j.Self.DNSName)||"").replace(/\.$/,""))}catch(e){}})' || true
}

make_plist() {
  node_bin="$1"; login="$2"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$node_bin")</string>
    <string>$(xml_escape "$ROOT")/node_modules/vite/bin/vite.js</string>
    <string>preview</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>$PORT</string>
    <string>--strictPort</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HORIZON_ALLOWED_LOGIN</key><string>$(xml_escape "$login")</string>
    <key>HORIZON_LLM</key><string>$(xml_escape "${HORIZON_LLM:-auto}")</string>
    <key>HORIZON_OLLAMA_MODEL</key><string>$(xml_escape "${HORIZON_OLLAMA_MODEL:-qwen3:8b}")</string>
    <key>PATH</key><string>$(xml_escape "$(dirname "$node_bin")"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG")</string>
</dict>
</plist>
PLIST
}

wait_up() {
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -fsS "http://127.0.0.1:$PORT/api/state?db=demo" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

publish() {
  ts="$(find_tailscale)"
  if [ -z "$ts" ]; then
    say "Tailscale n'est pas installé ou introuvable: Horizon tourne en local seulement (http://localhost:$PORT)."
    return 0
  fi
  if "$ts" serve --bg --https="$TS_PORT" "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    dns="$(detect_dns)"
    say "Publié sur ton réseau Tailscale: https://${dns:-<nom-de-ce-mac>.ts.net}:$TS_PORT"
  else
    say "La publication Tailscale a échoué. Vérifie que Tailscale est connecté et que HTTPS est activé"
    say "pour ton réseau (console d'administration Tailscale, onglet DNS, « HTTPS Certificates »),"
    say "puis relance: bash scripts/service.sh install"
  fi
}

cmd="${1:-}"
case "$cmd" in
  install)
    node_bin="$(find_node)"; [ -n "$node_bin" ] || die "Node introuvable. Installe-le avec: brew install node"
    "$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)' || die "Node 22.5 ou plus est requis (version actuelle: $("$node_bin" -v))."
    cd "$ROOT"
    [ -d node_modules ] || npm install
    npm run build
    login="${2:-${HORIZON_ALLOWED_LOGIN:-}}"
    [ -n "$login" ] || login="$(detect_login)"
    [ -n "$login" ] || die "Compte Tailscale introuvable. Relance avec: bash scripts/service.sh install ton-compte@exemple.com"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    make_plist "$node_bin" "$login" > "$PLIST"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    if wait_up; then say "Horizon tourne en arrière-plan: http://localhost:$PORT (compte autorisé: $login)"; else die "Le service ne répond pas. Regarde: bash scripts/service.sh logs"; fi
    publish
    ;;
  restart)
    cd "$ROOT"; npm run build
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    wait_up && say "Redémarré." || die "Le service ne répond pas. Regarde: bash scripts/service.sh logs"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then say "Service: installé"; else say "Service: non installé"; fi
    if curl -fsS "http://127.0.0.1:$PORT/api/state?db=demo" >/dev/null 2>&1; then say "Réponse locale: oui (http://localhost:$PORT)"; else say "Réponse locale: non"; fi
    ts="$(find_tailscale)"
    if [ -n "$ts" ]; then say "Publication Tailscale:"; "$ts" serve status 2>&1 | sed 's/^/  /' || true; fi
    ;;
  logs) mkdir -p "$(dirname "$LOG")"; touch "$LOG"; tail -n 50 -f "$LOG" ;;
  url)
    dns="$(detect_dns)"; [ -n "$dns" ] || die "Adresse Tailscale introuvable (Tailscale est-il connecté ?)."
    say "https://$dns:$TS_PORT"
    ;;
  uninstall)
    ts="$(find_tailscale)"
    [ -z "$ts" ] || "$ts" serve --https="$TS_PORT" off >/dev/null 2>&1 || true
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    say "Service et publication supprimés. Tes données (dossier data/) sont intactes."
    ;;
  plist)
    node_bin="$(find_node)"; [ -n "$node_bin" ] || node_bin="/usr/local/bin/node"
    make_plist "$node_bin" "${2:-${HORIZON_ALLOWED_LOGIN:-moi@example.com}}"
    ;;
  *)
    sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
