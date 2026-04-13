// ══════════════════════════════════════════════════════════════
// SunStar Solutions — Daily Email Report
// GitHub Actions: runs at 18:30 UTC = 12:00 AM IST
// Sends attendance + visit summary per company via Gmail/Nodemailer
// ══════════════════════════════════════════════════════════════

const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// ── Firebase init ──────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://sunstar-solutions-default-rtdb.asia-southeast1.firebasedatabase.app",
});
const db = admin.database();

// ── Nodemailer transporter ─────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// ── Helpers ────────────────────────────────────────────────────
function todayIST() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000); // UTC → IST
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayOfWeekIST() {
  // 0=Sun,1=Mon,...,6=Sat
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.getUTCDay();
}

function fmt(val) {
  return val || "—";
}

// ── Build HTML email ───────────────────────────────────────────
function buildEmailHtml(coName, date, salesRows, boRows, totalIn, totalOut, totalPending, totalVisits) {
  const hasData = salesRows.length > 0 || boRows.length > 0;

  const style = `
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
    .wrap { max-width: 800px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
    .header { background: linear-gradient(135deg, #06091A 0%, #0C1229 100%); padding: 28px 32px; border-bottom: 3px solid #EFA800; }
    .header-logo { color: #EFA800; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .header-sub { color: #7A8DB8; font-size: 13px; margin-top: 4px; }
    .header-co { color: #F0F4FF; font-size: 17px; font-weight: 700; margin-top: 8px; }
    .summary { display: flex; gap: 0; border-bottom: 1px solid #e8eaf0; }
    .card { flex: 1; padding: 18px 20px; text-align: center; border-right: 1px solid #e8eaf0; }
    .card:last-child { border-right: none; }
    .card-num { font-size: 28px; font-weight: 800; color: #06091A; }
    .card-lbl { font-size: 11px; color: #7A8DB8; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 3px; }
    .card-in .card-num { color: #1FD17A; }
    .card-out .card-num { color: #4B9FFF; }
    .card-pend .card-num { color: #FF9900; }
    .card-vis .card-num { color: #EFA800; }
    .section { padding: 0 24px 24px; }
    .section-title { font-size: 14px; font-weight: 700; color: #06091A; padding: 18px 0 10px; border-bottom: 2px solid #EFA800; margin-bottom: 0; display: flex; align-items: center; gap: 8px; }
    .section-title span { background: #EFA800; color: #06091A; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #06091A; color: #EFA800; padding: 10px 12px; text-align: left; font-weight: 700; font-size: 12px; letter-spacing: 0.4px; }
    td { padding: 9px 12px; border-bottom: 1px solid #f0f2f5; color: #2d3748; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #f8f9fc; }
    .status-in { color: #1FD17A; font-weight: 700; }
    .status-out { color: #4B9FFF; font-weight: 700; }
    .status-pend { color: #FF9900; font-weight: 700; }
    .status-visit { color: #EFA800; font-weight: 700; }
    .no-data { text-align: center; padding: 24px; color: #9ca3af; font-style: italic; font-size: 13px; }
    .footer { background: #f8f9fc; padding: 16px 24px; text-align: center; color: #9ca3af; font-size: 11px; border-top: 1px solid #e8eaf0; }
  `;

  const summaryCards = `
    <div class="summary">
      <div class="card card-in"><div class="card-num">${totalIn}</div><div class="card-lbl">✅ Checked In</div></div>
      <div class="card card-out"><div class="card-num">${totalOut}</div><div class="card-lbl">🚪 Checked Out</div></div>
      <div class="card card-pend"><div class="card-num">${totalPending}</div><div class="card-lbl">⚠️ Pending</div></div>
      <div class="card card-vis"><div class="card-num">${totalVisits}</div><div class="card-lbl">📍 Total Visits</div></div>
    </div>
  `;

  function buildTable(rows, isSales) {
    if (rows.length === 0) {
      return `<div class="no-data">No records found</div>`;
    }
    const visitCols = isSales
      ? `<th>Outlet</th><th>Remarks</th>`
      : ``;

    const headerRow = `<tr>
      <th>#</th><th>Name</th><th>Status</th><th>Time</th>${visitCols}
    </tr>`;

    const bodyRows = rows.map((r, i) => {
      let statusHtml = r.status;
      if (r.status === "In") statusHtml = `<span class="status-in">✅ In</span>`;
      else if (r.status === "Out") statusHtml = `<span class="status-out">🚪 Out</span>`;
      else if (r.status === "Pending") statusHtml = `<span class="status-pend">⚠️ Pending</span>`;
      else if (r.status === "Visit") statusHtml = `<span class="status-visit">📍 Visit</span>`;

      const extraCols = isSales
        ? `<td>${fmt(r.outlet)}</td><td style="max-width:200px;">${fmt(r.remarks)}</td>`
        : ``;

      return `<tr>
        <td style="color:#9ca3af;font-size:11px;">${i + 1}</td>
        <td style="font-weight:600;">${fmt(r.name)}</td>
        <td>${statusHtml}</td>
        <td style="white-space:nowrap;">${fmt(r.time)}</td>
        ${extraCols}
      </tr>`;
    }).join("");

    return `<table>${headerRow}${bodyRows}</table>`;
  }

  const salesSection = `
    <div class="section-title">📊 Sales Employees <span>${salesRows.length} records</span></div>
    ${buildTable(salesRows, true)}
  `;

  const boSection = `
    <div class="section-title">🖥️ Back Office Employees <span>${boRows.length} records</span></div>
    ${buildTable(boRows, false)}
  `;

  const noDataSection = `<div class="no-data" style="padding:36px;">No attendance or visit data recorded today.</div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${style}</style></head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="header-logo">☀️ SunStar Solutions</div>
      <div class="header-sub">Daily Field Force Report</div>
      <div class="header-co">🏢 ${coName} &nbsp;|&nbsp; 📅 ${date}</div>
    </div>
    ${hasData ? summaryCards : ""}
    <div class="section">
      ${hasData ? salesSection + boSection : noDataSection}
    </div>
    <div class="footer">
      Generated automatically by SunStar Solutions &bull; ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
    </div>
  </div>
</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const date = todayIST();
  const dow = dayOfWeekIST(); // 0=Sun … 6=Sat

  console.log(`[SunStar Report] Running for date: ${date}`);

  // Load all companies
  const coSnap = await db.ref("companies").get();
  if (!coSnap.exists()) {
    console.log("No companies found.");
    return;
  }
  const companies = coSnap.val();

  for (const [coId, co] of Object.entries(companies)) {
    const coName = co.name || coId;

    // ── Skip if mail not required ──────────────────────────────
    if (co.mail_required === false) {
      console.log(`[${coName}] mail_required=false → skipping`);
      continue;
    }

    // ── Skip if no CC emails configured ───────────────────────
    const ccEmails = (co.cc_emails || []).filter(Boolean);
    if (ccEmails.length === 0) {
      console.log(`[${coName}] No CC emails configured → skipping`);
      continue;
    }

    // ── Skip if today is a company holiday ────────────────────
    const holidays = co.holidays || [];
    if (holidays.includes(dow)) {
      console.log(`[${coName}] Today (dow=${dow}) is a holiday → skipping`);
      continue;
    }

    // ── Load employees ────────────────────────────────────────
    const usersSnap = await db
      .ref("users")
      .orderByChild("company_id")
      .equalTo(coId)
      .get();
    const users = {};
    if (usersSnap.exists()) {
      Object.entries(usersSnap.val()).forEach(([uid, u]) => {
        if (u.status !== "deleted_by_admin") users[uid] = u;
      });
    }

    // ── Load attendance ───────────────────────────────────────
    const attSnap = await db.ref(`attendance/${coId}/${date}`).get();
    const attendance = attSnap.exists() ? attSnap.val() : {};

    // ── Load visits ───────────────────────────────────────────
    const visSnap = await db.ref(`visits/${coId}/${date}`).get();
    const visits = visSnap.exists() ? visSnap.val() : {};

    // ── Build rows ────────────────────────────────────────────
    const salesRows = [];
    const boRows = [];
    let totalIn = 0, totalOut = 0, totalPending = 0, totalVisits = 0;

    // Attendance rows
    for (const [uid, att] of Object.entries(attendance)) {
      const u = users[uid];
      if (!u) continue;
      const isSales = u.emp_type !== "backoffice";
      const target = isSales ? salesRows : boRows;
      const name = u.name || "Unknown";

      if (att.start_time) {
        target.push({ name, status: "In", time: att.start_time, outlet: "—", remarks: "Day Started" });
        totalIn++;
      }
      if (att.end_time) {
        target.push({ name, status: "Out", time: att.end_time, outlet: "—", remarks: "Day Ended" });
        totalOut++;
      } else if (att.start_time) {
        target.push({ name, status: "Pending", time: "—", outlet: "—", remarks: "Not Checked Out" });
        totalPending++;
      }
    }

    // Visit rows (Sales only)
    for (const v of Object.values(visits)) {
      const u = users[v.salesman_uid];
      const name = (u && u.name) || v.salesman_name || "Unknown";
      salesRows.push({
        name,
        status: "Visit",
        time: v.time || "—",
        outlet: v.outlet || "—",
        remarks: v.remarks || "—",
      });
      totalVisits++;
    }

    // Sort by time within each group
    const byTime = (a, b) => (a.time > b.time ? 1 : -1);
    salesRows.sort(byTime);
    boRows.sort(byTime);

    // ── Build & send email ────────────────────────────────────
    const html = buildEmailHtml(
      coName, date, salesRows, boRows,
      totalIn, totalOut, totalPending, totalVisits
    );

    const adminEmail = co.admin_uid ? null : null; // admin_uid is uid, not email
    const toAddresses = ccEmails.join(", ");

    const mailOptions = {
      from: `"SunStar Solutions" <${process.env.GMAIL_USER}>`,
      to: toAddresses,
      subject: `📋 Daily Report — ${coName} — ${date}`,
      html,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`[${coName}] ✅ Email sent to: ${toAddresses}`);
    } catch (err) {
      console.error(`[${coName}] ❌ Email failed:`, err.message);
    }
  }

  console.log("[SunStar Report] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
