// routes/users.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Invalid token format' });
  }

  const token = parts[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    req.userId = decoded.userId;
    next();
  });
}

// GET /api/users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [users] = await connection.query(
      'SELECT id, name, email, role FROM users ORDER BY name ASC'
    );

    connection.release();

    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
