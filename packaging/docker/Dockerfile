# syntax=docker/dockerfile:1
# OpsPoint in a container (profile docker): Postgres for the records
# (DATABASE_URL), the /data volume or object storage for photos, every setting
# from the environment (docs/SETTINGS.md). See docker-compose.yml beside this.
#
#   docker build -f packaging/docker/Dockerfile -t opspoint .
#
# Built from the repository root; .dockerignore lets in only what the app needs,
# so no key, database or settings file can end up in an image.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY client/package.json client/package-lock.json client/
RUN cd client && npm ci --no-audit --no-fund
COPY client client
RUN cd client && npm run build
COPY server.js db.js updater.js bootstrap.js generate_cert.js ./
COPY server server
COPY migrations migrations
COPY static static

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="OpsPoint" \
      org.opencontainers.image.description="Residential operations" \
      org.opencontainers.image.source="https://github.com/harrisb415/opspoint-releases"
ENV NODE_ENV=production \
    OPSPOINT_PROFILE=docker \
    OPSPOINT_DATA=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/package.json /src/package-lock.json /src/server.js /src/db.js /src/updater.js /src/bootstrap.js /src/generate_cert.js ./
COPY --from=build /src/server server
COPY --from=build /src/migrations migrations
COPY --from=build /src/static static
COPY --from=build /src/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
# /healthz fails only when the database is unreachable (the platform restarts the container).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
