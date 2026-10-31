import 'dotenv/config';
import mongoose from 'mongoose';
import { AdminUser, findUserByEmail } from '../src/models/User.js';
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters');
try {
  await mongoose.connect(process.env.MONGODB_URI);
  const { user } = await findUserByEmail(email);
  if (user) {
    if (user.role !== 'admin') throw new Error('Email already belongs to a non-administrator');
    user.password = password;
    user.tokensValidAfter = Date.now();
    user.isActive = true;
    user.isVerified = true;
    await user.save();
  } else {
    await AdminUser.create({ name: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator', username: await AdminUser.generateUsername(email, 'Administrator'), email, password, role: 'admin', isVerified: true });
  }
  console.log('Administrator credentials saved. Remove bootstrap variables from your environment.');
} finally { await mongoose.disconnect(); }
