# Dev image: Vite serves ./src and proxies /api to the api service (see vite.config.js + compose env).
# For a real deploy, build once and host ./dist anywhere:
#   npm run build   →   serve dist/ behind nginx (the API also serves ../frontend/dist if WEB_DIST exists)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=development \
    WEB_PORT=5173 \
    VITE_PROXY_TARGET=http://api:4000

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
