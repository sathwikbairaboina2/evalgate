# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vitest.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY tests ./tests
COPY examples ./examples
RUN pnpm build

FROM node:24-slim AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/examples ./examples
COPY scripts/docker-example.sh ./scripts/docker-example.sh
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
