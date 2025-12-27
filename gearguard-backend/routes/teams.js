const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ===== MIDDLEWARE: AUTHENTICATE TOKEN =====
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'No token provided'
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token format'
    });
  }

  const token = parts[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    req.userId = decoded.userId;
    next();
  });
}

// ===== GET ALL TEAMS =====
router.get('/', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [teams] = await connection.query(`
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.team_lead_id, 
        t.specialization, 
        t.is_active,
        COUNT(tm.user_id) as member_count,
        u.name as team_lead_name
      FROM maintenance_teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON t.team_lead_id = u.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);

    connection.release();

    res.json({
      success: true,
      data: teams,
      count: teams.length
    });

  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== GET SINGLE TEAM WITH MEMBERS =====
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    // Get team details
    const [teams] = await connection.query(
      'SELECT * FROM maintenance_teams WHERE id = ?',
      [id]
    );

    if (teams.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }

    // Get team members
    const [members] = await connection.query(`
      SELECT u.id, u.name, u.email, u.role, tm.joined_at
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
    `, [id]);

    connection.release();

    res.json({
      success: true,
      data: {
        ...teams,
        members: members
      }
    });

  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== CREATE TEAM =====
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, team_lead_id, specialization } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Team name is required' 
      });
    }

    const connection = await global.pool.getConnection();

    // Create team
    const [result] = await connection.query(
      `INSERT INTO maintenance_teams (name, description, team_lead_id, specialization) 
       VALUES (?, ?, ?, ?)`,
      [name, description || null, team_lead_id || null, specialization || null]
    );

    connection.release();

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: {
        id: result.insertId,
        name,
        description,
        team_lead_id,
        specialization
      }
    });

  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== UPDATE TEAM =====
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, team_lead_id, specialization } = req.body;

    const connection = await global.pool.getConnection();

    // Check if team exists
    const [existing] = await connection.query(
      'SELECT id FROM maintenance_teams WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }

    // Update team
    await connection.query(
      `UPDATE maintenance_teams 
       SET name = ?, description = ?, team_lead_id = ?, specialization = ?
       WHERE id = ?`,
      [name, description || null, team_lead_id || null, specialization || null, id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Team updated successfully',
      data: { id, name, description, team_lead_id, specialization }
    });

  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== DELETE TEAM =====
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    // Check if team exists
    const [existing] = await connection.query(
      'SELECT id FROM maintenance_teams WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }

    // Delete team (cascade will remove members)
    await connection.query(
      'DELETE FROM maintenance_teams WHERE id = ?',
      [id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Team deleted successfully'
    });

  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== ADD MEMBER TO TEAM =====
router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    const connection = await global.pool.getConnection();

    // Check if team exists
    const [teams] = await connection.query(
      'SELECT id FROM maintenance_teams WHERE id = ?',
      [id]
    );

    if (teams.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Team not found' 
      });
    }

    // Check if user exists
    const [users] = await connection.query(
      'SELECT id FROM users WHERE id = ?',
      [user_id]
    );

    if (users.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check if already member
    const [existing] = await connection.query(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [id, user_id]
    );

    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'User is already a team member' 
      });
    }

    // Add member
    await connection.query(
      'INSERT INTO team_members (team_id, user_id) VALUES (?, ?)',
      [id, user_id]
    );

    connection.release();

    res.status(201).json({
      success: true,
      message: 'Member added to team'
    });

  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== REMOVE MEMBER FROM TEAM =====
router.delete('/:id/members/:user_id', authenticateToken, async (req, res) => {
  try {
    const { id, user_id } = req.params;

    const connection = await global.pool.getConnection();

    // Check if member exists
    const [existing] = await connection.query(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [id, user_id]
    );

    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found in team' 
      });
    }

    // Remove member
    await connection.query(
      'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
      [id, user_id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Member removed from team'
    });

  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;
