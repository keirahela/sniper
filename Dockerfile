FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && mkdir /app/.local \
    && chown node:node /app/.local

COPY --chown=node:node src ./src
COPY --chown=node:node accounts.json ./accounts.json
USER node
CMD ["node", "src/index.js"]
