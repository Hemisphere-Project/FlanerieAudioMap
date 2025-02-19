import { exec } from 'child_process';
import GithubWebHook from 'express-github-webhook';
import bodyParser from 'body-parser';

function log(msg) {
  console.log(`[\x1b[33mWebhook\x1b[0m]\t${msg}`);
}

let webhookHandler;

function githubHook(app, route = '/webhook', secret) {
    webhookHandler = GithubWebHook({ path: route, secret: secret });
    
    // HOOKS
    webhookHandler.on('*', function (event, repo, data) {
      if (event === 'push') {
        log('processing push event (Pull / Restart)');
        exec('git stash && git pull && npm i', (err, stdout, stderr) => {
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

export default githubHook;