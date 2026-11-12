#!/usr/bin/env bash
set -euo pipefail
gre_task_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
gre_page="$gre_task_dir/gre-reading-studio/dist/index.html"
if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$gre_page"
elif command -v gio >/dev/null 2>&1; then
  exec gio open "$gre_page"
fi
printf '%s\n' 'Open this webpage in Chrome or Edge:' "$gre_page"
