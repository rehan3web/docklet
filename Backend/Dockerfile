FROM node:20-alpine

RUN apk add --no-cache postgresql-client docker-cli docker-compose bash git

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
