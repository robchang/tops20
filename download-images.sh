#!/bin/bash
# download-images.sh — Downloads TOPS-20 disk and tape images for KLH10 WASM builds
#
# These are historical DEC and community-maintained software distribution images.
# All files are freely available from public PDP-10 preservation archives.
#
# Sources:
#   - DEC TOPS-20 tapes: http://pdp-10.trailing-edge.com/tapes/
#   - Panda TOPS-20 distribution: https://panda.trailing-edge.com/
#   - Panda tape image: https://github.com/PDP-10/panda
#
# Requirements: curl, bunzip2, tar
#
# Verified checksums (MD5):
#   RH20.RP07.1        1cee5bd59bfcf0a0876360c195293998
#   bb-h137f-bm.tap    a82ad1f21d28dd5bd905fe24b789eb5c
#   panda.tap           c543517319a2b37025531f7d798ebb74

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BLD_KL="$SCRIPT_DIR/build/wasm/bld-kl"
BLD_KS="$SCRIPT_DIR/build/wasm/bld-ks"
TAPES_DIR="$SCRIPT_DIR/tapes"
TMPDIR="${TMPDIR:-/tmp}/klh10-download-$$"

# Expected MD5 checksums
MD5_RH20="1cee5bd59bfcf0a0876360c195293998"
MD5_BB_H137F="a82ad1f21d28dd5bd905fe24b789eb5c"
MD5_PANDA_TAP="c543517319a2b37025531f7d798ebb74"

cleanup() {
    rm -rf "$TMPDIR"
}
trap cleanup EXIT

check_md5() {
    local file="$1"
    local expected="$2"
    local actual
    actual=$(md5sum "$file" | cut -d' ' -f1)
    if [ "$actual" = "$expected" ]; then
        echo "  checksum OK: $actual"
        return 0
    else
        echo "  checksum MISMATCH: expected $expected, got $actual"
        return 1
    fi
}

echo "=============================================="
echo "KLH10 TOPS-20 Image Downloader"
echo "=============================================="
echo ""

# Check prerequisites
for cmd in curl bunzip2 tar md5sum; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: Required command '$cmd' not found. Please install it."
        exit 1
    fi
done

mkdir -p "$TMPDIR"
mkdir -p "$BLD_KL"

# -----------------------------------------------
# 1. Download RH20.RP07.1 (Panda TOPS-20 pre-installed disk image)
#    Source: Mark Crispin's Panda distribution
#    From: https://panda.trailing-edge.com/panda-dist.tar.gz
# -----------------------------------------------
if [ -f "$BLD_KL/RH20.RP07.1" ]; then
    echo "[1/3] RH20.RP07.1 already exists in $BLD_KL/, verifying..."
    check_md5 "$BLD_KL/RH20.RP07.1" "$MD5_RH20" || {
        echo "  Existing file has wrong checksum, re-downloading..."
        rm -f "$BLD_KL/RH20.RP07.1"
    }
fi

if [ ! -f "$BLD_KL/RH20.RP07.1" ]; then
    echo "[1/3] Downloading Panda distribution (221 MB compressed)..."
    echo "  Source: https://panda.trailing-edge.com/panda-dist.tar.gz"
    echo "  This is Mark Crispin's enhanced TOPS-20 with pre-installed system on RP07 disk."
    curl -L --progress-bar -o "$TMPDIR/panda-dist.tar.gz" \
        "https://panda.trailing-edge.com/panda-dist.tar.gz"

    echo "  Extracting RH20.RP07.1 (476 MB)..."
    tar xzf "$TMPDIR/panda-dist.tar.gz" -C "$TMPDIR" panda-dist/RH20.RP07.1
    mv "$TMPDIR/panda-dist/RH20.RP07.1" "$BLD_KL/RH20.RP07.1"
    rm -f "$TMPDIR/panda-dist.tar.gz"
    rm -rf "$TMPDIR/panda-dist"

    echo "  Verifying RH20.RP07.1..."
    check_md5 "$BLD_KL/RH20.RP07.1" "$MD5_RH20"
fi
echo ""

# -----------------------------------------------
# 2. Copy boot.sav and mtboot.sav from source tree
#    These are small files already in the repository.
#    boot.sav = disk bootstrap loader (23 KB)
#    mtboot.sav = tape bootstrap loader (20 KB)
# -----------------------------------------------
echo "[2/3] Copying bootstrap loaders from run/klt20/..."
if [ -f "$SCRIPT_DIR/run/klt20/boot.sav" ]; then
    cp "$SCRIPT_DIR/run/klt20/boot.sav" "$BLD_KL/boot.sav"
    echo "  boot.sav copied ($(du -h "$BLD_KL/boot.sav" | cut -f1))"
else
    echo "  WARNING: run/klt20/boot.sav not found"
fi
if [ -f "$SCRIPT_DIR/run/klt20/mtboot.sav" ]; then
    cp "$SCRIPT_DIR/run/klt20/mtboot.sav" "$BLD_KL/mtboot.sav"
    echo "  mtboot.sav copied ($(du -h "$BLD_KL/mtboot.sav" | cut -f1))"
else
    echo "  WARNING: run/klt20/mtboot.sav not found"
fi
echo ""

# -----------------------------------------------
# 3. Download bb-h137f-bm.tap (DEC TOPS-20 V7.0 installation tape)
#    Source: DEC distribution BB-H137F-BM, "TOPS-20 V7.0 INSTL 16MT9"
#    From: http://pdp-10.trailing-edge.com/tapes/
#    Note: Not required for normal boot (we boot from disk), but useful
#    for fresh TOPS-20 installations from tape.
# -----------------------------------------------
if [ -f "$BLD_KL/bb-h137f-bm.tap" ]; then
    echo "[3/3] bb-h137f-bm.tap already exists, verifying..."
    check_md5 "$BLD_KL/bb-h137f-bm.tap" "$MD5_BB_H137F" || {
        echo "  Existing file has wrong checksum, re-downloading..."
        rm -f "$BLD_KL/bb-h137f-bm.tap"
    }
fi

if [ ! -f "$BLD_KL/bb-h137f-bm.tap" ]; then
    echo "[3/3] Downloading DEC TOPS-20 V7.0 install tape (8.5 MB compressed)..."
    echo "  Source: http://pdp-10.trailing-edge.com/tapes/bb-h137f-bm.tap.bz2"
    echo "  DEC part number BB-H137F-BM, 'TOPS-20 V7.0 INSTL 16MT9', copyright 1988 DEC."
    curl -L --progress-bar -o "$TMPDIR/bb-h137f-bm.tap.bz2" \
        "http://pdp-10.trailing-edge.com/tapes/bb-h137f-bm.tap.bz2"
    bunzip2 "$TMPDIR/bb-h137f-bm.tap.bz2"
    mv "$TMPDIR/bb-h137f-bm.tap" "$BLD_KL/bb-h137f-bm.tap"

    echo "  Verifying bb-h137f-bm.tap..."
    check_md5 "$BLD_KL/bb-h137f-bm.tap" "$MD5_BB_H137F"
fi
echo ""

# -----------------------------------------------
# Summary
# -----------------------------------------------
echo "=============================================="
echo "Download complete! Files in $BLD_KL/:"
echo "=============================================="
ls -lh "$BLD_KL/RH20.RP07.1" "$BLD_KL/boot.sav" "$BLD_KL/mtboot.sav" "$BLD_KL/bb-h137f-bm.tap" 2>/dev/null
echo ""
echo "To run the emulator:"
echo "  cd build/wasm/bld-kl"
echo "  node serve.js"
echo "  # Open http://localhost:8080"
echo "  # Click 'Boot TOPS-20' and wait ~30 seconds"
