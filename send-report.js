const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ── Firebase Init ──
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SA, 'base64').toString('utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ── Email Setup ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ── Helpers ──
function todayStr() {
  const now = new Date();
  // Bangladesh time = UTC + 6
  const bd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return bd.toISOString().split('T')[0];
}

function todayLabel() {
  const now = new Date();
  const bd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return bd.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function gradeColor(score) {
  if (score >= 90) return '#EFA800';
  if (score >= 75) return '#1FD17A';
  if (score >= 60) return '#4B9FFF';
  return '#FF4466';
}

// ── Build HTML Email ──
function buildEmail(companyName, date, summary, salesmanRows) {
  const totalVisits = salesmanRows.reduce((s, r) => s + r.visits, 0);
  const presentCount = salesmanRows.filter(r => r.status === 'present').length;
  const absentCount = salesmanRows.filter(r => r.status === 'absent').length;

  const rows = salesmanRows.map((r, i) => {
    const statusColor = r.status === 'present' ? '#1FD17A' : '#FF4466';
    const statusEmoji = r.status === 'present' ? '✅' : '❌';
    return `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8faff'};">
        <td style="padding:10px 14px;font-weight:600;color:#1a2850;">${r.name}</td>
        <td style="padding:10px 14px;text-align:center;color:${statusColor};font-weight:700;">${statusEmoji} ${r.status === 'present' ? 'Present' : 'Absent'}</td>
        <td style="padding:10px 14px;text-align:center;color:#1a2850;font-weight:600;">${r.visits}</td>
        <td style="padding:10px 14px;text-align:center;color:#1FD17A;">${r.startTime || '—'}</td>
        <td style="padding:10px 14px;text-align:center;color:#FF4466;">${r.endTime || '—'}</td>
        <td style="padding:10px 14px;text-align:center;color:#7A8DB8;">${r.duration || '—'}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:680px;margin:30px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#06091A 0%,#0C1229 100%);padding:32px 36px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="background:linear-gradient(145deg,#EFA800,#C88A00);width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">☀️</div>
        <div>
          <div style="color:#EFA800;font-size:20px;font-weight:800;letter-spacing:0.5px;">SunStar Solutions</div>
          <div style="color:#7A8DB8;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Field Force Management</div>
        </div>
      </div>
      <div style="margin-top:20px;">
        <div style="color:#F0F4FF;font-size:22px;font-weight:700;">${companyName}</div>
        <div style="color:#7A8DB8;font-size:13px;margin-top:4px;">📅 Daily Report — ${date}</div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div style="background:#F8FAFF;padding:24px 36px;border-bottom:1px solid #E0E8FF;">
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:16px;text-align:center;border-top:3px solid #EFA800;">
          <div style="font-size:28px;font-weight:800;color:#EFA800;">${totalVisits}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Total Visits</div>
        </div>
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:16px;text-align:center;border-top:3px solid #1FD17A;">
          <div style="font-size:28px;font-weight:800;color:#1FD17A;">${presentCount}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Present</div>
        </div>
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:16px;text-align:center;border-top:3px solid #FF4466;">
          <div style="font-size:28px;font-weight:800;color:#FF4466;">${absentCount}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Absent</div>
        </div>
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:16px;text-align:center;border-top:3px solid #4B9FFF;">
          <div style="font-size:28px;font-weight:800;color:#4B9FFF;">${salesmanRows.length}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:4px;">Total Staff</div>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div style="padding:24px 36px;">
      <div style="font-size:15px;font-weight:700;color:#1a2850;margin-bottom:14px;">👥 Salesman-wise Report</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E0E8FF;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#EFA800;">
            <th style="padding:11px 14px;text-align:left;color:#000;font-size:12px;letter-spacing:0.5px;">SALESMAN</th>
            <th style="padding:11px 14px;text-align:center;color:#000;font-size:12px;letter-spacing:0.5px;">STATUS</th>
            <th style="padding:11px 14px;text-align:center;color:#000;font-size:12px;letter-spacing:0.5px;">VISITS</th>
            <th style="padding:11px 14px;text-align:center;color:#000;font-size:12px;letter-spacing:0.5px;">START</th>
            <th style="padding:11px 14px;text-align:center;color:#000;font-size:12px;letter-spacing:0.5px;">END</th>
            <th style="padding:11px 14px;text-align:center;color:#000;font-size:12px;letter-spacing:0.5px;">DURATION</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    ${salesmanRows.filter(r => r.visitDetails.length > 0).map(r => `
    <!-- Visit Details for ${r.name} -->
    <div style="padding:0 36px 20px;">
      <div style="background:#F8FAFF;border:1px solid #E0E8FF;border-radius:10px;padding:16px;">
        <div style="font-size:13px;font-weight:700;color:#1a2850;margin-bottom:10px;">📍 ${r.name}'s Visits</div>
        ${r.visitDetails.map((v, i) => `
        <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #E0E8FF;${i === r.visitDetails.length - 1 ? 'border-bottom:none;' : ''}">
          <div style="width:24px;height:24px;background:#EFA800;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#000;flex-shrink:0;">${i + 1}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2850;">${v.outlet}</div>
            <div style="font-size:11px;color:#7A8DB8;margin-top:2px;">🕐 ${v.time}${v.remarks ? ` &nbsp;💬 ${v.remarks}` : ''}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('')}

    <!-- Footer -->
    <div style="background:#06091A;padding:20px 36px;text-align:center;">
      <div style="color:#3E4E78;font-size:12px;">Powered by <span style="color:#EFA800;font-weight:700;">SunStar Solutions</span> — Field Force Management</div>
      <div style="color:#3E4E78;font-size:11px;margin-top:4px;">This is an automated daily report. Do not reply to this email.</div>
    </div>
  </div>
</body>
</html>`;
}

// ── Main ──
async function main() {
  const today = todayStr();
  const dateLabel = todayLabel();
  console.log(`Sending daily report for: ${today}`);

  try {
    // Get all companies
    const companiesSnap = await db.ref('companies').get();
    if (!companiesSnap.exists()) {
      console.log('No companies found');
      return;
    }

    const companies = companiesSnap.val();

    for (const [coId, co] of Object.entries(companies)) {
      console.log(`Processing: ${co.name}`);

      // Get admin user
      const adminSnap = await db.ref(`users/${co.admin_uid}`).get();
      if (!adminSnap.exists()) continue;
      const adminUser = adminSnap.val();
      const adminEmail = adminUser.email;
      if (!adminEmail) continue;

      // Get all salesmen for this company
      const usersSnap = await db.ref('users')
        .orderByChild('company_id')
        .equalTo(coId)
        .get();

      if (!usersSnap.exists()) continue;

      const salesmen = Object.entries(usersSnap.val())
        .filter(([, u]) => u.role === 'salesman');

      const salesmanRows = [];

      for (const [uid, sm] of salesmen) {
        // Attendance
        const attSnap = await db.ref(`attendance/${coId}/${today}/${uid}`).get();
        const att = attSnap.exists() ? attSnap.val() : null;

        // Visits
        const visitSnap = await db.ref(`visits/${coId}/${today}`)
          .orderByChild('salesman_uid')
          .equalTo(uid)
          .get();

        const visits = visitSnap.exists()
          ? Object.values(visitSnap.val()).sort((a, b) => a.timestamp - b.timestamp)
          : [];

        // Duration
        let duration = '—';
        if (att && att.start_timestamp && att.end_timestamp) {
          const diff = att.end_timestamp - att.start_timestamp;
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          duration = `${h}h ${m}m`;
        }

        salesmanRows.push({
          name: sm.name,
          status: att ? 'present' : 'absent',
          visits: visits.length,
          startTime: att ? att.start_time : null,
          endTime: att ? att.end_time : null,
          duration,
          visitDetails: visits.map(v => ({
            outlet: v.outlet,
            time: v.time,
            remarks: v.remarks || ''
          }))
        });
      }

      // Sort: present first
      salesmanRows.sort((a, b) => {
        if (a.status === b.status) return b.visits - a.visits;
        return a.status === 'present' ? -1 : 1;
      });

      const html = buildEmail(co.name, dateLabel, {}, salesmanRows);
      const totalVisits = salesmanRows.reduce((s, r) => s + r.visits, 0);
      const presentCount = salesmanRows.filter(r => r.status === 'present').length;

      await transporter.sendMail({
        from: `"SunStar Solutions" <${process.env.EMAIL_USER}>`,
        to: adminEmail,
        subject: `📊 Daily Report — ${co.name} — ${today} (${presentCount} Present, ${totalVisits} Visits)`,
        html
      });

      console.log(`✅ Email sent to ${adminEmail} for ${co.name}`);
    }

    console.log('All reports sent!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }

  process.exit(0);
}

main();
