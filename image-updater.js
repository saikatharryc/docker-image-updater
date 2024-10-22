/**
 * This Updater script compares image from running container(s)
 * and if there are updates available to it, mostly a with latest tag it can be used.
 */

const cron = require('node-cron');
const Docker = require('dockerode');
const docker = new Docker();




/**
 * Manages the specified container based on the provided method.
 * 
 * @param {string} containerName - The name of the container to manage.
 * @param {string} method - The method to apply to the container (start, stop, rename, remove).
 * @param {string} renameCtx - The new name for the container in case of renaming.
 * @returns {Promise} - A promise that resolves when the container management operation is completed.
 */
const containerManagement = async (containerName, method, renameCtx) => {
    const container = docker.getContainer(containerName);
    let exec = ''
    switch (method) {
        case 'start':
            console.log(`Starting container: ${containerName}`);
            exec = await container.start();
            break;
        case 'stop':
            console.log(`Stopping container: ${containerName}`);
            exec = await container.stop();
            break;
        case 'rename':
            console.log(`Renaming container: ${containerName} to ${renameCtx}`);
            exec = await container.rename({ name: renameCtx });
            break;
        case 'remove':
            exec = console.log(`Removing container: ${containerName}`);
            await container.remove();
            break;
        default:
            console.log(`Invalid method: ${method}`);
            break;
    }
    return exec;
}

/**
 * Updates a container with a new image.
 * 
 * @param {object} containerInfo - The info of the container to update.
 * @param {string} targetContainerName - The name of the container to update.
 * @returns {Promise} - A promise that resolves when the container is updated.
 */
const updateImage = async (containerInfo, targetContainerName) => {
    const oldContainer = docker.getContainer(targetContainerName);
    const containerData = await oldContainer.inspect();
    const imageName = containerData.Config.Image;

    console.log(`Updating container ${containerInfo.Id}`);

    const oldContainerName = `${targetContainerName}-old-temp`;

    try {
        console.log(`Renaming current container to: ${oldContainerName}`);
        await containerManagement(targetContainerName, 'rename', oldContainerName);


        console.log(`Creating new container with updated image: ${imageName}`);
        const createContainerPayload = {
            ...containerInfo,
            ...containerData.Config,
            Image: imageName,
            name: targetContainerName,
            // ExposedPorts: containerData.Config.ExposedPorts, //This is coming from containerinspect data

        }
        createContainerPayload.HostConfig = { PortBindings: containerData.NetworkSettings.Ports }
        const newC = await docker.createContainer(createContainerPayload);

        // Step 5: Start the new container
        console.log(`Starting new container: ${targetContainerName}`);
        //   await containerManagement(targetContainerName, 'start');
        await containerManagement(oldContainerName, 'stop');
        newC.start();



        console.log(`Removing old container: ${oldContainerName}`);

        await containerManagement(oldContainerName, 'remove');
        console.log("[Action Completed for container]:", targetContainerName);

    } catch (createErr) {
        console.error(`Error creating or starting new container: ${createErr}`);
        console.log(`Rolling back: renaming ${oldContainerName} back to ${targetContainerName}`);
        await containerManagement(oldContainerName, 'rename', targetContainerName);
    }
}


/**
 * Checks all running containers for updates and updates them if required.
 *
 * This function iterates over all running containers, checks if the container
 * needs an update, and if so, updates the container. If an update is not
 * required for a container, a message is logged to the console.
 *
 * If an error occurs, an error message is logged to the console.
 *
 * @returns {Promise<void>}
 */
const checkForUpdates = async () => {
    try {
        const containers = await docker.listContainers();
        console.log('all_containers:', containers);

        for (const containerInfo of containers) {
            const containerName = containerInfo.Names[0].replace(/^\//, '');
            const isUpdated = await checkIfImageNeedsUpdate(containerName);
            if (isUpdated) {
                return updateImage(containerInfo, containerName);
            } else {
                console.log(`No update required for container: ${containerInfo.Id}`);
            }
        }
    } catch (error) {
        console.error('Error checking for updates: ', error);
    }
}

/**
 * Checks if a container's image needs to be updated.
 * 
 * This function takes a container name, inspects the container and checks if the image needs to be updated.
 * If a local image exists and has a different ID than the container's image, it considers the image as needing an update.
 * If a local image does not exist or has the same ID as the container's image, it checks the remote repository to see if an update is available.
 * If an update is available from the remote repository, it pulls the image and returns true.
 * 
 * @param {string} containerName - The name of the container to check.
 * @returns {Promise<boolean>} - A promise that resolves to true if the image needs to be updated or false if not.
 */
const checkIfImageNeedsUpdate = async (containerName) => {
    try {
        const container = docker.getContainer(containerName);
        const containerData = await container.inspect();
        const containerImageId = containerData.Image;
        const containerImageName = containerData.Config.Image;

        console.log(`Container ${containerName} is using image: ${containerImageId} (${containerImageName})`);
        await getRemoteImageId(containerImageName);

        let localImage;
        try {
            localImage = await docker.getImage(containerImageName).inspect();
        } catch (err) {
            console.log(`Local image not found for ${containerImageName}, will check the remote registry.`);
            localImage = null;
        }

        const localImageId = localImage ? localImage.Id : null;

        if (localImageId && containerImageId !== localImageId) {
            console.log(`Drift detected: Container image ID (${containerImageId}) differs from image ID (${localImageId}).`);
            // Image needs to be updated, use the local image
            return true;
        } else {
            console.log(`No update required for container: ${containerName}`);
            return false;
        }
    } catch (err) {
        console.error(`Error checking image update for container ${containerName}:`, err);
        return true;
    }
}


/**
 * Gets the ID of a remote image from the registry.
 *
 * This function takes an image name, pulls the image from the registry, and returns the ID of the image.
 * If the image is not found in the registry, it returns null and logs a message.
 * If the image requires authentication to access, it returns null and logs a message.
 * If any other error occurs, it rejects the promise with the error.
 *
 * @param {string} imageName - The name of the image to check.
 * @returns {Promise<string|null>} - A promise that resolves to the ID of the remote image or null if the image is not found or requires authentication.
 */
const getRemoteImageId = async (imageName) => {
    return new Promise((resolve, reject) => {
        docker.pull(imageName, { 'authconfig': process.env.DOCKER_AUTH || {} }, (err, stream) => {
            if (err) {
                // Handle 401 (authentication required) and 404 (image not found) errors gracefully
                if (err.statusCode === 401) {
                    console.log(`Registry authentication required for ${imageName}, skipping remote check`);
                    return resolve(null);  // Skip remote check if auth is required and not provided
                } else if (err.statusCode === 404) {
                    console.log(`Image ${imageName} not found in the registry`);
                    return resolve(null);  // Skip remote check if image is not found
                }
                return reject(err);  // Reject for other errors
            }

            docker.modem.followProgress(stream, onFinished, onProgress);

            function onFinished(err, output) {
                if (err) {
                    return reject(err);
                }
                const imageIdLine = output.find(line => line.id && line.status === 'Pull complete');
                const imageId = imageIdLine ? imageIdLine.id : null;
                resolve(imageId);
            }

            function onProgress(event) {
                console.log('Syncing remote image ...');
            }
        });
    });
}

docker.ping().then((d)=>{
    console.log('Successfully connected to docker', d);
    console.log('Starting image updater...');
    cron.schedule(process.env.CRON || '* * * * *', checkForUpdates);
}).catch((err)=>{
    console.log('Error connecting to docker', err);
    // process.exit(1);
    cron.schedule(process.env.CRON || '* * * * *', checkForUpdates);
})