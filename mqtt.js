const lastDatabaseSave = new Map();
const mqtt = require("mqtt");
const config = require("./config");
const database = require("./database");
const EventEmitter = require("events");
const mqttEvents = new EventEmitter();
const latestDevices = new Map();

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
    client.subscribe(config.mqtt.topic, (err) => {
        if (err) {
            console.error("Subscribe Failed:", err.message);
        } 
    });
});

client.on("error", (err) => {
    console.error("MQTT Error:", err);
});

client.on("message", (topic, message) => {
    const parts = topic.split("/");
    const product = parts[0];
    const deviceId = parts[1];
    database.getDevice(deviceId, (err, device) => {
        if (err) {
            console.error("Database Error:", err.message);
            return;
        }
        if (!device) {
            console.log(`Unknown Device: ${deviceId}`);
            return;
        }
        if (device.product_code !== config.productCodes[product]) {
            console.log(
                `Product mismatch for ${deviceId}. Expected ${device.product_code}, received ${product}`
            );
            return;
        }
        try {
            const data = JSON.parse(message.toString());
            if (typeof data !== "object" || data === null) {
                console.error("Invalid MQTT payload");
                return;
            }
            let deviceData = latestDevices.get(deviceId);
            if (!deviceData) {
                deviceData = {
                    deviceId,
                    product,
                    payloadVersion: 0,
                    channelCount: 0,
                    voltage: 0,
                    totalCurrent: 0,
                    totalRealPower: 0,
                    totalApparentPower: 0,
                    energyKWh: 0,
                    channels: [
                        {
                            channelId: 1,
                            current: 0,
                            pf: 0,
                            realPower: 0,
                            apparentPower: 0
                        }
                    ],
                    connected: true,
                    lastUpdate: "--:--:--",
                    lastSeen: 0
                };
                latestDevices.set(deviceId, deviceData);
            }
            if (!deviceData.connected) {
                database.updateDevice(deviceId, 1);
            }
            deviceData.connected = true;
            const payloadVersion = Number(data.payloadVersion) || 1;
            const channelCount = Number(data.channelCount) || 1;
            if (deviceData.payloadVersion !== payloadVersion || deviceData.channelCount !== channelCount) {
                deviceData.payloadVersion = payloadVersion;
                deviceData.channelCount = channelCount;
                database.updateDeviceInfo(
                    deviceId,
                    payloadVersion,
                    channelCount
                );
            }
            deviceData.voltage = Number(data.voltage) || 0;
            deviceData.totalCurrent = Number(data.totalCurrent) || 0;
            deviceData.channels = Array.isArray(data.channels) ? data.channels : [];
            deviceData.totalRealPower = 0;
            deviceData.totalApparentPower = 0;
            deviceData.energyKWh = Number(data.energyKWh) || 0;
            deviceData.channels.forEach(channel => {
                channel.apparentPower = deviceData.voltage * channel.current;
                channel.realPower = channel.apparentPower * channel.pf;
                deviceData.totalApparentPower += channel.apparentPower;
                deviceData.totalRealPower += channel.realPower;
            });
            const now = Date.now();
            deviceData.lastSeen = now;
            deviceData.lastUpdate = new Date(now).toISOString();
            // ---------------------------------------
            const lastSave = lastDatabaseSave.get(deviceId) || 0;
            if (now - lastSave >= config.saveInterval) {
                database.saveEnergyHistory(deviceId, deviceData.energyKWh);
                lastDatabaseSave.set(deviceId, now);
            }
            mqttEvents.emit("data", deviceData);
        }
        catch (err) {
            console.log("Invalid MQTT JSON", err.message);
        }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const deviceData of latestDevices.values()) {
        if (deviceData.connected &&
            (now - deviceData.lastSeen > config.offlineTimeout)) {
            deviceData.connected = false;
            deviceData.voltage = 0;
            deviceData.totalCurrent = 0;
            deviceData.totalRealPower = 0;
            deviceData.totalApparentPower = 0;
            deviceData.channels.forEach(channel => {
                channel.current = 0;
                channel.pf = 0;
                channel.realPower = 0;
                channel.apparentPower = 0;
            });
            database.updateDevice(deviceData.deviceId, 0);
            mqttEvents.emit("data", deviceData);
        }
    }
}, 10000);

module.exports = {
    latestDevices,
    mqttEvents
};