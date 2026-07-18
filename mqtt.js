const mqtt = require("mqtt");
const config = require("./config");
const database = require("./database");
const EventEmitter = require("events");

let latestData = {
    voltage: 0,
    current: 0,
    pf: 0,
    realPower: 0,
    apparentPower: 0,
    energyWh: 0,
    energyKWh: database.loadEnergy(),
    connected: false,
    lastUpdate: "--:--:--"
};

const mqttEvents = new EventEmitter();

const client = mqtt.connect({
    host: config.mqtt.host,
    port: config.mqtt.port,
    protocol: "mqtts",
    username: config.mqtt.username,
    password: config.mqtt.password,
    reconnectPeriod: 5000
});

client.on("connect", () => {
    console.log("MQTT Connected");
    latestData.connected = true;
    client.subscribe(config.mqtt.topic, (err) => {
        if (err) {
            console.log("Subscribe Failed");
        } else {
            console.log("Subscribed to", config.mqtt.topic);
        }
    });
});

client.on("close", () => {
    console.log("MQTT Disconnected");
    latestData.connected = false;
});

client.on("error", (err) => {
    console.error("MQTT Error:", err);
});

client.on("message", (topic, message) => {

    try {
        const data = JSON.parse(message.toString());

        latestData.voltage = Number(data.voltage) || 0;
        latestData.current = Number(data.current) || 0;
        latestData.pf = Number(data.pf) || 0;
        latestData.apparentPower = latestData.voltage * latestData.current;
        latestData.realPower = latestData.apparentPower * latestData.pf;
        latestData.energyKWh = Number(data.energyKwh) || latestData.energyKWh;
        latestData.energyWh = latestData.energyKWh * 1000;
        latestData.lastUpdate = Date.now();

        mqttEvents.emit("data", latestData);
    }

    catch (err) {
        console.log("Invalid MQTT JSON");
    }
});

setInterval(() => {
    database.saveEnergy(latestData.energyKWh);
}, config.saveInterval);

module.exports = {
    latestData,
    mqttEvents
};