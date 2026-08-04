const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authenticate = require("../middleware/auth");
const database = require("../database");
const config = require("../config");

const router = express.Router();

router.post("/login", (req, res) => {
    const { userid, password } = req.body;
    if (!userid || !password) {
        return res.status(400).json({
            success: false,
            message: "User ID and password are required."
        });
    }
    database.getUser(userid, (err, user) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Internal server error."
            });
        }
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid User ID or Password."
            });
        }
        bcrypt.compare(password, user.password, (err, match) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Internal server error."
                });
            }
            if (!match) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid User ID or Password."
                });
            }
            const token = jwt.sign(
                {
                    user_id: user.user_id,
                    userid: user.userid,
                    username: user.username,
                    role: user.role
                },
                config.jwt.secret,
                {
                    expiresIn: config.jwt.expiresIn
                }
            );
            res.cookie("token", token, {
                httpOnly: true,
                secure: config.isProduction,                    
                sameSite: config.isProduction ? "none" : "lax", 
                maxAge: 24 * 60 * 60 * 1000
            });
            res.json({
                success: true,
                user: {
                    user_id: user.user_id,
                    userid: user.userid,
                    username: user.username,
                    role: user.role
                }
            });
        });
    });
});

router.get("/me", authenticate, (req, res) => {
    res.json({
        success: true,
        user: {
            user_id: req.user.user_id,
            userid: req.user.userid,
            username: req.user.username
        }
    });
});

router.post("/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: config.isProduction ? "none" : "lax"
    });
    res.json({
        success: true
    });
});

module.exports = router;