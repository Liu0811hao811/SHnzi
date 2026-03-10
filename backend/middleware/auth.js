const jwt    = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'shanzi_jwt_secret_2026';

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '未授权，请先登录' });
  }

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token 无效或已过期，请重新登录' });
  }
};
