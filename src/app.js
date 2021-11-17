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
const { signInMiddleware } = require('./middleware/signInMiddleware');

// express
const app = express();
const PORT = 5000;

// telegram
const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

// jwt
const JWT_SIGNIN_KEY = process.env.JWT_SIGNIN_KEY;
const JWT_KEY = process.env.JWT_KEY;

// mutler for handling file in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(cookieParser());

const memoryDB = [];

const createClient = async (session = '') => {
  const stringSession = new StringSession(session);
  const options = { connectionRetries: 5, timeout: 60000 };
  const client = new TelegramClient(stringSession, API_ID, API_HASH, options);
  await client.connect();
  return client;
};

app.get('/', authMiddleware, (req, res) => {
  const { id } = req.credentials;
  return res.render('index', { id });
});

app.get('/app/login', (req, res) => {
  return res.render('login');
});

app.post('/auth/sendcode', async (req, res) => {
  const { phoneNumber } = req.body;

  const client = await createClient('');
  try {
    const settings = new Api.CodeSettings({
      allowFlashcall: true,
      currentNumber: true,
      allowAppHash: true,
    });

    const sendCode = new Api.auth.SendCode({
      phoneNumber,
      apiId: API_ID,
      apiHash: API_HASH,
      settings,
    });

    const { phoneCodeHash } = await client.invoke(sendCode);

    const savedSession = client.session.save();

    await client.disconnect();

    const payload = {
      stringSession: savedSession,
    };

    const sessionToken = await jwt.sign(payload, JWT_SIGNIN_KEY);

    res.cookie('signInCredentials', sessionToken);

    return res.json({
      message: 'sendCode success',
      phoneCodeHash,
      phoneNumber,
    });
  } catch (error) {
    await client.disconnect();

    return res.json({ error });
  }
});

app.post('/auth/signin', signInMiddleware, async (req, res) => {
  const { stringSession } = req.credentials;
  const { phoneNumber, phoneCodeHash, phoneCode } = req.body;

  const client = await createClient(stringSession);
  try {
    const signIn = new Api.auth.SignIn({
      phoneNumber,
      phoneCodeHash,
      phoneCode,
    });

    const result = await client.invoke(signIn);
    // VirtualClass {
    //   CONSTRUCTOR_ID: 3439659286,
    //   SUBCLASS_OF_ID: 3118485049,
    //   className: 'auth.Authorization',
    //   classType: 'constructor',
    //   flags: 0,
    //   tmpSessions: null,
    //   user: VirtualClass {
    //     CONSTRUCTOR_ID: 2474924225,
    //     SUBCLASS_OF_ID: 765557111,
    //     className: 'User',
    //     classType: 'constructor',
    //     flags: 33555551,
    //     self: true,
    //     contact: false,
    //     mutualContact: false,
    //     deleted: false,
    //     bot: false,
    //     botChatHistory: false,
    //     botNochats: false,
    //     verified: false,
    //     restricted: false,
    //     min: false,
    //     botInlineGeo: false,
    //     support: false,
    //     scam: false,
    //     applyMinPhoto: true,
    //     fake: false,
    //     id: 1473567916,
    //     accessHash: Integer { value: -4947174912722504629n },
    //     firstName: 'Drivegram',
    //     lastName: '[ User Demo ]',
    //     username: 'drivegramapp',
    //     phone: '6285158055102',
    //     photo: null,
    //     status: VirtualClass {
    //       CONSTRUCTOR_ID: 3988339017,
    //       SUBCLASS_OF_ID: 1527477310,
    //       className: 'UserStatusOnline',
    //       classType: 'constructor',
    //       expires: 1637158440
    //     },
    //     botInfoVersion: null,
    //     restrictionReason: null,
    //     botInlinePlaceholder: null,
    //     langCode: null
    //   }
    // }

    const savedSession = client.session.save();

    await client.disconnect();

    const { id } = result.user;

    const payload = {
      id,
      stringSession: savedSession,
    };

    const credentials = await jwt.sign(payload, JWT_KEY);
    res.clearCookie('signInCredentials');
    res.cookie('credentials', credentials);

    return res.json({ message: 'signIn success', id, phoneNumber });
  } catch (error) {
    await client.disconnect();
    return res.json({ error });
  }
});

app.post('/files', upload.any(), authMiddleware, async (req, res) => {
  const { id, stringSession } = req.credentials;

  const client = await createClient(stringSession);
  try {
    const [file] = req.files;

    const sendMedia = new Api.messages.SendMedia({
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
    });

    const result = await client.invoke(sendMedia);

    memoryDB.push({
      uid: id,
      id: result.updates[0].id,
      title: file.originalname,
      mimeType: file.mimetype,
      url: `/files/${result.updates[0].id}`,
      download_url: `/files/${result.updates[0].id}?download=1`,
    });

    await client.disconnect();

    return res.json({
      message: 'Upload success',
      file: {
        id: result.updates[0].id,
        title: file.originalname,
        mimeType: file.mimetype,
      },
    });
  } catch (error) {
    console.log(error);
    await client.disconnect();
    return res.json({ error });
  }
});

app.get('/files', authMiddleware, async (req, res) => {
  const { id } = req.credentials;

  try {
    const result = memoryDB.filter((file) => file.uid == id);
    return res.json(result);
  } catch (error) {
    return res.json({ error });
  }
});

app.get('/files/:fileid', authMiddleware, async (req, res) => {
  const { stringSession } = req.credentials;
  const { fileid } = req.params;
  const { download } = req.query;

  const client = await createClient(stringSession);

  const file = memoryDB.find((file) => file.id == fileid);
  try {
    const getMessages = new Api.messages.GetMessages({
      id: [parseInt(fileid)],
    });

    const result = await client.invoke(getMessages);

    const resultFile = await client.downloadMedia(result.messages[0], {
      progressCallback: console.log,
    });

    await client.disconnect();

    const mimeType = result.messages[0].media.document.mimeType;
    res.type(mimeType);
    if (download === '1') {
      console.log(file);
      res.set('Content-Disposition', `attachment; filename="${file.title}"`);
    }
    return res.send(resultFile);
  } catch (error) {
    await client.disconnect();
    return res.json({ error });
  }
});

app.listen(PORT, () => {
  console.log(`Server start at: http://localhost:${PORT}`);
});
