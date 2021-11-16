require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const { Api, TelegramClient } = require('telegram');
const { CustomFile } = require('telegram/client/uploads');
const { StringSession } = require('telegram/sessions');
const { authMiddleware } = require('./middleware/authMiddleware');

// express
const app = express();
const PORT = 5000;

// mutler for handling file in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// telegram
const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

// jwt
const JWT_KEY = process.env.JWT_KEY;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(cookieParser());

const memoryDB = [];

const stringSession = new StringSession('');
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});
client.connect();

app.post('/auth/sendcode', async (req, res) => {
  const { phoneNumber } = req.body;

  // await client.connect();
  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber,
      apiId: API_ID,
      apiHash: API_HASH,
      settings: new Api.CodeSettings({
        allowFlashcall: true,
        currentNumber: true,
        allowAppHash: true,
      }),
    })
  );

  return res.json({ phoneNumber, phoneCodeHash: result.phoneCodeHash });
});

app.post('/auth/signin', async (req, res) => {
  const { phoneNumber, phoneCodeHash, phoneCode } = req.body;

  // const stringSession = new StringSession('');
  // const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  //   connectionRetries: 5,
  // });

  // await client.connect();
  await client.invoke(
    new Api.auth.SignIn({
      phoneNumber,
      phoneCodeHash,
      phoneCode,
    })
  );

  const savedStringSession = client.session.save();
  const credential = jwt.sign({ stringSession: savedStringSession }, JWT_KEY);
  res.cookie('credential', credential);
  console.log(credential);
  return res.json({ credential });
});

app.post('/messages', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;
  const { message } = req.body;

  const telegramStringSession = new StringSession(stringSession);
  const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  const randomId = BigInt(+new Date());
  const peer = 'me';
  const result = await client.invoke(
    new Api.messages.SendMessage({
      peer,
      message,
      randomId,
      noWebpage: true,
    })
  );

  return res.json({
    id: result.updates[0].id,
    peer,
    message,
  });
});

app.get('/messages/:id', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;
  const { id } = req.params;
  console.log({ id });

  const telegramStringSession = new StringSession(stringSession);
  const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  const result = await client.invoke(
    new Api.messages.GetMessages({
      id: [parseInt(id)],
    })
  );

  return res.json({ id, message: result.messages[0].message });
});

app.post('/uploads', upload.any(), authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;

  const telegramStringSession = new StringSession(stringSession);
  const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  const file = req.files[0];

  const result = await client.invoke(
    new Api.messages.SendMedia({
      peer: 'me',
      message: '',
      randomId: BigInt(+new Date()),
      media: new Api.InputMediaUploadedDocument({
        file: await client.uploadFile({
          file: new CustomFile(file.originalname, file.size, '', file.buffer),
          workers: 15,
          onProgress: console.log,
        }),
        mimeType: file.mimetype,
        attributes: [
          new Api.DocumentAttributeFilename({
            fileName: file.originalname,
          }),
        ],
      }),
    })
  );

  memoryDB.push({
    id: result.updates[0].id,
    title: file.originalname,
    mimeType: file.mimetype,
    url: `/uploads/${result.updates[0].id}`,
  });
  return res.json({
    id: result.updates[0].id,
    title: file.originalname,
    mimeType: file.mimetype,
  });
});

app.get('/uploads', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;

  const telegramStringSession = new StringSession(stringSession);
  const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  return res.json(memoryDB);
});

app.get('/uploads/:id', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;
  const { id } = req.params;
  const { download } = req.query;

  const telegramStringSession = new StringSession(stringSession);
  const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  const result = await client.invoke(
    new Api.messages.GetMessages({
      id: [parseInt(id)],
    })
  );

  const resultFile = await client.downloadMedia(result.messages[0], {
    progressCallback: console.log,
  });

  const mimeType = result.messages[0].media.document.mimeType;
  res.type(mimeType);
  if (download === '1') {
    res.set('Content-Disposition', `attachment; filename="unknown"`);
  }
  return res.send(resultFile);
});

app.get('/', authMiddleware, (req, res) => {
  return res.render('index');
});

app.get('/app/login', (req, res) => {
  return res.render('login');
});

/*
  [ PUBLIC SHARED FILE ]
  - store user session to database
  - if file is public mode, then public user can access without signin
  - if public access the public mode file, it will get file with file owner session from database
  - if not public mode file, then use current session of user to get file
*/

app.listen(PORT, () => {
  console.log(`Server start at: localhost:${PORT}`);
});
