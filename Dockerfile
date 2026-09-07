FROM node:22.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4600 AUTH_MODE=runner DATA_DIR=/app/runtime
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node web ./web
COPY --chown=node:node scripts/reproduce.sh ./scripts/reproduce.sh
# No development questions, gold answers, or grader enter the serving image.
COPY --chown=node:node vendor/op05/corpus ./vendor/op05/corpus
RUN mkdir -p /app/runtime && chown node:node /app/runtime
USER node
EXPOSE 4600
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
