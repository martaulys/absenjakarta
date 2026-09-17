/** Format the current time as 'YYYY-MM-DD HH:mm:ss' in Asia/Jakarta (WIB, UTC+7). */
function nowJakartaSql() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

/** Today's date as 'YYYY-MM-DD' in Asia/Jakarta. */
function todayJakarta() {
  return nowJakartaSql().split(' ')[0];
}

module.exports = { nowJakartaSql, todayJakarta };
