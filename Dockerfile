FROM node:25-alpine AS web-builder
WORKDIR /app/web

RUN npm config set registry https://registry.npmmirror.com

COPY web/package*.json ./
RUN npm install

COPY web/ .
RUN npm run build

FROM node:25-alpine AS server-builder
WORKDIR /app/server

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN npm config set registry https://registry.npmmirror.com
RUN apk add --no-cache openssl

COPY server/package*.json ./
RUN npm install

COPY server/ .
RUN npx prisma generate
RUN npm run prod:build

FROM node:25-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/flashnext.db
ENV STATIC_PATH=/app/web/dist

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN npm config set registry https://registry.npmmirror.com
RUN apk add --no-cache openssl
RUN mkdir -p /app/data

COPY server/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=server-builder /app/server/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=server-builder /app/server/dist ./dist
COPY server/prisma ./prisma
COPY server/scripts ./scripts
COPY --from=web-builder /app/web/dist ./web/dist

EXPOSE 3000

CMD ["sh", "/app/scripts/entrypoint.sh"]
