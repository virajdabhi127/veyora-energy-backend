const express = require("express");
const router = express.Router();
const database = require("../database");
const authenticate = require("../middleware/auth");

router.get("/", authenticate, (req, res) => {
    const userId = req.user.user_id;
    database.getDevicesByUser(userId, (err, devices) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            username: req.user.username,
            devices
        });
    });
});

module.exports = router;