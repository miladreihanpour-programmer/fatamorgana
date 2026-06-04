# ── Fata Morgana API Server ───────────────────────────────────────────────────
# Node 20 on Debian slim — small image, good Playwright support
FROM node:20-slim

# Install Chromium system deps (required by Playwright)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright to use the system Chromium (saves 200MB download)
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

# Install Playwright browser bindings (not the browser itself — system one above)
RUN npx playwright install-deps chromium

# Copy all source files
COPY . .

# Create output directory
RUN mkdir -p output server

EXPOSE 3001

CMD ["node", "server/index.js"]
