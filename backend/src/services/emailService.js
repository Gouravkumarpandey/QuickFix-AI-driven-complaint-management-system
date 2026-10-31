import { randomInt } from 'node:crypto';
import { findUserByEmail } from '../models/User.js';
import { notificationAllowed } from './notificationPreferences.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create a transporter with your email credentials
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});



/**
 * Send an OTP email for account verification
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} otp - One-time password
 * @returns {Promise} - Nodemailer send mail promise
 */
export const sendOtpEmail = async (to, name, otp) => {
  try {
    const mailOptions = {
      from: `"QuickFix Support" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Verify Your QuickFix Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e4; border-radius: 5px;">
          <h2 style="color: #4a4a4a; text-align: center;">QuickFix Account Verification</h2>
          <p>Hello ${name},</p>
          <p>Thank you for registering with QuickFix. To complete your registration, please verify your account using the OTP below:</p>
          <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This OTP will expire in 10 minutes for security reasons.</p>
          <p>If you did not request this verification, please ignore this email.</p>
          <p style="margin-top: 30px;">Best regards,<br>The QuickFix Team</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw error;
  }
};

/**
 * Generate a random OTP
 * @param {number} length - Length of the OTP
 * @returns {string} - Generated OTP
 */
export const generateOTP = (length = 6) => {
  if (!Number.isInteger(length) || length < 4 || length > 8) throw new Error('OTP length must be 4–8 digits');
  return String(randomInt(10 ** length)).padStart(length, '0');
};

/**
 * Send password reset email with reset link
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} resetToken - Password reset token
 * @returns {Promise} - Nodemailer send mail promise
 */
export const sendPasswordResetEmail = async (to, name, resetToken) => {
  try {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const mailOptions = {
      from: `"QuickFix Support" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e4; border-radius: 5px;">
          <h2 style="color: #4a4a4a; text-align: center;">QuickFix Password Reset</h2>
          <p>Hello ${name},</p>
          <p>You requested a password reset for your QuickFix account. Please click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4a6cf7; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset My Password</a>
          </div>
          <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
          <p>This link will expire in 30 minutes for security reasons.</p>
          <p style="margin-top: 30px;">Best regards,<br>The QuickFix Team</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};

/**
 * Send complaint confirmation email after complaint creation
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} complaintId - Complaint ticket ID
 * @param {string} title - Complaint title
 * @param {string} description - Complaint description
 * @param {string} category - Complaint category
 * @param {string} priority - Complaint priority
 * @returns {Promise} - Nodemailer send mail promise
 */
export const sendComplaintConfirmationEmail = async (to, name, complaintId, title, description, category, priority) => {
  const { user } = await findUserByEmail(to);
  if (user && !notificationAllowed(user, 'email', 'complaintUpdated')) return { skipped: true };
  try {
    console.log(`📧 Attempting to send complaint confirmation email...`);
    console.log(`   To: ${to}`);
    console.log(`   Ticket ID: ${complaintId}`);

    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;

    const mailOptions = {
      from: `"QuickFix Support" <${process.env.EMAIL_USER}>`,
      to,
      subject: `[Ticket #${complaintId}] Thank you for contacting QuickFix Support`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f7fa;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px 40px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">QuickFix</h1>
                      <p style="margin: 8px 0 0 0; color: #e2e8f0; font-size: 14px;">Support Ticket System</p>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <p style="margin: 0 0 20px 0; color: #1e293b; font-size: 16px;">Hi ${name},</p>
                      
                      <p style="margin: 0 0 20px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                        Thank you for contacting QuickFix Support. This email is to confirm that we have received your support request and created a ticket for you.
                      </p>
                      
                      <!-- Ticket Info Box -->
                      <table role="presentation" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; margin: 20px 0; background-color: #f8fafc;">
                        <tr>
                          <td style="padding: 20px;">
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Ticket ID</td>
                                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">#${complaintId}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Subject</td>
                                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${title}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Category</td>
                                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${category}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Priority</td>
                                <td style="padding: 8px 0; text-align: right;">
                                  <span style="display: inline-block; padding: 4px 12px; background-color: ${priority === 'Critical' || priority === 'High' ? '#ef4444' : priority === 'Medium' ? '#f59e0b' : '#10b981'}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 3px; text-transform: uppercase;">${priority}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Status</td>
                                <td style="padding: 8px 0; text-align: right;">
                                  <span style="display: inline-block; padding: 4px 12px; background-color: #1e293b; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 3px;">OPEN</span>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Description -->
                      <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border-left: 3px solid #1e293b; border-radius: 4px;">
                        <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Your Message</p>
                        <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.5;">${description}</p>
                      </div>
                      
                      <p style="margin: 20px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                        Our support team will review your request and get back to you as soon as possible. You can expect a response within 24 hours during business days.
                      </p>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="margin: 30px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #1e293b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">View Ticket</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 20px 0 0 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                        You can view the status of your ticket or add additional information by clicking the button above or visiting your support portal.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f8fafc; border-top: 1px solid #cbd5e1;">
                      <p style="margin: 0 0 10px 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                        Best regards,<br>
                        <strong style="color: #1e293b;">QuickFix Support Team</strong>
                      </p>
                      <p style="margin: 15px 0 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                        Need help? Contact us at <a href="mailto:${process.env.EMAIL_USER}" style="color: #1e293b; text-decoration: none;">${process.env.EMAIL_USER}</a>
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Bottom Note -->
                  <tr>
                    <td style="padding: 20px 40px; text-align: center;">
                      <p style="margin: 0; color: #94a3b8; font-size: 11px; line-height: 1.5;">
                        This is an automated message. Please do not reply to this email.<br>
                        Ticket #${complaintId} | QuickFix Support System
                      </p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Complaint confirmation email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);
    console.log(`   Accepted: ${info.accepted}`);
    console.log(`   Rejected: ${info.rejected}`);
    return info;
  } catch (error) {
    console.error('❌ Error sending complaint confirmation email:', error);
    console.error('   Error details:', {
      message: error.message,
      code: error.code,
      command: error.command
    });
    throw error;
  }
};

/**
 * Send complaint resolution email when agent marks complaint as resolved
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} complaintId - Complaint ticket ID
 * @param {string} title - Complaint title
 * @returns {Promise} - Nodemailer send mail promise
 */
export const sendComplaintResolvedEmail = async (to, name, complaintId, title) => {
  const { user } = await findUserByEmail(to);
  if (user && !notificationAllowed(user, 'email', 'complaintResolved')) return { skipped: true };
  try {
    console.log(`📧 Attempting to send complaint resolution email...`);
    console.log(`   To: ${to}`);
    console.log(`   Ticket ID: ${complaintId}`);

    const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;

    const mailOptions = {
      from: `"QuickFix Support" <${process.env.EMAIL_USER}>`,
      to,
      subject: `[Ticket #${complaintId}] Your Issue Has Been Resolved`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f7fa;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px 40px; text-align: center;">
                      <div style="width: 64px; height: 64px; margin: 0 auto 16px; background-color: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 32px;">✓</span>
                      </div>
                      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Issue Resolved</h1>
                      <p style="margin: 8px 0 0 0; color: #d1fae5; font-size: 14px;">Ticket #${complaintId}</p>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <p style="margin: 0 0 20px 0; color: #1e293b; font-size: 16px;">Hi ${name},</p>
                      
                      <p style="margin: 0 0 20px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                        Thank you for contacting QuickFix Support. We're pleased to inform you that your support ticket has been resolved by our team.
                      </p>
                      
                      <!-- Ticket Info Box -->
                      <table role="presentation" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; margin: 20px 0; background-color: #f8fafc;">
                        <tr>
                          <td style="padding: 20px;">
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Ticket ID</td>
                                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">#${complaintId}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Subject</td>
                                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; text-align: right;">${title}</td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Status</td>
                                <td style="padding: 8px 0; text-align: right;">
                                  <span style="display: inline-block; padding: 4px 12px; background-color: #10b981; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 3px;">RESOLVED</span>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Important Notice Box -->
                      <div style="margin: 24px 0; padding: 20px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
                        <p style="margin: 0 0 12px 0; color: #92400e; font-size: 14px; font-weight: 600;">
                          ⚠️ Issue Not Resolved Yet?
                        </p>
                        <p style="margin: 0; color: #78350f; font-size: 13px; line-height: 1.6;">
                          If your problem has not been resolved or you need further assistance, please <strong>reply to this email</strong> within the next 24 hours to reopen your ticket. Our team will be happy to help you further.
                        </p>
                      </div>
                      
                      <!-- Auto-Close Notice -->
                      <div style="margin: 24px 0; padding: 16px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                        <p style="margin: 0; color: #1e40af; font-size: 13px; line-height: 1.6;">
                          <strong>📅 Auto-Close Notice:</strong> This ticket will be automatically closed after 24 hours if we don't hear back from you.
                        </p>
                      </div>
                      
                      <p style="margin: 24px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                        We hope we were able to help you resolve your issue. Your satisfaction is our priority, and we appreciate your patience throughout this process.
                      </p>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="margin: 30px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">View Ticket Details</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 20px 0 0 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                        You can view the complete resolution details and conversation history by clicking the button above.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #f8fafc; border-top: 1px solid #cbd5e1;">
                      <p style="margin: 0 0 10px 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                        Thank you for choosing QuickFix!<br>
                        <strong style="color: #1e293b;">QuickFix Support Team</strong>
                      </p>
                      <p style="margin: 15px 0 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                        Questions? Reply to this email or contact us at <a href="mailto:${process.env.EMAIL_USER}" style="color: #1e293b; text-decoration: none;">${process.env.EMAIL_USER}</a>
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Bottom Note -->
                  <tr>
                    <td style="padding: 20px 40px; text-align: center;">
                      <p style="margin: 0; color: #94a3b8; font-size: 11px; line-height: 1.5;">
                        You are receiving this email because you created a support ticket.<br>
                        Ticket #${complaintId} | QuickFix Support System
                      </p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Complaint resolution email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Error sending complaint resolution email:', error);
    throw error;
  }
};

/**
 * Send welcome email to new users/agents/analysts
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} role - User role (user, agent, analytics)
 */
export const sendWelcomeEmail = async (to, name, role) => {
  try {
    console.log(`📧 Attempting to send welcome email (${role})...`);

    let subject = 'Welcome to QuickFix!';
    let welcomeMessage = 'We are excited to have you on board.';
    let actionButtonText = 'Go to Dashboard';
    let actionButtonUrl = `${process.env.FRONTEND_URL}/dashboard`;
    let featuresList = '';

    // Customize content based on role
    if (role === 'agent') {
      subject = 'Welcome to QuickFix Agent Team! 🚀';
      welcomeMessage = `
        Welcome to the QuickFix support team! We're thrilled to have you join our mission of providing exceptional customer service.
        <br><br>
        As a Support Agent, you play a crucial role in resolving user issues and maintaining our high standards of satisfaction.
      `;
      featuresList = `
        <ul style="color: #475569; font-size: 14px; line-height: 1.6; padding-left: 20px;">
          <li>Process and resolve assigned tickets efficiently</li>
          <li>Use AI-powered tools for faster diagnosis</li>
          <li>Communicate directly with users</li>
          <li>Track your performance metrics</li>
        </ul>
      `;
      actionButtonText = 'Access Agent Portal';
      actionButtonUrl = `${process.env.FRONTEND_URL}/dashboard/agent`;
    } else if (role === 'analytics') {
      subject = 'Welcome to QuickFix Analytics Team! 📊';
      welcomeMessage = `
        Welcome to the QuickFix data team! You now have access to our advanced analytics platform.
        <br><br>
        Your insights will help drive decision-making and improve our overall service quality.
      `;
      featuresList = `
        <ul style="color: #475569; font-size: 14px; line-height: 1.6; padding-left: 20px;">
          <li>Monitor real-time system performance</li>
          <li>Analyze complaint trends and patterns</li>
          <li>Generate detailed reports</li>
          <li>Identify areas for improvement</li>
        </ul>
      `;
      actionButtonText = 'View Analytics';
      actionButtonUrl = `${process.env.FRONTEND_URL}/dashboard/analytics`;
    } else {
      // Default User
      subject = 'Welcome to QuickFix! 👋';
      welcomeMessage = `
        Thank you for joining QuickFix! We're here to ensure your issues are resolved quickly and efficiently.
        <br><br>
        Our AI-powered platform makes it easy to track, manage, and resolve any complaints you may have.
      `;
      featuresList = `
        <ul style="color: #475569; font-size: 14px; line-height: 1.6; padding-left: 20px;">
          <li>Submit complaints easily</li>
          <li>Track real-time status updates</li>
          <li>Get instant AI support</li>
          <li>Rate your service experience</li>
        </ul>
      `;
    }

    const mailOptions = {
      from: `"QuickFix Team" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                  
                  <!-- Gradient Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 40px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">QuickFix</h1>
                      <p style="margin: 8px 0 0 0; color: #ffedd5; font-size: 16px; font-weight: 500;">AI-Powered Complaint System</p>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 22px; font-weight: 600;">Hello ${name},</h2>
                      
                      <p style="margin: 0 0 24px 0; color: #475569; font-size: 16px; line-height: 1.6;">
                        ${welcomeMessage}
                      </p>
                      
                      <!-- Features Box -->
                      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 24px; margin-bottom: 30px;">
                        <h3 style="margin: 0 0 16px 0; color: #334155; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">What you can do:</h3>
                        ${featuresList}
                      </div>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="width: 100%;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="${actionButtonUrl}" style="display: inline-block; padding: 14px 32px; background-color: #f97316; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px; transition: background-color 0.2s;">
                              ${actionButtonText}
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 30px 0 0 0; text-align: center; color: #94a3b8; font-size: 14px;">
                        Need help getting started? <a href="#" style="color: #f97316; text-decoration: none;">Check our documentation</a>
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="margin: 0; color: #64748b; font-size: 14px;">
                        &copy; ${new Date().getFullYear()} QuickFix. All rights reserved.
                      </p>
                      <div style="margin-top: 12px;">
                        <a href="#" style="color: #94a3b8; text-decoration: none; margin: 0 8px; font-size: 12px;">Privacy Policy</a>
                        <span style="color: #cbd5e1;">|</span>
                        <a href="#" style="color: #94a3b8; text-decoration: none; margin: 0 8px; font-size: 12px;">Terms of Service</a>
                      </div>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent to ${to}`);
    return info;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    // Don't throw, just log. Welcome emails are non-critical.
  }
};