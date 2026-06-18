FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY server.js lunchAutomation.js ./

EXPOSE 3001

CMD ["npm", "start"]
