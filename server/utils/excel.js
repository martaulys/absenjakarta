const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const FILL_WARN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCDD2' } }; // merah muda
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

async function buildAttendanceWorkbook({ attendanceRows, leaveRows, baseUrl }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Riwayat Absen', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Nama Lengkap', key: 'name', width: 26 },
    { header: 'NIK/NIP', key: 'nik', width: 16 },
    { header: 'Tanggal', key: 'date', width: 20 },
    { header: 'Jenis', key: 'jenis', width: 16 },
    { header: 'Catatan/Keterangan', key: 'catatan', width: 34 },
    { header: 'Bukti/Foto', key: 'bukti', width: 16 },
    { header: 'Status', key: 'status', width: 26 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'G1' };

  attendanceRows.forEach((row) => {
    const excelRow = sheet.addRow({
      name: row.name,
      nik: row.nik || row.nip || '-',
      date: row.timestamp,
      jenis: row.type === 'masuk' ? 'Absen Masuk' : 'Absen Pulang',
      catatan: row.note || '-',
      bukti: '',
      status: row.fake_gps_flag ? `Terindikasi Fake GPS: ${row.fake_gps_reasons || ''}` : 'Normal',
    });
    proofLink(sheet, `F${excelRow.number}`, baseUrl, row.photo_path, 'Lihat Foto');
    styleDataRow(excelRow);
    excelRow.getCell('jenis').fill = FILL_OK;
    if (row.fake_gps_flag) {
      excelRow.getCell('status').fill = FILL_WARN;
    }
  });

  leaveRows.forEach((row) => {
    const excelRow = sheet.addRow({
      name: row.name,
      nik: row.nik || row.nip || '-',
      date: `${row.start_date} s.d. ${row.end_date}`,
      jenis: row.type === 'sakit' ? 'Sakit' : 'Izin',
      catatan: row.reason || '-',
      bukti: '',
      status: row.status === 'approved' ? 'Disetujui' : row.status === 'rejected' ? 'Ditolak' : 'Pending',
    });
    proofLink(sheet, `F${excelRow.number}`, baseUrl, row.proof_path, 'Lihat Bukti');
    styleDataRow(excelRow);
    excelRow.getCell('jenis').fill = FILL_WARN;
    if (row.status === 'pending') {
      excelRow.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
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
    excelRow.getCell('status').fill = emp.active ? FILL_OK : FILL_WARN;
  });

  return workbook;
}

module.exports = { buildAttendanceWorkbook, buildEmployeeWorkbook };
