FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY --from=frontend /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
