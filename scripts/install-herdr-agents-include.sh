#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Install or update the pi-tools Herdr guidance block in an AGENTS.md file.

Default target:
  ~/.pi/agent/AGENTS.md

Usage:
  scripts/install-herdr-agents-include.sh [options]

Options:
  --target-dir DIR       Write DIR/AGENTS.md. Use this for a project or parent directory.
  --agents-file FILE     Write this exact AGENTS.md path.
  --include FILE         Source include markdown. Default: agent-includes/herdr.md in this repo.
  --check                Do not write; exit 0 if target is current, 1 otherwise.
  --print-target         Print resolved target path and exit.
  -h, --help            Show this help.

Examples:
  # Global pi agent instructions
  scripts/install-herdr-agents-include.sh

  # Project-local instructions
  scripts/install-herdr-agents-include.sh --target-dir /path/to/project

  # Shared parent directory instructions for many repos
  scripts/install-herdr-agents-include.sh --target-dir ~/projects
USAGE
}

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
include_file="$repo_root/agent-includes/herdr.md"
agents_file="${PI_AGENT_HOME:-$HOME/.pi/agent}/AGENTS.md"
check=0
print_target=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || { echo "--target-dir requires DIR" >&2; exit 2; }
      agents_file="$2/AGENTS.md"
      shift 2
      ;;
    --agents-file)
      [[ $# -ge 2 ]] || { echo "--agents-file requires FILE" >&2; exit 2; }
      agents_file="$2"
      shift 2
      ;;
    --include)
      [[ $# -ge 2 ]] || { echo "--include requires FILE" >&2; exit 2; }
      include_file="$2"
      shift 2
      ;;
    --check)
      check=1
      shift
      ;;
    --print-target)
      print_target=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

agents_dir=$(dirname -- "$agents_file")
mkdir -p -- "$agents_dir"
agents_dir=$(CDPATH= cd -- "$agents_dir" && pwd)
agents_file="$agents_dir/$(basename -- "$agents_file")"

if [[ $print_target -eq 1 ]]; then
  printf '%s\n' "$agents_file"
  exit 0
fi

[[ -f "$include_file" ]] || { echo "Include not found: $include_file" >&2; exit 1; }

export AGENTS_FILE="$agents_file"
export INCLUDE_FILE="$include_file"
export REPO_ROOT="$repo_root"
export CHECK_ONLY="$check"

python3 <<'PY'
from __future__ import annotations

import os
import sys
from pathlib import Path

agents_file = Path(os.environ["AGENTS_FILE"])
include_file = Path(os.environ["INCLUDE_FILE"])
repo_root = Path(os.environ["REPO_ROOT"]).resolve()
check_only = os.environ["CHECK_ONLY"] == "1"

start = "<!-- BEGIN pi-tools:herdr -->"
end = "<!-- END pi-tools:herdr -->"

doc_path = repo_root / "docs" / "herdr-panes.md"
include = include_file.read_text()
include = include.replace("(../docs/herdr-panes.md)", f"({doc_path})")
include = include.rstrip()

block = f"""{start}
<!-- Managed by {repo_root}/scripts/install-herdr-agents-include.sh; edit source at {include_file}. -->

{include}
{end}
"""

old = agents_file.read_text() if agents_file.exists() else ""

if start in old and end in old:
    before, rest = old.split(start, 1)
    _managed, after = rest.split(end, 1)
    prefix = "" if not before.strip() else before.rstrip() + "\n\n"
    suffix = after.lstrip("\n")
    new = prefix + block + suffix
else:
    sep = "" if not old.strip() else "\n\n"
    new = old.rstrip() + sep + block

if old == new:
    print(f"Already current: {agents_file}")
    sys.exit(0)

if check_only:
    print(f"Needs update: {agents_file}")
    sys.exit(1)

agents_file.write_text(new)
print(f"Updated: {agents_file}")
PY
