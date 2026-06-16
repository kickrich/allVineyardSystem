FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=
ARG VITE_API_DIRECT=true
ARG VITE_VIDEO_FROM_FOLDER=false

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_DIRECT=$VITE_API_DIRECT
ENV VITE_VIDEO_FROM_FOLDER=$VITE_VIDEO_FROM_FOLDER

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
