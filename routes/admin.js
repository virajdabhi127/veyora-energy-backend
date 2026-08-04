const express = require("express");
const router = express.Router();

const database = require("../database");
const authenticate = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");

router.use(authenticate);
router.use(requireAdmin);

router.post("/create-user", (req, res) => {
    const { userid, username, password, role } = req.body;
    database.createUser(
        userid,
        username,
        password,
        role,
        (err, userId) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }
            res.json({
                success: true,
                message: "User created successfully.",
                userId
            });
        }
    );
});

router.get("/users", (req, res) => {
    database.getAllUsers((err, users) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            users
        });
    });
});

router.delete("/user/:userid", (req, res) => {
    const userid = req.params.userid;
    if (userid === req.user.userid) {
        return res.status(400).json({
            success: false,
            message: "You cannot delete your own account."
        });
    }
    database.deleteUser(userid, (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            message: "User deleted successfully."
        });
    });
});

router.put("/user/:userid", (req, res) => {
    const userid = req.params.userid;
    const { username, password, role } = req.body;
    database.updateUser(
        userid,
        username,
        password,
        role,
        (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            res.json({
                success: true,
                message: "User updated successfully."
            });
        }
    );
});

router.get("/devices", (req, res) => {
    database.getAllDevices((err, devices) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            devices
        });
    });
});

router.post("/assign-device", (req, res) => {
    const {
        deviceId,
        userid,
        productCode,
        channelCount
    } = req.body;
    database.getUserByUserId(userid, (err, user) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
        database.assignDevice(
            deviceId,
            user.user_id,
            productCode,
            parseInt(channelCount),
            (err) => {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        message: err.message
                    });
                }
                res.json({
                    success: true,
                    message: "Device assigned successfully."
                });
            }
        );
    });
});

router.put("/device/:deviceId", (req, res) => {
    const deviceId = req.params.deviceId;
    const {
        userid,
        productCode,
        channelCount
    } = req.body;
    database.getUserByUserId(userid, (err, user) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
        database.updatedevice(
            deviceId,
            user.user_id,
            productCode,
            parseInt(channelCount),
            (err) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Database error."
                    });
                }
                res.json({
                    success: true,
                    message: "Device updated successfully."
                });
            }
        );
    });
});

router.delete("/device/:deviceId", (req, res) => {
    const deviceId = req.params.deviceId;
    database.deleteDevice(deviceId, (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            message: "Device deleted successfully."
        });
    });
});

router.get("/stats", (req, res) => {
    database.getAdminStats((err, stats) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            totalUsers: stats.totalUsers,
            totalDevices: stats.totalDevices
        });
    });
});

module.exports = router;