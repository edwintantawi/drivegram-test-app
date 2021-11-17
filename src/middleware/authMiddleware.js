const jwt = require('jsonwebtoken');

const JWT_KEY = process.env.JWT_KEY;

const authMiddleware = (req, res, next) => {
  const credentials = req.cookies.credentials || req.body.credentials;
  if (!credentials) {
    // return res.json({ error: 'string session not found' });
    return res.redirect('/app/login');
  }

  const decodedCredential = jwt.verify(credentials, JWT_KEY);

  req.credentials = decodedCredential;
  next();
};

module.exports = { authMiddleware };
