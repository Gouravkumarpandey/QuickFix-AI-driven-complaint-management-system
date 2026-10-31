import rateLimit from 'express-rate-limit';
import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  adminLogin,
  googleLogin,
  decodeGoogleToken,
  googleSignupWithRole,
  facebookLogin,
  facebookSignupWithRole,
  generateComplaintFromChat,
  processChatForComplaint,
  chatWithAI,
  generateComplaintFromAI,
  refreshToken,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  verifyResetToken
} from "../controllers/authController.js";
import { validateSession } from "../controllers/sessionController.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Normal auth
router.post("/signup", registerUser);
router.post("/login", loginUser);
router.post("/logout", authenticate, (req, res, next) => logoutUser(req, res).catch(next));
router.post("/admin-login", adminLogin);
router.post("/refresh", refreshToken);

// OTP verification
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);

// Password reset
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/verify-reset-token/:token", verifyResetToken);

// Session validation
router.get("/validate-session", authenticate, validateSession);

// Google OAuth routes
router.get("/google", (req, res) => {
  res.json({
    success: true,
    message: "Google Auth route working ✅",
    availableRoutes: {
      login: "POST /api/auth/google",
      decode: "POST /api/auth/google-decode",
      signup: "POST /api/auth/google-signup"
    }
  });
});
router.post("/google", googleLogin);

// Google OAuth signup with role selection
router.post("/google-decode", decodeGoogleToken);
router.post("/google-signup", googleSignupWithRole);

// Facebook OAuth login
router.post("/facebook", facebookLogin);

// Facebook OAuth signup with role selection
router.post("/facebook-signup", facebookSignupWithRole);

// AI-powered complaint generation from chat
router.post("/generate-complaint-from-chat", generateComplaintFromChat);
router.post("/process-chat", processChatForComplaint);

// Google Gemini AI Assistant integration
router.post("/chat-ai", chatWithAI);
router.post("/chat-watson", chatWithAI); // Backward compatibility alias
router.post("/generate-complaint-ai", generateComplaintFromAI);
router.post("/generate-complaint-watson", generateComplaintFromAI); // Backward compatibility alias

export default router;
