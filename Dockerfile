# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if you have one)
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port your application listens on (HTTPS port 443)

EXPOSE 8080

# Define environment variables (if needed, you can also set them in Elastic Beanstalk/ECS)
# ENV NODE_ENV production
# ENV AUTH_TOKEN your_secret_auth_token
# ENV ENCRYPTION_KEY your_strong_32byte_hex_key
# ENV APIURL your_api_endpoint_url
# ENV PRIVATEKEY /app/certs/private.key
# ENV CERTIFICATE /app/certs/certificate.crt
# ENV SERVERPRIVATEKEY /app/certs/server-private.key
# ENV SERVERCERTIFICATE /app/certs/server-certificate.crt
# ENV SERVERCRTCERTIFICATE /app/certs/server-crt-certificate.crt

# Command to run your application
CMD [ "node", "nodeApi.js" ] 