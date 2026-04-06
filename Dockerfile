FROM node:20-alpine

# Use production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies 
# Using npm install instead of ci just in case package-lock is out of sync
RUN npm install

# Copy source code
COPY . .

# Create data directory if it doesn't exist
RUN mkdir -p /usr/src/app/data/images
RUN mkdir -p /usr/src/app/data/thumbnails

# Expose default port
EXPOSE 3000

# Set environment variables for docker
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/usr/src/app/data/nanobana.db
ENV IMAGE_DIR=/usr/src/app/data/images

# Start the application
CMD ["npm", "start"]
