const http = require('http');
const fs = require('fs');
const path = require('path');
http.createServer((req, res) => {
  const file = path.join(__dirname, 'icon_preview.html');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(file));
}).listen(3999, () => console.log('Preview server on http://localhost:3999'));
