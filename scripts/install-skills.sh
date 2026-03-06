#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/install-skills.sh <skills_dir> [--skip-verify]

Description:
  1) Copy all skills from this repository's skill/ into <skills_dir>
  2) Install dependencies for each copied skill that has package.json
  3) Run "verify" for skills that provide an npm script named verify (default)

Examples:
  scripts/install-skills.sh ~/.codex/skills
  scripts/install-skills.sh "$CODEX_HOME/skills" --skip-verify
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "$#" -lt 1 || "$#" -gt 2 ]]; then
  usage
  exit 0
fi

TARGET_DIR="$1"
SKIP_VERIFY="${2:-}"

if [[ -n "$SKIP_VERIFY" && "$SKIP_VERIFY" != "--skip-verify" ]]; then
  echo "Error: unknown option: $SKIP_VERIFY" >&2
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/skill"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Error: source skills directory not found: $SRC_DIR" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but not found in PATH." >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PKG_MGR="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PKG_MGR="npm"
else
  echo "Error: neither pnpm nor npm is available in PATH." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

echo "==> Installing skills to: $TARGET_DIR"
for src_skill in "$SRC_DIR"/*; do
  [[ -d "$src_skill" ]] || continue
  skill_name="$(basename "$src_skill")"
  dest_skill="$TARGET_DIR/$skill_name"
  rm -rf "$dest_skill"
  cp -R "$src_skill" "$dest_skill"
  echo "   - copied: $skill_name"
done

echo "==> Installing dependencies with $PKG_MGR"
for skill_dir in "$TARGET_DIR"/*; do
  [[ -d "$skill_dir" ]] || continue
  [[ -f "$skill_dir/package.json" ]] || continue
  echo "   - deps: $(basename "$skill_dir")"
  if [[ "$PKG_MGR" == "pnpm" ]]; then
    pnpm --dir "$skill_dir" install
  else
    npm --prefix "$skill_dir" install
  fi
done

if [[ "$SKIP_VERIFY" == "--skip-verify" ]]; then
  echo "==> Verify skipped."
  echo "Done."
  exit 0
fi

echo "==> Running verify scripts where available"
for skill_dir in "$TARGET_DIR"/*; do
  [[ -d "$skill_dir" ]] || continue
  [[ -f "$skill_dir/package.json" ]] || continue
  if node -e "const p=require(process.argv[1]); process.exit(p.scripts && p.scripts.verify ? 0 : 1)" "$skill_dir/package.json"; then
    echo "   - verify: $(basename "$skill_dir")"
    if [[ "$PKG_MGR" == "pnpm" ]]; then
      pnpm --dir "$skill_dir" run verify
    else
      npm --prefix "$skill_dir" run verify
    fi
  fi
done

echo "Done."
