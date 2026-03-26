FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 8001

CMD ["npm", "run", "dev"]
