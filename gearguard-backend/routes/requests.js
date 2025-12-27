const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ===== MIDDLEWARE: AUTHENTICATE TOKEN =====
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token format',
    });
  }

  const token = parts[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    req.userId = decoded.userId;
    next();
  });
}

// ===== HELPER: Generate Request Number =====
async function generateRequestNumber() {
  const connection = await global.pool.getConnection();

  const [rows] = await connection.query(
    'SELECT MAX(id) AS maxId FROM maintenance_requests'
  );

  connection.release();

  const nextId = (rows[0].maxId || 0) + 1;
  const year = new Date().getFullYear();

  return `REQ-${year}-${String(nextId).padStart(4, '0')}`;
}

// ===== HELPER: Calculate Overdue =====
function calculateOverdue(scheduledDate, status) {
  if (status === 'Repaired' || status === 'Scrap') return false;
  if (!scheduledDate) return false;

  const today = new Date();
  const scheduled = new Date(scheduledDate);
  return scheduled < today;
}

// ===== GET ALL REQUESTS =====
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, team_id, overdue } = req.query;

    let query = `
      SELECT 
        r.*,
        e.name as equipment_name,
        e.serial_number,
        COALESCE(r.assigned_to_name, u.name) as assigned_to_name,
        t.name as team_name
      FROM maintenance_requests r
      LEFT JOIN equipment e ON r.equipment_id = e.id
      LEFT JOIN users u ON r.assigned_to_id = u.id
      LEFT JOIN maintenance_teams t ON r.assigned_team_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    if (team_id) {
      query += ' AND r.assigned_team_id = ?';
      params.push(team_id);
    }

    if (overdue === 'true') {
      query += ' AND r.is_overdue = TRUE';
    }

    query += ' ORDER BY r.created_date DESC';

    const connection = await global.pool.getConnection();
    const [requests] = await connection.query(query, params);
    connection.release();

    res.json({
      success: true,
      data: requests,
      count: requests.length,
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== GET SINGLE REQUEST =====
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    const [requests] = await connection.query(
      `SELECT 
        r.*,
        e.name as equipment_name,
        e.serial_number,
        COALESCE(r.assigned_to_name, u.name) as assigned_to_name,
        t.name as team_name
      FROM maintenance_requests r
      LEFT JOIN equipment e ON r.equipment_id = e.id
      LEFT JOIN users u ON r.assigned_to_id = u.id
      LEFT JOIN maintenance_teams t ON r.assigned_team_id = t.id
      WHERE r.id = ?`,
      [id]
    );

    connection.release();

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    res.json({
      success: true,
      data: requests[0],
    });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== CREATE REQUEST (WITH AUTO-FILL) =====
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      type,
      subject,
      description,
      equipment_id,
      priority,
      scheduled_date,
      assigned_to_name,
    } = req.body;

    if (!subject || !equipment_id) {
      return res.status(400).json({
        success: false,
        message: 'Subject and equipment_id are required',
      });
    }

    const connection = await global.pool.getConnection();

    const [equipment] = await connection.query(
      'SELECT category, assigned_team_id FROM equipment WHERE id = ?',
      [equipment_id]
    );

    if (equipment.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Equipment not found',
      });
    }

    const equipmentRow = equipment[0];

    const requestNumber = await generateRequestNumber();

    const isOverdue = calculateOverdue(scheduled_date, 'New');

    const [result] = await connection.query(
      `INSERT INTO maintenance_requests 
       (request_number, type, subject, description, equipment_id, equipment_category,
        assigned_team_id, status, priority, scheduled_date, is_overdue, created_by_id,
        assigned_to_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestNumber,
        type || 'Corrective',
        subject,
        description || null,
        equipment_id,
        equipmentRow.category,
        equipmentRow.assigned_team_id,
        'New',
        priority || 'Medium',
        scheduled_date || null,
        isOverdue,
        req.userId,
        assigned_to_name || null,
      ]
    );

    connection.release();

    res.status(201).json({
      success: true,
      message: 'Request created successfully',
      data: {
        id: result.insertId,
        request_number: requestNumber,
        subject,
        equipment_id,
        equipment_category: equipmentRow.category,
        assigned_team_id: equipmentRow.assigned_team_id,
        status: 'New',
        priority: priority || 'Medium',
        assigned_to_name: assigned_to_name || null,
      },
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== UPDATE REQUEST (PARTIAL) =====
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      subject,
      description,
      status,
      assigned_to_id,
      assigned_team_id,
      priority,
      hours_spent,
      notes,
      assigned_to_name,
    } = req.body;

    const connection = await global.pool.getConnection();

    const [requests] = await connection.query(
      'SELECT * FROM maintenance_requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    const existing = requests[0];

    const updatedSubject = subject ?? existing.subject;
    const updatedDescription = description ?? existing.description;
    const updatedStatus = status ?? existing.status;
    const updatedAssignedTo = assigned_to_id ?? existing.assigned_to_id;
    const updatedAssignedTeam = assigned_team_id ?? existing.assigned_team_id;
    const updatedPriority = priority ?? existing.priority;
    const updatedHours = hours_spent ?? existing.hours_spent;
    const updatedNotes = notes ?? existing.notes;
    const updatedAssignedToName =
      assigned_to_name ?? existing.assigned_to_name;

    const updatedOverdue = calculateOverdue(
      existing.scheduled_date,
      updatedStatus
    );

    let completedDate = existing.completed_date;
    if (
      (updatedStatus === 'Repaired' || updatedStatus === 'Scrap') &&
      !existing.completed_date
    ) {
      completedDate = new Date();
    }

    await connection.query(
      `UPDATE maintenance_requests
       SET subject = ?, description = ?, status = ?, assigned_to_id = ?, assigned_team_id = ?,
           priority = ?, hours_spent = ?, is_overdue = ?, completed_date = ?, notes = ?,
           assigned_to_name = ?
       WHERE id = ?`,
      [
        updatedSubject,
        updatedDescription,
        updatedStatus,
        updatedAssignedTo,
        updatedAssignedTeam,
        updatedPriority,
        updatedHours,
        updatedOverdue,
        completedDate,
        updatedNotes,
        updatedAssignedToName,
        id,
      ]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Request updated successfully',
    });
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== UPDATE STATUS (KANBAN) =====
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, hours_spent } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const validStatuses = ['New', 'In Progress', 'Repaired', 'Scrap'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    const connection = await global.pool.getConnection();

    const [requests] = await connection.query(
      'SELECT * FROM maintenance_requests WHERE id = ?',
      [id]
    );

    if (requests.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    const existing = requests[0];

    const isOverdue = calculateOverdue(existing.scheduled_date, status);

    let completedDate = existing.completed_date;
    if (
      (status === 'Repaired' || status === 'Scrap') &&
      !existing.completed_date
    ) {
      completedDate = new Date();
    }

    await connection.query(
      `UPDATE maintenance_requests
       SET status = ?, is_overdue = ?, completed_date = ?, hours_spent = ?
       WHERE id = ?`,
      [
        status,
        isOverdue,
        completedDate,
        hours_spent || existing.hours_spent,
        id,
      ]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Status updated successfully',
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== ASSIGN REQUEST TO USER BY ID (optional) =====
router.put('/:id/assign', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to_id } = req.body;

    if (!assigned_to_id) {
      return res.status(400).json({
        success: false,
        message: 'assigned_to_id is required',
      });
    }

    const connection = await global.pool.getConnection();

    const [users] = await connection.query(
      'SELECT id, name FROM users WHERE id = ?',
      [assigned_to_id]
    );

    if (users.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = users[0];

    await connection.query(
      'UPDATE maintenance_requests SET assigned_to_id = ?, assigned_to_name = ? WHERE id = ?',
      [assigned_to_id, user.name, id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Request assigned successfully',
    });
  } catch (error) {
    console.error('Assign request error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== GET OVERDUE REQUESTS =====
router.get('/filter/overdue', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [requests] = await connection.query(
      `SELECT * FROM maintenance_requests
       WHERE is_overdue = TRUE AND status != 'Repaired'
       ORDER BY scheduled_date ASC`
    );

    connection.release();

    res.json({
      success: true,
      data: requests,
      count: requests.length,
    });
  } catch (error) {
    console.error('Get overdue error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== DELETE REQUEST =====
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    const [existing] = await connection.query(
      'SELECT id FROM maintenance_requests WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    await connection.query(
      'DELETE FROM maintenance_requests WHERE id = ?',
      [id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Request deleted successfully',
    });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
