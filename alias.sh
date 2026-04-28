#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SCRIPT="$PROJECT_DIR/run.sh"
ALIAS_NAME="tailhub"

if [[ ! -f "$RUN_SCRIPT" ]]; then
  echo "Could not find run.sh at: $RUN_SCRIPT" >&2
  exit 1
fi

detect_shell_rc() {
  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh)
      printf '%s\n' "$HOME/.zshrc"
      ;;
    bash)
      printf '%s\n' "$HOME/.bashrc"
      ;;
    *)
      if [[ -f "$HOME/.zshrc" ]]; then
        printf '%s\n' "$HOME/.zshrc"
      else
        printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
  esac
}

RC_FILE="${1:-$(detect_shell_rc)}"
mkdir -p "$(dirname "$RC_FILE")"
touch "$RC_FILE"

START_MARKER="# >>> TailHub alias >>>"
END_MARKER="# <<< TailHub alias <<<"
ALIAS_BLOCK=$(cat <<EOF
$START_MARKER
alias $ALIAS_NAME='$RUN_SCRIPT'
$END_MARKER
EOF
)

TMP_FILE="$(mktemp)"
awk -v start="$START_MARKER" -v end="$END_MARKER" '
  $0 == start { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$RC_FILE" > "$TMP_FILE"

{
  cat "$TMP_FILE"
  printf '\n%s\n' "$ALIAS_BLOCK"
} > "$RC_FILE"
rm -f "$TMP_FILE"

echo "Added alias:"
echo "  $ALIAS_NAME -> $RUN_SCRIPT"
echo ""
echo "Updated shell config:"
echo "  $RC_FILE"
echo ""
echo "Reload it with:"
echo "  source \"$RC_FILE\""
echo ""
echo "Then start TailHub with:"
echo "  $ALIAS_NAME"
