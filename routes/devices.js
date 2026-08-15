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

router.get("/:deviceId/daily-energy", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDailyEnergy(deviceId, (err, energy) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            today: energy.today,
            yesterday: energy.yesterday
        });
    });
});

router.get("/:deviceId/monthly-energy", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getMonthlyEnergy(deviceId, (err, energy) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            // Energy
            currentMonth: energy.currentMonth,
            previousMonth: energy.previousMonth,
            // Today's usage
            todayEnergy: energy.todayEnergy,
            // PGVCL estimated energy charges
            monthlyCost: energy.monthlyCost,
            todayCost: energy.todayCost
        });
    });
});

router.get("/:deviceId/channels", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDeviceChannels(deviceId, (err, channels) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            channels
        });
    });
});

router.put("/:deviceId/channels/:channelId", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    const channelId = Number(req.params.channelId);
    const channelName = req.body.channelName;
    if (!Number.isInteger(channelId) || channelId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid channel ID."
        });
    }
    if (
        typeof channelName !== "string" ||
        channelName.trim().length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Channel name cannot be empty."
        });
    }
    if (channelName.trim().length > 30) {
        return res.status(400).json({
            success: false,
            message: "Channel name must be 30 characters or less."
        });
    }
    database.renameDeviceChannel(
        deviceId,
        channelId,
        channelName.trim(),
        (err) => {
            if (err) {
                if (err.message === "Channel not found.") {
                    return res.status(404).json({
                        success: false,
                        message: "Channel not found."
                    });
                }
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            res.json({
                success: true,
                message: "Channel name updated successfully."
            });
        }
    );
});

router.get("/:deviceId/load-history", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getLoadHistory(deviceId, (err, history) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            history
        });
    });
});

router.get("/:deviceId/daily-load", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDailyLoad(deviceId, (err, load) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            load
        });
    });
});

router.get("/:deviceId/monthly-load", authenticate, (req, res) => {
    const deviceId = req.params.deviceId;
    database.getMonthlyLoad(deviceId, (err, load) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            load
        });
    });
});

module.exports = router;