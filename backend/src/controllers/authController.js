import { jwtSecret, verifyToken, sessionAllowed } from '../services/tokenService.js';
import { User, getUserModelByRole, findUserByEmail, findUserById } from "../models/User.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
// import fetch from "node-fetch"; // Node 18+ has fetch built-in
import crypto from "crypto";
import { sendOtpEmail, generateOTP, sendPasswordResetEmail, sendWelcomeEmail } from "../services/emailService.js";

import anthropicService from "../services/anthropicService.js";
import { Complaint } from "../models/Complaint.js";
import { validateAndFormatPhoneNumber } from "../utils/phoneValidation.js";
import { triggerSignupSMS } from "../services/smsTriggers.js";

// Initialize Twilio - will be done lazily if needed
let client;

const getGoogleClient = () => {
  if (!client) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.warn('⚠️ GOOGLE_CLIENT_ID is not set. Google Auth will fail.');
    }
    client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return client;
};

// Verify Google Token (ID Token or Access Token)
const verifyGoogleToken = async (token) => {
  try {
    // 1. Try to verify as ID Token
    const googleClient = getGoogleClient();
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new Error("Invalid ID Token payload");

    return {
      name: payload.name,
      email: payload.email,
      email_verified: payload.email_verified,
      picture: payload.picture,
      googleId: payload.sub
    };
  } catch (idTokenError) {
    // 2. If ID Token fails, try as Access Token (UserInfo API)
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        // If both fail, throw the original error or a generic one
        throw idTokenError;
      }

      const data = await response.json();
      return {
        name: data.name,
        email: data.email,
        email_verified: data.email_verified,
        picture: data.picture,
        googleId: data.sub
      };
    } catch (accessTokenError) {
      throw idTokenError; // Throw the original error
    }
  }
};

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id, tokenType: 'access', issuedAt: Date.now() }, jwtSecret(), { expiresIn: "7d" });
};

// Generate Refresh Token (longer expiration)
const generateRefreshToken = (id) => {
  return jwt.sign({ id, tokenType: 'refresh', issuedAt: Date.now() }, jwtSecret(), { expiresIn: "30d" });
};

// Set token as a secure cookie
const setTokenCookie = (res, token) => {
  const cookieOptions = {
    httpOnly: true, // Prevents client-side JS from accessing the cookie
    secure: process.env.NODE_ENV === "production", // Only send over HTTPS in production
    sameSite: "strict", // Protects against CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matches JWT expiration)
  };
  res.cookie("token", token, cookieOptions);
};

// Simple validation helper
const validateSignup = (name, email, password) => {
  const errors = [];

  if (!name || name.trim().length < 2) {
    errors.push("Name must be at least 2 characters long");
  }

  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    errors.push("Please provide a valid email");
  }

  if (!password || password.length < 6) {
    errors.push("Password must be at least 6 characters long");
  }

  return errors;
};

// Signup with OTP verification
export const registerUser = async (req, res) => {
  const { name, email, password, role = "user", phoneNumber } = req.body;
    if (role !== 'user') return res.status(403).json({ message: 'Staff accounts must be created by an administrator' });

  console.log("Registration request received:", { name, email, role, phoneNumber: phoneNumber ? '***' : 'not provided' });

  try {
    // Validate input
    if (!name || !email || !password) {
      console.log("Missing required fields");
      return res.status(400).json({
        message: "Missing required fields: name, email, and password are all required",
      });
    }

    const validationErrors = validateSignup(name, email, password);
    if (validationErrors.length > 0) {
      console.log("Validation errors:", validationErrors);
      return res.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Validate role - BLOCK admin role from regular signup
    if (role && !["user", "agent", "analytics"].includes(role)) {
      console.log("Invalid role:", role);
      return res.status(400).json({
        message: "Invalid role. Must be 'user', 'agent', or 'analytics'",
      });
    }

    // Explicitly block admin role signup
    if (role === "admin") {
      console.log(`Blocked admin signup attempt for email: ${email}`);
      return res.status(403).json({
        message: "Admin accounts cannot be created through signup. Please use the admin login page.",
      });
    }

    // Check if user already exists in ANY collection
    const { user: existingUser } = await findUserByEmail(email);
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User already exists with this email" });
    }

    console.log(`Attempting to create user with role: ${role}`);

    // Generate OTP for verification
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Get the appropriate model based on role
    const UserModel = getUserModelByRole(role);
    console.log(`Using model for collection: ${UserModel.collection.name}`);

    // Generate unique username
    const username = await UserModel.generateUsername(email, name);
    console.log(`Generated username: ${username}`);

    // Create user in the role-specific collection
    const userData = {
      name: name.trim(),
      username: username,
      email: email.toLowerCase().trim(),
      password,
      role,
      otp,
      otpExpiry,
      isVerified: false
    };

    // Validate and add phone number if provided
    if (phoneNumber && phoneNumber.trim()) {
      const phoneValidation = validateAndFormatPhoneNumber(phoneNumber.trim(), 'IN');

      if (phoneValidation.isValid) {
        userData.phoneNumber = phoneValidation.formattedNumber; // Store in E.164 format
        console.log(`Phone number validated and formatted: ${phoneValidation.internationalFormat}`);
      } else {
        console.log("Phone number validation failed:", phoneValidation.error);
        return res.status(400).json({
          message: "Invalid phone number",
          error: phoneValidation.error,
          hint: "Please provide phone number in international format (e.g., +1234567890 or +911234567890)"
        });
      }
    }

    const user = await UserModel.create(userData);

    // Send OTP via email in the background
    sendOtpEmail(user.email, user.name, otp)
      .then(() => console.log("OTP email sent to user in background"))
      .catch((emailError) => console.error("Failed to send OTP email in background:", emailError));

    // Send Welcome Email in the background
    sendWelcomeEmail(user.email, user.name, user.role)
      .then(() => console.log("Welcome email sent to user in background"))
      .catch((welcomeError) => console.error("Failed to send welcome email in background:", welcomeError));

    // Send SMS notification in the background if phone number is provided
    if (user.phoneNumber) {
      triggerSignupSMS(user)
        .then(() => console.log("Signup SMS sent to user in background"))
        .catch((smsError) => console.error("Failed to send signup SMS in background:", smsError));
    }
    console.log("User registered (unverified) in collection:", {
      collection: UserModel.collection.name,
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully. Please verify your email with the OTP sent to your inbox.",
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        isVerified: false
      },
      requiresVerification: true,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
};

// Login
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide email and password" });
    }

    // Find user across all collections
    const { user, model } = await findUserByEmail(email);

    if (user && user.isActive !== false && (await user.matchPassword(password))) {
      // Check if user is verified (except for OAuth users who are pre-verified)
      if (!user.isVerified && !user.isGoogleUser && !user.isFacebookUser) {
        // Generate new OTP for unverified users
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        user.otp = otp;
        user.otpExpiry = otpExpiry;
        await user.save();

        // Send new OTP in the background
        sendOtpEmail(user.email, user.name, otp)
          .then(() => console.log("Login verification OTP email sent in background"))
          .catch((err) => console.error("Failed to send login verification OTP email in background:", err));

        return res.status(401).json({
          message: "Account not verified. A new verification OTP has been sent to your email.",
          requiresVerification: true,
          userId: user._id
        });
      }

      console.log("User logged in successfully from collection:", {
        collection: model?.collection?.name || 'unknown',
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      });

      // Generate both access and refresh tokens
      if (user.isActive === false) return res.status(401).json({ message: 'Account deactivated' });
    const accessToken = generateToken(user._id);
      const refreshToken = generateRefreshToken(user._id);

      // Set token as a cookie
      setTokenCookie(res, accessToken);

      res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name || `${user.firstName} ${user.lastName}`,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        },
        token: accessToken,
        refreshToken: refreshToken,
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

// Logout
export const logoutUser = async (req, res) => {
  req.user.tokensValidAfter = Date.now();
  await req.user.save();
  req.app.get('io')?.in(`user:${req.user._id}`).disconnectSockets(true);
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
};

// Admin login uses the same hashed-password authentication as other accounts.
export const adminLogin = async (req, res, next) => {
 try {
  const { user } = await findUserByEmail(req.body.email || '');
  if (!user || user.role !== 'admin') return res.status(401).json({ message: 'Invalid administrator credentials' });
  return loginUser(req, res);
 } catch (error) { next(error); }
};

// Google Login
export const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Google token is required" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error("GOOGLE_CLIENT_ID environment variable is not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Verify token (ID Token or Access Token)
    let payload;
    try {
      payload = await verifyGoogleToken(token);
    } catch (err) {
      return res.status(400).json({ message: "Invalid Google token" });
    }

    const { name, email, email_verified } = payload;

    if (!email_verified) {
      return res.status(400).json({ message: "Email not verified with Google" });
    }

    if (!email || !name) {
      return res.status(400).json({ message: "Required user information not available from Google" });
    }

    const { user: existingUser } = await findUserByEmail(email);

    if (!existingUser) {
      // User doesn't exist - they need to sign up first
      console.log("Google login failed - user not found:", email);
      return res.status(404).json({
        message: "Account not found. Please sign up first to create an account.",
        requiresSignup: true
      });
    }

    const user = existingUser;
    console.log("Existing Google user logged in:", {
      id: user._id,
      name: user.name,
      email: user.email,
    });

    if (user.isActive === false) return res.status(401).json({ message: 'Account deactivated' });
    const accessToken = generateToken(user._id);
    setTokenCookie(res, accessToken);

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token: accessToken,
    });
  } catch (error) {
    console.error("Google login error:", error);

    // More specific error messages
    if (error.message && error.message.includes('Token used too early')) {
      return res.status(400).json({ message: "Invalid token timing. Please try again." });
    }

    if (error.message && error.message.includes('Invalid token signature')) {
      return res.status(400).json({ message: "Invalid Google token. Please try again." });
    }

    if (error.message && error.message.includes('Token expired')) {
      return res.status(400).json({ message: "Google token expired. Please try again." });
    }

    res.status(500).json({
      message: "Server error during Google login",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Decode Google token without creating user
export const decodeGoogleToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Google token is required" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error("GOOGLE_CLIENT_ID environment variable is not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Verify token (ID Token or Access Token)
    let payload;
    try {
      payload = await verifyGoogleToken(token);
    } catch (err) {
      return res.status(400).json({ message: "Invalid Google token" });
    }

    const { name, email, email_verified } = payload;

    if (!email_verified) {
      return res.status(400).json({ message: "Email not verified with Google" });
    }

    if (!email || !name) {
      return res.status(400).json({ message: "Required user information not available from Google" });
    }

    // Check if user already exists
    const { user: existingUser } = await findUserByEmail(email);

    res.json({
      success: true,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      userExists: !!existingUser,
    });
  } catch (error) {
    console.error("Google token decode error:", error);

    if (error.message && error.message.includes('Token used too early')) {
      return res.status(400).json({ message: "Invalid token timing. Please try again." });
    }

    if (error.message && error.message.includes('Invalid token signature')) {
      return res.status(400).json({ message: "Invalid Google token. Please try again." });
    }

    if (error.message && error.message.includes('Token expired')) {
      return res.status(400).json({ message: "Google token expired. Please try again." });
    }

    res.status(500).json({
      message: "Server error during Google token decode",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Google signup with role selection
export const googleSignupWithRole = async (req, res) => {
  try {
    const { token, role = "user", organization, phoneNumber } = req.body;
    if (role !== 'user') return res.status(403).json({ message: 'Staff accounts must be created by an administrator' });

    if (!token) {
      return res.status(400).json({ message: "Google token is required" });
    }

    // Validate role - BLOCK admin from OAuth signup
    if (!["user", "agent", "analytics"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role. Must be 'user', 'agent', or 'analytics'",
      });
    }

    // Explicitly block admin role
    if (role === "admin") {
      console.log(`Blocked admin Google signup attempt`);
      return res.status(403).json({
        message: "Admin accounts cannot be created through Google signup.",
      });
    }

    // Validate organization for non-user roles
    if (role !== "user" && !organization) {
      return res.status(400).json({
        message: "Organization name is required for agent and analytics roles",
      });
    }

    // Phone number is optional for Google signups (can be added later in profile)
    // If not provided, we'll skip WhatsApp notifications until they add it

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error("GOOGLE_CLIENT_ID environment variable is not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Verify token (ID Token or Access Token)
    let payload;
    try {
      payload = await verifyGoogleToken(token);
    } catch (err) {
      return res.status(400).json({ message: "Invalid Google token" });
    }

    const { name, email, email_verified } = payload;

    if (!email_verified) {
      return res.status(400).json({ message: "Email not verified with Google" });
    }

    if (!email || !name) {
      return res.status(400).json({ message: "Required user information not available from Google" });
    }

    // Check if user already exists
    const { user: existingUser } = await findUserByEmail(email);

    // If user already exists → auto-login instead of rejecting with 409
    if (existingUser) {
      console.log(`Google signup: user ${email} already exists — auto-logging in`);

      // Generate token and set cookie (same as regular login)
      const accessToken = generateToken(existingUser._id);
      setTokenCookie(res, accessToken);

      return res.status(200).json({
        success: true,
        message: "Welcome back! You have been logged in.",
        alreadyExisted: true,
        user: {
          id: existingUser._id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
          isGoogleUser: existingUser.isGoogleUser,
          isVerified: existingUser.isVerified,
        },
        token: accessToken,
      });
    }

    // Create new user with selected role in appropriate collection
    const UserModel = getUserModelByRole(role);

    // Generate unique username
    const username = await UserModel.generateUsername(email, name);

    const userData = {
      name: name.trim(),
      username: username,
      email: email.toLowerCase().trim(),
      password: Math.random().toString(36).slice(-8), // dummy password
      role: role,
      isGoogleUser: true,
      isVerified: true, // Google users are pre-verified
    };

    // Add phone number if provided
    if (phoneNumber && phoneNumber.trim()) {
      userData.phoneNumber = phoneNumber.trim();
    }

    // Add organization if provided
    if (organization) {
      userData.organization = organization.trim();
    }

    const user = await UserModel.create(userData);

    console.log("New Google user created with role:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: user.organization,
    });

    // Send SMS notification if phone number is provided
    // Send SMS notification in the background if phone number is provided
    if (user.phoneNumber) {
      triggerSignupSMS(user)
        .then(() => console.log("Signup SMS sent to Google user in background"))
        .catch((smsError) => console.error("Failed to send signup SMS in background:", smsError));
    }

    if (user.isActive === false) return res.status(401).json({ message: 'Account deactivated' });
    const accessToken = generateToken(user._id);
    setTokenCookie(res, accessToken);

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token: accessToken,
    });
  } catch (error) {
    console.error("Google signup error:", error);

    if (error.message && error.message.includes('Token used too early')) {
      return res.status(400).json({ message: "Invalid token timing. Please try again." });
    }

    if (error.message && error.message.includes('Invalid token signature')) {
      return res.status(400).json({ message: "Invalid Google token. Please try again." });
    }

    if (error.message && error.message.includes('Token expired')) {
      return res.status(400).json({ message: "Google token expired. Please try again." });
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: "User with this email already exists" });
    }

    res.status(500).json({
      message: "Server error during Google signup",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Facebook Login - Verifies access token from Facebook SDK
export const facebookLogin = async (req, res) => {
  try {
    const { accessToken, isSignup } = req.body;

    if (!accessToken) {
      return res.status(400).json({ message: "Facebook access token is required" });
    }

    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      console.error("Facebook OAuth environment variables are not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Step 1: Verify the access token with Facebook
    const appAccessToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
    const debugTokenUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appAccessToken}`;

    const debugResponse = await fetch(debugTokenUrl);
    const debugData = await debugResponse.json();

    if (debugData.error || !debugData.data || !debugData.data.is_valid) {
      console.error('Facebook token validation failed:', debugData.error || 'Token is invalid');
      return res.status(401).json({
        message: "Invalid Facebook access token",
        error: debugData.error?.message || 'Token validation failed'
      });
    }

    // Step 2: Verify the token is for our app
    if (debugData.data.app_id !== process.env.FACEBOOK_APP_ID) {
      return res.status(401).json({
        message: "Access token is not for this application"
      });
    }

    // Step 3: Get user information using the verified token
    const userResponse = await fetch(`https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,email,picture`);
    const facebookUser = await userResponse.json();

    if (facebookUser.error) {
      return res.status(400).json({
        message: "Failed to get user information from Facebook",
        error: facebookUser.error.message
      });
    }

    const { name, email, id } = facebookUser;

    if (!email) {
      return res.status(400).json({
        message: "Email not available from Facebook account. Please ensure email permission is granted."
      });
    }

    // Step 4: Find or create user in database
    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      console.log("Facebook login failed - user not found:", email);
      return res.status(404).json({
        message: "Account not found. Please sign up first to create an account.",
        requiresSignup: true,
        facebookData: {
          name,
          email,
          id
        }
      });
    } else {
      // Update Facebook info if user exists
      if (!user.facebookId) {
        user.facebookId = id;
        user.isFacebookUser = true;
        user.isVerified = true;
        await user.save();
      }

      console.log("✅ Existing Facebook user logged in:", {
        id: user._id,
        name: user.name,
        email: user.email,
        facebookId: id,
      });
    }

    // Step 5: Generate JWT token for our application
    const token = generateToken(user._id);

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token: token,
    });
  } catch (error) {
    console.error("❌ Facebook login error:", error);

    if (error.message && error.message.includes('fetch')) {
      return res.status(500).json({
        message: "Facebook API temporarily unavailable. Please try again."
      });
    }

    res.status(500).json({
      message: "Server error during Facebook login",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Decode GitHub code and get user info without creating user
export const decodeGithubCode = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ message: "GitHub authorization code is required" });
    }

    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      console.error("GitHub OAuth environment variables are not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(400).json({
        message: "GitHub authentication failed",
        error: tokenData.error_description
      });
    }

    // Get user information
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    const githubUser = await userResponse.json();

    if (!githubUser.email) {
      // Get user's primary email if not public
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      const emails = await emailResponse.json();
      const primaryEmail = emails.find(email => email.primary && email.verified);

      if (!primaryEmail) {
        return res.status(400).json({
          message: "No verified email found in GitHub account"
        });
      }

      githubUser.email = primaryEmail.email;
    }

    const { name, email, login } = githubUser;

    if (!email || !login) {
      return res.status(400).json({
        message: "Required user information not available from GitHub"
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });

    res.json({
      success: true,
      name: name || login,
      email: email.toLowerCase().trim(),
      githubUsername: login,
      userExists: !!existingUser,
    });
  } catch (error) {
    console.error("GitHub code decode error:", error);

    if (error.message && error.message.includes('fetch')) {
      return res.status(500).json({
        message: "GitHub API temporarily unavailable. Please try again."
      });
    }

    res.status(500).json({
      message: "Server error during GitHub code decode",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// GitHub signup with role selection
export const githubSignupWithRole = async (req, res) => {
  try {
    const { code, role = "user" } = req.body;
    if (role !== 'user') return res.status(403).json({ message: 'Staff accounts must be created by an administrator' });

    if (!code) {
      return res.status(400).json({ message: "GitHub authorization code is required" });
    }

    // Validate role
    if (!["user", "admin", "agent", "analytics"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role. Must be 'user', 'admin', 'agent', or 'analytics'",
      });
    }

    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      console.error("GitHub OAuth environment variables are not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(400).json({
        message: "GitHub authentication failed",
        error: tokenData.error_description
      });
    }

    // Get user information
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    const githubUser = await userResponse.json();

    if (!githubUser.email) {
      // Get user's primary email if not public
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      const emails = await emailResponse.json();
      const primaryEmail = emails.find(email => email.primary && email.verified);

      if (!primaryEmail) {
        return res.status(400).json({
          message: "No verified email found in GitHub account"
        });
      }

      githubUser.email = primaryEmail.email;
    }

    const { name, email, login } = githubUser;

    if (!email || !login) {
      return res.status(400).json({
        message: "Required user information not available from GitHub"
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists. Please use regular GitHub login instead."
      });
    }

    // Create new user with selected role
    const user = await User.create({
      name: name || login,
      email: email.toLowerCase().trim(),
      password: Math.random().toString(36).slice(-8), // dummy password
      role: role,
      isGithubUser: true,
      githubId: githubUser.id,
      githubUsername: login,
    });

    console.log("New GitHub user created with role:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      githubUsername: login,
    });

    // Send SMS notification if phone number is provided
    if (user.phoneNumber) {
      try {
        await triggerSignupSMS(user);
        console.log("Signup SMS sent to GitHub user");
      } catch (smsError) {
        console.error("Failed to send signup SMS:", smsError);
      }
    }

    const token = generateToken(user._id);
    setTokenCookie(res, token);

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token: token,
    });
  } catch (error) {
    console.error("GitHub signup error:", error);

    if (error.message && error.message.includes('fetch')) {
      return res.status(500).json({
        message: "GitHub API temporarily unavailable. Please try again."
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: "User with this email already exists" });
    }

    res.status(500).json({
      message: "Server error during GitHub signup",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// AI Service Integration for Complaint Auto-Generation
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5001';

// Helper function to call AI service
const callAIService = async (endpoint, data) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`AI Service error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('AI Service call failed:', error);
    throw error;
  }
};

// Auto-generate complaint from user chat
export const generateComplaintFromChat = async (req, res) => {
  try {
    const { userId, chatHistory, userMessage } = req.body;

    if (!userId || !chatHistory || !userMessage) {
      return res.status(400).json({
        message: "User ID, chat history, and user message are required"
      });
    }

    // Verify user exists
    const { user } = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Step 1: Get chatbot response from AI service
    const chatbotResponse = await callAIService('/api/chatbot/message', {
      message: userMessage,
      session_id: userId,
      user_context: {
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

    // Step 2: Analyze chat for complaint indicators
    const complaintAnalysis = await callAIService('/classify', {
      text: `${chatHistory}\nUser: ${userMessage}\nBot: ${chatbotResponse.response}`
    });

    // Step 3: Check if this conversation indicates a complaint
    const isComplaintWorthy = complaintAnalysis.category !== 'general_inquiry' &&
      (complaintAnalysis.sentiment === 'negative' ||
        complaintAnalysis.priority === 'high' ||
        complaintAnalysis.category.includes('complaint'));

    if (isComplaintWorthy) {
      // Step 4: Generate structured complaint from chat
      const complaintData = await generateStructuredComplaint(chatHistory, userMessage, complaintAnalysis, user);

      return res.json({
        success: true,
        chatbotResponse: chatbotResponse.response,
        complaintGenerated: true,
        complaintData: complaintData,
        analysis: complaintAnalysis,
        message: "I've detected this might be a complaint. Would you like me to automatically create a complaint ticket for you?"
      });
    } else {
      // Regular chat response
      return res.json({
        success: true,
        chatbotResponse: chatbotResponse.response,
        complaintGenerated: false,
        analysis: complaintAnalysis,
        message: chatbotResponse.response
      });
    }

  } catch (error) {
    console.error("Complaint generation error:", error);

    // Fallback response if AI service is down
    return res.json({
      success: true,
      chatbotResponse: "I understand your concern. Let me help you with that. Could you please provide more details about the issue you're experiencing?",
      complaintGenerated: false,
      error: "AI service temporarily unavailable",
      message: "I'm here to help! Please describe your issue and I'll assist you."
    });
  }
};

// Generate structured complaint data
const generateStructuredComplaint = async (chatHistory, userMessage, analysis, user) => {
  try {
    // Extract key information from chat
    const fullConversation = `${chatHistory}\nUser: ${userMessage}`;

    // Use AI to extract structured data
    const extractedData = await callAIService('/api/extract-complaint-data', {
      conversation: fullConversation,
      analysis: analysis,
      user_info: {
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

    return {
      title: extractedData.title || `${analysis.category} - Auto-generated from chat`,
      description: extractedData.description || fullConversation,
      category: analysis.category,
      priority: analysis.priority,
      sentiment: analysis.sentiment,
      tags: extractedData.tags || [analysis.category, 'auto-generated', 'chat-based'],
      source: 'ai-chat',
      confidence: analysis.confidence,
      extractedEntities: extractedData.entities || {},
      suggestedActions: extractedData.actions || [],
      estimatedResolutionTime: extractedData.estimatedTime || '24-48 hours'
    };
  } catch (error) {
    console.error("Error generating structured complaint:", error);

    // Fallback structure
    return {
      title: `${analysis.category} - Auto-generated Complaint`,
      description: `${chatHistory}\nUser: ${userMessage}`,
      category: analysis.category,
      priority: analysis.priority,
      sentiment: analysis.sentiment,
      tags: ['auto-generated', 'chat-based', analysis.category],
      source: 'ai-chat',
      confidence: analysis.confidence || 0.7
    };
  }
};

// Process chat and potentially create complaint
export const processChatForComplaint = async (req, res) => {
  try {
    const { userId, message, sessionId } = req.body;

    if (!userId || !message) {
      return res.status(400).json({
        message: "User ID and message are required"
      });
    }

    const { user } = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get AI chatbot response
    const aiResponse = await callAIService('/api/chatbot/message', {
      message: message,
      session_id: sessionId || userId,
      user_context: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

    // Analyze message for complaint indicators
    const analysis = await callAIService('/classify', {
      text: message
    });

    // Check if user wants to create a complaint
    const createComplaint = analysis.intent === 'create_complaint' ||
      message.toLowerCase().includes('complaint') ||
      message.toLowerCase().includes('issue') ||
      analysis.sentiment === 'negative' && analysis.priority === 'high';

    res.json({
      success: true,
      response: aiResponse.response,
      shouldCreateComplaint: createComplaint,
      analysis: {
        category: analysis.category,
        priority: analysis.priority,
        sentiment: analysis.sentiment,
        confidence: analysis.confidence
      },
      sessionId: sessionId || userId
    });

  } catch (error) {
    console.error("Chat processing error:", error);

    // Fallback response
    res.json({
      success: true,
      response: "I'm here to help you! Could you please tell me more about what you need assistance with?",
      shouldCreateComplaint: false,
      error: "AI service temporarily unavailable"
    });
  }
};

// Send message to AI Assistant (Anthropic Claude)
export const chatWithAI = async (req, res) => {
  try {
    const { userId, message, conversationHistory = [] } = req.body;

    if (!userId || !message) {
      return res.status(400).json({
        message: "User ID and message are required"
      });
    }

    const { user } = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch complaints based on role (User's submissions or Agent's assignments)
    let complaintQuery = { status: { $ne: 'Closed' } };
    if (user.role === 'agent') {
      complaintQuery.assignedTo = userId;
    } else {
      complaintQuery.user = userId;
    }

    const complaints = await Complaint.find(complaintQuery)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('complaintId title description status category priority createdAt');

    console.log('AI Chat Request (Anthropic Claude):', {
      user: user.name,
      message: message.substring(0, 50),
      historyLength: conversationHistory.length,
      complaintsCount: complaints.length
    });

    // Use Anthropic Claude for conversation
    const context = {
      userName: user.name,
      userRole: user.role,
      userEmail: user.email,
      complaints: complaints
    };

    const result = await anthropicService.chat(message, conversationHistory, context);

    if (result.success) {
      return res.json({
        success: true,
        response: result.response,
        model: result.model,
        searchUsed: false
      });
    }

    // Fallback if Anthropic also fails
    return res.json({
      success: true,
      response: "I'm having trouble accessing my systems right now. Please try again later.",
      model: 'fallback'
    });
  } catch (error) {
    console.error('AI Chat Error:', error);
    return res.status(500).json({
      success: false,
      message: "Failed to process your message",
      error: error.message
    });
  }
};

// Generate complaint from conversation (Anthropic powered)
export const generateComplaintFromAI = async (req, res) => {
  try {
    const { userId, conversationHistory, currentMessage } = req.body;

    if (!userId || !conversationHistory) {
      return res.status(400).json({
        message: "User ID and conversation history are required"
      });
    }

    const { user } = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Use Anthropic
    const anthropicService = (await import('../services/anthropicService.js')).default;

    const fullConversation = currentMessage
      ? `${conversationHistory}\n\nLatest message: ${currentMessage}`
      : conversationHistory;

    // Use analyzeComplaint or custom prompt
    const result = await anthropicService.analyzeComplaint(
      "Conversation Complaint",
      fullConversation + "\n\nExtract complaint details from this conversation."
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Error generating complaint from conversation"
      });
    }

    const complaintData = {
      title: result.summary || 'AI Generated Complaint',
      description: fullConversation, // Or better summary
      category: result.category,
      priority: result.priority,
      tags: ['ai-generated', 'claude', 'chatbot'],
      source: 'chat-conversation',
      aiModel: result.model,
      confidence: 0.9
    };

    const userInfo = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    res.json({
      success: true,
      response: "I've analyzed the conversation and prepared a complaint ticket for you.",
      complaintData: complaintData,
      user: userInfo,
      model: result.model,
      fallback: false
    });

  } catch (error) {
    console.error("Complaint generation error:", error);

    res.status(500).json({
      success: false,
      message: "Error generating complaint from conversation",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Facebook signup with role selection
export const facebookSignupWithRole = async (req, res) => {
  try {
    const { code, role = "user", organization, phoneNumber } = req.body;
    if (role !== 'user') return res.status(403).json({ message: 'Staff accounts must be created by an administrator' });

    if (!code) {
      return res.status(400).json({ message: "Facebook authorization code is required" });
    }

    // Validate role
    if (!["user", "admin", "agent", "analytics"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role. Must be 'user', 'admin', 'agent', or 'analytics'",
      });
    }

    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      console.error("Facebook OAuth environment variables are not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: 'http://localhost:5000/auth/facebook/callback',
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(400).json({
        message: "Facebook authentication failed",
        error: tokenData.error.message
      });
    }

    // Get user information
    const userResponse = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${tokenData.access_token}&fields=id,name,email`);
    const facebookUser = await userResponse.json();

    if (facebookUser.error) {
      return res.status(400).json({
        message: "Failed to get user information from Facebook",
        error: facebookUser.error.message
      });
    }

    const { name, email, id } = facebookUser;

    if (!email) {
      return res.status(400).json({
        message: "Email not available from Facebook account"
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });

    if (existingUser) {
      // If user exists, update Facebook info and return user data
      if (!existingUser.facebookId) {
        existingUser.facebookId = id;
        existingUser.isFacebookUser = true;
        await existingUser.save();
      }

      return res.json({
        success: true,
        user: {
          id: existingUser._id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
        },
        token: generateToken(existingUser._id),
      });
    }

    // Create new user with specified role
    const userData = {
      name: name,
      email: email.toLowerCase().trim(),
      password: Math.random().toString(36).slice(-8), // dummy password
      role: role,
      isFacebookUser: true,
      facebookId: id,
    };

    if (phoneNumber && phoneNumber.trim()) {
      userData.phoneNumber = phoneNumber.trim();
    }

    if (organization) {
      userData.organization = organization.trim();
    }

    const user = await User.create(userData);

    console.log("New Facebook user created with role:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      facebookId: id,
    });

    // Send SMS notification if phone number is provided
    if (user.phoneNumber) {
      try {
        await triggerSignupSMS(user);
        console.log("Signup SMS sent to Facebook user");
      } catch (smsError) {
        console.error("Failed to send signup SMS:", smsError);
      }
    }

    const token = generateToken(user._id);
    setTokenCookie(res, token);

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token: token,
    });
  } catch (error) {
    console.error("Facebook signup error:", error);

    if (error.code === 11000) {
      return res.status(409).json({ message: "User with this email already exists" });
    }

    res.status(500).json({
      message: "Server error during Facebook signup",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Refresh tokens are accepted only here. Logout and password changes revoke both token types.
export const refreshToken = async (req, res) => {
  try {
    const decoded = verifyToken(req.body.refreshToken, 'refresh');
    const { user } = await findUserById(decoded.id);
    if (!sessionAllowed(user, decoded)) return res.status(401).json({ message: 'Session revoked' });
    const token = generateToken(user._id);
    setTokenCookie(res, token);
    return res.json({ token, refreshToken: generateRefreshToken(user._id), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
};

// Verify OTP
export const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const { user } = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if OTP matches and has not expired
    if (user.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
      return res.status(400).json({ message: "OTP has expired. Please request a new one" });
    }

    // Mark user as verified and clear OTP fields
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    console.log("User verified successfully:", user.email);

    // Generate tokens after verification
    if (user.isActive === false) return res.status(401).json({ message: 'Account deactivated' });
    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    setTokenCookie(res, accessToken);

    res.json({
      success: true,
      message: "Email verified successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: true
      },
      token: accessToken,
      refreshToken: refreshToken
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Server error during OTP verification" });
  }
};

// Resend OTP
export const resendOTP = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const { user } = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send new OTP via email in the background
    sendOtpEmail(user.email, user.name, otp)
      .then(() => console.log("Resend OTP email sent in background"))
      .catch((err) => console.error("Failed to send resend OTP email in background:", err));

    res.json({
      success: true,
      message: "New OTP sent to your email",
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ message: "Server error during OTP resend" });
  }
};

// Forgot Password - Send reset email
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide your email"
      });
    }

    // Find the user by email across all collections
    const { user } = await findUserByEmail(email);
    if (!user) {
      // For security reasons, don't reveal that the user doesn't exist
      return res.json({
        success: true,
        message: "If your email is registered, you'll receive a password reset link shortly"
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash the token and store in database
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set token expiry (30 minutes)
    user.resetPasswordExpire = Date.now() + 30 * 60 * 1000;

    await user.save();

    try {
      // Send email with reset token
      await sendPasswordResetEmail(user.email, user.name, resetToken);

      res.json({
        success: true,
        message: "Password reset link sent to your email"
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);

      // Remove reset token from database if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();

      return res.status(500).json({
        success: false,
        message: "Failed to send reset email. Please try again later."
      });
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
};

// Reset Password - Process reset request
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide reset token and new password"
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const models = ['user', 'agent', 'analytics', 'admin'].map(getUserModelByRole);
    const user = (await Promise.all(models.map(Model => Model.findOne({ resetPasswordToken: hashedToken, resetPasswordExpire: { $gt: Date.now() } })))).find(Boolean);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token. Please request a new one."
      });
    }

    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    // Update password
    user.password = password;
    user.tokensValidAfter = Date.now();

    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    console.log("Password reset successful for user:", user.email);

    res.json({
      success: true,
      message: "Password reset successful. Please login with your new password."
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
};

// Verify Reset Token - Check if token is valid before showing reset form
export const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required"
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token
    const models = ['user', 'agent', 'analytics', 'admin'].map(getUserModelByRole);
    const user = (await Promise.all(models.map(Model => Model.findOne({ resetPasswordToken: hashedToken, resetPasswordExpire: { $gt: Date.now() } })))).find(Boolean);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token"
      });
    }

    res.json({
      success: true,
      message: "Token is valid"
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
};
