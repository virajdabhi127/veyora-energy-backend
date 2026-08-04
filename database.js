const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const dbPath = process.env.DB_PATH || "./veyora.db";
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database Error:", err.message);
    } 
});

function getISTDate() {
    return new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
    });
}

function getISTMonth() {
    const now = new Date();
    const year = now.toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric"
    });
    const month = now.toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        month: "2-digit"
    });
    return `${year}-${month}-01`;
}

db.run("PRAGMA foreign_keys = ON;");

function createUser(userid, username, password, role, callback) {
    db.get(
        "SELECT user_id FROM users WHERE userid = ?",
        [userid],
        (err, existingUser) => {
            if (err) {
                return callback(err);
            }
            if (existingUser) {
                return callback(new Error("User ID already exists."));
            }
            bcrypt.hash(password, 10, (err, hash) => {
                if (err) {
                    return callback(err);
                }
                db.run(
                    `INSERT INTO users (userid, username, password, role)
                    VALUES (?, ?, ?, ?)`,
                    [userid, username, hash, role],
                    function (err) {
                        if (callback) {
                            callback(err, this.lastID);
                        }
                    }
                );
            });
        }
    );
}

function assignDevice(deviceId, userId, productCode, channelCount, callback) {
    db.get(
        "SELECT device_id FROM devices WHERE device_id = ?",
        [deviceId],
        (err, existingDevice) => {
            if (err) {
                return callback(err);
            }

            if (existingDevice) {
                return callback(new Error("Device ID already exists."));
            }
            db.run(
                `INSERT INTO devices
                (
                    device_id,
                    user_id,
                    product_code,
                    payload_version,
                    channel_count
                )
                VALUES (?, ?, ?, ?, ?)`,
                [deviceId, userId, productCode, 1, channelCount],
                function (err) {
                    if (err) {
                        return callback(err);
                    }
                    db.run(
                        `INSERT INTO energy_history (device_id, energy_kwh)
                         VALUES (?, 0)`,
                        [deviceId],
                        callback
                    );
                }
            );
        }
    );
}

function getUserByUsername(username, callback) {
    db.get(
        `SELECT user_id
         FROM users
         WHERE username = ?`,
        [username],
        callback
    );
}

function getUserByUserId(userid, callback) {
    db.get(
        `SELECT user_id
         FROM users
         WHERE userid = ?`,
        [userid],
        callback
    );
}

db.run(`
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    user_id INTEGER,
    product_code TEXT NOT NULL,
    payload_version INTEGER DEFAULT 1,
    channel_count INTEGER DEFAULT 1,
    status INTEGER DEFAULT 0,
    last_update DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS energy_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    energy_kwh REAL NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(device_id)
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS energy_daily_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    history_date DATE NOT NULL,
    energy_kwh REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, history_date),
    FOREIGN KEY(device_id) REFERENCES devices(device_id)
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS energy_monthly_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    history_month DATE NOT NULL,
    energy_kwh REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, history_month),
    FOREIGN KEY(device_id) REFERENCES devices(device_id)
)
`);

function getAllEnergyHistory(callback) {
    db.all(
        `SELECT
            device_id AS deviceId,
            energy_kwh AS energyKWh
         FROM energy_history`,
        callback
    );
}

function insertDailyHistory(deviceId, historyDate, energyKWh, callback) {
    db.run(
        `INSERT INTO energy_daily_history
        (
            device_id,
            history_date,
            energy_kwh
        )
        VALUES (?, ?, ?)
        ON CONFLICT(device_id, history_date)
        DO UPDATE SET
            energy_kwh = excluded.energy_kwh,
            created_at = CURRENT_TIMESTAMP`,
        [deviceId, historyDate, energyKWh],
        callback
    );
}

function insertMonthlyHistory(deviceId, historyMonth, energyKWh, callback) {
    db.run(
        `INSERT INTO energy_monthly_history
        (
            device_id,
            history_month,
            energy_kwh
        )
        VALUES (?, ?, ?)
        ON CONFLICT(device_id, history_month)
        DO UPDATE SET
            energy_kwh = excluded.energy_kwh,
            created_at = CURRENT_TIMESTAMP`,
        [deviceId, historyMonth, energyKWh],
        callback
    );
}

function saveMonthlyHistory(deviceId, energyKWh) {
   const historyMonth = getISTMonth();
     insertMonthlyHistory(
        deviceId,
        getISTMonth(),
        energyKWh,
        (err) => {
            if (err) {
                console.error("Monthly history update error:", err.message);
            }
        }
    );
}

function saveDailyHistory(deviceId, energyKWh) {
    const historyDate = getISTDate();
    insertDailyHistory(
        deviceId,
        getISTDate(),
        energyKWh,
        (err) => {
            if (err) {
                console.error("Daily history update error:", err.message);
            }
        }
    );
}

function getUser(userid, callback) {
    db.get(
        `SELECT user_id, userid, username, password, role
         FROM users
         WHERE userid = ?`,
        [userid],
        callback
    );
}

function updateDevice(deviceId, status, callback = null) {
    db.run(
        `UPDATE devices
         SET status = ?,
             last_update = CURRENT_TIMESTAMP
         WHERE device_id = ?`,
        [status, deviceId],
        callback
    );
}

function saveEnergyHistory(deviceId, energyKWh) {
    db.run(
        `UPDATE energy_history
         SET energy_kwh = ?,
             recorded_at = CURRENT_TIMESTAMP
         WHERE device_id = ?`,
        [energyKWh, deviceId],
        (err) => {
            if (err) {
                console.error("Energy update error:", err.message);
                return;
            }
            saveMonthlyHistory(deviceId, energyKWh);
            saveDailyHistory(deviceId, energyKWh);
        }
    );
}

function getDevice(deviceId, callback) {
    db.get(
        `SELECT * FROM devices WHERE device_id = ?`,
        [deviceId],
        callback
    );
}

function getDevicesByUser(userId, callback) {
    db.all(
        `SELECT
            device_id AS deviceId,
            product_code AS productCode,
            channel_count AS channelCount,
            payload_version AS payloadVersion,
            status,
            last_update AS lastUpdate
         FROM devices
         WHERE user_id = ?`,
        [userId],
        callback
    );
}

function updateDeviceInfo(deviceId, payloadVersion, channelCount, callback = null) {
    db.run(
        `UPDATE devices
         SET payload_version = ?,
             channel_count = ?
         WHERE device_id = ?`,
        [payloadVersion, channelCount, deviceId],
        function (err) {
            if (err) {
                console.error("Device Info Update Error:", err.message);
                if (callback) callback(err);
                return;
            }
            if (this.changes === 0) {
                console.warn(`No device found with ID: ${deviceId}`);
            } else {
                console.log(
                    `Device ${deviceId} updated (Payload V${payloadVersion}, Channels ${channelCount})`
                );
            }
            if (callback) callback(null);
        }
    );
}

function getAllDevices(callback) {
     db.all(
        `SELECT
            device_id AS deviceId,
            userid,
            product_code AS productCode,
            channel_count AS channelCount
         FROM devices
         JOIN users
           ON devices.user_id = users.user_id
         ORDER BY device_id`,
        callback
    );
}

function getAllUsers(callback) {
    db.all(
        `SELECT
            userid,
            username,
            role
         FROM users
         ORDER BY user_id`,
        callback
    );
}

function deleteUser(userid, callback) {
    db.run(
        `DELETE FROM users
         WHERE userid = ?`,
        [userid],
        callback
    );
}

function updateUser(userid, username, password, role, callback) {
    if (!password) {
        db.run(
            `UPDATE users
             SET username = ?,
                 role = ?
             WHERE userid = ?`,
            [username, role, userid],
            callback
        );
    } else {
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
                return callback(err);
            }
            db.run(
                `UPDATE users
                 SET username = ?,
                     password = ?,
                     role = ?
                 WHERE userid = ?`,
                [username, hash, role, userid],
                callback
            );
        });
    }
}

function updatedevice(deviceId, userId, productCode, channelCount, callback) {
    db.run(
        `UPDATE devices
         SET user_id = ?,
             product_code = ?,
             channel_count = ?
         WHERE device_id = ?`,
        [userId, productCode, channelCount, deviceId],
        callback
    );
}

function deleteDevice(deviceId, callback) {
    db.serialize(() => {
        db.run(
            "DELETE FROM energy_history WHERE device_id = ?",
            [deviceId]
        );
        db.run(
            "DELETE FROM energy_daily_history WHERE device_id = ?",
            [deviceId]
        );
        db.run(
            "DELETE FROM energy_monthly_history WHERE device_id = ?",
            [deviceId]
        );
        db.run(
            "DELETE FROM devices WHERE device_id = ?",
            [deviceId],
            callback
        );
    });
}

function getAdminStats(callback) {
    db.get(
        `
        SELECT
            (SELECT COUNT(*) FROM users) AS totalUsers,
            (SELECT COUNT(*) FROM devices) AS totalDevices
        `,
        callback
    );
}

module.exports = {
    db,
    getUser,
    getAllUsers,
    deleteUser,
    updateUser,
    updateDevice,
    updatedevice,
    deleteDevice,
    getAdminStats,
    getDevicesByUser,
    updateDeviceInfo,
    saveEnergyHistory,
    getAllEnergyHistory,
    insertDailyHistory,
    insertMonthlyHistory,
    saveDailyHistory,
    saveMonthlyHistory,
    getDevice,
    createUser,
    assignDevice,
    getUserByUserId,
    getUserByUsername,
    getAllDevices
};