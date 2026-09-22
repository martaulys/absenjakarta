const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const FILL_RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCDD2' } }; // merah muda - libur/kosong
const FILL_OK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBDEFB' } }; // biru muda
const BORDER = { style: 'thin', color: { argb: 'FFE0E4E9' } };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  });
  row.height = 22;
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  });
}

function proofLink(sheet, cellRef, baseUrl, relativePath, label) {
  if (!relativePath) {
    sheet.getCell(cellRef).value = '-';
    return;
  }
  sheet.getCell(cellRef).value = {
    text: label,
    hyperlink: `${baseUrl}/uploads/${relativePath}`,
  };
  sheet.getCell(cellRef).font = { color: { argb: 'FF1565C0' }, underline: true };
}

/**
 * @param {object} p
 * @param {Array<object>} p.rows - one row per employee+date, shaped by buildAttendanceMatrix() in routes/admin.js
 * @param {string} p.baseUrl
 */
async function buildAttendanceWorkbook({ rows, baseUrl }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Riwayat Absen', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Nama', key: 'name', width: 24 },
    { header: 'NIK', key: 'nik', width: 14 },
    { header: 'Tanggal', key: 'date', width: 22 },
    { header: 'Jam Absen Masuk', key: 'jamMasuk', width: 15 },
    { header: 'Jam Absen Pulang', key: 'jamPulang', width: 15 },
    { header: 'Lokasi', key: 'lokasi', width: 20 },
    { header: 'Catatan', key: 'catatan', width: 28 },
    { header: 'Latitude', key: 'lat', width: 14 },
    { header: 'Longitude', key: 'lng', width: 14 },
    { header: 'Bukti Foto', key: 'bukti', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'K1' };

  rows.forEach((r) => {
    const excelRow = sheet.addRow({
      name: r.name,
      nik: r.nik || '-',
      date: r.dateLabel,
      jamMasuk: r.jamMasuk || '',
      jamPulang: r.jamPulang || '',
      lokasi: r.lokasi || '-',
      catatan: r.catatan || '-',
      lat: r.lat != null ? r.lat : '-',
      lng: r.lng != null ? r.lng : '-',
      bukti: '',
      status: r.status || '-',
    });
    proofLink(sheet, `J${excelRow.number}`, baseUrl, r.photoPath, 'Lihat Foto');
    styleDataRow(excelRow);

    if (r.isNonWorking) {
      // Hari libur (Sabtu/Minggu atau tanggal merah) - seluruh baris ditandai merah
      excelRow.eachCell((cell) => {
        cell.fill = FILL_RED;
      });
    } else {
      if (!r.jamMasuk) {
        excelRow.getCell('date').fill = FILL_RED;
        excelRow.getCell('jamMasuk').fill = FILL_RED;
      }
      if (!r.jamPulang) {
        excelRow.getCell('date').fill = FILL_RED;
        excelRow.getCell('jamPulang').fill = FILL_RED;
      }
      if (r.status === 'Terindikasi') {
        excelRow.getCell('status').fill = FILL_RED;
      } else if (r.status === 'Normal') {
        excelRow.getCell('status').fill = FILL_OK;
      }
    }
  });

  return workbook;
}

async function buildEmployeeWorkbook({ employees }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data Karyawan', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Nama Lengkap', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'NIK', key: 'nik', width: 16 },
    { header: 'NIP', key: 'nip', width: 16 },
    { header: 'Jabatan', key: 'position', width: 18 },
    { header: 'Lokasi', key: 'location', width: 22 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Tanggal Keluar', key: 'exitDate', width: 16 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  employees.forEach((emp) => {
    const excelRow = sheet.addRow({
      name: emp.name,
      email: emp.email,
      nik: emp.nik || '-',
      nip: emp.nip || '-',
      position: emp.position_name || '-',
      location: emp.location_name || '-',
      status: emp.active ? 'Aktif' : 'Non-aktif',
      exitDate: emp.exit_date || '-',
    });
    styleDataRow(excelRow);
    excelRow.getCell('status').fill = emp.active ? FILL_OK : FILL_RED;
  });

  return workbook;
}

module.exports = { buildAttendanceWorkbook, buildEmployeeWorkbook };
