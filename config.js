module.exports = {
    mqtt: {
        host: process.env.MQTT_HOST,
        port: Number(process.env.MQTT_PORT) || 8883,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topic: process.env.MQTT_TOPIC || "energymeter/+/status"
    },
    server: {
        port: process.env.PORT || 3000
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: "7d"
    },
    productCodes: {
        energymeter: "EM",
        homeautomation: "HA",
        combined: "EM_HA"
    },
    isProduction: process.env.NODE_ENV === "production",
    offlineTimeout: 15000,
    saveInterval: 60000
};