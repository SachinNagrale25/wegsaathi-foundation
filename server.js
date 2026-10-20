const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// FIX: admin password from environment (fallback only for local testing)
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'wegsaathi@admin2026';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD not set - using insecure default. Set it before going live!');
const sessions = new Set(); // FIX: random session tokens instead of reusing the password as token

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- DATABASE (JSON file) ----------
const DB_FILE = path.join(__dirname, 'database.json');
const initialData = {
  settings: {
    minDonation: 100, maxDonation: 100000, gatewayFeePercent: 2.36,
    ngoName: 'WegSaathi Foundation', ngoPan: 'AAACW1234F', ngo80GNumber: 'AAACW1234FE20261',
    supportEmail: 'support@wegsaathi.org', trackingPixelId: 'G-WEGSAATHI2026'
  },
  campaigns: [
    { id: 'camp-1', title: 'Mental Health & Cultural Integration Camps', cause: 'Mental Health & Well-being', goal: 500000, raised: 390000,
      banner: 'https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=900&q=80',
      description: 'Bridging traditional community healing wisdom with modern clinical mental health support across urban and rural India.',
      thankYouMessage: 'Thank you for supporting Mental Health accessibility!', digitalFileUrl: '/guides/WegSaathi-Mental-Wellness-Handbook.pdf' },
    { id: 'camp-2', title: 'Rural Youth Education & Skill Academy', cause: 'Youth Empowerment & Education', goal: 300000, raised: 185000,
      banner: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=80',
      description: 'Empowering rural students with scholarships, resilience training, and vocational digital skills.',
      thankYouMessage: 'Thank you for empowering the next generation of leaders!', digitalFileUrl: '/guides/WegSaathi-Youth-Impact-Report.pdf' },
    { id: 'camp-3', title: 'Community Healthcare & Emergency Relief', cause: 'Rural Healthcare', goal: 750000, raised: 420000,
      banner: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=900&q=80',
      description: 'Mobile medical vans, preventive health checkups, and nutritional support for vulnerable families.',
      thankYouMessage: 'Your generosity saves lives every single day. Thank you!', digitalFileUrl: '/guides/WegSaathi-Health-Kit.pdf' }
  ],
  donations: [
    { id: 'TXN-WS-98102', receiptNo: '80G/2026-27/00101', name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210', pan: 'ABCDE1234F',
      amount: 2000, feeCovered: 47, totalPaid: 2047, frequency: 'Monthly', status: 'Active', mode: 'UPI', cause: 'Mental Health & Well-being',
      campaignId: 'camp-1', tribute: 'In Memory of Ramesh Pal', anonymous: false, date: '2026-03-12T10:30:00.000Z' },
    { id: 'TXN-WS-98105', receiptNo: '80G/2026-27/00102', name: 'Rajesh Kulkarni', email: 'rajesh@example.com', phone: '9822011223', pan: 'FGHIJ5678K',
      amount: 5000, feeCovered: 0, totalPaid: 5000, frequency: 'One-time', status: 'Completed', mode: 'Card', cause: 'Youth Empowerment & Education',
      campaignId: 'camp-2', tribute: '', anonymous: false, date: '2026-04-02T14:15:00.000Z' }
  ],
  blogsAndEvents: [
    { id: 'post-1', type: 'Event', title: 'Mental Health Awareness & Community Dialogue 2026', date: '2026-11-15', summary: 'Join 500+ volunteers and psychologists as we bridge traditional support structures with clinical care.' },
    { id: 'post-2', type: 'Blog', title: 'How Grassroots Counseling Transforms Rural Families', date: '2026-10-01', summary: 'Field findings from 40+ villages and urban community centers.' }
  ],
  csrPartners: [
    { name: 'Tata Social Impact Initiative', tier: 'Platinum CSR Partner', contribution: 'Community Wellness Centers' },
    { name: 'Infosys Care Foundation', tier: 'Gold Digital Partner', contribution: 'Youth Academy Infrastructure' },
    { name: 'Mahindra Sustainability Fund', tier: 'Silver Partner', contribution: 'Mobile Rural Clinics' }
  ],
  legalDocs: [
    { title: '80G Tax Exemption Certificate', regNo: 'AAACW1234FE20261', year: '2026-27' },
    { title: '12A Registration Certificate', regNo: 'AAACW1234FA20251', year: 'Permanent' },
    { title: 'CSR-1 Registration (MCA)', regNo: 'CSR00049281', year: '2026' },
    { title: 'NGO Darpan Unique ID', regNo: 'RJ/2026/0491823', year: 'Verified' }
  ],
  enquiries: []
};

function readDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) { // FIX: atomic write prevents corrupted file on crash
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const newId = (prefix) => prefix + crypto.randomBytes(5).toString('hex').toUpperCase(); // FIX: unguessable IDs
const nextReceiptNo = (db) => {
  const max = db.donations.reduce((m, d) => Math.max(m, parseInt((d.receiptNo || '').split('/').pop(), 10) || 0), 100);
  return `80G/2026-27/${String(max + 1).padStart(5, '0')}`; // FIX: no duplicates
};
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const validPan = (p) => !p || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p);

// ---------- PUBLIC API ----------
app.get('/api/init', (req, res) => {
  const db = readDB();
  const supporterWall = db.donations.slice(0, 50).map(d => ({
    name: d.anonymous ? 'Anonymous Well-Wisher' : d.name,
    amount: d.amount, cause: d.cause, tribute: d.tribute, date: d.date
  }));
  res.json({ settings: { minDonation: db.settings.minDonation, maxDonation: db.settings.maxDonation,
    gatewayFeePercent: db.settings.gatewayFeePercent, ngoName: db.settings.ngoName, supportEmail: db.settings.supportEmail },
    campaigns: db.campaigns, supporterWall, blogsAndEvents: db.blogsAndEvents, csrPartners: db.csrPartners, legalDocs: db.legalDocs });
});

// NOTE: No payment gateway is connected. Integrate Razorpay/Cashfree and only
// record the donation after the gateway's webhook/signature verification succeeds.
app.post('/api/donate', (req, res) => {
  const db = readDB();
  const { name, email, phone, pan, amount, coverFee, frequency, mode, cause, campaignId, tribute, anonymous, customNote } = req.body;
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount < db.settings.minDonation || numAmount > db.settings.maxDonation)
    return res.status(400).json({ error: `Donation amount must be between ₹${db.settings.minDonation} and ₹${db.settings.maxDonation}` });
  if (!validEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  const panU = (pan || '').toUpperCase();
  if (!validPan(panU)) return res.status(400).json({ error: 'Invalid PAN format' });

  const feeCovered = coverFee ? Math.round(numAmount * (db.settings.gatewayFeePercent / 100)) : 0;
  const freq = frequency || 'One-time';
  const donation = {
    id: newId('TXN-WS-'), receiptNo: nextReceiptNo(db),
    name: String(name || 'Supporter').slice(0, 100), email, phone: String(phone || '').slice(0, 15), pan: panU,
    amount: numAmount, feeCovered, totalPaid: numAmount + feeCovered, frequency: freq,
    status: freq === 'One-time' ? 'Completed' : 'Active', mode: mode || 'UPI', cause: cause || 'General Fund',
    campaignId: campaignId || 'camp-1', tribute: String(tribute || '').slice(0, 200), anonymous: Boolean(anonymous),
    customNote: String(customNote || '').slice(0, 300), date: new Date().toISOString()
  };
  db.donations.unshift(donation);
  const camp = db.campaigns.find(c => c.id === donation.campaignId);
  if (camp) camp.raised += numAmount;
  writeDB(db);
  res.json({ success: true, donation,
    thankYouMessage: camp ? camp.thankYouMessage : 'Thank you for supporting WegSaathi Foundation!',
    digitalDeliverable: camp ? camp.digitalFileUrl : null });
});

function drawReceipt(doc, db, donation) {
  doc.rect(0, 0, 612, 110).fill('#133829');
  doc.fillColor('#D4AF37').fontSize(24).text('WEGSAATHI FOUNDATION', 50, 35);
  doc.fillColor('#FFFFFF').fontSize(10).text('Regd. NGO | Mental Health, Youth Empowerment & Community Welfare', 50, 65);
  doc.text(`PAN: ${db.settings.ngoPan}  |  80G Reg No: ${db.settings.ngo80GNumber}`, 50, 82);
  doc.roundedRect(430, 35, 130, 45, 5).fill('#D4AF37');
  doc.fillColor('#133829').fontSize(12).text('80G RECEIPT', 442, 47);
  doc.fontSize(9).text('Section 80G', 452, 63);
  doc.fillColor('#111111').fontSize(18).text('OFFICIAL DONATION RECEIPT', 50, 140);
  doc.moveTo(50, 165).lineTo(550, 165).strokeColor('#D4AF37').stroke();
  const rows = [
    ['Receipt Number:', donation.receiptNo], ['Transaction ID:', donation.id],
    ['Date of Donation:', new Date(donation.date).toLocaleDateString('en-IN')], ['Donor Name:', donation.name],
    ['Donor PAN:', donation.pan || 'Not Provided'], ['Email / Phone:', `${donation.email} / ${donation.phone || 'N/A'}`],
    ['Amount Donated:', `INR ${donation.amount.toLocaleString('en-IN')}/-`], ['Gateway Fee Covered:', `INR ${donation.feeCovered || 0}/-`],
    ['Total Received:', `INR ${donation.totalPaid.toLocaleString('en-IN')}/-`], ['Payment Mode & Type:', `${donation.mode} (${donation.frequency})`],
    ['Designated Cause:', donation.cause], ['Honour / Tribute:', donation.tribute || 'N/A']
  ];
  rows.forEach((r, i) => {
    const y = 185 + i * 24;
    doc.fillColor('#555555').fontSize(11).text(r[0], 50, y);
    doc.fillColor('#000000').fontSize(11).text(String(r[1]), 220, y);
  });
  doc.rect(50, 490, 500, 65).fillAndStroke('#F9F6F0', '#D4AF37');
  doc.fillColor('#133829').fontSize(10).text('Declaration: Donations to WegSaathi Foundation are eligible for deduction under Section 80G of the Income Tax Act, 1961, subject to applicable rules. This is a computer-generated receipt and requires no signature.', 65, 505, { width: 470 });
  doc.fillColor('#777777').fontSize(9).text('Thank you for walking with WegSaathi Foundation.', 50, 580, { align: 'center' });
}

app.get('/api/receipt/:id', (req, res) => {
  const db = readDB();
  const donation = db.donations.find(d => d.id === req.params.id);
  if (!donation) return res.status(404).send('Receipt not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Receipt_80G_${donation.id}.pdf`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res); drawReceipt(doc, db, donation); doc.end();
});

// NOTE: email-only lookup has no verification. Add an email OTP before production.
app.post('/api/donor/login', (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  const db = readDB();
  const donations = db.donations.filter(d => d.email.toLowerCase() === email)
    .map(d => ({ ...d, pan: d.pan ? d.pan.slice(0, 2) + '******' + d.pan.slice(-2) : '' })); // FIX: mask PAN
  res.json({ donations });
});

app.post('/api/donor/cancel-recurring', (req, res) => {
  const { id, email } = req.body || {};
  const db = readDB();
  const item = db.donations.find(d => d.id === id && d.email.toLowerCase() === String(email || '').toLowerCase());
  if (!item || item.frequency === 'One-time') return res.status(404).json({ error: 'Subscription not found' });
  item.status = 'Cancelled by Donor';
  writeDB(db);
  res.json({ success: true });
});

app.get('/api/donor/annual-receipt/:email', (req, res) => {
  const db = readDB();
  const email = req.params.email.toLowerCase();
  const list = db.donations.filter(d => d.email.toLowerCase() === email);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=Annual_80G_Summary.pdf');
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(18).fillColor('#133829').text('WEGSAATHI FOUNDATION - ANNUAL 80G SUMMARY (FY 2026-27)', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).fillColor('#000').text(`Donor Email: ${email}`);
  doc.text(`Total Donations: INR ${list.reduce((a, d) => a + d.amount, 0).toLocaleString('en-IN')}`);
  doc.moveDown();
  list.forEach((d, i) => doc.fontSize(10).text(`${i + 1}. ${new Date(d.date).toLocaleDateString('en-IN')} | ${d.receiptNo} | INR ${d.amount} | ${d.mode} | ${d.cause}`));
  doc.end();
});

app.get('/api/id-card', (req, res) => {
  const clean = (v, d) => String(v || d).replace(/[^\w\s+\-]/g, '').slice(0, 40);
  const name = clean(req.query.name, 'Supporter'), blood = clean(req.query.bloodGroup, 'O+'),
        city = clean(req.query.city, 'India'), role = clean(req.query.role, 'changemaker');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=WegSaathi_ID_${name.replace(/\s+/g, '_')}.pdf`);
  const doc = new PDFDocument({ size: [350, 220], margin: 20 });
  doc.pipe(res);
  doc.rect(0, 0, 350, 60).fill('#133829');
  doc.fillColor('#D4AF37').fontSize(14).text('WEGSAATHI FOUNDATION', 20, 20);
  doc.fillColor('#FFF').fontSize(8).text('OFFICIAL SUPPORTER & VOLUNTEER ID CARD', 20, 38);
  doc.fillColor('#111').fontSize(13).text(name.toUpperCase(), 20, 80);
  doc.fontSize(10).fillColor('#444').text(`Role: ${role.toUpperCase()}`, 20, 102);
  doc.text(`City: ${city}`, 20, 118); doc.text(`Blood Group: ${blood}`, 20, 134);
  doc.text(`Issued: ${new Date().toLocaleDateString('en-IN')}`, 20, 150);
  doc.rect(0, 190, 350, 30).fill('#D4AF37');
  doc.fillColor('#133829').fontSize(9).text('www.wegsaathi.org | Verified Community Member', 20, 200, { align: 'center' });
  doc.end();
});

app.post('/api/enquiry', (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !validEmail(email) || !message) return res.status(400).json({ error: 'Name, valid email and message required' });
  const db = readDB();
  db.enquiries.unshift({ id: Date.now(), name: String(name).slice(0, 100), email, message: String(message).slice(0, 1000), date: new Date().toISOString() });
  writeDB(db);
  res.json({ success: true, message: 'Thank you! We will get back to you shortly.' });
});

// ---------- ADMIN ----------
function checkAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!sessions.has(token)) return res.status(401).json({ error: 'Unauthorized Admin Access' });
  next();
}
const loginAttempts = {};
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip; const now = Date.now();
  const a = (loginAttempts[ip] = (loginAttempts[ip] || []).filter(t => now - t < 15 * 60 * 1000));
  if (a.length >= 5) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const given = Buffer.from(String((req.body || {}).password || ''));
  const real = Buffer.from(ADMIN_PASS);
  if (given.length === real.length && crypto.timingSafeEqual(given, real)) {
    const token = crypto.randomBytes(24).toString('hex'); sessions.add(token);
    return res.json({ success: true, token });
  }
  a.push(now);
  res.status(401).json({ error: 'Invalid Admin Password' });
});

app.get('/api/admin/dashboard', checkAdmin, (req, res) => res.json(readDB()));

app.post('/api/admin/offline-donation', checkAdmin, (req, res) => {
  const db = readDB();
  const { name, email, phone, pan, amount, mode, chequeNo, cause } = req.body;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const entry = { id: newId('OFFLINE-WS-'), receiptNo: nextReceiptNo(db), name, email: email || '', phone, pan: (pan || '').toUpperCase(),
    amount: amt, feeCovered: 0, totalPaid: amt, frequency: 'One-time', status: 'Completed', mode: `${mode || 'Cash'} (${chequeNo || 'Cash'})`,
    cause: cause || 'General Fund', tribute: '', anonymous: false, date: new Date().toISOString() };
  db.donations.unshift(entry); writeDB(db);
  res.json({ success: true, donation: entry });
});

const csvCell = (v) => { // FIX: proper quoting + spreadsheet formula-injection guard
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
app.get('/api/admin/export-csv', checkAdmin, (req, res) => {
  const db = readDB();
  const headers = ['Transaction_ID', 'Receipt_No', 'Date', 'Name', 'Email', 'Phone', 'PAN', 'Amount', 'Fee_Covered', 'Total', 'Frequency', 'Status', 'Mode', 'Cause', 'Tribute'];
  const rows = db.donations.map(d => [d.id, d.receiptNo, d.date, d.name, d.email, d.phone, d.pan, d.amount, d.feeCovered, d.totalPaid, d.frequency, d.status, d.mode, d.cause, d.tribute].map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=WegSaathi_Donors_Export.csv');
  res.send([headers.join(','), ...rows].join('\n'));
});

// Completed (original was cut off here): all receipts in one PDF, one per page
app.get('/api/admin/bulk-receipts', checkAdmin, (req, res) => {
  const db = readDB();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=WegSaathi_All_80G_Receipts_Bulk.pdf');
  const doc = new PDFDocument({ margin: 50, autoFirstPage: false });
  doc.pipe(res);
  db.donations.forEach(d => { doc.addPage(); drawReceipt(doc, db, d); });
  if (!db.donations.length) { doc.addPage(); doc.text('No donations yet.'); }
  doc.end();
});

app.listen(PORT, () => console.log(`WegSaathi Foundation running on http://localhost:${PORT}`));
