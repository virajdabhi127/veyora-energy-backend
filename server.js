const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const config = require("./config");
const mqtt = require("./mqtt");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("Dashboard Connected");
    socket.emit("update", mqtt.latestData);
    socket.on("disconnect", () => {
        console.log("Dashboard Disconnected");
    });
});

mqtt.mqttEvents.on("data", (data) => {
    io.emit("update", data);
});

server.listen(config.server.port, () => {
    console.log("--------------------------------");
    console.log("Energy Monitor Started");
    console.log("http://localhost:" + config.server.port);
    console.log("--------------------------------");
});