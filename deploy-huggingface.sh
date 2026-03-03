#!/bin/bash
# deploy-huggingface.sh — Deploy KLH10 TOPS-20 emulator to Hugging Face Spaces
#
# Usage:
#   ./deploy-huggingface.sh USERNAME [SPACE_NAME]
#
# Prerequisites:
#   - Hugging Face account
#   - git with HF credentials configured (https://huggingface.co/settings/tokens)
#
# Example:
#   ./deploy-huggingface.sh robchang tops20

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Parse arguments
HF_USER="${1:-}"
SPACE_NAME="${2:-tops20}"

if [ -z "$HF_USER" ]; then
    echo "Usage: $0 USERNAME [SPACE_NAME]"
    echo ""
    echo "  USERNAME    Your Hugging Face username"
    echo "  SPACE_NAME  Name for the Space (default: tops20)"
    echo ""
    echo "Prerequisites:"
    echo "  1. Create a Hugging Face account at https://huggingface.co"
    echo "  2. Create an access token at https://huggingface.co/settings/tokens"
    echo "  3. Run: git credential approve <<< \"protocol=https host=huggingface.co username=$HF_USER password=YOUR_TOKEN\""
    exit 1
fi

SPACE_REPO="https://huggingface.co/spaces/${HF_USER}/${SPACE_NAME}"
DEPLOY_DIR="${TMPDIR:-/tmp}/klh10-hf-deploy-$$"

cleanup() {
    rm -rf "$DEPLOY_DIR"
}
trap cleanup EXIT

echo "=============================================="
echo "Deploying KLH10 to Hugging Face Spaces"
echo "  Space: ${HF_USER}/${SPACE_NAME}"
echo "  URL:   ${SPACE_REPO}"
echo "=============================================="
echo ""

# Step 1: Clone or create the Space repo
echo "[1/4] Setting up Space repository..."
if git ls-remote "$SPACE_REPO" &>/dev/null; then
    echo "  Cloning existing Space..."
    git clone "$SPACE_REPO" "$DEPLOY_DIR"
else
    echo "  Space does not exist yet. Please create it first:"
    echo "    1. Go to https://huggingface.co/new-space"
    echo "    2. Name: ${SPACE_NAME}"
    echo "    3. SDK: Docker"
    echo "    4. Template: Blank"
    echo "    5. Then re-run this script"
    exit 1
fi
echo ""

# Step 2: Copy files
echo "[2/4] Copying files..."

# Clean existing files (except .git and .gitattributes)
find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 -not -name '.git' -not -name '.gitattributes' -exec rm -rf {} +

# Ensure git-lfs is initialized and .gitattributes tracks binary files
cd "$DEPLOY_DIR"
git lfs install --local 2>/dev/null || true
git lfs track "*.wasm" "*.sav" "*.tap" 2>/dev/null || true
cd "$SCRIPT_DIR"

# Copy Dockerfile (renamed from Dockerfile.huggingface)
cp "$SCRIPT_DIR/Dockerfile.huggingface" "$DEPLOY_DIR/Dockerfile"
echo "  Dockerfile"

# Copy download script
cp "$SCRIPT_DIR/download-images.sh" "$DEPLOY_DIR/download-images.sh"
echo "  download-images.sh"

# Copy .dockerignore
cp "$SCRIPT_DIR/.dockerignore" "$DEPLOY_DIR/.dockerignore"
echo "  .dockerignore"

# Copy WASM build files
mkdir -p "$DEPLOY_DIR/build/wasm/bld-kl"
for f in index.html main.js emulator-worker.js kn10-kl.js kn10-kl.wasm \
         serve.js tops20-config-commands.txt tops20-boot-commands.txt \
         boot.sav mtboot.sav rogue.tap vt100-frame.webp; do
    if [ -f "$SCRIPT_DIR/build/wasm/bld-kl/$f" ]; then
        cp "$SCRIPT_DIR/build/wasm/bld-kl/$f" "$DEPLOY_DIR/build/wasm/bld-kl/$f"
        echo "  build/wasm/bld-kl/$f"
    else
        echo "  WARNING: build/wasm/bld-kl/$f not found"
    fi
done

# Copy bootstrap loaders (needed by download-images.sh)
mkdir -p "$DEPLOY_DIR/run/klt20"
cp "$SCRIPT_DIR/run/klt20/boot.sav" "$DEPLOY_DIR/run/klt20/boot.sav"
cp "$SCRIPT_DIR/run/klt20/mtboot.sav" "$DEPLOY_DIR/run/klt20/mtboot.sav"
echo "  run/klt20/boot.sav"
echo "  run/klt20/mtboot.sav"
echo ""

# Step 3: Create HF Space README.md
echo "[3/4] Creating Space configuration..."
cat > "$DEPLOY_DIR/README.md" << 'READMEEOF'
---
title: TOPS-20 PDP-10 Emulator
emoji: "\U0001F5A5"
colorFrom: blue
colorTo: blue
sdk: docker
app_port: 7860
custom_headers:
  cross-origin-embedder-policy: require-corp
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---

# TOPS-20 PDP-10 Emulator

A PDP-10 mainframe emulator running DEC TOPS-20 V7.0 in your browser via WebAssembly.

Click **Boot TOPS-20** and wait ~30 seconds for the boot sequence to complete.

WebAssembly port via agentic coding by Rob Chang.
KLH10 emulator by Kenneth L. Harrenstien.
Panda TOPS-20 distribution by Mark Crispin.

Source: [github.com/robchang/tops20](https://github.com/robchang/tops20)
READMEEOF
echo "  README.md (HF Space config)"
echo ""

# Step 4: Push to HF
echo "[4/4] Pushing to Hugging Face..."
cd "$DEPLOY_DIR"
git add -A
git commit -m "Deploy KLH10 TOPS-20 emulator" || {
    echo "  No changes to deploy."
    exit 0
}
git push

echo ""
echo "=============================================="
echo "Deployment complete!"
echo "  Space: ${SPACE_REPO}"
echo "=============================================="
echo ""
echo "The Space will now build the Docker image (this takes several minutes"
echo "as it downloads the 476 MB disk image during build)."
echo ""
echo "Once built, open: ${SPACE_REPO}"
