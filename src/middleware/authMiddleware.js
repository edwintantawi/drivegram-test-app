const jwt = require('jsonwebtoken');

const JWT_KEY = process.env.JWT_KEY;

const authMiddleware = (req, res, next) => {
  // const { credential } = req.cookies;
  const credential = req.cookies.credential || req.body.credential;
  // const { credential } = req.body;
  if (!credential) {
    // return res.json({ error: 'string session not found' });
    res.redirect('/app/login');
  }

  const decodedCredential = jwt.verify(credential, JWT_KEY);

  req.auth = { credential: decodedCredential };
  next();
};

module.exports = { authMiddleware };
