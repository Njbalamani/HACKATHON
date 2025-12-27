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

// ===== DASHBOARD STATISTICS =====
router.get('/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    // Total requests
    const [totalRows] = await connection.query(
      'SELECT COUNT(*) as total FROM maintenance_requests'
    );
    const totalRequests = totalRows[0]?.total || 0;

    // By status
    const [statusRows] = await connection.query(
      `SELECT status, COUNT(*) as count FROM maintenance_requests 
       GROUP BY status`
    );

    // Overdue count
    const [overdueRows] = await connection.query(
      `SELECT COUNT(*) as overdue FROM maintenance_requests 
       WHERE is_overdue = TRUE AND status != 'Repaired' AND status != 'Scrap'`
    );
    const overdueCount = overdueRows[0]?.overdue || 0;

    // Average hours spent
    const [hoursRows] = await connection.query(
      `SELECT AVG(hours_spent) as avg_hours FROM maintenance_requests 
       WHERE hours_spent IS NOT NULL AND hours_spent > 0`
    );
    const rawAvgHours = hoursRows[0]?.avg_hours || 0;
    const avgHours = rawAvgHours ? parseFloat(rawAvgHours).toFixed(2) : 0;

    // Equipment count
    const [equipRows] = await connection.query(
      'SELECT COUNT(*) as total FROM equipment'
    );
    const equipmentCount = equipRows[0]?.total || 0;

    // Team members count (example: technicians + supervisors)
    const [teamRows] = await connection.query(
      "SELECT COUNT(*) as total FROM users WHERE role IN ('technician', 'supervisor')"
    );
    const teamMembers = teamRows[0]?.total || 0;

    // Completion rate
    const completedCount =
      statusRows.find((s) => s.status === 'Repaired')?.count || 0;
    const completionRate =
      totalRequests > 0
        ? ((completedCount / totalRequests) * 100).toFixed(2)
        : 0;

    connection.release();

    res.json({
      success: true,
      data: {
        totalRequests,
        statusBreakdown: statusRows.reduce((acc, s) => {
          acc[s.status] = s.count;
          return acc;
        }, {}),
        overdueCount,
        completionRate: `${completionRate}%`,
        avgHours: parseFloat(avgHours),
        equipmentCount,
        teamMembers,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== REPORTS: BY EQUIPMENT =====
router.get('/equipment', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [reports] = await connection.query(
      `SELECT 
        e.id,
        e.name as equipment_name,
        e.category,
        COUNT(r.id) as total_requests,
        SUM(CASE WHEN r.status = 'Repaired' THEN 1 ELSE 0 END) as completed_requests,
        SUM(CASE WHEN r.is_overdue = TRUE AND r.status NOT IN ('Repaired', 'Scrap') THEN 1 ELSE 0 END) as overdue_requests,
        AVG(r.hours_spent) as avg_hours_spent,
        MAX(r.created_date) as last_request_date
       FROM equipment e
       LEFT JOIN maintenance_requests r ON e.id = r.equipment_id
       GROUP BY e.id, e.name, e.category
       ORDER BY total_requests DESC`
    );

    connection.release();

    res.json({
      success: true,
      data: reports.map((r) => ({
        equipment_id: r.id,
        equipment_name: r.equipment_name,
        category: r.category,
        total_requests: r.total_requests || 0,
        completed_requests: r.completed_requests || 0,
        overdue_requests: r.overdue_requests || 0,
        completion_rate: r.total_requests
          ? ((r.completed_requests / r.total_requests) * 100).toFixed(2) + '%'
          : 'N/A',
        avg_hours_spent: r.avg_hours_spent
          ? parseFloat(r.avg_hours_spent).toFixed(2)
          : 0,
        last_request_date: r.last_request_date,
      })),
      count: reports.length,
    });
  } catch (error) {
    console.error('Equipment report error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== REPORTS: BY TEAM =====
router.get('/team', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [reports] = await connection.query(
      `SELECT 
        t.id,
        t.name as team_name,
        COUNT(r.id) as total_requests,
        SUM(CASE WHEN r.status = 'Repaired' THEN 1 ELSE 0 END) as completed_requests,
        SUM(CASE WHEN r.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(r.hours_spent) as total_hours_spent,
        AVG(r.hours_spent) as avg_hours_per_request
       FROM maintenance_teams t
       LEFT JOIN maintenance_requests r ON t.id = r.assigned_team_id
       GROUP BY t.id, t.name
       ORDER BY total_requests DESC`
    );

    connection.release();

    res.json({
      success: true,
      data: reports.map((r) => ({
        team_id: r.id,
        team_name: r.team_name,
        total_requests: r.total_requests || 0,
        completed_requests: r.completed_requests || 0,
        in_progress: r.in_progress || 0,
        total_hours_spent: r.total_hours_spent
          ? parseFloat(r.total_hours_spent).toFixed(2)
          : 0,
        avg_hours_per_request: r.avg_hours_per_request
          ? parseFloat(r.avg_hours_per_request).toFixed(2)
          : 0,
        efficiency_rate: r.total_requests
          ? ((r.completed_requests / r.total_requests) * 100).toFixed(2) + '%'
          : 'N/A',
      })),
      count: reports.length,
    });
  } catch (error) {
    console.error('Team report error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== REPORTS: BY TECHNICIAN =====
router.get('/technician', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [reports] = await connection.query(
      `SELECT 
        u.id,
        u.name as technician_name,
        u.role,
        COUNT(r.id) as assigned_requests,
        SUM(CASE WHEN r.status = 'Repaired' THEN 1 ELSE 0 END) as completed_requests,
        SUM(CASE WHEN r.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(r.hours_spent) as total_hours_spent,
        AVG(r.hours_spent) as avg_hours_per_job
       FROM users u
       LEFT JOIN maintenance_requests r ON u.id = r.assigned_to_id
       WHERE u.role IN ('technician', 'supervisor')
       GROUP BY u.id, u.name, u.role
       ORDER BY completed_requests DESC`
    );

    connection.release();

    res.json({
      success: true,
      data: reports.map((r) => ({
        technician_id: r.id,
        technician_name: r.technician_name,
        role: r.role,
        assigned_requests: r.assigned_requests || 0,
        completed_requests: r.completed_requests || 0,
        in_progress: r.in_progress || 0,
        total_hours_spent: r.total_hours_spent
          ? parseFloat(r.total_hours_spent).toFixed(2)
          : 0,
        avg_hours_per_job: r.avg_hours_per_job
          ? parseFloat(r.avg_hours_per_job).toFixed(2)
          : 0,
        productivity_rate: r.assigned_requests
          ? ((r.completed_requests / r.assigned_requests) * 100).toFixed(2) +
            '%'
          : 'N/A',
      })),
      count: reports.length,
    });
  } catch (error) {
    console.error('Technician report error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== PERFORMANCE METRICS =====
router.get('/performance', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [overallRows] = await connection.query(
      `SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'Repaired' THEN 1 ELSE 0 END) as total_completed,
        SUM(CASE WHEN is_overdue = TRUE AND status NOT IN ('Repaired', 'Scrap') THEN 1 ELSE 0 END) as total_overdue,
        AVG(hours_spent) as avg_hours,
        MIN(created_date) as first_request_date,
        MAX(created_date) as last_request_date
       FROM maintenance_requests`
    );

    const overall = overallRows[0];

    const [monthlyData] = await connection.query(
      `SELECT 
        DATE_FORMAT(created_date, '%Y-%m') as month,
        COUNT(*) as requests,
        SUM(CASE WHEN status = 'Repaired' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN is_overdue = TRUE THEN 1 ELSE 0 END) as overdue
       FROM maintenance_requests
       WHERE created_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(created_date, '%Y-%m')
       ORDER BY month DESC`
    );

    connection.release();

    const completionRate =
      overall.total_requests > 0
        ? ((overall.total_completed / overall.total_requests) * 100).toFixed(2)
        : 0;

    const overdueRate =
      overall.total_requests > 0
        ? ((overall.total_overdue / overall.total_requests) * 100).toFixed(2)
        : 0;

    res.json({
      success: true,
      data: {
        overall: {
          total_requests: overall.total_requests || 0,
          completed_requests: overall.total_completed || 0,
          overdue_requests: overall.total_overdue || 0,
          completion_rate: `${completionRate}%`,
          overdue_rate: `${overdueRate}%`,
          avg_hours_per_request: overall.avg_hours
            ? parseFloat(overall.avg_hours).toFixed(2)
            : 0,
          first_request_date: overall.first_request_date,
          last_request_date: overall.last_request_date,
        },
        monthly_trends: monthlyData.map((m) => ({
          month: m.month,
          total_requests: m.requests,
          completed: m.completed || 0,
          overdue: m.overdue || 0,
          completion_percentage: m.requests
            ? ((m.completed / m.requests) * 100).toFixed(2) + '%'
            : 'N/A',
        })),
      },
    });
  } catch (error) {
    console.error('Performance metrics error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== EQUIPMENT DOWNTIME ANALYSIS =====
router.get('/downtime', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const [downtimeData] = await connection.query(
      `SELECT 
        e.id,
        e.name as equipment_name,
        COUNT(DISTINCT r.id) as maintenance_events,
        SUM(CASE WHEN r.status IN ('In Progress', 'New') THEN 1 ELSE 0 END) as current_pending,
        SUM(r.hours_spent) as total_maintenance_hours,
        MAX(r.created_date) as last_maintenance_date
       FROM equipment e
       LEFT JOIN maintenance_requests r ON e.id = r.equipment_id
       GROUP BY e.id, e.name
       HAVING maintenance_events > 0
       ORDER BY total_maintenance_hours DESC`
    );

    connection.release();

    res.json({
      success: true,
      data: downtimeData.map((d) => ({
        equipment_id: d.id,
        equipment_name: d.equipment_name,
        maintenance_events: d.maintenance_events || 0,
        current_pending_tasks: d.current_pending || 0,
        total_maintenance_hours: d.total_maintenance_hours
          ? parseFloat(d.total_maintenance_hours).toFixed(2)
          : 0,
        last_maintenance_date: d.last_maintenance_date,
        risk_level:
          (d.current_pending || 0) > 3
            ? 'HIGH'
            : (d.current_pending || 0) > 1
            ? 'MEDIUM'
            : 'LOW',
      })),
      count: downtimeData.length,
    });
  } catch (error) {
    console.error('Downtime analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ===== TEAM WORKLOAD ANALYSIS =====
router.get('/workload', authenticateToken, async (req, res) => {
  try {
    const connection = await global.pool.getConnection();

    const sql = `
      SELECT 
        t.id AS team_id,
        t.name AS team_name,
        COUNT(r.id) AS total_assigned,
        SUM(CASE WHEN r.status = 'New' THEN 1 ELSE 0 END) AS new_requests,
        SUM(CASE WHEN r.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN r.priority = 'Critical' THEN 1 ELSE 0 END) AS critical_tasks
      FROM maintenance_teams t
      LEFT JOIN maintenance_requests r ON t.id = r.assigned_team_id
      GROUP BY t.id, t.name
    `;

    const [rows] = await connection.query(sql);

    connection.release();

    rows.sort((a, b) => {
      const inProgA = a.in_progress || 0;
      const inProgB = b.in_progress || 0;
      if (inProgB !== inProgA) return inProgB - inProgA;

      const critA = a.critical_tasks || 0;
      const critB = b.critical_tasks || 0;
      return critB - critA;
    });

    res.json({
      success: true,
      data: rows.map((w) => ({
        team_id: w.team_id,
        team_name: w.team_name,
        total_assigned: w.total_assigned || 0,
        new_requests: w.new_requests || 0,
        in_progress: w.in_progress || 0,
        critical_tasks: w.critical_tasks || 0,
        workload_status:
          (w.in_progress || 0) > 5
            ? 'OVERLOADED'
            : (w.in_progress || 0) > 2
            ? 'BUSY'
            : 'AVAILABLE',
        avg_days_to_completion: 'N/A',
      })),
      count: rows.length,
    });
  } catch (error) {
    console.error('Workload analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
