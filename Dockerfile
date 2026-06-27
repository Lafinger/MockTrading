ARG NODE_IMAGE=mirror.gcr.io/library/node:24-slim
FROM ${NODE_IMAGE}

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=5173
ENV LOSERGOD_API=mock
EXPOSE 5173

CMD ["npm", "start"]
