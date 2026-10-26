// 本地模拟 WebDAV 服务器（仅用于验证同步逻辑）
// 用法：node scripts/mock-webdav.cjs &
//       MOCK_DAV=http://127.0.0.1:18080/dav cargo test --test webdav_sync -- --nocapture
// 支持：MKCOL / PUT / GET / PROPFIND(0,1) + Basic Auth（账号 user / 密码 pass）
const http = require('http');

const PORT = Number(process.env.MOCK_DAV_PORT || 18080);
const USER = 'user';
const PASS = 'pass';
const ROOT = '/dav';

/** path -> Buffer */
const files = new Map();
/** path -> true */
const dirs = new Set([ROOT, ROOT + '/']);
let lastError = '';

function expectedAuth() {
  return 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
}

function normalize(p) {
  const decoded = decodeURIComponent(p);
  return decoded.replace(/\/+$/, '');
}

function childrenOf(dirPath) {
  const out = [];
  for (const f of files.keys()) {
    if (f.startsWith(dirPath + '/') && !f.slice(dirPath.length + 1).includes('/')) {
      out.push(f);
    }
  }
  for (const d of dirs) {
    const dd = d.replace(/\/+$/, '');
    if (dd !== dirPath && dd.startsWith(dirPath + '/') && !dd.slice(dirPath.length + 1).includes('/')) {
      out.push(dd + '/');
    }
  }
  return out;
}

function responseXml(href, isDir, size) {
  return (
    '<D:response>' +
    `<D:href>${encodeURI(href).replace(/%2F/gi, '/')}</D:href>` +
    '<D:propstat><D:prop>' +
    (isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>') +
    (isDir ? '' : `<D:getcontentlength>${size}</D:getcontentlength>`) +
    '<D:getlastmodified>Mon, 19 Oct 2026 06:00:00 GMT</D:getlastmodified>' +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>' +
    '</D:response>'
  );
}

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== expectedAuth()) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="mock"' });
    res.end('unauthorized');
    return;
  }

  const path = normalize(new URL(req.url, 'http://localhost').pathname);
  const method = req.method.toUpperCase();

  try {
    if (method === 'MKCOL') {
      if (dirs.has(path) || files.has(path)) {
        res.writeHead(405);
        res.end();
        return;
      }
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent && parent !== ROOT.slice(0, -1) && !dirs.has(parent)) {
        res.writeHead(409);
        res.end('parent missing');
        return;
      }
      dirs.add(path);
      res.writeHead(201);
      res.end();
      return;
    }

    if (method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const parent = path.slice(0, path.lastIndexOf('/'));
        if (parent && !dirs.has(parent)) {
          res.writeHead(409);
          res.end('parent missing');
          return;
        }
        files.set(path, buf);
        res.writeHead(201);
        res.end();
      });
      return;
    }

    if (method === 'GET') {
      const buf = files.get(path);
      if (!buf) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Length': buf.length });
      res.end(buf);
      return;
    }

    if (method === 'PROPFIND') {
      const depth = String(req.headers.depth || '0');
      const isFile = files.has(path);
      const isDir = dirs.has(path) || dirs.has(path + '/');
      if (!isFile && !isDir) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      let body = '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">';
      if (isFile) {
        body += responseXml(path, false, files.get(path).length);
      } else {
        body += responseXml(path + '/', true, 0);
        if (depth !== '0') {
          for (const child of childrenOf(path)) {
            const childIsDir = child.endsWith('/');
            const clean = child.replace(/\/+$/, '');
            body += responseXml(
              childIsDir ? clean + '/' : clean,
              childIsDir,
              childIsDir ? 0 : (files.get(clean) || Buffer.alloc(0)).length
            );
          }
        }
      }
      body += '</D:multistatus>';

      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(body);
      return;
    }

    res.writeHead(405);
    res.end('method not allowed');
  } catch (err) {
    lastError = String(err && err.stack ? err.stack : err);
    res.writeHead(500);
    res.end(lastError);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock webdav ready on http://127.0.0.1:${PORT}/dav/`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
