import dotenv from 'dotenv';
dotenv.config();
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COOKIE_NAME = 'simple_auth';
const ADMIN_PASSWORD = process.env.PASSWORD;
const GUEST_PASSWORD_FILE = path.join(__dirname, '..', 'guest_password.json');

// Initialize guest password file if not exists
if (!fs.existsSync(GUEST_PASSWORD_FILE)) {
  fs.writeFileSync(GUEST_PASSWORD_FILE, JSON.stringify({ password: 'guest' }));
}

function signRole(role) {
  let data = role;
  if (role === 'guest') data += ':' + getGuestPassword();
  return role + ':' + crypto.createHmac('sha256', ADMIN_PASSWORD).update(data).digest('hex');
}

function verifyAndGetRole(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const idx = cookieValue.indexOf(':');
  if (idx === -1) return null;
  const role = cookieValue.substring(0, idx);
  const sig = cookieValue.substring(idx + 1);
  if (!role || !sig || (role !== 'admin' && role !== 'guest')) return null;
  let data = role;
  if (role === 'guest') data += ':' + getGuestPassword();
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(data).digest('hex');
  if (sig.length !== expected.length) return null;
  if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return role;
  }
  return null;
}

export function getGuestPassword() {
  try {
    return JSON.parse(fs.readFileSync(GUEST_PASSWORD_FILE, 'utf8')).password || null;
  } catch {
    return null;
  }
}

export function setGuestPassword(password) {
  fs.writeFileSync(GUEST_PASSWORD_FILE, JSON.stringify({ password }));
}

export function useSimpleAuth(app) {
  app.use(cookieParser());
}

export function getUserRole(req) {
  return verifyAndGetRole(req.cookies && req.cookies[COOKIE_NAME]);
}

export function requireAuth(req, res, next) {
  const role = getUserRole(req);
  if (role) {
    req.userRole = role;
    return next();
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function requireAdmin(req, res, next) {
  const role = getUserRole(req);
  if (role === 'admin') {
    req.userRole = role;
    return next();
  }
  if (role === 'guest') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function handleLogin(req, res) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const password = params.get('password');
      let role = null;
      if (password === ADMIN_PASSWORD) {
        role = 'admin';
      } else {
        const guestPwd = getGuestPassword();
        if (guestPwd && password === guestPwd) {
          role = 'guest';
        }
      }
      if (role) {
        res.cookie(COOKIE_NAME, signRole(role), { httpOnly: true, sameSite: 'Lax' });
        const nextUrl = req.query.next || '/control';
        res.redirect(nextUrl);
      } else {
        res.send(loginForm('Mot de passe incorrect'));
      }
    });
  } else {
    res.send(loginForm(''));
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function loginForm(error) {
  return `<!DOCTYPE html>
  <html><head><title>Login</title></head><body>
    <form method="POST">
      <h2>Enter password</h2>
      ${error ? `<div style='color:red'>${escapeHtml(error)}</div>` : ''}
      <input type="password" name="password" autofocus required />
      <button type="submit">Login</button>
    </form>
  </body></html>`;
}
