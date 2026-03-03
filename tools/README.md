# Rogue Build Tools

Tools for rebuilding the pre-built `rogue.tap` tape image.

## Files

- `create-dumper-tape.mjs` — Packages source files into a TOPS-20 DUMPER format tape
- `build-rogue-exe.mjs` — Boots TOPS-20 in headless Chromium, compiles Rogue, and captures the result

## Rebuilding rogue.tap

Prerequisites: `npm install playwright && npx playwright install chromium`

```bash
# 1. Create a source tape from rogue-src/ files
node tools/create-dumper-tape.mjs build/wasm/bld-kl/rogue.tap \
  "rogue-src/rogue.pas:ROGUE.PAS" \
  "rogue-src/rogue.constants:ROGUE.CONSTANTS" \
  "rogue-src/extern.mac:EXTERN.MAC" \
  "rogue-src/rogue.configuration:ROGUE.CONFIGURATION"

# 2. Start the dev server
npm start &

# 3. Build the EXE inside the emulator and capture the result
node tools/build-rogue-exe.mjs

# Output: build/wasm/bld-kl/rogue.tap (pre-built EXE + config files)
```

## Rogue source

The `rogue-src/` directory contains the original TOPS-20 Rogue source code
(Pascal + MACRO assembly). See `rogue-src/PROVENANCE.md` for attribution.
