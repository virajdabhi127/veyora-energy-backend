const jwt = require("jsonwebtoken");
const config = require("../config");

function authenticate(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }
    jwt.verify(token, config.jwt.secret, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token."
            });
        }
        req.user = decoded;
        next();
    });
}
module.exports = authenticate;