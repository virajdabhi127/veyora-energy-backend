const lastDatabaseSave = new Map();
const mqtt = require("mqtt");
const config = require("./config");
const database = require("./database");
const EventEmitter = require("events");
const mqttEvents = new EventEmitter();
const latestDevices = new Map();
const lastLoadHistorySave = new Map();
const dailyLoadFinalized = new Map();

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
            finalizePreviousDayLoad(deviceId);
            // ---------------------------------------
            const lastSave = lastDatabaseSave.get(deviceId) || 0;
            if (now - lastSave >= config.saveInterval) {
                database.saveEnergyHistory(deviceId, deviceData.energyKWh);
                lastDatabaseSave.set(deviceId, now);
            }
            const lastLoadSave = lastLoadHistorySave.get(deviceId) || 0;
            if (now - lastLoadSave >= 10000) {
                database.saveLoadHistory(
                    deviceId,
                    deviceData.totalRealPower
                );
                lastLoadHistorySave.set(deviceId, now);
                database.calculateDailyLoad(
                    deviceId,
                    getISTDateString(),
                    (err) => {
                        if (err) {
                            console.error(
                                `Live daily load calculation failed for ${deviceId}:`,
                                err.message
                            );
                        }
                    }
                );
            }
            checkDailyLoadRollover(deviceId);
            mqttEvents.emit("data", deviceData);
        }
        catch (err) {
            console.log("Invalid MQTT JSON", err.message);
        }
    });
});

function getISTDateString(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function checkDailyLoadRollover(deviceId) {
    const now = new Date();
    const istTime = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(now);
    if (istTime !== "23:59:59") {
        return;
    }
    const historyDate = getISTDateString();
    database.calculateDailyLoad(
        deviceId,
        historyDate,
        (err) => {
            if (err) {
                console.error(
                    `Daily load calculation failed for ${deviceId}:`,
                    err.message
                );
                return;
            }
            console.log(
                `Daily load calculated for ${deviceId} on ${historyDate}`
            );
            database.verifyDailyLoad(
                deviceId,
                historyDate,
                (err, result) => {
                    if (err) {
                        console.error(
                            `Daily load verification failed for ${deviceId}:`,
                            err.message
                        );
                        return;
                    }
                    if (result.rows.length === 0) {
                        console.error(
                            `Daily load summary missing for ${deviceId} on ${historyDate}. Load history will NOT be deleted.`
                        );
                        return;
                    }
                    console.log(
                        `Daily load summary verified for ${deviceId} on ${historyDate}.`
                    );
                    database.verifyFinalLoadReading(
                        deviceId,
                        historyDate,
                        (err, result) => {
                            if (err) {
                                console.error(
                                    `Final load reading verification failed for ${deviceId}:`,
                                    err.message
                                );
                                return;
                            }
                            if (result.rows.length === 0) {
                                console.error(
                                    `Final load reading missing for ${deviceId} on ${historyDate}. Load history will NOT be deleted.`
                                );
                                return;
                            }
                            console.log(
                                `Final load reading verified for ${deviceId} on ${historyDate}.`
                            );
                            database.deleteDailyLoadHistory(
                                deviceId,
                                historyDate,
                                (err, result) => {
                                    if (err) {
                                        console.error(
                                            `Load history deletion failed for ${deviceId}:`,
                                            err.message
                                        );
                                        return;
                                    }

                                    console.log(
                                        `Deleted ${result.rowCount} load history records for ${deviceId} on ${historyDate}.`
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

function finalizePreviousDayLoad(deviceId) {
    const todayDate = getISTDateString();
    if (dailyLoadFinalized.get(deviceId) === todayDate) {
        return;
    }
    const today = new Date();
    const yesterday = new Date(
        today.getTime() - (24 * 60 * 60 * 1000)
    );
    const yesterdayDate = getISTDateString(yesterday);
    database.calculateDailyLoad(
        deviceId,
        yesterdayDate,
        (err) => {
            if (err) {
                console.error(
                    `Failed to finalize daily load for ${deviceId}:`,
                    err.message
                );
                return;
            }
            console.log(
                `Daily load finalized for ${deviceId}: ${yesterdayDate}`
            );
            dailyLoadFinalized.set(deviceId, todayDate);
        }
    );
}

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