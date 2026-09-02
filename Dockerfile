# syntax=docker/dockerfile:1

# SignDrop container image (KaiCorp Labs Standard)
#
# Multi-stage: dependencies and build are discarded, final image carries
# only the Next.js standalone output.

# ── Dependencies ─────────────────────────────────────────────────────
# `npm ci` against the committed lockfile, so the image is the same one
# twice; `npm install` without it resolved whatever was newest that day.
# `--ignore-scripts` because postinstall copies pdf.js's assets and the
# source is not here yet — it runs in the builder, where it can.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The worker, character maps and standard fonts pdf.js needs, into public/,
# so nothing in the running image ever reaches for a CDN. Together with
# public/trust they are carried into the standalone output by postbuild.
RUN node scripts/copy-pdfjs-assets.mjs && npm run build

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SIGNDROP_PORT=3466 \
    SIGNDROP_HOST=0.0.0.0 \
    PORT=3466 \
    HOSTNAME=0.0.0.0

RUN apk -U upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup --system --gid 10001 signdrop \
 && adduser --system --uid 10001 --ingroup signdrop signdrop

COPY --from=builder --chown=root:root /app/.next/standalone ./

EXPOSE 3466
USER signdrop

CMD ["node", "start.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3466)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.title="SignDrop" \
      org.opencontainers.image.description="Client-side PDF signing, cryptographic sealing, and document verification." \
      org.opencontainers.image.source="https://github.com/Ulzuhan/signdrop" \
      org.opencontainers.image.licenses="MIT"
