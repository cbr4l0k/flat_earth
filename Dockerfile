FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_CLERK_PUBLISHABLE_KEY

ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/.output ./.output

EXPOSE 3000

CMD ["npm", "run", "start"]
