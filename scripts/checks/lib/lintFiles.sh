#!/bin/sh
# Sourced after the lint wrapper has changed to its own checkout.
list_lint_files() (
  # Git hook variables override the working directory, even in a nested checkout.
  git_variables=$(git rev-parse --local-env-vars)
  for name in $git_variables; do unset "$name"; done
  checkout=$(pwd -P)
  root=$(git rev-parse --show-toplevel)
  [ "$root" = "$checkout" ] || { echo "Lint requires its own Git checkout." >&2; exit 1; }
  git ls-files --cached --others --exclude-standard -z -- "$@"
)
