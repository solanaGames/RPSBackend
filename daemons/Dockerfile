FROM node:18.8.0-alpine
RUN apk add --no-cache git openssh

RUN mkdir -p /home/solbet/app

COPY . /home/solbet/app/

WORKDIR /home/solbet/app/libs
RUN yarn

WORKDIR /home/solbet/app/daemons
RUN yarn