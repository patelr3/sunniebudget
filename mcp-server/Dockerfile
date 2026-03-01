FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ src/

EXPOSE 8090
CMD ["node", "src/index.js"]
