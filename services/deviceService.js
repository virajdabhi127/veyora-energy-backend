const database = require("../database");

function getUserDevices(userId, callback) {
    database.getDevicesByUser(userId, callback);
}

module.exports = {
    getUserDevices
};