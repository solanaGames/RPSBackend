FROM node:18.8.0-alpine
RUN apk add --no-cache git openssh

RUN mkdir -p /home/SolRPS/app

COPY . /home/SolRPS/app/

WORKDIR /home/SolRPS/app
RUN yarn