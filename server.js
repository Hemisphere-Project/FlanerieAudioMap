// Import dotenv
require('dotenv').config();

// Import express
const https = require('https')
const express = require('express');
const path = require('path');
const fs = require('fs')

// Create express app
const app = express();

// Set the port
const port = process.env.PORT || 3000;

// Set the static path
app.use(express.static(path.join(__dirname, 'www')));

// static audio files
app.use('/media', express.static(path.join(__dirname, 'media')));

// Default endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
}); 

// Start the server
https.createServer({
    key: fs.readFileSync('certs/server.key'),
    cert: fs.readFileSync('certs/server.cert')
  }, app).listen(port, () => {
    console.log('Listening on port ' + port);
})