FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /work
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /work/dist /usr/share/nginx/html
EXPOSE 8080
