# Run-only Dockerfile for KLH10 TOPS-20 WebAssembly Emulator
# Builds a self-contained image with all disk/tape images included.
#
# Usage:
#   docker build -t tops20 .
#   docker run -p 8080:8080 tops20
#   Open http://localhost:8080

FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl bzip2 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN ./download-images.sh

EXPOSE 8080
CMD ["node", "build/wasm/bld-kl/serve.js"]
