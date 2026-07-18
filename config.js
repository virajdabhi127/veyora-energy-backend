module.exports = {
    mqtt: {
        host: process.env.MQTT_HOST,
        port: Number(process.env.MQTT_PORT) || 8883,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topic: process.env.MQTT_TOPIC
    },
    server: {
        port: process.env.PORT || 3000
    },
    saveInterval: 30000
};