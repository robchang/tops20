# Rogue Build Tools

Tools for rebuilding the pre-built `rogue.tap` tape image.

## Files

- `create-dumper-tape.mjs` — Packages source files into a TOPS-20 DUMPER format tape
- `build-rogue-exe.mjs` — Boots TOPS-20 in headless Chromium, compiles Rogue, and captures the result

## Rebuilding rogue.tap

Prerequisites: `npm install playwright && npx playwright install chromium`

```bash
# 1. Clone the Rogue source
git clone https://github.com/PDP-10/rogue.git rogue-src

# 2. Create a source tape from the cloned files
node tools/create-dumper-tape.mjs build/wasm/bld-kl/rogue.tap \
  "rogue-src/rogue.pas:ROGUE.PAS" \
  "rogue-src/rogue.constants:ROGUE.CONSTANTS" \
  "rogue-src/extern.mac:EXTERN.MAC" \
  "rogue-src/rogue.configuration:ROGUE.CONFIGURATION"

# 3. Start the dev server
npm start &

# 4. Build the EXE inside the emulator and capture the result
node tools/build-rogue-exe.mjs

# Output: build/wasm/bld-kl/rogue.tap (pre-built EXE + config files)
```

## Rogue source

The original TOPS-20 Rogue source code (Pascal + MACRO assembly) is at:
https://github.com/PDP-10/rogue
