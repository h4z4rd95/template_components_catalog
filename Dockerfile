# syntax=docker/dockerfile:1
# ---- build stage (npm workspaces monorepo, Next.js static export) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run catalog:sync && npm run build:next

# ---- serve stage (shared nginx:alpine base) ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/next-catalog/out /usr/share/nginx/html
EXPOSE 80
