import { NextFunction, Request, Response } from "express";
import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import {
  sendAccountDeleteAdminNotificationEmail,
  sendAccountDeleteEmail,
  sendNotificationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from "../utils/Emails/send.emails.js";
import generateVerificationCode from "../utils/generateVerificationCode.js";
import { RequestWithUser } from "../TYPES.js";
import generateResetToken from "../utils/generateResetToken.js";
import { format } from "date-fns";

// Register user
export const registerUser = async (req: Request, res: Response) => {
  const { username, password, email } = req.body;
  // Check if all required fields are provided
  if (!username || !password || !email)
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  try {
    // Check if user already exists
    const user = await User.findOne({ username, email });
    if (user)
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Generate a new verification token
    const token: string = await crypto.randomBytes(60).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Generate new verification code
    const verificationCode: string = generateVerificationCode();
    const newUserName = username.trim(); // Remove all spaces in the username and convert it to a single word
    const newUser = new User({
      newUserName,
      password: hashedPassword,
      email,
      verificationCode,
      verificationCodeExpires: expiresAt,
      verificationToken: token,
      verificationTokenExpiresAt: expiresAt,
    });
    await newUser.save();

    await sendVerificationEmail(verificationCode, email, username, token, {
      "X-Category": "Verification Email",
    });

    return res.status(201).json({
      message: "User registered successfully. Verification email sent.",
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Login a user
export const loginUser = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    // Send welcome email since there is passport authentication
    if (req.isAuthenticated() && req.user.email && req.user.username) {
      const loggedInUser = await User.findOne({
        _id: req.user._id,
        email: req.user.email,
      });
      if (loggedInUser) {
        //send notification email
        await sendNotificationEmail(
          "Account Login",
          loggedInUser.email,
          loggedInUser.username,
          new Date().toLocaleDateString(),
          `${loggedInUser.username}, ${loggedInUser.email}`,
          { "X-Category": "Login Notification" }
        );

        // Save a new access token on client browser
        res.cookie("token", loggedInUser.accessToken, {
          httpOnly: true,
          sameSite: "strict",
          secure: true,
          expires: loggedInUser.accessTokenExpires,
        });
      }
    }
    return res.status(200).json({ message: "Logged in successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Logout user
export const logoutUser = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    // send account notificaiton email
    if (req.isAuthenticated() && req.user.email && req.user.username) {
      await sendNotificationEmail(
        "Account Logout",
        req.user.email,
        req.user.username,
        new Date().toLocaleDateString(),
        `${(req.user.username, req.user.email)}`,
        { "X-Category": "Logout Notification" }
      );
    }
    // Clear cookies
    res.clearCookie("token");
    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Send user account delete request for warning
export const sendDeleteAccountRequest = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const token = await crypto.randomBytes(60).toString("hex");
    user.accountDeleteToken = token;
    await user.save();
    await sendAccountDeleteEmail(
      user.email,
      user.username,
      `${process.env.CLIENT_URL}/delete-account/${user._id}/${token}`,
      { "X-Category": "Account Delete Email" }
    );

    return res.status(200).json({ message: "Account deletion request sent" });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Delete user account
export const deleteUserAccount = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  const { token } = req.params;
  const { message } = req.body;
  // TODO: Send the admin an email containing and explaining users reason for account deletion
  // Check if user provided a message
  if (!message)
    return res
      .status(400)
      .json({ message: "Must provide a message to proceed!" });
  try {
    const deletedUser = await User.deleteOne({
      _id: req.user.id,
      accountDeleteToken: token,
    });
    if (!deletedUser) return res.status(404).json({ error: "User not found" });

    // Send user account delete email
    await sendNotificationEmail(
      "Account Deletion",
      req.user.email,
      req.user.username,
      format(new Date(), "YYYY:MM:dd"),
      `${(req.user.username, req.user.email)}`,
      { "X-Category": "Account Deletion Notification" }
    );

    // Send email to notify admin that a user account has been deleted
    await sendAccountDeleteAdminNotificationEmail(
      req.user.email,
      req.user.username,
      "User account deleted",
      message,
      new Date().toLocaleDateString(),
      { "X-Category": "Account deletion" }
    );

    res.clearCookie("token");

    return res
      .status(200)
      .json({ message: "User account deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Get user profile
export const getUserProfile = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(403).json({ error: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update user profile
export const updateUserProfile = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    const { username, password, avatarUrl, firstName, lastName } = req.body;
    // Post avatarUrl to cloudinary before storing in db
    let newAvatarUrl: string = "";
    (async function () {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
        api_key: process.env.CLOUDINARY_API_KEY!,
        api_secret: process.env.CLOUDINARY_API_SECRET!,
      });

      // Upload user avatar image
      const uploadResult = await cloudinary.uploader.upload(avatarUrl, {
        public_id: `Flint ai user ${username} profile avatar`,
      });

      newAvatarUrl = uploadResult.url;
    });
    const updatedData: any = { username }; // Updated user data object
    if (password) updatedData.password = await bcrypt.hash(password, 10);
    if (avatarUrl) updatedData.avatarUrl = newAvatarUrl;
    if (firstName) updatedData.name.firstName = firstName;
    if (lastName) updatedData.name.firstName = lastName;

    // Fetch user and updata if the fields were provided
    const updatedUser = await User.findByIdAndUpdate(req.user.id, updatedData, {
      new: true,
    });
    if (!updatedUser) {
      return res.status(403).json({ error: "User not found" });
    }
    await sendNotificationEmail(
      "Profile Update",
      updatedUser.email,
      updatedUser.username,
      new Date().toLocaleDateString(),
      `${(updatedUser.username, updatedUser.email)}`,
      { "X-Category": "Profile Update Notification" }
    );
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// Verify user account
export const verifyUserAccountWithCode = async (
  req: Request,
  res: Response
) => {
  const { code } = req.body;
  if (!code)
    return res
      .status(400)
      .json({ success: false, message: "Verification code is required" });
  try {
    // Find for a user with verification code that has not expired
    const user = await User.findOne({
      verificationCode: code,
      isVerified: false,
      verificationCodeExpires: { $gt: new Date(Date.now()) },
    });
    if (!user)
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    user.isVerified = true;
    user.verificationCode = "";
    user.verificationCodeExpires = new Date(Date.now());
    user.verificationToken = "";
    user.verificationTokenExpires = new Date(Date.now());
    await user.save();
    await sendWelcomeEmail(user.email, user.username, {
      "X-Category": "Welcome Email",
    });
    return res.status(200).json({ message: "Account verified successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};
// Verify user account
export const verifyUserAccountWithToken = async (
  req: Request,
  res: Response
) => {
  const { token } = req.params;
  if (!token)
    return res
      .status(400)
      .json({ success: false, message: "Expired verification token" });
  try {
    // Find for a user with verification code that has not expired
    const user = await User.findOne({
      verificationToken: token,
      isVerified: false,
      verificationTokenExpires: { $gt: new Date(Date.now()) },
    });
    if (!user)
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification token",
      });
    user.isVerified = true;
    user.verificationCode = "";
    user.verificationCodeExpires = new Date(Date.now());
    user.verificationToken = "";
    user.verificationTokenExpires = new Date(Date.now());
    await user.save();
    await sendWelcomeEmail(user.email, user.username, {
      "X-Category": "Welcome Email",
    });
    return res.status(200).json({ message: "Account verified successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Resend verification code
export const resendVerificationCode = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email)
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  try {
    const user = await User.findOne({
      email,
      verificationCodeExpires: { $gt: new Date(Date.now()) },
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    if (user.isVerified)
      return res.status(400).json({ success: false, message: "User verified" });
    // Generate a new verification token
    const token: string = await crypto.randomBytes(60).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Generate new verification code
    const verificationCode: string = generateVerificationCode();
    user.verificationCode = verificationCode;
    user.verificationCodeExpires = expiresAt;
    user.verificationToken = token;
    user.verificationTokenExpires = expiresAt;
    await user.save();
    await sendVerificationEmail(verificationCode, email, user.username, token, {
      "X-Category": "Verification Email",
    });
    return res.status(200).json({ message: "Verification email sent" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Request to reset password
export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email)
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  try {
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(403)
        .json({ success: false, message: "User not found" });
    const { resetToken, expiresAt } = await generateResetToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordTokenExpires = expiresAt;
    await user.save();
    await sendPasswordResetEmail(
      email,
      user.username,
      `${process.env.CLIENT_URL}/reset-password/${resetToken}`,
      {
        "X-Category": "Password Reset Email",
      }
    );
    return res.status(200).json({ message: "Password reset email sent" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Reset password
export const resetPassword = async (req: Request, res: Response) => {
  const { token } = req.params;
  const { password } = req.body;
  if (!password)
    return res
      .status(400)
      .json({ success: false, message: "A valid password is required" });
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordTokenExpires: { $gt: new Date(Date.now()) },
    });
    if (!user)
      return res.status(403).json({
        success: false,
        message: "Invalid or expired reset link. Try again later",
      });
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = "";
    user.resetPasswordTokenExpires = undefined;
    await user.save();
    sendNotificationEmail(
      "Password Reset",
      user.email,
      user.username,
      new Date().toLocaleDateString(),
      `${(user.username, user.email)}`,
      { "X-Category": "Password Reset Notification" }
    );
    return res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Check auth state
export const checkAuthState = async (
  req: Request & RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    if (req.isAuthenticated() && !user) next();
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Handle github login
export const githubLogin = async (
  req: Request & RequestWithUser,
  res: Response
) => {
  try {
    if (req.user.email && req.user.username) {
      // Send welcome email since there is passport authentication
      const loggedInUser = await User.findOne({
        _id: req.user._id,
        email: req.user.email,
      });
      if (loggedInUser) {
        //send notification email
        await sendNotificationEmail(
          "Account Login Via Github",
          req.user.email,
          req.user.username,
          new Date().toLocaleDateString(),
          `${(req.user.username, req.user.email)}`,
          { "X-Category": "Login Notification" }
        );
        // Save a new access token on client browser
        res.cookie("token", loggedInUser.accessToken, {
          httpOnly: true,
          sameSite: "strict",
          secure: true,
          expires: loggedInUser.accessTokenExpires,
        });
      }
    } else {
      return res.status(401).json({ message: "Unauthorized" });
    }
    //Redirect user permanently to frontend home page
    return res.status(301).redirect(`${process.env.CLIENT_URL}`);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

// NOTE: Will work on more endpoints
