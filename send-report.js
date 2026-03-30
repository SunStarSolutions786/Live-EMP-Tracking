const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');

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
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ── Helpers ──
function todayBD() {
  const now = new Date();
  const bd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return bd.toISOString().split('T')[0];
}
function todayLabel() {
  const bd = new Date(new Date().getTime() + 6 * 60 * 60 * 1000);
  return bd.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
function getDayOfWeek() {
  const bd = new Date(new Date().getTime() + 6 * 60 * 60 * 1000);
  return bd.getDay(); // 0=Sun, 6=Sat
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Build HTML Email ──
function buildEmail(coName, date, salesRows, boRows) {
  const totalVisits = salesRows.reduce((s,r)=>s+r.visits,0);
  const allRows = [...salesRows, ...boRows];
  const presentCount = allRows.filter(r=>r.status==='present').length;
  const absentCount = allRows.filter(r=>r.status==='absent').length;

  const buildRows = (rows, showVisits) => rows.map((r,i)=>{
    const statusColor = r.status==='present'?'#1FD17A':'#FF4466';
    const statusEmoji = r.status==='present'?'✅':'❌';
    return `<tr style="background:${i%2===0?'#ffffff':'#f8faff'};">
      <td style="padding:10px 14px;font-weight:600;color:#1a2850;">${r.name}</td>
      <td style="padding:10px 14px;text-align:center;color:${statusColor};font-weight:700;">${statusEmoji} ${r.status==='present'?'Present':'Absent'}</td>
      ${showVisits?`<td style="padding:10px 14px;text-align:center;color:#1a2850;font-weight:600;">${r.visits}</td>`:''}
      <td style="padding:10px 14px;text-align:center;color:#1FD17A;">${r.startTime||'—'}</td>
      <td style="padding:10px 14px;text-align:center;color:#FF4466;">${r.endTime||'—'}</td>
      <td style="padding:10px 14px;text-align:center;color:#7A8DB8;">${r.duration||'—'}</td>
    </tr>`;
  }).join('');

  const salesSection = salesRows.length > 0 ? `
    <div style="padding:0 36px 20px;">
      <div style="font-size:15px;font-weight:700;color:#1a2850;margin-bottom:12px;">📊 Sales Employees</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E0E8FF;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#EFA800;">
          <th style="padding:10px 14px;text-align:left;color:#000;font-size:11px;">EMPLOYEE</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">STATUS</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">VISITS</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">START</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">END</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">DURATION</th>
        </tr></thead>
        <tbody>${buildRows(salesRows, true)}</tbody>
      </table>
    </div>` : '';

  const boSection = boRows.length > 0 ? `
    <div style="padding:0 36px 20px;">
      <div style="font-size:15px;font-weight:700;color:#1a2850;margin-bottom:12px;">🏢 Back Office Employees</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E0E8FF;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#1FD17A;">
          <th style="padding:10px 14px;text-align:left;color:#000;font-size:11px;">EMPLOYEE</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">STATUS</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">START</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">END</th>
          <th style="padding:10px 14px;text-align:center;color:#000;font-size:11px;">DURATION</th>
        </tr></thead>
        <tbody>${buildRows(boRows, false)}</tbody>
      </table>
    </div>` : '';

  // Visit details for sales
  const visitDetails = salesRows.filter(r=>r.visitDetails.length>0).map(r=>`
    <div style="padding:0 36px 16px;">
      <div style="background:#F8FAFF;border:1px solid #E0E8FF;border-radius:10px;padding:14px;">
        <div style="font-size:13px;font-weight:700;color:#1a2850;margin-bottom:10px;">📍 ${r.name}'s Visits</div>
        ${r.visitDetails.map((v,i)=>`
        <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #E0E8FF;${i===r.visitDetails.length-1?'border-bottom:none;':''}">
          <div style="width:24px;height:24px;background:#EFA800;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#000;flex-shrink:0;">${i+1}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1a2850;">${v.outlet}</div>
            <div style="font-size:11px;color:#7A8DB8;margin-top:2px;">🕐 ${v.time}${v.remarks?' &nbsp;💬 '+v.remarks:''}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:680px;margin:30px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#06091A 0%,#0C1229 100%);padding:32px 36px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="background:linear-gradient(145deg,#EFA800,#C88A00);width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">☀️</div>
        <div>
          <div style="color:#EFA800;font-size:20px;font-weight:800;">SunStar Solutions</div>
          <div style="color:#7A8DB8;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Field Force Management</div>
        </div>
      </div>
      <div style="margin-top:20px;">
        <div style="color:#F0F4FF;font-size:22px;font-weight:700;">${coName}</div>
        <div style="color:#7A8DB8;font-size:13px;margin-top:4px;">📅 Daily Report — ${date}</div>
      </div>
    </div>
    <div style="background:#F8FAFF;padding:24px 36px;border-bottom:1px solid #E0E8FF;">
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:110px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:14px;text-align:center;border-top:3px solid #EFA800;">
          <div style="font-size:26px;font-weight:800;color:#EFA800;">${totalVisits}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:3px;">Total Visits</div>
        </div>
        <div style="flex:1;min-width:110px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:14px;text-align:center;border-top:3px solid #1FD17A;">
          <div style="font-size:26px;font-weight:800;color:#1FD17A;">${presentCount}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:3px;">Present</div>
        </div>
        <div style="flex:1;min-width:110px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:14px;text-align:center;border-top:3px solid #FF4466;">
          <div style="font-size:26px;font-weight:800;color:#FF4466;">${absentCount}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:3px;">Absent</div>
        </div>
        <div style="flex:1;min-width:110px;background:#fff;border:1px solid #E0E8FF;border-radius:12px;padding:14px;text-align:center;border-top:3px solid #4B9FFF;">
          <div style="font-size:26px;font-weight:800;color:#4B9FFF;">${allRows.length}</div>
          <div style="font-size:11px;color:#7A8DB8;text-transform:uppercase;letter-spacing:1px;margin-top:3px;">Total Staff</div>
        </div>
      </div>
    </div>
    ${salesSection}${boSection}${visitDetails}
    <div style="background:#06091A;padding:18px 36px;text-align:center;">
      <div style="color:#3E4E78;font-size:12px;">Powered by <span style="color:#EFA800;font-weight:700;">SunStar Solutions</span></div>
      <div style="color:#3E4E78;font-size:11px;margin-top:3px;">Automated daily report. Do not reply.</div>
    </div>
  </div>
</body></html>`;
}

// ── Build Excel Attachment ──
function buildExcelAttachment(coName, date, month, year, salesRows, boRows, attMonthData) {
  const wb = XLSX.utils.book_new();
  
  // Sheet 1: Today's Report
  const todayData = [...salesRows.map(r=>['Sales',r.name,r.status==='present'?'Present':'Absent',r.visits,r.startTime||'—',r.endTime||'—',r.duration||'—']),
    ...boRows.map(r=>['Back Office',r.name,r.status==='present'?'Present':'Absent','—',r.startTime||'—',r.endTime||'—',r.duration||'—'])];
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['SunStar Solutions — Daily Report'],['Company: '+coName],['Date: '+date],[''],
    ['Dept','Employee','Status','Visits','Start','End','Duration'],
    ...todayData
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Daily Report');

  // Sheet 2: MTD Attendance
  if(attMonthData && attMonthData.length > 0) {
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['SunStar Solutions — MTD Attendance'],['Company: '+coName],['Month: '+MONTHS[month]+' '+year],[''],
      ['Dept','Employee','Date','Start','End','Duration','Status'],
      ...attMonthData
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'MTD Attendance');
  }

  return XLSX.write(wb, { bookType:'xlsx', type:'buffer' });
}

// ── Main ──
async function main() {
  const today = todayBD();
  const dateLabel = todayLabel();
  const todayDow = getDayOfWeek();
  const now = new Date(new Date().getTime() + 6 * 60 * 60 * 1000);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  console.log(`Sending daily report for: ${today}`);

  try {
    const companiesSnap = await db.ref('companies').get();
    if (!companiesSnap.exists()) { console.log('No companies'); return; }
    const companies = companiesSnap.val();

    for (const [coId, co] of Object.entries(companies)) {
      if (co.status === 'inactive') { console.log(`Skip inactive: ${co.name}`); continue; }
      
      // Skip on company holiday
      const holidays = co.holidays || [0];
      if (holidays.includes(todayDow)) { console.log(`Skip holiday for: ${co.name}`); continue; }

      console.log(`Processing: ${co.name}`);
      const adminSnap = await db.ref(`users/${co.admin_uid}`).get();
      if (!adminSnap.exists()) continue;
      const adminEmail = adminSnap.val().email;
      if (!adminEmail) continue;

      // CC emails
      const ccEmails = co.cc_emails || [];

      // Get salesmen
      const usersSnap = await db.ref('users').orderByChild('company_id').equalTo(coId).get();
      if (!usersSnap.exists()) continue;
      const allUsers = Object.entries(usersSnap.val())
        .filter(([,u]) => u.role === 'salesman' && u.status !== 'deleted_by_admin');

      const salesUsers = allUsers.filter(([,u]) => u.emp_type !== 'backoffice');
      const boUsers = allUsers.filter(([,u]) => u.emp_type === 'backoffice');

      // Get today's data
      const vSnap = await db.ref(`visits/${coId}/${today}`).get();
      const visits = vSnap.exists() ? vSnap.val() : {};
      const attSnap = await db.ref(`attendance/${coId}/${today}`).get();
      const att = attSnap.exists() ? attSnap.val() : {};

      const buildRows = async (users) => {
        return Promise.all(users.map(async ([uid, sm]) => {
          const smVisits = Object.values(visits).filter(v => v.salesman_uid === uid);
          const smAtt = att[uid] || null;
          let duration = '—';
          if (smAtt && smAtt.start_timestamp && smAtt.end_timestamp) {
            const diff = smAtt.end_timestamp - smAtt.start_timestamp;
            duration = `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m`;
          }
          return {
            name: sm.name,
            status: smAtt ? 'present' : 'absent',
            visits: smVisits.length,
            startTime: smAtt ? smAtt.start_time : null,
            endTime: smAtt ? smAtt.end_time : null,
            duration,
            visitDetails: smVisits.sort((a,b)=>a.timestamp-b.timestamp).map(v=>({outlet:v.outlet,time:v.time,remarks:v.remarks||''}))
          };
        }));
      };

      const salesRows = await buildRows(salesUsers);
      const boRows = await buildRows(boUsers);
      
      salesRows.sort((a,b) => a.status===b.status ? b.visits-a.visits : a.status==='present'?-1:1);
      boRows.sort((a,b) => a.status==='present'?-1:1);

      // Build MTD attendance data for attachment
      const attMonthData = [];
      for (let d = 1; d <= now.getDate(); d++) {
        const ds = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayDow = new Date(currentYear, currentMonth, d).getDay();
        if (holidays.includes(dayDow)) continue;
        const dayAttSnap = await db.ref(`attendance/${coId}/${ds}`).get();
        const dayAtt = dayAttSnap.exists() ? dayAttSnap.val() : {};
        for (const [uid, u] of allUsers) {
          const empAtt = dayAtt[uid] || null;
          let dur = '—';
          if (empAtt && empAtt.start_timestamp && empAtt.end_timestamp) {
            const diff = empAtt.end_timestamp - empAtt.start_timestamp;
            dur = `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m`;
          }
          attMonthData.push([u.emp_type==='backoffice'?'Back Office':'Sales', u.name, ds,
            empAtt?empAtt.start_time:'—', empAtt?empAtt.end_time:'—', dur, empAtt?'Present':'Absent']);
        }
      }

      const html = buildEmail(co.name, dateLabel, salesRows, boRows);
      const excelBuf = buildExcelAttachment(co.name, today, currentMonth, currentYear, salesRows, boRows, attMonthData);
      const totalVisits = salesRows.reduce((s,r)=>s+r.visits,0);
      const presentCount = [...salesRows,...boRows].filter(r=>r.status==='present').length;

      await transporter.sendMail({
        from: `"SunStar Solutions" <${process.env.EMAIL_USER}>`,
        to: adminEmail,
        cc: ccEmails.length ? ccEmails.join(',') : undefined,
        subject: `📊 Daily Report — ${co.name} — ${today} (${presentCount} Present, ${totalVisits} Visits)`,
        html,
        attachments: [{
          filename: `${co.name}_Report_${today}.xlsx`,
          content: excelBuf,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }]
      });
      console.log(`✅ Email sent to ${adminEmail}${ccEmails.length?' (CC: '+ccEmails.join(', ')+')':''} for ${co.name}`);
    }
    console.log('All reports sent!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
  process.exit(0);
}
main();
