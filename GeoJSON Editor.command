#!/bin/bash
set -u

# Finder may launch Terminal without the interactive shell's PATH.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

pause_on_error() {
  if [[ -t 0 ]]; then
    read -r -p 'Pencereyi kapatmak için Enter tuşuna basın. ' unused
  fi
}

cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Node.js ve npm gerekli. Node.js 22.12 veya üstünü kurup tekrar deneyin.' >&2
  pause_on_error
  exit 1
fi

node scripts/start-local.mjs
result=$?
if [[ "$result" != 0 ]]; then pause_on_error; fi
exit "$result"
