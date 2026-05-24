require('dotenv').config();

// ── Africa's Talking setup ─────────────────────────
let atSMS = null;

function initAT() {
  try {
    const apiKey   = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME;

    if (!apiKey || !username) {
      console.warn('[SMS] Africa\'s Talking not configured — missing AT_API_KEY or AT_USERNAME');
      return null;
    }

    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey, username });
    console.log('[SMS] Africa\'s Talking initialized successfully');
    return at.SMS;
  } catch (err) {
    console.error('[SMS] Failed to initialize Africa\'s Talking:', err.message);
    return null;
  }
}

atSMS = initAT();

// ── Twilio setup (optional fallback) ──────────────
let twilioClient = null;

function initTwilio() {
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    const twilio = require('twilio');
    console.log('[SMS] Twilio initialized as fallback');
    return twilio(sid, token);
  } catch (err) {
    console.error('[SMS] Failed to initialize Twilio:', err.message);
    return null;
  }
}

twilioClient = initTwilio();

// ── Normalize phone number ─────────────────────────
function normalizePhone(phone) {
  // Remove spaces and dashes
  let p = phone.replace(/[\s\-]/g, '');

  // Already has + prefix
  if (p.startsWith('+')) return p;

  // Ghana number starting with 0 → +233
  if (p.startsWith('0') && p.length === 10) {
    return '+233' + p.slice(1);
  }

  // Already has country code without +
  if (p.startsWith('233')) return '+' + p;

  // Default: add + prefix
  return '+' + p;
}

// ── Send via Africa's Talking ──────────────────────
async function sendViaAT(phone, message) {
  if (!atSMS) throw new Error('Africa\'s Talking not initialized');

  const normalized = normalizePhone(phone);
  console.log(`[SMS] Sending via AT to ${normalized}`);
  function normalizePhone(phone) {
  let p = phone.replace(/[\s\-\(\)]/g, '');

  if (p.startsWith('+233')) return p;        // already correct
  if (p.startsWith('233'))  return '+' + p;  // missing + only
  if (p.startsWith('0'))    return '+233' + p.slice(1); // local format
  if (p.length === 9)       return '+233' + p; // bare 9 digits

  return '+' + p;
}

  // Build options — only add 'from' if sender ID is set
  const options = {
    to:      [normalized],
    message,
  };

  const senderId = process.env.AT_SENDER_ID;
  if (senderId && senderId.trim() !== '') {
    options.from = senderId.trim();
  }

  const result = await atSMS.send(options);
  console.log('[SMS] AT result:', JSON.stringify(result));

  const recipient = result?.SMSMessageData?.Recipients?.[0];
  if (!recipient) throw new Error('No recipient data returned');

  if (recipient.statusCode !== 101 &&
      recipient.status !== 'Success') {
    throw new Error(`AT send failed: ${recipient.status}`);
  }

  return { provider: 'africas_talking', success: true };
}

// ── Send via Twilio ────────────────────────────────
async function sendViaTwilio(phone, message) {
  if (!twilioClient || !process.env.TWILIO_PHONE) {
    throw new Error('Twilio not configured');
  }

  const normalized = normalizePhone(phone);
  console.log(`[SMS] Sending via Twilio to ${normalized}`);

  await twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE,
    to:   normalized,
  });

  return { provider: 'twilio', success: true };
}

// ── Main send function ─────────────────────────────
async function sendSMS(phone, message) {
  const normalized = normalizePhone(phone);

  // Try Africa's Talking first
  if (atSMS) {
    try {
      return await sendViaAT(phone, message);
    } catch (err) {
      console.error(`[SMS] AT failed: ${err.message}`);
      // Fall through to Twilio
    }
  }

  // Try Twilio as fallback
  if (twilioClient) {
    try {
      return await sendViaTwilio(phone, message);
    } catch (err) {
      console.error(`[SMS] Twilio failed: ${err.message}`);
    }
  }

  // Both failed — log to console for dev
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('  SMS COULD NOT BE SENT (no provider)');
  console.log(`  To:      ${normalized}`);
  console.log(`  Message: ${message}`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  return { provider: 'none', success: false };
}

// ── OTP specific sender ────────────────────────────
async function sendOTPSMS(phone, code) {
  const message =
    `Your Bless Dhi verification code is: ${code}` +
    `\nValid for 10 minutes. Do not share this code.`;

  return sendSMS(phone, message);
}

module.exports = { sendSMS, sendOTPSMS, normalizePhone };