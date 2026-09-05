# One image, two commands: the API and the worker are the same code.
#   api    → node src/index.js
#   worker → node src/worker/index.js
FROM node:20-alpine

WORKDIR /app

# install deps first so a source edit does not reinstall everything
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=development \
    PORT=4000 \
    HOST=0.0.0.0

EXPOSE 4000
CMD ["node", "src/index.js"]
