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
            username TEXT NOT NULL,
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
            channel_energy JSONB DEFAULT '{}'::jsonb,
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
            start_energy_kwh REAL NOT NULL DEFAULT 0,
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

    await db.query(`
        CREATE TABLE IF NOT EXISTS device_channels (
            id SERIAL PRIMARY KEY,
            device_id TEXT NOT NULL,
            product_code TEXT NOT NULL,
            channel_id INTEGER NOT NULL,
            channel_name TEXT NOT NULL,
            UNIQUE(device_id, channel_id),
            FOREIGN KEY(device_id)
                REFERENCES devices(device_id)
                ON DELETE CASCADE
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS load_history (
            id SERIAL PRIMARY KEY,
            device_id TEXT NOT NULL,
            real_power REAL NOT NULL,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(device_id)
        );
    `)

    await db.query(`
         CREATE TABLE IF NOT EXISTS load_daily_history (
            id SERIAL PRIMARY KEY,
            device_id TEXT NOT NULL,
            history_date DATE NOT NULL,
            peak_load REAL NOT NULL,
            peak_load_time TIMESTAMP,
            base_load REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (device_id, history_date),
            FOREIGN KEY (device_id) REFERENCES devices(device_id)
        );
    `)

    await db.query(`
        CREATE TABLE IF NOT EXISTS load_history_batches (
            id SERIAL PRIMARY KEY,
            device_id TEXT NOT NULL,
            batch_id TEXT NOT NULL,
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(device_id, batch_id),
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
                    const channelValues = [];
                    for (let i = 1; i <= channelCount; i++) {
                        channelValues.push([
                            deviceId,
                            i,
                            productCode,
                            `Channel ${i}`
                        ]);
                    }
                    const channelQuery = `
                        INSERT INTO device_channels
                        (
                            device_id,
                            channel_id,
                            product_code,
                            channel_name
                        )
                        VALUES ($1, $2, $3, $4)
                    `;
                    let completed = 0;
                    if (channelValues.length === 0) {
                        createEnergyHistory();
                        return;
                    }
                    channelValues.forEach(values => {
                        db.query(
                            channelQuery,
                            values,
                            (err) => {
                                if (err) {
                                    return callback(err);
                                }
                                completed++;
                                if (completed === channelValues.length) {
                                    createEnergyHistory();
                                }
                            }
                        );
                    });
                    function createEnergyHistory() {
                        db.query(
                            `INSERT INTO energy_history
                             (device_id, energy_kwh)
                             VALUES ($1, 0)`,
                            [deviceId],
                            callback
                        );
                    }
                }
            );
        }
    );
}

function renameDeviceChannel(deviceId, channelId, channelName, callback) {
    const query = `
        UPDATE device_channels
        SET channel_name = $1
        WHERE device_id = $2
          AND channel_id = $3
    `;
    db.query(
        query,
        [channelName, deviceId, channelId],
        (err, result) => {
            if (err) {
                console.error("Error renaming channel:", err);
                return callback(err);
            }
            if (result.rowCount === 0) {
                return callback(new Error("Channel not found."));
            }
            callback(null);
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
            energy_kwh AS "energyKWh",
            channel_energy AS "channelEnergy"
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

function saveMonthlyHistory(deviceId, callback) {
    const query = `
        SELECT COALESCE(SUM(energy_kwh), 0) AS monthly_energy
        FROM energy_daily_history
        WHERE device_id = $1
          AND history_date >= DATE_TRUNC(
              'month',
              CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
          )::DATE
          AND history_date <= (
              CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
          )::DATE
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            console.error("Monthly energy calculation error:", err.message);
            return callback(err);
        }
        const monthlyEnergy = Number(result.rows[0].monthly_energy);
        const historyMonth = getISTMonth();
        insertMonthlyHistory(
            deviceId,
            historyMonth,
            monthlyEnergy,
            callback
        );
    });
}

function saveDailyHistory(deviceId, energyKWh, callback) {
    const historyDate = getISTDate();
    const insertQuery = `
        INSERT INTO energy_daily_history
        (
            device_id,
            history_date,
            energy_kwh,
            start_energy_kwh
        )
        VALUES ($1, $2, 0, $3)
        ON CONFLICT (device_id, history_date)
        DO NOTHING
    `;
    db.query(
        insertQuery,
        [deviceId, historyDate, energyKWh],
        (err) => {
            if (err) {
                console.error(
                    "Daily history initialization error:",
                    err.message
                );

                if (callback) callback(err);
                return;
            }
            const updateQuery = `
                UPDATE energy_daily_history
                SET
                    energy_kwh = GREATEST(
                        $3 - start_energy_kwh,
                        0
                    ),
                    created_at = CURRENT_TIMESTAMP
                WHERE device_id = $1
                  AND history_date = $2
            `;
            db.query(
                updateQuery,
                [deviceId, historyDate, energyKWh],
                (err) => {
                    if (err) {
                        console.error(
                            "Daily history update error:",
                            err.message
                        );
                    }
                    if (callback) {
                        callback(err);
                    }
                }
            );
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

function saveEnergyHistory(deviceId, energyKWh, channels) {
    const channelEnergy = {};
    if (Array.isArray(channels)) {
        channels.forEach(channel => {
            const channelId = Number(channel.channelId);
            if (channelId > 0) {
                channelEnergy[channelId] = Number(channel.energyKWh) || 0;
            }
        });
    }
    db.query(
        `UPDATE energy_history
         SET energy_kwh = $1,
             channel_energy = $2::jsonb,
             recorded_at = CURRENT_TIMESTAMP
         WHERE device_id = $3`,
        [
            Number(energyKWh) || 0,
            JSON.stringify(channelEnergy),
            deviceId
        ],
        (err) => {
            if (err) {
                console.error(
                    "Energy update error:",
                    err.message
                );
                return;
            }
            saveDailyHistory(
                deviceId,
                energyKWh,
                (dailyErr) => {
                    if (dailyErr) {
                        console.error(
                            "Daily history update error:",
                            dailyErr.message
                        );
                        return;
                    }
                    saveMonthlyHistory(deviceId, (monthlyErr) => {
                            if (monthlyErr) {
                                console.error(
                                    "Monthly history update error:",
                                    monthlyErr.message
                                );
                            }
                        }
                    );
                }
            );
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
            "DELETE FROM device_channels WHERE device_id = $1",
            [deviceId],
            (err) => {
                if (err) {
                    return db.query(
                        "ROLLBACK",
                        () => callback(err)
                    );
                }
                db.query(
                    "DELETE FROM energy_history WHERE device_id = $1",
                    [deviceId],
                    (err) => {
                        if (err) {
                            return db.query(
                                "ROLLBACK",
                                () => callback(err)
                            );
                        }
                        db.query(
                            "DELETE FROM energy_daily_history WHERE device_id = $1",
                            [deviceId],
                            (err) => {
                                if (err) {
                                    return db.query(
                                        "ROLLBACK",
                                        () => callback(err)
                                    );
                                }
                                db.query(
                                    "DELETE FROM energy_monthly_history WHERE device_id = $1",
                                    [deviceId],
                                    (err) => {
                                        if (err) {
                                            return db.query(
                                                "ROLLBACK",
                                                () => callback(err)
                                            );
                                        }
                                        db.query(
                                            "DELETE FROM load_history WHERE device_id = $1",
                                            [deviceId],
                                            (err) => {
                                                if (err) {
                                                    return db.query(
                                                        "ROLLBACK",
                                                        () => callback(err)
                                                    );
                                                }
                                                db.query(
                                                    "DELETE FROM load_daily_history WHERE device_id = $1",
                                                    [deviceId],
                                                    (err) => {
                                                        if (err) {
                                                            return db.query(
                                                                "ROLLBACK",
                                                                () => callback(err)
                                                            );
                                                        }
                                                        db.query(
                                                            "DELETE FROM devices WHERE device_id = $1",
                                                            [deviceId],
                                                            (err) => {
                                                                if (err) {
                                                                    return db.query(
                                                                        "ROLLBACK",
                                                                        () => callback(err)
                                                                    );
                                                                }
                                                                db.query(
                                                                    "COMMIT",
                                                                    callback
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

function getDailyEnergy(deviceId, callback) {
    const query = `
        SELECT
            COALESCE(
                MAX(CASE
                    WHEN history_date =
                        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
                    THEN energy_kwh
                END),
                0
            ) AS today,
            COALESCE(
                MAX(CASE
                    WHEN history_date =
                        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - 1
                    THEN energy_kwh
                END),
                0
            ) AS yesterday
        FROM energy_daily_history
        WHERE device_id = $1
          AND history_date >=
              (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - 1
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            console.error("Error fetching daily energy:", err);
            return callback(err, null);
        }
        const row = result.rows[0];
        callback(null, {
            today: Number(row.today),
            yesterday: Number(row.yesterday)
        });
    });
}

function getMonthlyEnergy(deviceId, callback) {
    const query = `
        SELECT
            COALESCE(
                MAX(
                    CASE
                        WHEN history_month =
                            DATE_TRUNC(
                                'month',
                                CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
                            )::DATE
                        THEN energy_kwh
                    END
                ),
                0
            ) AS current_month,
            COALESCE(
                MAX(
                    CASE
                        WHEN history_month =
                            (
                                DATE_TRUNC(
                                    'month',
                                    CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
                                ) - INTERVAL '1 month'
                            )::DATE
                        THEN energy_kwh
                    END
                ),
                0
            ) AS previous_month
        FROM energy_monthly_history
        WHERE device_id = $1
          AND history_month >= (
              DATE_TRUNC(
                  'month',
                  CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
              ) - INTERVAL '1 month'
          )::DATE
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            console.error("Error fetching monthly energy:", err);
            return callback(err, null);
        }
        const row = result.rows[0];
        const currentMonth = Number(row.current_month);
        const previousMonth = Number(row.previous_month);
        const dailyQuery = `
            SELECT
                COALESCE(
                    energy_kwh,
                    0
                ) AS today_energy
            FROM energy_daily_history
            WHERE device_id = $1
              AND history_date =
                  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
            LIMIT 1
        `;
        db.query(dailyQuery, [deviceId], (err, dailyResult) => {
            if (err) {
                console.error(
                    "Error fetching today's energy:",
                    err
                );
                return callback(err, null);
            }
            const todayEnergy =
                dailyResult.rows.length > 0
                    ? Number(dailyResult.rows[0].today_energy)
                    : 0;
            const monthlyCost = calculatePGVCLCost(currentMonth);
            const todayCost =
                calculatePGVCLTodayCost(
                    currentMonth,
                    todayEnergy
                );
            callback(null, {
                currentMonth,
                previousMonth,
                todayEnergy,
                monthlyCost,
                todayCost
            });
        });
    });
}

function getDeviceChannels(deviceId, callback) {
    const query = `
        SELECT
            product_code,
            channel_id,
            channel_name
        FROM device_channels
        WHERE device_id = $1
        ORDER BY channel_id ASC
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            console.error("Error fetching device channels:", err);
            return callback(err, null);
        }
        callback(null, result.rows);
    });
}

function calculatePGVCLCost(units) {
    units = Number(units);
    if (!Number.isFinite(units) || units <= 0) {
        return 0;
    }
    let cost = 0;
    if (units <= 50) {
        cost = units * 3.05;
    } else if (units <= 100) {
        cost = (50 * 3.05) + ((units - 50) * 3.50);
    } else if (units <= 250) {
        cost = (50 * 3.05) + (50 * 3.50) + ((units - 100) * 4.15);
    } else {
        cost = (50 * 3.05) + (50 * 3.50) + (150 * 4.15) + ((units - 250) * 5.20);
    }
    return Number(cost.toFixed(2));
}

function calculatePGVCLTodayCost(monthlyEnergy, todayEnergy) {
    monthlyEnergy = Number(monthlyEnergy);
    todayEnergy = Number(todayEnergy);
    if (!Number.isFinite(monthlyEnergy) || !Number.isFinite(todayEnergy) || monthlyEnergy <= 0 || todayEnergy <= 0) {
        return 0;
    }
    const previousMonthEnergy = Math.max(
        0,
        monthlyEnergy - todayEnergy
    );
    const currentCost = calculatePGVCLCost(monthlyEnergy);
    const previousCost = calculatePGVCLCost(previousMonthEnergy);
    return Number((currentCost - previousCost).toFixed(2));
}

function saveLoadHistory(deviceId, realPower, recordedAt, callback) {
    const query = `
        INSERT INTO load_history
        (device_id, real_power, recorded_at)
        VALUES ($1, $2, $3)
    `;
    db.query(
        query,
        [deviceId, realPower, recordedAt],
        (err, result) => {
            if (callback) {
                callback(err, result);
            }
        }
    );
}

function saveLoadHistoryBatch(deviceId, batchId, samples, callback) {
    db.query("BEGIN", (err) => {
        if (err) {
            return callback(err);
        }
        db.query(
            `
            INSERT INTO load_history_batches
            (device_id, batch_id)
            VALUES ($1, $2)
            ON CONFLICT (device_id, batch_id)
            DO NOTHING
            RETURNING id
            `,
            [deviceId, batchId],
            (err, result) => {
                if (err) {
                    return db.query(
                        "ROLLBACK",
                        () => callback(err)
                    );
                }
                if (result.rows.length === 0) {
                    return db.query(
                        "COMMIT",
                        (err) => {
                            if (err) {
                                return db.query(
                                    "ROLLBACK",
                                    () => callback(err)
                                );
                            }
                            callback(null, true);
                        }
                    );
                }
                let index = 0;
                function insertNext() {
                    if (index >= samples.length) {
                        return db.query(
                            "COMMIT",
                            (err) => {
                                if (err) {
                                    return db.query(
                                        "ROLLBACK",
                                        () => callback(err)
                                    );
                                }
                                callback(null, false);
                            }
                        );
                    }
                    const sample = samples[index];
                    const recordedAt = new Date(sample.timestamp * 1000);
                    db.query(
                        `
                        INSERT INTO load_history
                        (
                            device_id,
                            real_power,
                            recorded_at
                        )
                        VALUES ($1, $2, $3)
                        `,
                        [
                            deviceId,
                            Number(sample.kw) * 1000,
                            recordedAt
                        ],
                        (err) => {
                            if (err) {
                                return db.query(
                                    "ROLLBACK",
                                    () => callback(err)
                                );
                            }
                            index++;
                            insertNext();
                        }
                    );
                }
                insertNext();
            }
        );
    });
}

function calculateDailyLoad(deviceId, historyDate, callback) {
    const query = `
        WITH daily_data AS (
            SELECT real_power, recorded_at
            FROM load_history
            WHERE device_id = $1
            AND recorded_at >= $2::date
            AND recorded_at <= ($2::date + INTERVAL '23 hours 59 minutes 50 seconds')
        ),
        ranked_data AS (
            SELECT
                real_power,
                recorded_at,
                ROW_NUMBER() OVER (ORDER BY real_power ASC) AS rn,
                COUNT(*) OVER () AS total_count
            FROM daily_data
        ),
        stats AS (
            SELECT
                MAX(real_power) AS peak_load,
                (
                    SELECT recorded_at
                    FROM daily_data
                    ORDER BY real_power DESC, recorded_at ASC
                    LIMIT 1
                ) AS peak_load_time,

                AVG(real_power) FILTER (
                    WHERE rn <= CEIL(total_count * 0.10)
                ) AS base_load

            FROM ranked_data
        )
        INSERT INTO load_daily_history (
            device_id,
            history_date,
            peak_load,
            peak_load_time,
            base_load
        )
        SELECT
            $1,
            $2::date,
            peak_load,
            peak_load_time,
            base_load
        FROM stats
        WHERE peak_load IS NOT NULL
        ON CONFLICT (device_id, history_date)
        DO UPDATE SET
            peak_load = EXCLUDED.peak_load,
            peak_load_time = EXCLUDED.peak_load_time,
            base_load = EXCLUDED.base_load;
    `;
    db.query(query, [deviceId, historyDate], (err, result) => {
        if (callback) {
            callback(err, result);
        }
    });
}

function finalizeAndCleanupDailyLoad(deviceId, historyDate, callback) {
    // First calculate and store the daily peak/base
    calculateDailyLoad(deviceId, historyDate, (err) => {
        if (err) {
            console.error(
                `Daily load calculation failed for ${deviceId}:`,
                err.message
            );
            if (callback) callback(err);
            return;
        }
        // Verify that the daily summary exists
        const verifyQuery = `
            SELECT
                peak_load,
                peak_load_time,
                base_load
            FROM load_daily_history
            WHERE device_id = $1
              AND history_date = $2::date
              AND peak_load IS NOT NULL
              AND base_load IS NOT NULL
        `;
        db.query(
            verifyQuery,
            [deviceId, historyDate],
            (err, result) => {
                if (err) {
                    console.error(
                        "Daily load verification failed:",
                        err.message
                    );
                    if (callback) callback(err);
                    return;
                }
                // No valid daily summary → DO NOT DELETE
                if (result.rows.length === 0) {
                    console.error(
                        `Daily load summary missing for ${deviceId} on ${historyDate}. Load history NOT deleted.`
                    );
                    if (callback) {
                        callback(
                            new Error(
                                "Daily load summary not found. Load history was not deleted."
                            )
                        );
                    }
                    return;
                }
                // Now verify that the final 10-second reading exists
                const finalReadingQuery = `
                    SELECT recorded_at
                    FROM load_history
                    WHERE device_id = $1
                      AND recorded_at >= $2::date
                      AND recorded_at <= (
                          $2::date +
                          INTERVAL '23 hours 59 minutes 50 seconds'
                      )
                    ORDER BY recorded_at DESC
                    LIMIT 1
                `;
                db.query(
                    finalReadingQuery,
                    [deviceId, historyDate],
                    (err, readingResult) => {
                        if (err) {
                            console.error(
                                "Final load reading check failed:",
                                err.message
                            );
                            if (callback) callback(err);
                            return;
                        }
                        if (readingResult.rows.length === 0) {
                            console.error(
                                `No load reading found for ${deviceId} on ${historyDate}. Load history NOT deleted.`
                            );
                            if (callback) {
                                callback(
                                    new Error(
                                        "Final load reading missing. Load history was not deleted."
                                    )
                                );
                            }
                            return;
                        }
                        const lastReading = readingResult.rows[0].recorded_at;
                        // Everything is valid → delete old temporary data
                        const deleteQuery = `
                            DELETE FROM load_history
                            WHERE device_id = $1
                              AND recorded_at >= $2::date
                              AND recorded_at < (
                                  $2::date + INTERVAL '1 day'
                              )
                        `;
                        db.query(
                            deleteQuery,
                            [deviceId, historyDate],
                            (err, deleteResult) => {
                                if (err) {
                                    console.error(
                                        "Load history deletion failed:",
                                        err.message
                                    );
                                    if (callback) callback(err);
                                    return;
                                }
                                if (callback) {
                                    callback(null, deleteResult);
                                }
                            }
                        );
                    }
                );
            }
        );
    });
}

function verifyDailyLoad(deviceId, historyDate, callback) {
    const query = `
        SELECT peak_load, peak_load_time, base_load
        FROM load_daily_history
        WHERE device_id = $1
          AND history_date = $2::date
          AND peak_load IS NOT NULL
          AND base_load IS NOT NULL
        LIMIT 1
    `;
    db.query(query, [deviceId, historyDate], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result);
    });
}

function verifyFinalLoadReading(deviceId, historyDate, callback) {
    const query = `
        SELECT recorded_at
        FROM load_history
        WHERE device_id = $1
          AND recorded_at = (
              $2::date + INTERVAL '23 hours 59 minutes 50 seconds'
          )
        LIMIT 1
    `;
    db.query(query, [deviceId, historyDate], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result);
    });
}

function deleteDailyLoadHistory(deviceId, historyDate, callback) {
    const query = `
        DELETE FROM load_history
        WHERE device_id = $1
          AND recorded_at >= $2::date
          AND recorded_at < ($2::date + INTERVAL '1 day')
    `;
    db.query(query, [deviceId, historyDate], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result);
    });
}

function getLoadHistory(deviceId, callback) {
    const query = `
        SELECT
            real_power,
            recorded_at
        FROM load_history
        WHERE device_id = $1
          AND recorded_at >= CURRENT_DATE
          AND recorded_at < (CURRENT_DATE + INTERVAL '1 day')
        ORDER BY recorded_at ASC
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result.rows);
    });
}

function getDailyLoad(deviceId, callback) {
    const query = `
        SELECT
            history_date,
            peak_load,
            peak_load_time,
            base_load
        FROM load_daily_history
        WHERE device_id = $1
          AND history_date = CURRENT_DATE
        LIMIT 1
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result.rows[0] || null);
    });
}

function getMonthlyLoad(deviceId, callback) {
    const query = `
        SELECT
            history_date,
            energy_kwh
        FROM energy_daily_history
        WHERE device_id = $1
          AND history_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND history_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        ORDER BY history_date ASC
    `;
    db.query(query, [deviceId], (err, result) => {
        if (err) {
            callback(err, null);
            return;
        }
        callback(null, result.rows);
    });
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
    ensureAdmin,
    getDailyEnergy,
    getMonthlyEnergy,
    getDeviceChannels,
    renameDeviceChannel,
    saveLoadHistory,
    saveLoadHistoryBatch,
    calculateDailyLoad,
    finalizeAndCleanupDailyLoad,
    verifyDailyLoad,
    verifyFinalLoadReading,
    deleteDailyLoadHistory,
    getLoadHistory,
    getDailyLoad,
    getMonthlyLoad
};