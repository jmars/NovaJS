#!/usr/bin/env bash
# Regenerates the Ghidra analysis project for EV_Nova.dat from scratch.
#
# The analyzed project is a build artifact (~30MB) and is NOT committed to
# git. This script reproduces it from the binary + the checked-in scripts
# (ghidra_scripts/). Run it when the project is missing (e.g. after a reboot
# wiped /tmp) or to re-analyze after Ghidra/toolchain changes.
#
# The binary is EV Nova 1.0.10 (copyrighted Ambrosia commercial data) and is
# kept OUT of git — it ships as the 'game-binary' GitHub release (jmars/NovaJS,
# sha256 43e8db386caa0fd32d48e8b5a45b81c894063870a0b52e95ef89a1c6471a248c).
# To fetch it:
#   gh release download game-binary --dir /tmp/evbin
#   unzip -o /tmp/evbin/EV_Nova.dat.zip -d /tmp/evbin
#   mkdir -p ../repo && mv /tmp/evbin/EV_Nova.dat ../repo/
# then run this script.
#
# Usage:
#   scripts/regenerate_ghidra.sh [project_dir]
#
# Defaults:
#   project_dir  ~/projects/evnova/ghidra_project   (gitignored, persistent)
#   project      EVNova
#   binary       repo/EV_Nova.dat  (sibling of novajs — kept out of git; see
#                repo/README or the binary's source before committing)
#
# Produces:
#   <project_dir>/EVNova.gpr  (+ EVNova.rep/) — the analyzed project.
#   The scripts then run with:
#     tools/ghidra_12.1.3_PUBLIC/support/analyzeHeadless <project_dir> EVNova \
#       -process EV_Nova.dat -noanalysis -scriptPath ghidra_scripts \
#       -postScript <script.java> <args>

set -euo pipefail

# Resolve repo root: this script lives in novajs/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOVAJS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EVNOVA_DIR="$(cd "$NOVAJS_DIR/.." && pwd)"

GHIDRA="$EVNOVA_DIR/tools/ghidra_12.1.3_PUBLIC/support/analyzeHeadless"
BINARY="$EVNOVA_DIR/repo/EV_Nova.dat"
PROJECT_DIR="${1:-$EVNOVA_DIR/ghidra_project}"
PROJECT="EVNova"
SCRIPTS_DIR="$NOVAJS_DIR/ghidra_scripts"

if [[ ! -x "$GHIDRA" ]]; then
    echo "ERROR: analyzeHeadless not found at $GHIDRA" >&2
    echo "Install Ghidra 12.1.3 to $EVNOVA_DIR/tools/ first." >&2
    exit 1
fi
if [[ ! -f "$BINARY" ]]; then
    echo "ERROR: binary not found at $BINARY" >&2
    echo "Place EV_Nova.dat there (it is kept out of git)." >&2
    exit 1
fi

mkdir -p "$PROJECT_DIR"

echo "Importing + analyzing $BINARY into $PROJECT_DIR/$PROJECT ..."
echo "  scripts: $SCRIPTS_DIR"
# -import performs the initial analysis; the scripts run later with
# -process ... -noanalysis (no re-analysis needed for decompile scripts).
"$GHIDRA" "$PROJECT_DIR" "$PROJECT" -import "$BINARY"

echo "Done. Project: $PROJECT_DIR/$PROJECT.gpr"
echo "Example script run:"
echo "  $GHIDRA $PROJECT_DIR $PROJECT -process EV_Nova.dat -noanalysis \\"
echo "    -scriptPath $SCRIPTS_DIR -postScript ghidra_ambient.java 0x0041af90"
