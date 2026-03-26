FROM node:20-alpine

WORKDIR /app

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .

# Create data directory
RUN mkdir -p /app/data /app/uploads

EXPOSE 8001

CMD ["npm", "run", "dev"]
