# Use Node.js LTS version as the base image
FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Start the app using tsx
CMD ["npx", "tsx", "main.ts"]

# Expose the application port (adjust if your app uses a different port)
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]
