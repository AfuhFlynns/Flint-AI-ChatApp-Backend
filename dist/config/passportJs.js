var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Import required modules
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as LocalStrategy } from "passport-local";
import { config } from "dotenv";
import User from "../models/user.model.js";
config();
// Verify callback for Local Strategy
const localVerifyCallback = (username, password, done) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!username || !password)
            return done(null, false);
        const foundUser = yield User.findOne({
            $or: [{ username: username }, { email: username }],
        }).select("+password");
        if (!foundUser)
            return done(null, false);
        const isMatch = yield foundUser.comparePassword(password);
        if (!isMatch)
            return done(null, false);
        foundUser.isVerified = true;
        return done(null, foundUser);
    }
    catch (error) {
        return done(error, false);
    }
});
// Verify callback for GitHub Strategy
const gitHubVerifyCallback = (accessToken, refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const existingUser = yield User.findOne({ githubId: profile.id });
        if (existingUser) {
            return done(null, existingUser);
        }
        const newUser = new User({
            githubId: profile.id,
            username: profile.username,
            email: (_a = profile.emails[0]) === null || _a === void 0 ? void 0 : _a.value,
            accessToken,
            refreshToken,
            accesstokenExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
            refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
            isVerified: true,
        });
        yield newUser.save();
        return done(null, newUser);
    }
    catch (error) {
        return done(error, false);
    }
});
// Initialize Local Strategy
passport.use(new LocalStrategy({ usernameField: "username", passwordField: "password" }, localVerifyCallback));
// Initialize GitHub Strategy
passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL,
}, gitHubVerifyCallback));
// Serialize and Deserialize User
passport.serializeUser((user, done) => {
    done(null, user._id);
});
passport.deserializeUser((id, done) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User.findById(id);
        if (!user)
            return done(null, false);
        return done(null, user);
    }
    catch (error) {
        done(error, null);
    }
}));
//# sourceMappingURL=passportJs.js.map