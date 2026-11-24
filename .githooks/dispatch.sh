#!/bin/sh
# Each wrapper sources this file so hooks keep Git's working directory and arguments.
hook_dir=$(dirname "$0")
checker=scripts/publish-check.mjs
if [ ! -f "$checker" ]; then checker="$hook_dir/publish-check.mjs"; fi

chain_hook() {
  name=$1
  shift
  previous=$(git config --get finance.previousHooksPath) || return 0
  previous_hook=$(git -c core.hooksPath="$previous" rev-parse --git-path "hooks/$name") || return 2
  if [ -x "$previous_hook" ] && [ ! "$previous_hook" -ef "$0" ]; then
    # Also avoid recursion if an old relative hooksPath selects this checkout's own wrapper.
    if ! cmp -s "$previous_hook" "$0"; then "$previous_hook" "$@"; fi
  fi
}

scan_push() {
  while read -r local_ref new remote_ref old; do
    case "$new" in *[!0]*) ;; *) continue ;; esac
    for ref in "$local_ref" "$remote_ref"; do
      FINANCE_PUBLISH_TEXT_SCOPE=@branch-name node "$checker" --text "$ref" || return $?
    done
    node "$checker" --push-ref "$new" "$old" "$1" || return $?
  done
}

run_hook() {
  name=$1
  shift
  # Earlier checkout versions treat an absent private folder as an unconfigured machine.
  if [ -z "${LOCALAPPDATA:-}" ] || [ ! -r "$LOCALAPPDATA/finance/private/publish-check/inputs.json" ]; then
    echo "Publish check inputs are missing or unreadable." >&2
    exit 2
  fi
  export FINANCE_PUBLISH_REQUIRED=1
  case "$name" in
    pre-commit)
      chain_hook "$name" "$@"
      exec node "$checker" --staged ;;
    commit-msg)
      chain_hook "$name" "$@"
      export FINANCE_PUBLISH_TEXT_SCOPE=@commit-message
      exec node "$checker" --text-file "$1" ;;
    pre-push)
      # Both checks must see every ref, including when several branches are pushed at once.
      refs=$(mktemp) || exit 2
      trap 'rm -f "$refs"' EXIT
      cat >"$refs"
      scan_push "$1" <"$refs"
      chain_hook "$name" "$@" <"$refs" ;;
  esac
}
