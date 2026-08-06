# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Bill Pay — multi-stage image.
#
#   base       node + pnpm + the shared libs Prisma needs on Alpine
#   deps       full dependency tree (used to build)
#   prod-deps  runtime-only tree WITH the Prisma client already generated;
#              `prisma` and `tsx` are runtime deps on purpose so the container
#              can migrate and seed itself on start
#   builder    prisma generate + next build (standalone output)
#   runner     slim final image: standalone server + migration/seed toolchain
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
# openssl + libc6-compat are required by the Prisma query engine on Alpine.
RUN apk add --no-cache openssl libc6-compat
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
WORKDIR /app


FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile


FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
# Generate the Prisma client INTO the runtime tree, at build time and as root.
# The container runs as an unprivileged user against a read-only node_modules,
# so it must never need to generate the client at start-up.
COPY prisma ./prisma
RUN pnpm exec prisma generate


FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm exec next build


FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Runtime dependency tree (includes the Prisma CLI and tsx for the entrypoint).
COPY --from=prod-deps /app/node_modules ./node_modules

# Next.js standalone server: server.js + its traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migration + seed toolchain. `prisma/seed.ts` imports the shared approval
# policy resolver from src/lib, so the whole pure core ships alongside it —
# it is a handful of dependency-free .ts files, and shipping all of it means a
# later seed change cannot silently break the container. tsconfig.json comes
# too so tsx can resolve the `@/*` path alias.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/src/lib ./src/lib
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
