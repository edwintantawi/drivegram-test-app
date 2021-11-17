const jwt = require('jsonwebtoken');

const JWT_SIGNIN_KEY = process.env.JWT_SIGNIN_KEY;

const signInMiddleware = async (req, res, next) => {
  const { signInCredentials } = req.cookies;

  try {
    const result = await jwt.verify(signInCredentials, JWT_SIGNIN_KEY);
    req.credentials = result;
    next();
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
};

module.exports = { signInMiddleware };
