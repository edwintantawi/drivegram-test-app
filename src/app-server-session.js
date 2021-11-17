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
const clients = new Map();
const phoneCodeResolvers = new Map();
const loginPromises = new Map();

app.post('/auth/login', async (req, res) => {
  const { phoneNumber } = req.body;
  const id = `${+new Date()}`;
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  clients.set(id, client);
  try {
    //   const result = await client.invoke(
    //     new Api.auth.SendCode({
    //       phoneNumber,
    //       apiId: API_ID,
    //       apiHash: API_HASH,
    //       settings: new Api.CodeSettings({
    //         allowFlashcall: true,
    //         currentNumber: true,
    //         allowAppHash: true,
    //       }),
    //     })
    //   );

    const loginPromise = client.start({
      phoneNumber,
      phoneCode: () =>
        new Promise((resolve) => {
          phoneCodeResolvers.set(id, resolve);
        }),
      onError: (error) => console.log(error),
    });

    loginPromises.set(id, loginPromise);

    return res.json({ id });
    // console.log(result);
    // res.json({ phoneNumber, phoneCodeHash: result.phoneCodeHash });
    // await client.disconnect();
  } catch (error) {
    console.log(error);
    return res.json({ error });
    // await client.disconnect();
  }
});

app.post('/auth/phonecode', async (req, res) => {
  const { id, phoneCode } = req.body;

  // const stringSession = new StringSession('');
  // const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  //   connectionRetries: 5,
  // });
  // await client.connect();

  const client = clients.get(id);
  const phoneResolver = phoneCodeResolvers.get(id);
  const loginPromise = loginPromises.get(id);

  try {
    //   await client.invoke(
    //     new Api.auth.SignIn({
    //       phoneNumber,
    //       phoneCodeHash,
    //       phoneCode,
    //     })
    //   );

    //   const savedStringSession = client.session.save();
    //   const credential = jwt.sign(
    //     {
    //       stringSession: savedStringSession,
    //       user: {
    //         phoneNumber,
    //       },
    //     },
    //     JWT_KEY
    //   );
    //   res.cookie('credential', credential);
    //   console.log(credential);
    //   res.json({ credential });
    //   await client.disconnect();

    console.log({ clients, phoneCodeResolvers, loginPromises });
    if (!client || !phoneCodeResolvers || loginPromise) {
      return res.json({ id, message: 'login first' });
    }

    phoneResolver(phoneCode);
    await loginPromise;

    const sessionString = client.session.save();
    await client.disconnect();
    clients.delete(id);
    phoneCodeResolvers.delete(id);
    loginPromises.delete(id);

    const credential = jwt.sign(
      {
        stringSession: sessionString,
        user: {
          phoneNumber,
        },
      },
      JWT_KEY
    );
    res.cookie('credential', credential);
    console.log(credential);

    return res.json({ id, credential: sessionString });
  } catch (error) {
    await client.disconnect();
    clients.delete(id);
    phoneCodeResolvers.delete(id);
    loginPromises.delete(id);
    return res.json({ error });
  }
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

  try {
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
    await client.disconnect();
    return res.json({
      id: result.updates[0].id,
      title: file.originalname,
      mimeType: file.mimetype,
    });
  } catch (error) {
    await client.disconnect();
    return res.json({ error });
  }
});

app.get('/uploads', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;

  try {
    // const telegramStringSession = new StringSession(stringSession);
    // const client = new TelegramClient(telegramStringSession, API_ID, API_HASH, {
    //   connectionRetries: 5,
    // });
    // await client.connect();

    // await client.disconnect();
    return res.json(memoryDB);
  } catch (error) {
    return res.json({ error });
  }
});

app.get('/uploads/:id', authMiddleware, async (req, res) => {
  const {
    credential: { stringSession },
  } = req.auth;
  const { id } = req.params;
  const { download } = req.query;

  try {
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
  } catch (error) {
    return res.json({ error });
  }
});

app.get('/', authMiddleware, (req, res) => {
  const {
    credential: { user },
  } = req.auth;
  return res.render('index', { user });
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
