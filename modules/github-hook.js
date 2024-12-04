// import { exec } from 'child_process';
const exec = require('child_process').exec;


function log(msg) {
  console.log(`[\x1b[33mWebhook\x1b[0m]\t${msg}`);
}


// import GithubWebHook from 'express-github-webhook';
const GithubWebHook = require('express-github-webhook');
const bodyParser = require('body-parser');
var webhookHandler;



function githubHook(app, route = '/webhook', secret) {

    webhookHandler = GithubWebHook({ path: route, secret: secret });
    
    // HOOKS
    webhookHandler.on('*', function (event, repo, data) {
      // log('hook', event, repo, data);
      if (event === 'push') {
        // git stash then git pull && pm2 restart contacts
        log('processing push event (Pull / Restart)');
        exec('git pull && npm i', (err, stdout, stderr) => {
          if (err) {
            console.error(err);
            return; 
          }
          log(stdout);
          process.exit();
        });
      }
    });


    // Middlewares
    app.use(bodyParser.json());
    app.use(webhookHandler);

    log('ready.\n----------------------');
}

module.exports = githubHook;