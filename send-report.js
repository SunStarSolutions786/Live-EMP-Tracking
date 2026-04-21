'use strict';

/**
 * SunStar Solutions — Daily Report Email
 * Runs via GitHub Actions at 18:30 UTC (12:00 AM IST)
 *
 * EXIT CODES:
 *   0 = Success OR intentional skip (mail not required / holiday / no employees)
 *   1 = Unexpected fatal error (Firebase auth failure, etc.)
 *
 * KEY FIX: Always exit(0) on intentional skips so GitHub does NOT
 * mark the run as failed and send failure notification emails.
 */

const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');

// ── Global safety net — catch ANYTHING that escapes try-catch ──────────────
// These prevent unexpected Firebase/nodemailer async errors from crashing
// the process with exit code 1 (which triggers GitHub failure notifications)
process.on('unhandledRejection', (reason) => {
  console.error('[WARN] Unhandled promise rejection (non-fatal):', reason);
  // Do NOT exit(1) here — this would cause GitHub failure notifications
  // for benign Firebase connection cleanup errors
});

process.on('uncaughtException', (err) => {
  console.error('[WARN] Uncaught exception (non-fatal):', err.message || err);
  // Same — log but don't crash the run
});

// ── Firebase init ──────────────────────────────────────────────────────────
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: serviceAccount.databaseURL ||
      'https://sunstar-solutions-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
  db = admin.database();
} catch (initErr) {
  console.error('[FATAL] Firebase init failed:', initErr.message || initErr);
  process.exit(1);
}

// ── Clean exit helper — always closes Firebase before exiting ──────────────
async function safeExit(code) {
  try {
    await admin.app().delete();
  } catch (e) {
    // Ignore cleanup errors
  }
  process.exit(code);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function todayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

function isHoliday(dateStr, weeklyHols = [], customHols = []) {
  const dow = dayOfWeek(dateStr);
  if (weeklyHols.includes(dow)) return true;
  if (customHols.some(h => h.date === dateStr)) return true;
  return false;
}

function fmt12(timeStr) {
  if (!timeStr) return '—';
  const s = timeStr.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) return s;
  const parts = s.split(':');
  let h = parseInt(parts[0]), m = parseInt(parts[1] || '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

// isMailRequired — handles boolean false, string "false", 0, "0"
function isMailRequired(val) {
  if (val === false || val === 'false' || val === 0 || val === '0') return false;
  return true; // default: send mail
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    const today = todayIST();
    console.log(`[INFO] Running for date: ${today}`);

    // Load all companies
    const coSnap = await db.ref('companies').get();
    if (!coSnap.exists()) {
      console.log('[SKIP] No companies found in Firebase');
      await safeExit(0);
      return;
    }

    const companies = coSnap.val();
    let emailsSent = 0;
    let emailsSkipped = 0;

    for (const [coId, co] of Object.entries(companies)) {
      try {
        const sent = await processCompany(coId, co, today);
        if (sent) emailsSent++;
        else emailsSkipped++;
      } catch (coErr) {
        // Don't fail the entire run for one company error — log and continue
        console.error(`[ERROR] Company ${co.name || coId}:`, coErr.message || coErr);
        emailsSkipped++;
      }
    }

    console.log(`[INFO] Done. Emails sent: ${emailsSent} | Skipped: ${emailsSkipped}`);
    await safeExit(0);

  } catch (err) {
    console.error('[FATAL] Unexpected top-level error:', err.message || err);
    await safeExit(1);
  }
})();

// Returns true if email was sent, false if skipped
async function processCompany(coId, co, today) {
  const coName = co.name || coId;

  // ── 1. Check mail_required ──────────────────────────────────────────────
  // Handles boolean false, string "false", 0, "0" — all mean "don't send"
  if (!isMailRequired(co.mail_required)) {
    console.log(`[SKIP] ${coName}: mail_required is false`);
    return false;
  }

  // ── 2. Check holiday ───────────────────────────────────────────────────
  const weeklyHols  = Array.isArray(co.holidays)       ? co.holidays        : [0];
  const customHols  = Array.isArray(co.custom_holidays) ? co.custom_holidays : [];
  if (isHoliday(today, weeklyHols, customHols)) {
    console.log(`[SKIP] ${coName}: today is a holiday`);
    return false;
  }

  // ── 3. Load employees + find company admin email ──────────────────────
  const usersSnap = await db.ref('users')
    .orderByChild('company_id').equalTo(coId).get();
  if (!usersSnap.exists()) {
    console.log(`[SKIP] ${coName}: no users found`);
    return false;
  }
  const allUsers = usersSnap.val();

  // Get company admin email from users table
  const adminUser = Object.values(allUsers).find(u => u.role === 'company_admin');
  const adminEmail = adminUser ? adminUser.email : null;
  if (!adminEmail) {
    console.log(`[SKIP] ${coName}: company admin email not found`);
    return false;
  }

  const employees = Object.entries(allUsers)
    .filter(([, u]) => u.role === 'salesman' && u.status !== 'deleted_by_admin');
  if (!employees.length) {
    console.log(`[SKIP] ${coName}: no active employees`);
    return false;
  }

  // ── 4. Check GMAIL credentials before doing heavy work ────────────────
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;
  if (!gmailUser || !gmailPass) {
    console.error(`[ERROR] ${coName}: GMAIL_USER or GMAIL_PASS secret not set — skipping`);
    return false;
  }

  // ── 5. Load today's attendance & visits ───────────────────────────────
  const [attSnap, visSnap] = await Promise.all([
    db.ref(`attendance/${coId}/${today}`).get(),
    db.ref(`visits/${coId}/${today}`).get()
  ]);
  const attData = attSnap.exists() ? attSnap.val() : {};
  const visData = visSnap.exists() ? visSnap.val() : {};

  // Count visits per employee
  const visitsByEmp = {};
  Object.values(visData).forEach(v => {
    visitsByEmp[v.salesman_uid] = (visitsByEmp[v.salesman_uid] || 0) + 1;
  });

  // Get default shift from templates or legacy fields
  const defShift = (() => {
    const templates = Array.isArray(co.shift_templates) ? co.shift_templates : [];
    const def = templates.find(t => t.is_default) || templates[0];
    if (def) return { shiftIn: def.shift_in, shiftOut: def.shift_out, grace: def.grace || 15 };
    return { shiftIn: co.shift_in || '09:00', shiftOut: co.shift_out || '18:00', grace: co.greeting_period ?? 15 };
  })();

  // ── 6. Build report rows ──────────────────────────────────────────────
  const salesRows = [];
  const boRows    = [];

  employees.sort(([, a], [, b]) => {
    const na = parseInt((a.emp_id || 'EMP-9999').split('-')[1] || 9999);
    const nb = parseInt((b.emp_id || 'EMP-9999').split('-')[1] || 9999);
    return na - nb;
  });

  for (const [uid, u] of employees) {
    const att    = attData[uid] || null;
    const visits = visitsByEmp[uid] || 0;
    const isBo   = u.emp_type === 'backoffice';

    // Resolve employee shift: override → template → company default
    let shiftIn  = defShift.shiftIn;
    let shiftOut = defShift.shiftOut;
    let grace    = defShift.grace;

    if (u.shift_template_name && Array.isArray(co.shift_templates)) {
      const tmpl = co.shift_templates.find(t => t.name === u.shift_template_name);
      if (tmpl) { shiftIn = tmpl.shift_in; shiftOut = tmpl.shift_out; grace = tmpl.grace || 15; }
    }
    // Direct employee overrides take highest priority
    if (u.shift_in)  shiftIn  = u.shift_in;
    if (u.shift_out) shiftOut = u.shift_out;
    if (u.greeting_period != null) grace = u.greeting_period;

    const row = {
      empId   : u.emp_id || '—',
      name    : u.name   || 'Unknown',
      shiftIn, shiftOut, grace,
      inTime  : att ? fmt12(att.start_time) : '—',
      outTime : att && att.end_time ? fmt12(att.end_time) : '—',
      status  : 'Absent',
      remark  : '',
      visits
    };

    if (att && att.start_time) {
      const inMin    = parseTimeToMin(att.start_time);
      const shInMin  = parseTimeToMin(shiftIn);
      const shOutMin = parseTimeToMin(shiftOut);
      const lateMin  = Math.max(0, inMin - (shInMin + grace));

      if (att.end_time) {
        const outMin    = parseTimeToMin(att.end_time);
        const workedMin = outMin - inMin;
        const shDurMin  = shOutMin - shInMin;
        const otMin     = Math.max(0, workedMin - shDurMin);
        const earlyMin  = Math.max(0, shOutMin - outMin);

        row.status = lateMin > 0 ? 'Late' : 'Present';
        if (lateMin  > 0) row.remark += `⚠️ Late ${minsToHHMM(lateMin)}`;
        if (otMin    > 0) row.remark += `${row.remark ? ' | ' : ''}OT +${minsToHHMM(otMin)}`;
        if (earlyMin > 0) row.remark += `${row.remark ? ' | ' : ''}Early -${minsToHHMM(earlyMin)}`;
        if (!row.remark)  row.remark  = 'On time ✅';
      } else {
        row.status = 'Pending';
        row.remark = `⚠️ No checkout${lateMin > 0 ? ` | Late ${minsToHHMM(lateMin)}` : ''}`;
      }
    }

    (isBo ? boRows : salesRows).push(row);
  }

  // ── 7. Build HTML email ──────────────────────────────────────────────
  const html = buildHtml(coName, today, salesRows, boRows);

  // ── 8. Send email ────────────────────────────────────────────────────
  const ccEmails = Array.isArray(co.cc_emails)
    ? co.cc_emails.filter(Boolean).join(', ')
    : '';

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
    pool: false
  });

  transporter.on('error', (err) => {
    console.error(`[WARN] Transporter error for ${coName}:`, err.message);
  });

  try {
    await transporter.sendMail({
      from   : `"SunStar Solutions" <${gmailUser}>`,
      to     : adminEmail,          // Company admin receives the report
      cc     : ccEmails || undefined, // CC list from company settings
      subject: `📊 Daily Report — ${coName} — ${today}`,
      html
    });
    console.log(`[OK] Email sent for ${coName} → ${adminEmail}`);
  } finally {
    transporter.close();
  }

  return true;
}

// ── Time helpers ───────────────────────────────────────────────────────────
function parseTimeToMin(t) {
  if (!t || !t.includes(':')) return 0;
  const s = t.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]), m = parseInt(ampm[2]);
    if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const parts = s.split(':');
  return parseInt(parts[0]) * 60 + (parseInt(parts[1]) || 0);
}

function minsToHHMM(m) {
  const h = Math.floor(Math.abs(m) / 60), mm = Math.abs(m) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ── HTML builder ───────────────────────────────────────────────────────────
function buildHtml(coName, date, salesRows, boRows) {
  const rowStyle = `style="border-bottom:1px solid #E5E7EB;font-size:13px;"`;
  const th = (t, w = '') => `<th style="background:#EFA800;color:#000;padding:8px 10px;text-align:left;font-size:12px;${w ? 'width:' + w + ';' : ''}">${t}</th>`;
  const td = (t, c = '#1A2850', bold = false) => `<td style="padding:7px 10px;color:${c};${bold ? 'font-weight:700;' : ''}">${t}</td>`;

  function buildSection(title, rows, showVisits) {
    if (!rows.length) return `<p style="color:#6B7280;font-size:13px;">No ${title.toLowerCase()} employees found.</p>`;
    const present = rows.filter(r => r.status === 'Present' || r.status === 'Late').length;
    const absent  = rows.filter(r => r.status === 'Absent').length;
    const pending = rows.filter(r => r.status === 'Pending').length;
    const summary = `<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <span style="background:#D1FAE5;color:#065F46;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">✅ Present: ${present}</span>
      <span style="background:#FEE2E2;color:#991B1B;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">❌ Absent: ${absent}</span>
      ${pending ? `<span style="background:#FEF3C7;color:#92400E;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">⚠️ Pending: ${pending}</span>` : ''}
    </div>`;
    const tableRows = rows.map(r => {
      const sc = r.status === 'Present' ? '#065F46' : r.status === 'Late' ? '#B45309' : r.status === 'Pending' ? '#92400E' : '#991B1B';
      return `<tr ${rowStyle}>
        ${td(r.empId, '#1E40AF', true)}
        ${td(r.name)}
        ${td(`${fmt12(r.shiftIn)} – ${fmt12(r.shiftOut)}`, '#6B7280')}
        ${td(r.inTime, r.status === 'Absent' ? '#D1D5DB' : '#1A2850')}
        ${td(r.outTime, r.status === 'Absent' || r.outTime === '—' ? '#D1D5DB' : '#1A2850')}
        ${td(`<b style="color:${sc};">${r.status}</b>`)}
        ${showVisits ? td(r.visits > 0 ? String(r.visits) : '—', r.visits > 0 ? '#1D4ED8' : '#9CA3AF') : ''}
        ${td(r.remark || '—', '#6B7280')}
      </tr>`;
    }).join('');
    return summary + `<table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        ${th('Emp ID')}${th('Name', '160px')}${th('Shift')}${th('In')}${th('Out')}${th('Status')}
        ${showVisits ? th('Visits', '60px') : ''}${th('Remarks')}
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  }

  const hasSales = salesRows.length > 0;
  const hasBO    = boRows.length > 0;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:800px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <!-- Header -->
  <div style="background:#06091A;padding:24px 28px;display:flex;align-items:center;gap:16px;">
    <div style="background:linear-gradient(145deg,#EFA800,#C88A00);width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">☀️</div>
    <div>
      <div style="color:#EFA800;font-size:20px;font-weight:800;letter-spacing:0.3px;">SunStar Solutions</div>
      <div style="color:#7A8DB8;font-size:12px;margin-top:2px;">Daily Attendance Report</div>
    </div>
  </div>
  <!-- Date bar -->
  <div style="background:#EFA800;padding:10px 28px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:15px;font-weight:800;color:#000;">📋 ${coName}</div>
    <div style="font-size:13px;font-weight:700;color:#000;">📅 ${date}</div>
  </div>
  <!-- Body -->
  <div style="padding:24px 28px;">
    ${hasSales ? `<h3 style="color:#1D4ED8;font-size:15px;margin:0 0 14px;">📊 Sales Employees</h3>${buildSection('Sales', salesRows, true)}<br>` : ''}
    ${hasBO    ? `<h3 style="color:#065F46;font-size:15px;margin:0 0 14px;">🏢 Back Office Employees</h3>${buildSection('Back Office', boRows, false)}` : ''}
    ${!hasSales && !hasBO ? '<p style="color:#6B7280;text-align:center;padding:20px;">No employee data for today.</p>' : ''}
  </div>
  <!-- Footer -->
  <div style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:14px 28px;text-align:center;font-size:11px;color:#9CA3AF;">
    Auto-generated by SunStar Solutions Field Force Management
  </div>
</div>
</body></html>`;
}
