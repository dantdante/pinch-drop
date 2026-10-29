# Pinch Drop — the whole tower in one image.
FROM node:20-alpine

WORKDIR /app

# install dependencies first so they cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
