const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "data", "energy.json");

function loadEnergy() {
    try {
        if (!fs.existsSync(filePath)) {
            return 0;
        }
        const file = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(file);
        return data.energyKWh || 0;

    }
    catch (err) {
        console.log("Error reading energy file.");
        return 0;
    }
}

function saveEnergy(energy) {
    const data = {
        energyKWh: energy
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

module.exports = {
    loadEnergy,
    saveEnergy
};