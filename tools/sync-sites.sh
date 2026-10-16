#!/usr/bin/env bash
# Copy the shared code from WH1 (the reference site) to the other sites.
#
#   tools/sync-sites.sh          -> updates GW/ and WH4/
#
# What is NOT copied (site specific, edit it inside each site folder):
#   js/firebase-config.js   Firebase project + siteConfig.gatepassPrefix
#
# Site specific text in the HTML (page titles, "LDC-SR" / "LDC-GW",
# the security guard company on the print-out) is rewritten below.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/WH1"

sync_site() {
  local site="$1"
  local dst="$ROOT/$site"
  mkdir -p "$dst"
  (cd "$SRC" && find . -type f ! -path "./js/firebase-config.js") |
    while read -r rel; do
      mkdir -p "$dst/$(dirname "$rel")"
      cp "$SRC/$rel" "$dst/$rel"
    done
}

# sed on every HTML page of a site
sed_html() {
  local site="$1"
  shift
  find "$ROOT/$site" -name "*.html" -exec sed -i "$@" {} +
}

# --- WH4: same company texts as WH1, only the site name differs ---
sync_site WH4
sed_html WH4 -e 's/<title>\(.*\) - WH1<\/title>/<title>\1 - WH4<\/title>/'

# --- GW: LDC-GW, guard company is ISUZU ---
sync_site GW
sed_html GW \
  -e 's/<title>\(.*\) - WH1<\/title>/<title>\1 - LDC-GW<\/title>/' \
  -e 's/LDC-SR/LDC-GW/g' \
  -e 's/Security guard (รปภ.)<br \/>LINEX/Security guard (รปภ.)<br \/>ISUZU MOTORS (THAILAND)/'

echo "Synced WH1 -> WH4, GW"
