# DC Ayakkabı Satış — tek imaj: web arayüzü + API sunucusu + SQLite veritabanı
FROM node:22-bookworm-slim AS build
# better-sqlite3 yerel modülü derlenebilsin diye derleme araçları (sadece bu aşamada)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build && npm prune --omit=dev --workspaces --include-workspace-root && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Europe/Istanbul PORT=3000 DATA_DIR=/data WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/scripts/sifre-sifirla.mjs server/scripts/
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
CMD ["node", "dist/index.js"]
