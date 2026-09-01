require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const authRoutes = require("./routes/auth");
const deviceRoutes = require("./routes/devices");
const database = require("./database");
const config = require("./config");
const mqtt = require("./mqtt");
const adminRoutes = require("./routes/admin");
const cookieParser = require("cookie-parser");
const initializeSocket = require("./socket");

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://veyora.in"
    ],
    credentials: true
}));

const io = initializeSocket(server, mqtt);

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/devices", deviceRoutes);

function checkDailyHistoryRollover() {
    database.getAllDevices((err, devices) => {
        if (err) {
            console.error(
                "Failed to get devices for daily history rollover:",
                err.message
            );
            return;
        }
        if (!devices || devices.length === 0) {
            return;
        }
        devices.forEach(device => {
            database.ensureDailyHistoryRow(
                device.deviceId,
                (err) => {
                    if (err) {
                        console.error(
                            `Daily history rollover failed for ${device.deviceId}:`,
                            err.message
                        );
                    }
                }
            );
        });
    });
}

database.init(() => {
    checkDailyHistoryRollover();
    setInterval(checkDailyHistoryRollover, 10 * 60 * 1000);
    server.listen(config.server.port, () => {
        console.log("SERVER_STARTED");
    });
});