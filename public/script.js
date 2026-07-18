const socket = io();

socket.on("connect", () => {
    console.log("Socket Connected");
});

socket.on("disconnect", () => {
    console.log("Socket Disconnected");
});

socket.on("update", (data) => {
    document.getElementById("status").textContent = data.connectionStatus;
    document.getElementById("lastUpdate").textContent = data.lastUpdate;
    document.getElementById("voltage").textContent = data.voltage.toFixed(2);
    document.getElementById("current").textContent = data.current.toFixed(2);
    document.getElementById("pf").textContent = data.pf.toFixed(2);
    document.getElementById("realPower").textContent = data.realPower.toFixed(2);
    document.getElementById("apparentPower").textContent = data.apparentPower.toFixed(2);
    document.getElementById("energyWh").textContent = data.energyWh.toFixed(2);
    document.getElementById("energyKWh").textContent = data.energyKWh.toFixed(3);
});

setInterval(() => {
    document.getElementById("currentTime").textContent =
        new Date().toLocaleTimeString("en-IN", {
            hour12:false
        });
},1000);