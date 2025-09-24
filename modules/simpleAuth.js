import dotenv from 'dotenv';
dotenv.config();
import cookieParser from 'cookie-parser';

const COOKIE_NAME = 'simple_auth';
const COOKIE_VALUE = process.env.PASSWORD;

export function useSimpleAuth(app) {
  app.use(cookieParser());
}

export function requireAuth(req, res, next) {
  if (req.cookies && req.cookies[COOKIE_NAME] === COOKIE_VALUE) {
    return next();
  }
  // Save original url for redirect after login
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function handleLogin(req, res) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const password = params.get('password');
      if (password === COOKIE_VALUE) {
        res.cookie(COOKIE_NAME, COOKIE_VALUE, { httpOnly: true, sameSite: 'Lax' });
        const nextUrl = req.query.next || '/control';
        res.redirect(nextUrl);
      } else {
        res.send(loginForm('Incorrect password', req.query.next));
      }
    });
  } else {
    res.send(loginForm('', req.query.next));
  }
}

function loginForm(error, next) {
  return `<!DOCTYPE html>
  <html><head><title>Login</title></head><body>
    <form method="POST">
      <h2>Enter password</h2>
      ${error ? `<div style='color:red'>${error}</div>` : ''}
      <input type="password" name="password" autofocus required />
      <input type="hidden" name="next" value="${next ? encodeURIComponent(next) : ''}" />
      <button type="submit">Login</button>
    </form>
  </body></html>`;
}
