const express = require('express');
const jwt = require('jsonwebtoken')
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


// ===== GET ALL EQUIPMENT =====
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, status, department } = req.query;

    let query = 'SELECT * FROM equipment WHERE 1=1';
    let params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (department) {
      query += ' AND department = ?';
      params.push(department);
    }

    query += ' ORDER BY created_at DESC';

    const connection = await global.pool.getConnection();
    const [equipment] = await connection.query(query, params);
    connection.release();

    res.json({
      success: true,
      data: equipment,
      count: equipment.length
    });

  } catch (error) {
    console.error('Get equipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== GET SINGLE EQUIPMENT =====
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    const [equipment] = await connection.query(
      'SELECT * FROM equipment WHERE id = ?',
      [id]
    );

    connection.release();

    if (equipment.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Equipment not found' 
      });
    }

    res.json({
      success: true,
      data: equipment
    });

  } catch (error) {
    console.error('Get equipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== CREATE EQUIPMENT =====
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      serial_number,
      category,
      location,
      department,
      purchase_date,
      warranty_expiry,
      assigned_to_id,
      assigned_team_id,
      notes
    } = req.body;

    // Validation
    if (!name || !serial_number) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and serial number are required' 
      });
    }

    const connection = await global.pool.getConnection();

    // Check if serial number already exists
    const [existing] = await connection.query(
      'SELECT id FROM equipment WHERE serial_number = ?',
      [serial_number]
    );

    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Equipment with this serial number already exists' 
      });
    }

    // Create equipment
    const [result] = await connection.query(
      `INSERT INTO equipment 
       (name, serial_number, category, location, department, purchase_date, warranty_expiry, assigned_to_id, assigned_team_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        serial_number,
        category || 'Machinery',
        location || null,
        department || null,
        purchase_date || null,
        warranty_expiry || null,
        assigned_to_id || null,
        assigned_team_id || null,
        notes || null
      ]
    );

    connection.release();

    res.status(201).json({
      success: true,
      message: 'Equipment created successfully',
      data: {
        id: result.insertId,
        name,
        serial_number,
        category,
        location,
        department,
        status: 'Active'
      }
    });

  } catch (error) {
    console.error('Create equipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== UPDATE EQUIPMENT (PARTIAL) =====
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      serial_number,
      category,
      location,
      department,
      purchase_date,
      warranty_expiry,
      assigned_to_id,
      assigned_team_id,
      status,
      notes
    } = req.body;

    const connection = await global.pool.getConnection();

    // Get existing equipment
    const [existingRows] = await connection.query(
      'SELECT * FROM equipment WHERE id = ?',
      [id]
    );

    if (existingRows.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }

    const existing = existingRows[0];

    // Use new value if provided, otherwise keep existing
    const updated = {
      name: name ?? existing.name,
      serial_number: serial_number ?? existing.serial_number,
      category: category ?? existing.category,
      location: location ?? existing.location,
      department: department ?? existing.department,
      purchase_date: purchase_date ?? existing.purchase_date,
      warranty_expiry: warranty_expiry ?? existing.warranty_expiry,
      assigned_to_id: assigned_to_id ?? existing.assigned_to_id,
      assigned_team_id: assigned_team_id ?? existing.assigned_team_id,
      status: status ?? existing.status,
      notes: notes ?? existing.notes
    };

    await connection.query(
      `UPDATE equipment
       SET name = ?, serial_number = ?, category = ?, location = ?, department = ?,
           purchase_date = ?, warranty_expiry = ?, assigned_to_id = ?, assigned_team_id = ?,
           status = ?, notes = ?
       WHERE id = ?`,
      [
        updated.name,
        updated.serial_number,
        updated.category,
        updated.location,
        updated.department,
        updated.purchase_date,
        updated.warranty_expiry,
        updated.assigned_to_id,
        updated.assigned_team_id,
        updated.status,
        updated.notes,
        id
      ]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Equipment updated successfully'
    });

  } catch (error) {
    console.error('Update equipment error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===== DELETE EQUIPMENT =====
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await global.pool.getConnection();

    // Check if equipment exists
    const [existing] = await connection.query(
      'SELECT id FROM equipment WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Equipment not found' 
      });
    }

    // Delete equipment
    await connection.query(
      'DELETE FROM equipment WHERE id = ?',
      [id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Equipment deleted successfully'
    });

  } catch (error) {
    console.error('Delete equipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== SEARCH EQUIPMENT =====
router.get('/search/query', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query must be at least 2 characters' 
      });
    }

    const connection = await global.pool.getConnection();

    const [equipment] = await connection.query(
      'SELECT * FROM equipment WHERE name LIKE ? OR serial_number LIKE ?',
      [`%${q}%`, `%${q}%`]
    );

    connection.release();

    res.json({
      success: true,
      data: equipment,
      count: equipment.length
    });

  } catch (error) {
    console.error('Search equipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;
