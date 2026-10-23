# template_components_catalog — monorepo (Next.js + Nuxt static exports)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm install --no-audit --no-fund
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/docs /usr/share/nginx/html
