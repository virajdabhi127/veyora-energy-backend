module.exports = {
    mqtt: {
        host: "38283212ae99409b8e30f1f17de9a408.s1.eu.hivemq.cloud",
        port: 8883,
        username: "veyora.energymeter",
        password: "Veyora.Energymeter",
        topic: "energymeter/status"   // Change to your actual topic
    },
    server: {
        port: process.env.PORT || 3000
    },
    saveInterval: 30000
};