const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { parse } = require("cookie");
const config = require("./config");
const deviceService = require("./services/deviceService");

function initializeSocket(server, mqtt) {

    const io = new Server(server, {
        cors: {
            origin: [
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                "http://localhost:3000",
                "https://veyora.in"
            ],
            credentials: true
        }
    });

    io.use((socket, next) => {
        const rawCookie = socket.handshake.headers.cookie;
        if (!rawCookie) {
            return next(new Error("Authentication required"));
        }
        const cookies = parse(rawCookie);
        const token = cookies.token;

        if (!token) {
            return next(new Error("Authentication required"));
        }

        jwt.verify(token, config.jwt.secret, (err, decoded) => {
            if (err) {
                return next(new Error("Invalid token"));
            }
            deviceService.getUserDevices(decoded.user_id, (err, devices) => {
                if (err) {
                    return next(new Error("Database error"));
                }
                socket.user = decoded;
                socket.devices = devices.map(device => device.deviceId);
                socket.selectedDevice = devices.length > 0 ? devices[0].deviceId : null;
                next();
            });
        });
    });

    io.on("connection", (socket) => {
    socket.on("selectDevice", (deviceId) => {
        if (!socket.devices.includes(deviceId)) {
            return;
        }
        socket.selectedDevice = deviceId;
        const device = mqtt.latestDevices.get(deviceId);
        if (device) {
            socket.emit("update", device);
        }
    });
});

    mqtt.mqttEvents.on("data", (data) => {
        for (const socket of io.sockets.sockets.values()) {
            if (socket.selectedDevice === data.deviceId) {
                socket.emit("update", data);
            }
        }
    });
    return io;
}

module.exports = initializeSocket;