import express from "express";
import morgan from "morgan";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import geminiRouter from "./routes/gemini.route.js";
import connectDB from "./config/db/connectDB.js";
import mongoose from "mongoose";
import path from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Initialize env vars
config();
// Connect to MongoDB
connectDB();
// Create a new express application instance
const app = express();
const port = process.env.PORT || 3000;
// Express session setup
app.use(session({
    secret: process.env.EXPRESS_SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
    cookie: {
        httpOnly: true,
        sameSite: "strict",
        signed: true,
        secure: process.env.APP_STATUS === "production",
        maxAge: Date.now() + 60 * 60 * 60 * 1000, // 1 hour
    },
}));
// Express middleware setup
app.use(cookieParser());
app.use(express.json());
app.use(cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    optionsSuccessStatus: 200,
}));
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use(morgan("dev"));
// Middleware to initialize session properties
const sessionInitializer = (req, _, next) => {
    if (!req.session.visited || !req.session.userId || !req.session.user) {
        req.session.visited = false;
        req.session.userId = "";
        req.session.user = null;
    }
    next();
};
// Apply session initializer middleware
app.use(sessionInitializer);
// Passport js init
import "./config/passportJs.js";
app.use(passport.initialize());
app.use(passport.session());
// Route handlers
app.use("/assist", geminiRouter);
app.get("/", (req, res) => {
    req.session.visited = true;
    console.log(req.session);
    console.log(req.sessionID);
    console.log(req.isAuthenticated());
    req.sessionStore.get(req.sessionID, (error, sessionData) => {
        if (error)
            console.log(error);
        console.log(sessionData);
    });
    res.send("Hello, world!");
});
// Target wrong routes
app.get("*", (req, res) => {
    if (req.accepts("json"))
        res.status(404).json({ success: false, message: "Page not found!" });
    if (req.accepts("text"))
        res.status(404).send("Page not found!");
    if (req.accepts("html"))
        return res
            .status(404)
            .sendFile(path.join(__dirname, "views", "404page.html"));
});
// Start server
mongoose.connection.once("open", () => {
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
});
//# sourceMappingURL=server.js.map