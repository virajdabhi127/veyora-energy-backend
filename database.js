require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const db = process.env.DATABASE_URL
    ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: {
              rejectUnauthorized: false,
          },
      })
    : new Pool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
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

async function initializeDatabase() {
    await db.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        userid TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
    )
    `);

    await db.query(`
    CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        user_id INTEGER,
        product_code TEXT NOT NULL,
        payload_version INTEGER DEFAULT 1,
        channel_count INTEGER DEFAULT 1,
        status INTEGER DEFAULT 0,
        last_update TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
    )
    `);

    await db.query(`
    CREATE TABLE IF NOT EXISTS energy_history (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        energy_kwh REAL NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_id) REFERENCES devices(device_id)
    )
    `);

    await db.query(`
    CREATE TABLE IF NOT EXISTS energy_daily_history (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        history_date DATE NOT NULL,
        energy_kwh REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_id, history_date),
        FOREIGN KEY(device_id) REFERENCES devices(device_id)
    )
    `);

   await db.query(`
    CREATE TABLE IF NOT EXISTS energy_monthly_history (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        history_month DATE NOT NULL,
        energy_kwh REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_id, history_month),
        FOREIGN KEY(device_id) REFERENCES devices(device_id)
    )
    `);
    await new Promise((resolve, reject) => {
        ensureAdmin(err => err ? reject(err) : resolve());
    });
};

async function init(callback) {
    try {
        await initializeDatabase();
        console.log("Database initialized successfully.");
        if (callback) callback();
    } catch (err) {
        console.error("Database initialization failed:", err);
        process.exit(1);
    }
}

function ensureAdmin(callback) {
    db.query(
        "SELECT user_id FROM users WHERE role = 'admin'",
        (err, result) => {
            if (err) {
                return callback(err);
            }
            if (result.rows.length > 0) {
                return callback(null);
            }
            console.log("No admin found. Creating default admin...");
            createUser(
                process.env.DEFAULT_ADMIN_USER,
                process.env.DEFAULT_ADMIN_NAME,
                process.env.DEFAULT_ADMIN_PASSWORD,
                "admin",
                (err) => {
                    if (err) {
                        return callback(err);
                    }
                    console.log("Default admin created successfully.");
                    callback(null);
                }
            );
        }
    );
}

function createUser(userid, username, password, role, callback) {
    db.query(
        "SELECT user_id FROM users WHERE userid = $1",
        [userid],
        (err, result) => {
            if (err) {
                return callback(err);
            }

            if (result.rows.length > 0) {
                return callback(new Error("User ID already exists."));
            }

            bcrypt.hash(password, 10, (err, hash) => {
                if (err) {
                    return callback(err);
                }

                db.query(
                    `INSERT INTO users (userid, username, password, role)
                     VALUES ($1, $2, $3, $4)
                     RETURNING user_id`,
                    [userid, username, hash, role],
                    (err, result) => {
                        if (callback) {
                            callback(err, result?.rows[0]?.user_id);
                        }
                    }
                );
            });
        }
    );
}

function assignDevice(deviceId, userId, productCode, channelCount, callback) {
    db.query(
        "SELECT device_id FROM devices WHERE device_id = $1",
        [deviceId],
        (err, result) => {
            if (err) {
                return callback(err);
            }
            if (result.rows.length > 0) {
                return callback(new Error("Device ID already exists."));
            }
            db.query(
                `INSERT INTO devices
                (
                    device_id,
                    user_id,
                    product_code,
                    payload_version,
                    channel_count
                )
                VALUES ($1, $2, $3, $4, $5)`,
                [deviceId, userId, productCode, 1, channelCount],
                (err) => {
                    if (err) {
                        return callback(err);
                    }
                    db.query(
                        `INSERT INTO energy_history (device_id, energy_kwh)
                         VALUES ($1, 0)`,
                        [deviceId],
                        callback
                    );
                }
            );
        }
    );
}

function getUserByUsername(username, callback) {
    db.query(
        `SELECT user_id
         FROM users
         WHERE username = $1`,
        [username],
        (err, result) => {
            callback(err, result?.rows[0]);
        }
    );
}

function getUserByUserId(userid, callback) {
    db.query(
        `SELECT user_id
         FROM users
         WHERE userid = $1`,
        [userid],
        (err, result) => {
            callback(err, result?.rows[0]);
        }
    );
}

function getAllEnergyHistory(callback) {
    db.query(
        `SELECT
            device_id AS "deviceId",
            energy_kwh AS "energyKWh"
         FROM energy_history`,
        (err, result) => {
            callback(err, result?.rows);
        }
    );
}

function insertDailyHistory(deviceId, historyDate, energyKWh, callback) {
    db.query(
        `INSERT INTO energy_daily_history
        (
            device_id,
            history_date,
            energy_kwh
        )
        VALUES ($1, $2, $3)
        ON CONFLICT(device_id, history_date)
        DO UPDATE SET
            energy_kwh = EXCLUDED.energy_kwh,
            created_at = CURRENT_TIMESTAMP`,
        [deviceId, historyDate, energyKWh],
        callback
    );
}

function insertMonthlyHistory(deviceId, historyMonth, energyKWh, callback) {
    db.query(
        `INSERT INTO energy_monthly_history
        (
            device_id,
            history_month,
            energy_kwh
        )
        VALUES ($1, $2, $3)
        ON CONFLICT(device_id, history_month)
        DO UPDATE SET
            energy_kwh = EXCLUDED.energy_kwh,
            created_at = CURRENT_TIMESTAMP`,
        [deviceId, historyMonth, energyKWh],
        callback
    );
}

function saveMonthlyHistory(deviceId, energyKWh) {
    const historyMonth = getISTMonth();
    insertMonthlyHistory(
        deviceId,
        historyMonth,
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
        historyDate,
        energyKWh,
        (err) => {
            if (err) {
                console.error("Daily history update error:", err.message);
            }
        }
    );
}

function getUser(userid, callback) {
    db.query(
        `SELECT user_id, userid, username, password, role
         FROM users
         WHERE userid = $1`,
        [userid],
        (err, result) => {
            callback(err, result?.rows[0]);
        }
    );
}

function updateDevice(deviceId, status, callback = null) {
    db.query(
        `UPDATE devices
         SET status = $1,
             last_update = CURRENT_TIMESTAMP
         WHERE device_id = $2`,
        [status, deviceId],
        callback
    );
}

function saveEnergyHistory(deviceId, energyKWh) {
    db.query(
        `UPDATE energy_history
         SET energy_kwh = $1,
             recorded_at = CURRENT_TIMESTAMP
         WHERE device_id = $2`,
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
    db.query(
        `SELECT * FROM devices
         WHERE device_id = $1`,
        [deviceId],
        (err, result) => {
            callback(err, result?.rows[0]);
        }
    );
}

function getDevicesByUser(userId, callback) {
    db.query(
        `SELECT
            device_id AS "deviceId",
            product_code AS "productCode",
            channel_count AS "channelCount",
            payload_version AS "payloadVersion",
            status,
            last_update AS "lastUpdate"
         FROM devices
         WHERE user_id = $1`,
        [userId],
        (err, result) => {
            callback(err, result?.rows);
        }
    );
}

function updateDeviceInfo(deviceId, payloadVersion, channelCount, callback = null) {
    db.query(
        `UPDATE devices
         SET payload_version = $1,
             channel_count = $2
         WHERE device_id = $3`,
        [payloadVersion, channelCount, deviceId],
        (err, result) => {
            if (err) {
                console.error("Device Info Update Error:", err.message);
                if (callback) callback(err);
                return;
            }
            if (result.rowCount === 0) {
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
    db.query(
        `SELECT
            device_id AS "deviceId",
            userid,
            product_code AS "productCode",
            channel_count AS "channelCount"
         FROM devices
         JOIN users
           ON devices.user_id = users.user_id
         ORDER BY device_id`,
        (err, result) => {
            callback(err, result?.rows);
        }
    );
}

function getAllUsers(callback) {
    db.query(
        `SELECT
            userid,
            username,
            role
         FROM users
         ORDER BY user_id`,
        (err, result) => {
            callback(err, result?.rows);
        }
    );
}

function deleteUser(userid, callback) {
    db.query(
        `DELETE FROM users
         WHERE userid = $1`,
        [userid],
        callback
    );
}

function updateUser(userid, username, password, role, callback) {
    if (!password) {
        db.query(
            `UPDATE users
             SET username = $1,
                 role = $2
             WHERE userid = $3`,
            [username, role, userid],
            callback
        );
    } else {
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
                return callback(err);
            }

            db.query(
                `UPDATE users
                 SET username = $1,
                     password = $2,
                     role = $3
                 WHERE userid = $4`,
                [username, hash, role, userid],
                callback
            );
        });
    }
}

function updatedevice(deviceId, userId, productCode, channelCount, callback) {
    db.query(
        `UPDATE devices
         SET user_id = $1,
             product_code = $2,
             channel_count = $3
         WHERE device_id = $4`,
        [userId, productCode, channelCount, deviceId],
        callback
    );
}

function deleteDevice(deviceId, callback) {
    db.query("BEGIN", (err) => {
        if (err) return callback(err);

        db.query(
            "DELETE FROM energy_history WHERE device_id = $1",
            [deviceId],
            (err) => {
                if (err) {
                    return db.query("ROLLBACK", () => callback(err));
                }

                db.query(
                    "DELETE FROM energy_daily_history WHERE device_id = $1",
                    [deviceId],
                    (err) => {
                        if (err) {
                            return db.query("ROLLBACK", () => callback(err));
                        }

                        db.query(
                            "DELETE FROM energy_monthly_history WHERE device_id = $1",
                            [deviceId],
                            (err) => {
                                if (err) {
                                    return db.query("ROLLBACK", () => callback(err));
                                }

                                db.query(
                                    "DELETE FROM devices WHERE device_id = $1",
                                    [deviceId],
                                    (err) => {
                                        if (err) {
                                            return db.query("ROLLBACK", () => callback(err));
                                        }

                                        db.query("COMMIT", callback);
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
}

function getAdminStats(callback) {
    db.query(
        `SELECT
            (SELECT COUNT(*) FROM users) AS "totalUsers",
            (SELECT COUNT(*) FROM devices) AS "totalDevices"`,
        (err, result) => {
            callback(err, result?.rows[0]);
        }
    );
}
module.exports = {
    getUser,
    init,
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
    getAllDevices,
    ensureAdmin
};