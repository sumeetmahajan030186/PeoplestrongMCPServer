# Use Node.js LTS version as the base image
FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
# Copy manifests
COPY package.json package-lock.json tsconfig.json ./

# Install project dependencies ci is clean install
RUN npm ci 

# Copy the rest of the application code
COPY . .

# Expose the application port (adjust if your app uses a different port)
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]
