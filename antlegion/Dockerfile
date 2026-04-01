FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./

# ── 系统依赖（Playwright Chromium + 常用工具）──
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    bash \
    git \
    wget

# Playwright 使用系统 Chromium，不要再下载
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ── 预装常用 npm 包到全局缓存 ──
# 创建一个临时项目安装依赖，利用 npm cache 加速后续 npm install
RUN mkdir -p /tmp/npm-precache && cd /tmp/npm-precache && \
    npm init -y > /dev/null 2>&1 && \
    # 后端常用依赖
    npm install --prefer-offline \
      express@^4.21.0 \
      better-sqlite3@^11.7.0 \
      cors@^2.8.5 \
      zod@^3.24.0 \
      @types/express@^5.0.0 \
      @types/better-sqlite3@^7.6.12 \
      @types/cors@^2.8.17 \
      typescript@^5.7.0 \
      ts-node@^10.9.0 \
    > /dev/null 2>&1 && \
    # 前端常用依赖
    npm install --prefer-offline \
      react@^18.3.0 \
      react-dom@^18.3.0 \
      react-router-dom@^6.28.0 \
      @types/react@^18.3.0 \
      @types/react-dom@^18.3.0 \
      @vitejs/plugin-react@^4.3.0 \
      autoprefixer@^10.4.0 \
      postcss@^8.4.0 \
      tailwindcss@^3.4.0 \
      vite@^6.0.0 \
    > /dev/null 2>&1 && \
    # 测试框架
    npm install --prefer-offline \
      @playwright/test@^1.49.0 \
    > /dev/null 2>&1 && \
    # 清理临时项目但保留 npm cache
    cd / && rm -rf /tmp/npm-precache

# workspace 和配置通过 volume/config 挂载
VOLUME ["/workspace"]

USER node
CMD ["node", "dist/index.js"]
