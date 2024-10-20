# Docker Auto Update

This project includes a script to automatically update Docker images specifically for the `latest` or same tags which might have updated layers when you always want to auto update.

This further can be adjusted to work on a format where it finds the latest tag and update in the env when available, thats for another time.

## Usage

1. Clone the repository.
2. Navigate to the project directory.
3. Run the script using Node.js:

```bash
node image-updater.js
```

## image-updater.js

This script checks for updates to Docker images and updates them if necessary.
### Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/)

