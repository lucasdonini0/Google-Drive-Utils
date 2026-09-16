const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "../src/renderer");
const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
  const pathname = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  const target = path.join(root, pathname);
  if (!target.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
}).listen(4173, "127.0.0.1", () => console.log("UI preview: http://127.0.0.1:4173"));
