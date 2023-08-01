const express = require('express');
const env = require('dotenv').config()
const bodyParser = require('body-parser');
const request = require('request-promise');
const fs = require('fs');
const Promise = require('promise');
const promisePoller = require('promise-poller').default;
const app = express();
const port = 3000;

app.use(bodyParser.json());

const protocol = process.env.protocol;
const server = process.env.server;
const auth = {
  user: process.env.user,
  pass: process.env.pass,
};

let projectUrl;
let projectId;

app.post('/startautoedit', async (req, res) => {
  const projectData = {
    json: '{}',
    name: 'Test 101',
  };

  try {
    // Create a new project
    const response = await post('/projects/', projectData);
    projectUrl = JSON.parse(response).url;
    projectId = JSON.parse(response).id;
    console.log('Successfully created project: ' + projectUrl);

    // Add a couple of clips (to be asynchronously processed)
    const promiseArray = [];
    promiseArray.push(
      createClip({
        path: 'media-files/bg.mp4',
        position: 0.0,
        end: 10.0,
        layer: 0,
      })
    );
    promiseArray.push(
      createClip({
        path: 'media-files/deckshare.webm',
        position: 0.0,
        end: 10.0,
        layer: 100
      })
    );
    promiseArray.push(
      createClip({
        path: 'media-files/webcam.webm',
        position: 0.0,
        end: 10.0,
        layer: 200,
      })
    );

    // Wait until all files and clips are uploaded
    await Promise.all(promiseArray);

    // Export as a new video
    const exportData = {
      export_type: 'video',
      video_format: 'mp4',
      video_codec: 'libx264',
      video_bitrate: 8000000,
      audio_codec: 'ac3',
      audio_bitrate: 1920000,
      project: projectUrl,
      json: '{}',
    };
    const exportResponse = await post('/exports/', exportData);

    // Export has been created and will begin processing soon
    const exportUrl = JSON.parse(exportResponse).url;
    const exportId = JSON.parse(exportResponse).id;
    console.log('Successfully created export: ' + exportUrl);

    // Poll until the export has finished
    console.log('Polling export status...');
    const exportOutputUrl = await pollExportStatus(exportId);
    console.log('Export completed: ' + JSON.stringify(exportOutputUrl));

    // New exported video is ready for download now
    console.log('Download ' + exportOutputUrl);
    request(exportOutputUrl).pipe(fs.createWriteStream(`Output-${projectId}.mp4`));

    res.json({ message: 'Export completed successfully.' });
  } catch (error) {
    console.error('Error occurred:', error);
    res.status(500).json({ error: 'Export process failed or took too long to complete.' });
  }
});

function pollExportStatus(exportId) {
  return new Promise((resolve, reject) => {
    const pollInterval = 5000; // Poll every 5 seconds
    const maxAttempts = 720; // Total polling attempts (approx. 1 hour)

    let attempts = 0;

    const poll = () => {
      attempts++;

      if (attempts > maxAttempts) {
        reject(new Error('Export process took too long to complete.'));
        return;
      }

      get(`/exports/${exportId}/`)
        .then((response) => {
          const exportStatus = JSON.parse(response).status;
          const exportOutputUrl = JSON.parse(response).output;

          if (exportStatus === 'completed') {
            resolve(exportOutputUrl);
            return;
          }

          console.log(`Export status (Attempt ${attempts}):`, exportStatus);
          setTimeout(poll, pollInterval);
        })
        .catch((err) => reject(err));
    };

    poll();
  });
}

function createClip(clip) {
  const clipProjectUrl = clip.projectUrl || projectUrl;

  const fileData = {
    json: '{}',
    project: clipProjectUrl,
    media: fs.createReadStream(clip.path),
  };

  return post('/files/', fileData)
    .then((response) => {
      const fileUrl = JSON.parse(response).url;
      console.log('Successfully created file: ' + fileUrl);

      const clipData = {
        file: fileUrl,
        json: '{}',
        position: clip.position || 0.0,
        start: clip.start || 0.0,
        end: clip.end || JSON.parse(response).json.duration,
        layer: clip.layer || 0,
        project: clipProjectUrl,
      };

      return post('/clips/', clipData).then((response) => {
        const clipUrl = JSON.parse(response).url;
        console.log('Successfully created clip: ' + clipUrl);
      });
    });
}

function post(endpoint, data) {
  const options = {
    method: 'POST',
    url: `${protocol}://${auth.user}:${auth.pass}@${server}${endpoint}`,
    formData: data,
  };

  return request(options);
}

function get(endpoint) {
  const options = {
    method: 'GET',
    url: `${protocol}://${auth.user}:${auth.pass}@${server}${endpoint}`,
  };

  return request(options);
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
