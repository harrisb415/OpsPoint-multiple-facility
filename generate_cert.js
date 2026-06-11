/**
 * Generates a self-signed certificate with proper Subject Alternative Names
 * so modern browsers (Chrome 58+) accept it without warnings.
 * Requires: selfsigned package  (installed by generate_cert.bat)
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

function getLanIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

(async () => {
  try {
    const selfsigned = require('selfsigned');

    const lanIPs  = getLanIPs();
    // Extra hostnames / IPs can be passed as CLI args:
    //   node generate_cert.js opspoint.duckdns.org 203.0.113.5
    const extraArgs = process.argv.slice(2);
    const extraDNS  = extraArgs.filter(a => !/^\d+\.\d+\.\d+\.\d+$/.test(a));
    const extraIPs  = extraArgs.filter(a =>  /^\d+\.\d+\.\d+\.\d+$/.test(a));

    const altNames = [
      { type: 2, value: 'localhost' },
      { type: 7, ip:    '127.0.0.1' },
      ...lanIPs.map(ip => ({ type: 7, ip })),
      ...extraDNS.map(h => ({ type: 2, value: h })),
      ...extraIPs.map(ip => ({ type: 7, ip })),
    ];

    const cn    = extraDNS[0] || 'localhost';
    const attrs = [{ name: 'commonName', value: cn }];
    const opts  = {
      days:       3650,
      algorithm:  'sha256',
      keySize:    2048,
      extensions: [{ name: 'subjectAltName', altNames }]
    };

    // selfsigned v3+ returns a Promise; v2 returns synchronously
    let pems = selfsigned.generate(attrs, opts);
    if (pems && typeof pems.then === 'function') pems = await pems;

    // Handle both v2 (pems.private) and v3 (pems.privateKey / pems.key) property names
    const privKey = pems.private || pems.privateKey || pems.key;
    const certPem = pems.cert    || pems.certificate;

    if (!privKey || !certPem) {
      throw new Error('Unexpected selfsigned output — keys: ' + Object.keys(pems || {}).join(', '));
    }

    fs.writeFileSync(path.join(DATA, 'key.pem'),  privKey);
    fs.writeFileSync(path.join(DATA, 'cert.pem'), certPem);

    const sanList = ['localhost', '127.0.0.1', ...lanIPs, ...extraDNS, ...extraIPs].join(', ');
    console.log('Certificate generated successfully.');
    console.log('Valid for: ' + sanList);
    process.exit(0);
  } catch (e) {
    console.error('Certificate generation failed:', e.message);
    process.exit(1);
  }
})();
