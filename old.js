const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const cryptojs = require('crypto-js');

const app = express();
const port = 8080;

const EncryptionKey = process.env.EncryptionKey;

function encrypt(str) {
  return cryptojs.AES.encrypt(str, EncryptionKey.toString()).toString();
}

function decrypt(str) {
  try {
    const decryptedBytes = cryptojs.AES.decrypt(str, String(EncryptionKey));
    const decryptedString = decryptedBytes.toString(cryptojs.enc.Utf8);
    return decryptedString || '';
  } catch (error) {
    console.log('Decryption error:', error);
    return '';
  }
}


function generateId() {
  return Array.from(Array(40).keys())
    .map(() => Math.round(Math.random() * 9))
    .join('');
}

app.use(cors({ origin: '*', optionsSuccessStatus: 200 }));
app.use(bodyParser.urlencoded({ limit: '20mb', extended: false }));
app.use(bodyParser.json({ limit: '20mb' }));

let TotalRequests = 0;

app.get('/', async function(req, res) {
  res.status(200);
  res.header('Content-Type', 'application/json');
  res.json({ online: true, reqCount: TotalRequests });
});

function DecryptGlobalData() {
  const encryptedData = fs.readFileSync('./data/global.data');
  const encryptedJson = JSON.parse(encryptedData);
  const decryptedJson = {};

  Object.getOwnPropertyNames(encryptedJson).forEach(key => {
    const decryptedKey = decrypt(key);
    const decryptedValue = decrypt(encryptedJson[key]);
    decryptedJson[decryptedKey] = decryptedValue;
  });

  return decryptedJson;
}

function InlineError(res, error, code) {
  res.status(code);
  res.header('Content-Type', 'application/json');
  res.json({ error });
}

function GetGlobalFile() {
  const data = fs.readFileSync(`./data/global.data`);
  const json = JSON.parse(data);
  const compiled = {};

  Object.getOwnPropertyNames(json).forEach(key => {
    compiled[decrypt(key)] = json[key];
  });

  return compiled;
}

function GetProjectFile(id) {
  try {
    fs.readFileSync(`./data/projects/p${id}.data`);
  } catch (error) {
    fs.writeFileSync(`./data/projects/p${id}.data`, "{}");
  }
  const data = fs.readFileSync(`./data/projects/p${id}.data`);
  const json = JSON.parse(data);
  const compiled = {};

  Object.getOwnPropertyNames(json).forEach(key => {
    compiled[decrypt(key)] = json[key];
  });

  return compiled;
}

function SetGlobalFile(data) {
  const compiled = {};

  Object.getOwnPropertyNames(data).forEach(key => {
    compiled[encrypt(key)] = data[key];
  });

  const stringed = JSON.stringify(compiled);
  fs.writeFileSync(`./data/global.data`, stringed);
}

function SetProjectFile(id, data) {
  const compiled = {};

  Object.getOwnPropertyNames(data).forEach(key => {
    compiled[encrypt(key)] = data[key];
  });

  const stringed = JSON.stringify(compiled);
  fs.writeFileSync(`./data/projects/p${id}.data`, stringed);
}

function safeReadFileSync(path) {
  let res = null;
  try {
    res = fs.readFileSync(path, 'utf8');
  } catch (error) {
    () => {};
  }
  return res;
}

function GetFileById(id, path) {
  if (path) {
    return `./data/file/${id}.enc`;
  }
  const data = safeReadFileSync(`./data/file/${id}.enc`);
  return data;
}

function SetFileById(id, data) {
  fs.writeFileSync(GetFileById(id, true), data);
}

function PCall(func, catc) {
  try {
    func();
  } catch (err) {
    catc(err);
  }
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

const RateLimits = {};

function checkAndFixIp(ip) {
  if (!RateLimits[ip]) {
    RateLimits[ip] = 0;
  }
  if (RateLimits[ip] < 0) {
    RateLimits[ip] = 0;
  }
}

app.get('/get', async function(req, res) {
  TotalRequests += 1;

  // ratelimit request
  const ip = encrypt(String(req.headers['x-forwarded-for'] || req.socket.remoteAddress));
  checkAndFixIp(ip);
  if (RateLimits[ip] > 0) {
    await delay(RateLimits[ip] + 100);
    RateLimits[ip] -= 100;
  }

  const key = String(req.query.key);
  if (!key) return InlineError(res, 'NoKeySpecified', 400);
  const isGlobal = isNaN(Number(req.query.project));
  const projectId = Number(req.query.project);

  let data = {};
  if (isGlobal) {
    data = GetGlobalFile();
  } else {
    data = GetProjectFile(projectId);
  }
  const id = data[key];
  if (isNaN(Number(id))) return InlineError(res, 'KeyFileNonExistent', 400);
  const filedata = GetFileById(id);
  if (filedata === null) return InlineError(res, 'KeyFileEmptyOrNonExistent', 400);

  res.status(200);
  res.header('Content-Type', 'text/plain');
  res.send(decrypt(filedata));
});

app.post('/set', async function(req, res) {
  TotalRequests += 1;

  // ratelimit request
  const ip = encrypt(String(req.headers['x-forwarded-for'] || req.socket.remoteAddress));
  checkAndFixIp(ip);
  if (RateLimits[ip] > 0) {
    await delay(RateLimits[ip] + 100);
    RateLimits[ip] -= 100;
  }

  const key = String(req.query.key);
  if (!key) return InlineError(res, 'NoKeySpecified', 400);
  const value = String(req.body.value);
  const isGlobal = isNaN(Number(req.query.project));
  const projectId = Number(req.query.project);

  if (isGlobal) {
    const data = GetGlobalFile();
    let id = data[key];
    if (!id) {
      id = generateId();
      SetFileById(id, '');
      data[key] = id;
    }
    SetFileById(id, encrypt(value));
    SetGlobalFile(data);

    res.status(200);
    res.header('Content-Type', 'application/json');
    res.json({ success: true });
    return;
  }

  const data = GetProjectFile(projectId);
  let id = data[key];
  if (!id) {
    id = generateId();
    SetFileById(id, '');
    data[key] = id;
  }
  SetFileById(id, encrypt(value));
  SetProjectFile(projectId, data);

  res.status(200);
  res.header('Content-Type', 'application/json');
  res.json({ success: true });
});

app.delete('/delete', async function(req, res) {
  TotalRequests += 1;

  // ratelimit request
  const ip = encrypt(String(req.headers['x-forwarded-for'] || req.socket.remoteAddress));
  checkAndFixIp(ip);
  if (RateLimits[ip] > 0) {
    await delay(RateLimits[ip] + 100);
    RateLimits[ip] -= 100;
  }

  const key = String(req.query.key);
  if (!key) return InlineError(res, 'NoKeySpecified', 400);
  const isGlobal = isNaN(Number(req.query.project));
  const projectId = Number(req.query.project);

  let data = {};
  if (isGlobal) {
    data = GetGlobalFile();
  } else {
    data = GetProjectFile(projectId);
  }
  const id = data[key];
  if (id) {
    fs.unlink(GetFileById(id, true), err => {
      if (err) console.log('couldnt delete', id, err);
    });
    delete data[key];
  }
  if (isGlobal) {
    SetGlobalFile(data);
  } else {
    SetProjectFile(projectId, data);
  }

  res.status(200);
  res.header('Content-Type', 'application/json');
  res.json({ success: true });
});

/*app.get('/g', async function(req, res) {
  res.send(DecryptGlobalData());
});*/

app.listen(port, () => console.log('Listening on port ' + port));
