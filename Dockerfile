#*********************************************************************
# Copyright (c) Intel Corporation 2021
# SPDX-License-Identifier: Apache-2.0
#*********************************************************************/
FROM node:24-bullseye-slim@sha256:139c1bbc5dbcd10c1e26d7ae2911d7de13b3e9d03497b1da2d404b88f3f4e2d7 as builder

WORKDIR /rps

# Copy needed files
COPY package*.json ./

# Install dependencies
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
COPY .rpsrc ./

# Transpile TS => JS
RUN npm run compile
RUN npm prune --production

# set the user to non-root
USER node

FROM alpine:latest@sha256:8a1f59ffb675680d47db6337b49d22281a139e9d709335b492be023728e11715
LABEL license='SPDX-License-Identifier: Apache-2.0' \
      copyright='Copyright (c) Intel Corporation 2021'

RUN addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node 
RUN apk update && apk upgrade && apk add nodejs && rm -rf /var/cache/apk/*

COPY --from=builder  /rps/dist /rps/dist
# for healthcheck backwards compatibility
COPY --from=builder  /rps/.rpsrc /.rpsrc
COPY --from=builder  /rps/node_modules /rps/node_modules
COPY --from=builder  /rps/package.json /rps/package.json
# set the user to non-root
USER node
# Default Ports Used
EXPOSE 8080
EXPOSE 8081
EXPOSE 8082
CMD ["node", "/rps/dist/Index.js"]
