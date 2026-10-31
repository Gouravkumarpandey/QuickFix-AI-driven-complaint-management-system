import mongoose from 'mongoose';
export const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
  _id: { type: String, default: 'global' },
  value: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true }));
