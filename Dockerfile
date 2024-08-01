FROM node:22-alpine
 
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app
 
COPY package.json package.json
COPY package-lock.json package-lock.json
 
RUN npm install
 
COPY --chown=node:node . .

EXPOSE 8080
 
CMD [ "node", "app.js" ]