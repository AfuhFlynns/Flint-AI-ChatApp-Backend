import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import cors from "cors";
import session from "express-session";
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

// Extend express-session's SessionData
declare module "express-session" {
  interface SessionData {
    visited?: boolean;
  }
}

// Create a new express application instance
const app = express();
const port = process.env.PORT || 3000;

// Express session setup
app.use(
  session({
    secret: process.env.EXPRESS_SESSION_SECRET as string,
    saveUninitialized: false,
    resave: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: (process.env.APP_STATUS as string) === "production",
      maxAge: Date.now() + 60 * 60 * 1000, // 1 hour
    },
  })
);

// Express middleware setup
app.use(cookieParser());
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use(morgan("dev"));

app.use("/assist", geminiRouter);

// Middleware to initialize session properties
const sessionInitializer = (req: Request, _: Response, next: NextFunction) => {
  if (!req.session.visited) {
    req.session.visited = false;
  }
  next();
};

// Apply session initializer middleware
app.use(sessionInitializer);

// Route handlers
app.get("/", (req: Request, res: Response) => {
  req.session.visited = true;
  console.log(req.session);
  console.log(req.sessionID);
  req.sessionStore.get(req.sessionID, (error, sessionData) => {
    if (error) console.log(error);
    console.log(sessionData);
  });
  res.send("Hello, world!");
});

// Target wrong routes
app.get("*", (req, res) => {
  if (req.accepts("json"))
    res.status(404).json({ success: false, message: "Page not found!" });
  if (req.accepts("text")) res.status(404).send("Page not found!");
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
