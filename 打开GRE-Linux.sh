#!/bin/sh
# Run with: sh ./打开GRE-Linux.sh
# No executable bit is required, including on USB drives mounted with noexec.
set -eu
case "$0" in
  /*) gre_script=$0 ;;
  *) gre_script=$PWD/$0 ;;
esac
gre_dir=$(CDPATH= cd -P "$(dirname "$gre_script")" && pwd -P)
gre_page=$gre_dir/GRE-start.html
if [ ! -f "$gre_page" ]; then
  printf '%s\n' 'GRE-start.html was not found. Keep this launcher inside the GRE folder.' >&2
  exit 1
fi
# Both desktop openers accept a literal absolute filename, including spaces.
if command -v xdg-open >/dev/null 2>&1; then
  if xdg-open "$gre_page"; then exit 0; fi
fi
if command -v gio >/dev/null 2>&1; then
  if gio open "$gre_page"; then exit 0; fi
fi
printf 'Open this file with your web browser:\n%s\n' "$gre_page" >&2
exit 1
