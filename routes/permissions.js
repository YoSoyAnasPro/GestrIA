const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getUserById, getEmployeePermissions, updateEmployeePermissions, getAllUsersByOwner } = require('../database');

router.use(auth);

// Get all users with their permissions (admin/jefe only)
router.get('/', async (req, res) => {
  try {
    const caller = await getUserById(req.userId);
    const role = caller?.role || req.userRole;
    if (!['admin', 'jefe'].includes(role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const users = await getAllUsersByOwner(req.userId);
    const result = await Promise.all(users.filter(u => u.id !== req.userId).map(async u => {
      const perms = await getEmployeePermissions(req.userId, u.id);
      return { ...u, permissions: perms };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get permissions for a specific user
router.get('/:userId', async (req, res) => {
  try {
    const caller = await getUserById(req.userId);
    const role = caller?.role || req.userRole;
    if (!['admin', 'jefe'].includes(role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const perms = await getEmployeePermissions(req.userId, req.params.userId);
    if (!perms) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(perms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update permissions for a specific user
router.put('/:userId', async (req, res) => {
  try {
    const caller = await getUserById(req.userId);
    const role = caller?.role || req.userRole;
    if (!['admin', 'jefe'].includes(role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const targetUser = await getUserById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (targetUser.role === 'admin' && req.userId !== req.params.userId) {
      return res.status(403).json({ error: 'No puedes cambiar permisos de otro administrador' });
    }
    const perms = req.body.permissions || {};
    await updateEmployeePermissions(req.userId, req.params.userId, perms);
    res.json({ success: true, permissions: perms });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get current user's own permissions
router.get('/me/current', async (req, res) => {
  try {
    const perms = await getEmployeePermissions(req.userId, req.userId);
    res.json(perms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
