#!/bin/sh
# Harness-style installer:
#   curl -fsSL https://raw.githubusercontent.com/akhan157/Plainhand/main/install.sh | sh
#
# Downloads the app, installs its dependencies and Chromium, creates a
# `plainhand` launcher, and starts it. Your workspace is kept separately.
set -eu

REPO="akhan157/Plainhand"
HOME_DIR="${PLAINHAND_HOME:-$HOME/.plainhand}"
BIN_DIR="${PLAINHAND_BIN_DIR:-$HOME/.local/bin}"
APP="$HOME_DIR/app"
# latest (default) = newest GitHub release; main = development version; or a tag such as v1.1.2.
VERSION="${PLAINHAND_VERSION:-latest}"
WORKSPACE="$HOME_DIR/workspace"
START=1

for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    --help|-h)
      echo "Usage: curl -fsSL https://raw.githubusercontent.com/akhan157/Plainhand/main/install.sh | sh"
      echo "       PLAINHAND_HOME=/path PLAINHAND_BIN_DIR=/path PLAINHAND_VERSION=latest|main|vX.Y.Z sh install.sh [--no-start]"
      echo "Workspace defaults to ~/.plainhand/workspace; launcher to ~/.local/bin/plainhand."
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Plainhand needs $1. Install it and run this again." >&2; exit 1; }; }
need node
need npm
need curl
need tar
NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Plainhand needs Node.js 22 or newer (this is $(node -v)). Install it from https://nodejs.org and run this again." >&2
  exit 1
fi

TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

case "$VERSION" in
  main) REF="refs/heads/main"; LABEL="development version (main)" ;;
  latest)
    TAG=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed -n 's#.*/releases/tag/##p')
    case "$TAG" in v[0-9]*) ;; *) echo "Could not find the latest Plainhand release. Check your connection, or set PLAINHAND_VERSION=main." >&2; exit 1 ;; esac
    REF="refs/tags/$TAG"; LABEL="$TAG" ;;
  v[0-9]*) REF="refs/tags/$VERSION"; LABEL="$VERSION" ;;
  *) echo "PLAINHAND_VERSION must be latest, main or a release tag such as v1.1.2." >&2; exit 2 ;;
esac
echo "Downloading Plainhand ${LABEL}…"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/plainhand.tar.gz"
tar -xzf "$TMP/plainhand.tar.gz" -C "$TMP"
SRC=""
for candidate in "$TMP"/Plainhand-*; do
  if [ -d "$candidate" ]; then SRC="$candidate"; break; fi
done
if [ -z "$SRC" ]; then echo "The download did not contain Plainhand." >&2; exit 1; fi

mkdir -p "$HOME_DIR"
rm -rf "$APP.new"
cp -R "$SRC" "$APP.new"

echo "Installing dependencies…"
(cd "$APP.new" && npm ci --no-audit --no-fund --omit=dev)

echo "Installing Chromium (first run only)…"
if ! (cd "$APP.new" && node node_modules/playwright/cli.js install chromium); then
  echo "Chromium did not install. Plainhand can still run; PDFs and form assistance need it." >&2
  echo "If needed, run: npx playwright install chromium" >&2
fi

if [ -d "$APP" ]; then rm -rf "$APP.old"; mv "$APP" "$APP.old"; fi
mv "$APP.new" "$APP"
rm -rf "$APP.old"
mkdir -p "$WORKSPACE" "$BIN_DIR"

cat > "$BIN_DIR/plainhand" <<LAUNCHER
#!/bin/sh
exec node "$APP/bin/plainhand.mjs" --data-root "$WORKSPACE" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/plainhand"

echo
echo "Plainhand is installed."
echo "  Workspace: $WORKSPACE"
echo "  Launcher:  $BIN_DIR/plainhand"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to your PATH to run 'plainhand' from anywhere." ;;
esac
if [ "$START" -eq 0 ]; then
  echo "Run: $BIN_DIR/plainhand"
  exit 0
fi
exec "$BIN_DIR/plainhand"
