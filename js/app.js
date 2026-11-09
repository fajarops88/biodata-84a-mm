'use strict';
/* =====================================================================
 * SPA BIODATA KELAS S2 MM
 * Satu URL (/exec). Navigasi hanya lewat navigateTo() — tanpa
 * window.location / window.open / ?page=. Token sesi disimpan di memori.
 * Backend: Google Apps Script (REST via fetch POST); alamatnya ada di js/config.js.
 * ===================================================================== */

const AppState = {
  token: null, email: null, isAdmin: false, isUtama: false, me: null,
  stats: { approved: 0 }, members: null, adminData: null,
  page: 'beranda', tab: 'Menunggu', q: '', fotoData: null, editId: null,
  chatMessages: [], chatUnread: 0,
  kuliahTab: 'chat', materi: null, materiFilter: '', tentangTab: 'sambutan', pgFiles: { lampiran: [], instruksi: [] }, pgUnggah: 0,
  publik: null, agenda: { pub: null, adm: null }, profilAdmin: null, jadwalAdmin: null,
  menu: { akses: {}, pesan: {} }, menuAdm: null, pasar: null, pasarKontak: null, pasarSaya: null, pasarAdm: null, pasarF: { jenis: '', kat: '', q: '' }, etCtx: 'saya', etFoto: { lama: [], baru: [] }
};

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => String(n || '?').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean)
  .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const waNum = hp => { const d = String(hp).replace(/\D/g, ''); return d.startsWith('0') ? '62' + d.slice(1) : d; };
const tgl = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); };

const FIELD_DEFS = [ // [nama, label, ikon, contoh, tipe]
  ['NamaLengkap', 'Nama lengkap & gelar', 'badge', 'Contoh: Rina Wulandari, S.E.', 'text'],
  ['NamaPanggilan', 'Nama panggilan', 'tag', 'Contoh: Rina', 'text'],
  ['NIM', 'NIM', 'pin', 'Contoh: 22020000001', 'text'],
  ['AsalKota', 'Asal kota', 'location_on', 'Contoh: Balikpapan', 'text'],
  ['Provinsi', 'Provinsi', 'map', 'Contoh: Kalimantan Timur', 'text'],
  ['TempatKerja', 'Tempat kerja', 'apartment', 'Contoh: Dinas Perhubungan Kota', 'text'],
  ['Jabatan', 'Jabatan', 'work', 'Contoh: Kepala Seksi', 'text'],
  ['NomorHP', 'Nomor HP / WhatsApp', 'phone_iphone', '081234567890', 'tel'],
  ['Hobi', 'Hobi', 'interests', 'Contoh: Bersepeda, membaca', 'text']
];

/* ---------- Komunikasi dengan server (fetch ke Google Apps Script) ---------- */
const GAS_URL = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
const WAKTU_HABIS_MS = 120000; // unggah file besar butuh waktu
const BACA_SAJA = /^api_(boot|me|members|matkul|tugasSaya|chatPesan|materi|pengumuman|pengumumanAdmin|publik|agenda|notifKonfig|notifAudience|blastDaftar|notifAntrean|pasar|pasarKontak|pasarSaya|pasarAdmin|menuAdmin)$/;
const _inflight = {};
let _epochTulis = 0;

function api(fn, ...args) {
  if (!GAS_URL || /GANTI|XXXX/.test(GAS_URL)) {
    return Promise.reject(new Error('Konfigurasi belum lengkap: isi GAS_URL di js/config.js.'));
  }
  if (!BACA_SAJA.test(fn)) { _epochTulis++; return kirimApi(fn, args); }
  // permintaan baca yang identik dan sedang berjalan digabung (hemat eksekusi server)
  const kunci = _epochTulis + '|' + fn + '|' + JSON.stringify(args);
  if (_inflight[kunci]) return _inflight[kunci];
  const p = kirimApi(fn, args);
  _inflight[kunci] = p;
  const bersih = () => { delete _inflight[kunci]; };
  p.then(bersih, bersih);
  return p;
}

async function kirimApi(fn, args) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WAKTU_HABIS_MS);
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      // text/plain menghindari preflight CORS yang tidak didukung Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      signal: ctl.signal
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'Server terlalu lama menjawab. Coba lagi.' : 'Koneksi gagal. Periksa internet Anda lalu coba lagi.');
  } finally { clearTimeout(timer); }
  let r;
  try { r = await res.json(); } catch (e) { throw new Error('Jawaban server tidak dapat dibaca. Coba lagi sebentar lagi.'); }
  if (r && r.ok) return r.data;
  throw new Error((r && r.msg) || 'Terjadi kesalahan.');
}
const call = (fn, ...a) => api(fn, AppState.token, ...a);

/* Bangunkan server Apps Script sejak halaman dibuka (tanpa menunggu pengguna menekan tombol) */
function panaskanServer() {
  try {
    if (!GAS_URL || /GANTI|XXXX/.test(GAS_URL)) return;
    if (sessionStorage.getItem('panas') && Date.now() - Number(sessionStorage.getItem('panas')) < 240000) return;
    sessionStorage.setItem('panas', String(Date.now()));
    fetch(GAS_URL + '?w=1', { mode: 'no-cors' }).catch(() => {});
  } catch (e) { /* abaikan */ }
}

/* ---------- Sesi ---------- */
function applySession(r) {
  if (r.token) AppState.token = r.token;
  AppState.email = r.email; AppState.isAdmin = r.isAdmin; AppState.isUtama = !!r.isUtama; AppState.me = r.me;
  if (AppState.token) startChatPolling();
}
function resetSession() {
  stopChatPolling();
  Object.assign(AppState, { token: null, email: null, isAdmin: false, isUtama: false, me: null, members: null, adminData: null, fotoData: null, chatMessages: [], chatUnread: 0, materi: null, profilAdmin: null, jadwalAdmin: null, notifCfg: null, pengumuman: null, pengumumanAdm: null, notifAud: null, blastList: null, blastPilih: null, notifAnt: null, pasarKontak: null, pasarSaya: null, pasarAdm: null, menuAdm: null });
  AppState.agenda.adm = null;
}
function handleAuthError(e) {
  if (e && e.message === 'SESI_HABIS') {
    resetSession(); toast('Sesi berakhir. Silakan masuk lagi.', 'error'); navigateTo('beranda'); return true;
  }
  return false;
}
function fail(e) { if (!handleAuthError(e)) toast(e.message, 'error'); }
const isApproved = () => AppState.isAdmin || (AppState.me && AppState.me.Status === 'Disetujui');
const landing = () => (isApproved() ? 'teman' : AppState.me ? 'status' : 'formulir');

async function doLogin(ev) {
  ev.preventDefault();
  const f = ev.target, btn = f.querySelector('[type=submit]');
  setBusy(btn, true, 'Memeriksa…');
  try {
    applySession(await api('api_login', f.email.value, f.pin.value));
    closeModal();
    toast('Selamat datang!');
    navigateTo(landing());
  } catch (e) { fail(e); setBusy(btn, false); }
}
function doLogout() {
  const t = AppState.token; resetSession();
  if (t) api('api_logout', t).catch(() => {});
  navigateTo('beranda');
}

function bukaGantiPin() {
  openModal('<form class="p-5" onsubmit="kirimGantiPin(event)"><h2 class="text-lg font-bold">Ganti PIN</h2>'
    + '<p class="mt-1 text-sm text-slate-600">PIN dipakai untuk masuk kembali. Jangan bagikan ke siapa pun.</p>'
    + '<div class="mt-4 space-y-3">'
    + '<div><label class="lbl" for="pinLama">PIN saat ini</label><input id="pinLama" class="inp" type="password" inputmode="numeric" pattern="\\d{6,12}" required autocomplete="current-password" data-autofocus></div>'
    + '<div><label class="lbl" for="pinBaru">PIN baru (6–12 angka)</label><input id="pinBaru" class="inp" type="password" inputmode="numeric" pattern="\\d{6,12}" required autocomplete="new-password"></div>'
    + '<div><label class="lbl" for="pinBaru2">Ulangi PIN baru</label><input id="pinBaru2" class="inp" type="password" inputmode="numeric" required autocomplete="new-password"></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-primary">Simpan PIN</button></div></form>');
}
async function kirimGantiPin(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  const lama = $('pinLama').value, baru = $('pinBaru').value, baru2 = $('pinBaru2').value;
  if (baru !== baru2) return toast('PIN baru dan ulangi PIN tidak sama.', 'error');
  setBusy(btn, true, 'Menyimpan…');
  try { await call('api_changePin', lama, baru); closeModal(); toast('PIN berhasil diganti.'); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---------- Logo aplikasi (khusus admin) ---------- */
let logoData = null;
function setLogo(url) {
  const box = $('logoBox'); if (!box) return;
  const old = box.querySelector('img'); if (old) old.remove();
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = 'Logo'; img.loading = 'lazy';
    img.className = 'absolute inset-0 h-full w-full bg-white object-cover';
    img.onerror = () => img.remove();
    box.appendChild(img);
  }
}
function bukaGantiLogo() {
  logoData = null;
  const ada = !!AppState.stats.logoUrl;
  openModal('<form class="p-5" onsubmit="kirimGantiLogo(event)"><h2 class="text-lg font-bold">Ganti Logo Aplikasi</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Logo akan tampil di header menggantikan ikon bawaan. Gunakan gambar persegi (JPG/PNG/WebP).</p>'
    + '<div class="mt-4 text-center"><div class="relative mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-2xl bg-primary-soft text-primary ring-4 ring-gold-soft">'
    + '<span class="material-symbols-outlined !text-4xl">school</span>'
    + '<img id="logoPrev" alt="Pratinjau logo" class="absolute inset-0 h-full w-full bg-white object-cover ' + (ada ? '' : 'hidden') + '" src="' + esc(AppState.stats.logoUrl || '') + '" onerror="this.classList.add(\'hidden\')"></div>'
    + '<input id="logoInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onchange="pickLogo(this)" data-autofocus>'
    + '<label for="logoInput" class="btn btn-ghost mt-3"><span class="material-symbols-outlined">upload</span>Pilih Gambar</label></div>'
    + '<div class="mt-5 flex flex-wrap justify-end gap-2">'
    + (ada ? '<button type="button" class="btn btn-ghost !text-red-700" onclick="hapusLogo()">Hapus Logo</button>' : '')
    + '<button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button type="submit" class="btn btn-primary">Simpan Logo</button></div></form>');
}
async function pickLogo(inp) {
  const f = inp.files[0]; if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Gunakan gambar JPG, PNG, atau WebP.', 'error'); inp.value = ''; return; }
  if (f.size > 15 * 1024 * 1024) { toast('Ukuran gambar maksimal 15 MB.', 'error'); inp.value = ''; return; }
  try {
    logoData = await compressImage(f);
    const p = $('logoPrev'); p.src = logoData; p.classList.remove('hidden');
  } catch (e) { toast(e.message, 'error'); }
}
async function kirimGantiLogo(ev) {
  ev.preventDefault();
  if (!logoData) return toast('Pilih gambar logo terlebih dahulu.', 'error');
  const btn = ev.target.querySelector('[type=submit]');
  setBusy(btn, true, 'Menyimpan…');
  try {
    const url = await call('api_setLogo', logoData);
    AppState.stats.logoUrl = url; setLogo(url); closeModal(); toast('Logo berhasil diganti.');
  } catch (e) { setBusy(btn, false); fail(e); }
}
async function hapusLogo() {
  try { await call('api_hapusLogo'); AppState.stats.logoUrl = ''; setLogo(''); closeModal(); toast('Logo dihapus, kembali ke ikon bawaan.'); }
  catch (e) { fail(e); }
}

/* ---------- Kontak WA bantuan (khusus admin) ---------- */
function bukaGantiWa() {
  const ada = !!AppState.stats.waBantuan;
  openModal('<form class="p-5" onsubmit="kirimGantiWa(event)"><h2 class="text-lg font-bold">Kontak WhatsApp Bantuan</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Nomor ini akan tampil sebagai tombol bantuan di Beranda, untuk teman yang kesulitan saat mendaftar.</p>'
    + '<div class="mt-4"><label class="lbl" for="waNomor">Nomor WhatsApp</label><input id="waNomor" class="inp" type="tel" inputmode="numeric" required data-autofocus placeholder="081234567890" value="' + esc(AppState.stats.waBantuan || '') + '"></div>'
    + '<div class="mt-5 flex flex-wrap justify-end gap-2">'
    + (ada ? '<button type="button" class="btn btn-ghost !text-red-700" onclick="hapusWaBantuan()">Hapus</button>' : '')
    + '<button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button type="submit" class="btn btn-primary">Simpan</button></div></form>');
}
async function kirimGantiWa(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  setBusy(btn, true, 'Menyimpan…');
  try {
    const nomor = await call('api_setWaBantuan', $('waNomor').value.trim());
    AppState.stats.waBantuan = nomor; closeModal(); toast('Kontak WA bantuan disimpan.');
    if (AppState.page === 'beranda') navigateTo('beranda');
  } catch (e) { setBusy(btn, false); fail(e); }
}
async function hapusWaBantuan() {
  try {
    await call('api_hapusWaBantuan'); AppState.stats.waBantuan = ''; closeModal(); toast('Kontak WA bantuan dihapus.');
    if (AppState.page === 'beranda') navigateTo('beranda');
  } catch (e) { fail(e); }
}

/* ---------- Chat Kelas: polling santai (±17-21 detik, jeda saat tab tidak aktif) ---------- */
let chatTimer = null;
function startChatPolling() {
  stopChatPolling();
  chatTimer = setInterval(pollChat, 17000 + Math.floor(Math.random() * 4000));
}
function stopChatPolling() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }
async function pollChat() {
  if (!AppState.token || !isApproved() || document.hidden) return;
  try {
    const list = await call('api_chatPesan');
    const lamaLen = AppState.chatMessages.length;
    AppState.chatMessages = list;
    if (AppState.page === 'kuliah' && AppState.kuliahTab === 'chat') { paintChat(true); }
    else if (list.length > lamaLen) { AppState.chatUnread += (list.length - lamaLen); renderShell(); paintKuliahTabs(); }
  } catch (e) { /* diam, coba lagi siklus berikutnya */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollChat(); });

/* ---------- Utilitas UI ---------- */
function setBusy(btn, on, txt) {
  if (on) {
    btn.dataset.h = btn.innerHTML; btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span>' + esc(txt || 'Memproses…');
  } else { btn.disabled = false; if (btn.dataset.h) btn.innerHTML = btn.dataset.h; }
}
let toastTimer;
function toast(msg, type) {
  const t = $('toast');
  t.className = 'fixed bottom-5 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl '
    + (type === 'error' ? 'bg-red-700' : 'bg-primary');
  t.textContent = msg;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}
function openModal(html) {
  $('modalRoot').innerHTML = '<div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onclick="if(event.target===this)closeModal()">'
    + '<div role="dialog" aria-modal="true" class="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">' + html + '</div></div>';
  const f = document.querySelector('#modalRoot [data-autofocus]'); if (f) f.focus();
}
function closeModal() { $('modalRoot').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

const chip = s => {
  const m = { Menunggu: 'bg-amber-100 text-amber-800', Disetujui: 'bg-emerald-100 text-emerald-800', Ditolak: 'bg-red-100 text-red-800' };
  return '<span class="chip ' + (m[s] || 'bg-slate-100 text-slate-700') + '">' + esc(s) + '</span>';
};
const avatar = (r, cls) => '<div class="relative grid shrink-0 place-items-center overflow-hidden bg-primary-soft font-bold text-primary ' + cls + '"><span>'
  + esc(initials(r.NamaLengkap)) + '</span>'
  + (r.FotoUrl ? '<img src="' + esc(r.FotoUrl) + '" alt="Foto ' + esc(r.NamaPanggilan) + '" loading="lazy" class="absolute inset-0 h-full w-full object-cover" onerror="this.remove()">' : '')
  + '</div>';
const loadingHtml = () => '<div class="grid place-items-center py-24 text-slate-500"><span class="material-symbols-outlined animate-spin !text-4xl text-primary">progress_activity</span><p class="mt-3 text-sm">Memuat…</p></div>';
const lockedHtml = (msg, aksi) => '<div class="card mx-auto max-w-lg p-8 text-center"><span class="material-symbols-outlined !text-4xl text-gold">lock</span>'
  + '<h2 class="mt-3 text-lg font-bold">Akses belum tersedia</h2><p class="mt-1 text-sm text-slate-600">' + esc(msg) + '</p>'
  + (aksi || '<button class="btn btn-primary mt-5" onclick="navigateTo(\'beranda\')">Kembali ke Beranda</button>') + '</div>';

/* ---------- Pengaturan menu (diatur admin: semua / anggota / ditutup) ---------- */
const MENU_NAMA = { tentang: 'Tentang', pasar: 'Pasar', teman: 'Daftar Teman', kuliah: 'Kuliah', formulir: 'Biodata (Isi Biodata / Biodata Saya)', status: 'Status',
  kuliah_chat: 'Kuliah › Chat', kuliah_absen: 'Kuliah › Absen', kuliah_tugas: 'Kuliah › Tugas', kuliah_materi: 'Kuliah › Materi' };
const MENU_BAWAAN = { tentang: 'semua', pasar: 'anggota', teman: 'anggota', kuliah: 'anggota', formulir: 'semua', status: 'anggota', kuliah_chat: 'anggota', kuliah_absen: 'anggota', kuliah_tugas: 'anggota', kuliah_materi: 'anggota' };
const aksesMenu = k => ((AppState.menu && AppState.menu.akses) || {})[k] || MENU_BAWAAN[k] || 'semua';
const menuTampil = k => { const a = aksesMenu(k); return a === 'semua' || (a === 'anggota' && !!AppState.token); };
const menuBoleh = k => AppState.isAdmin || menuTampil(k);
function tutupHtml(k) {
  const pes = ((AppState.menu && AppState.menu.pesan) || {})[k] || (k.indexOf('kuliah_') === 0 ? 'Bagian ini sedang ditutup oleh admin.' : 'Menu ini sedang ditutup oleh admin.');
  return '<div class="card mx-auto max-w-lg p-8 text-center"><span class="material-symbols-outlined !text-4xl text-gold">block</span>'
    + '<h2 class="mt-3 text-lg font-bold">' + esc((MENU_NAMA[k] || 'Menu').split(' (')[0]) + ' sedang ditutup</h2><p class="mt-1 text-sm text-slate-600">' + esc(pes) + '</p>'
    + '<button class="btn btn-primary mt-5" onclick="navigateTo(\'beranda\')">Kembali ke Beranda</button></div>';
}
/** Mengembalikan HTML penghalang bila menu tidak boleh dibuka pengguna ini; null bila boleh. */
function gerbangMenu(k) {
  if (!MENU_NAMA[k] || AppState.isAdmin || menuTampil(k)) return null;
  if (aksesMenu(k) === 'anggota' && !AppState.token) return lockedHtml('Menu ini khusus anggota. Silakan masuk terlebih dahulu.', '<button class="btn btn-primary mt-5" onclick="bukaLogin()">Masuk</button>');
  return tutupHtml(k);
}

/* ---------- Router SPA ---------- */
function navItems() {
  const it = [{ id: 'beranda', icon: 'home', label: 'Beranda' }, { id: 'tentang', icon: 'info', label: 'Tentang' }, { id: 'pasar', icon: 'storefront', label: 'Pasar' }];
  if (AppState.token && isApproved()) it.push({ id: 'teman', icon: 'groups', label: 'Daftar Teman' });
  if (AppState.token && isApproved()) it.push({ id: 'kuliah', icon: 'menu_book', label: 'Kuliah', badge: true });
  it.push({ id: 'formulir', icon: 'badge', label: AppState.me ? 'Biodata Saya' : 'Isi Biodata' });
  if (AppState.me) it.push({ id: 'status', icon: 'rule', label: 'Status' });
  if (AppState.isAdmin) it.push({ id: 'admin', icon: 'admin_panel_settings', label: 'Panel Admin' });
  if (AppState.isAdmin) it.push({ id: 'kelolaAbsensi', icon: 'checklist', label: 'Kelola Absensi' });
  return it.filter(i => !MENU_NAMA[i.id] || menuBoleh(i.id)).map(i => (AppState.isAdmin && MENU_NAMA[i.id] && aksesMenu(i.id) === 'tutup') ? Object.assign({}, i, { tutup: true }) : i);
}
function renderShell() {
  const mk = extra => navItems().map(i => '<button type="button" class="nav-btn relative ' + extra + (i.id === AppState.page ? ' active' : '') + '" onclick="navigateTo(\'' + i.id + '\')"'
    + (i.id === AppState.page ? ' aria-current="page"' : '') + '><span class="material-symbols-outlined">' + i.icon + '</span>' + i.label
    + (i.tutup ? '<span class="material-symbols-outlined !text-base" title="Disembunyikan dari pengguna">visibility_off</span>' : '')
    + (i.badge && AppState.chatUnread ? '<span class="chat-badge">' + (AppState.chatUnread > 99 ? '99+' : AppState.chatUnread) + '</span>' : '') + '</button>').join('');
  $('nav').innerHTML = mk(''); $('navMobile').innerHTML = mk('shrink-0');
  const nama = AppState.me ? AppState.me.NamaPanggilan : (AppState.isAdmin ? 'Admin' : '');
  $('userBox').innerHTML = AppState.token
    ? '<div class="hidden text-right leading-tight sm:block"><div class="text-sm font-semibold">' + esc(nama) + '</div><div class="text-[11px] text-slate-500">'
      + (AppState.isUtama ? 'Admin Utama' : AppState.isAdmin ? 'Admin' : esc(AppState.me ? AppState.me.Status : '')) + '</div></div>'
      + (AppState.isAdmin ? '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaGantiLogo()" aria-label="Ganti Logo"><span class="material-symbols-outlined">image</span><span class="hidden sm:inline">Logo</span></button>' : '')
      + (AppState.isAdmin ? '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaGantiWa()" aria-label="Kontak WA Bantuan"><span class="material-symbols-outlined">support_agent</span><span class="hidden sm:inline">WA</span></button>' : '')
      + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaGantiPin()" aria-label="Ganti PIN"><span class="material-symbols-outlined">key</span><span class="hidden sm:inline">PIN</span></button>'
      + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="doLogout()" aria-label="Keluar"><span class="material-symbols-outlined">logout</span><span class="hidden sm:inline">Keluar</span></button>'
    : '<button type="button" class="btn btn-primary !min-h-[40px] !px-4" onclick="bukaLogin()"><span class="material-symbols-outlined">login</span>Masuk</button>';
}

async function navigateTo(page, opts) {
  opts = opts || {};
  // Tugas, Absensi, Chat, dan Materi kini tab di dalam menu Kuliah; pemanggilan lama tetap diarahkan ke tab yang sesuai.
  const subKuliah = { chat: 'chat', absensi: 'absen', tugas: 'tugas', materi: 'materi' };
  if (subKuliah[page]) { AppState.kuliahTab = subKuliah[page]; page = 'kuliah'; }
  AppState.page = page; AppState.editId = opts.editId || null;
  renderShell();
  const c = $('app-container');
  const gerbang = gerbangMenu(page);
  if (gerbang !== null) { c.innerHTML = gerbang; window.scrollTo({ top: 0 }); return; }
  c.innerHTML = loadingHtml();
  try {
    c.innerHTML = await pages[page](opts);
    if (after[page]) after[page](opts);
    window.scrollTo({ top: 0 });
  } catch (e) { if (!handleAuthError(e)) c.innerHTML = lockedHtml(e.message); }
}

/* ---------- Halaman ---------- */
const pages = {};
const after = {};

/* ---------- Beranda publik: sambutan, visi misi, struktur, agenda ---------- */
const HARI_ID = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const ymdPlus = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tglYmd = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tglSingkat = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const tglPendek = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
function labelPekan(ws, we) {
  const a = new Date(ws + 'T00:00:00Z'), b = new Date(we + 'T00:00:00Z');
  const bln = d => d.toLocaleDateString('id-ID', { timeZone: 'UTC', month: 'long' });
  const ta = a.getUTCFullYear(), tb = b.getUTCFullYear();
  if (a.getUTCMonth() === b.getUTCMonth() && ta === tb) return a.getUTCDate() + ' – ' + b.getUTCDate() + ' ' + bln(b) + ' ' + tb;
  if (ta === tb) return a.getUTCDate() + ' ' + bln(a) + ' – ' + b.getUTCDate() + ' ' + bln(b) + ' ' + tb;
  return a.getUTCDate() + ' ' + bln(a) + ' ' + ta + ' – ' + b.getUTCDate() + ' ' + bln(b) + ' ' + tb;
}
const paragraf = t => String(t || '').split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => '<p>' + esc(x) + '</p>').join('');

function sambutanHtml(p) {
  const k = p.pengurus[0];
  return '<section class="mt-6" aria-labelledby="hSambutan"><div class="card p-6 md:p-8"><div class="flex flex-col gap-5 md:flex-row">'
    + '<div class="flex shrink-0 flex-col items-center text-center md:w-40">'
    + avatar({ NamaLengkap: k.nama || 'Ketua Kelas', NamaPanggilan: k.nama || 'Ketua Kelas', FotoUrl: k.fotoUrl }, 'h-28 w-28 rounded-2xl text-2xl ring-4 ring-gold-soft')
    + '<div class="mt-3 text-sm font-bold">' + esc(k.nama || 'Ketua Kelas') + '</div><div class="text-xs text-slate-500">Ketua Kelas 84A MM</div></div>'
    + '<div class="min-w-0 flex-1"><h2 id="hSambutan" class="flex items-center gap-2 text-xl font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">campaign</span>Sambutan Ketua Kelas</h2>'
    + '<div class="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">' + paragraf(p.sambutan) + '</div></div></div></div></section>';
}

function visiMisiHtml(p) {
  return '<section class="mt-6 grid gap-4 md:grid-cols-2" aria-label="Visi dan Misi">'
    + '<div class="card p-6"><h2 class="flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">visibility</span>Visi</h2>'
    + '<p class="mt-3 text-sm leading-relaxed text-slate-700">' + esc(p.visi) + '</p></div>'
    + '<div class="card p-6"><h2 class="flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">flag</span>Misi</h2>'
    + '<ol class="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">'
    + p.misi.map((m, i) => '<li class="flex gap-3"><span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">' + (i + 1) + '</span><span>' + esc(m) + '</span></li>').join('')
    + '</ol></div></section>';
}

function strukturHtml(p) {
  return '<section class="mt-6" aria-labelledby="hStruktur"><h2 id="hStruktur" class="mb-3 flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">account_tree</span>Struktur Organisasi</h2>'
    + '<div class="grid gap-3 sm:grid-cols-3">'
    + p.pengurus.map(k => '<div class="card pengurus-kartu flex flex-col items-center p-5 text-center">'
      + '<div class="cincin">' + avatar({ NamaLengkap: k.nama || k.peran, NamaPanggilan: k.nama || k.peran, FotoUrl: k.fotoUrl }, 'h-24 w-24 rounded-2xl text-xl') + '</div>'
      + '<div class="mt-3 text-xs font-semibold uppercase text-gold">' + esc(k.peran) + '</div>'
      + '<div class="mt-1 font-bold ' + (k.nama ? '' : 'text-slate-400') + '">' + esc(k.nama || 'Belum ditetapkan') + '</div></div>').join('')
    + '</div></section>';
}

/* ---- Agenda (dipakai di Beranda publik dan di tab Jadwal Kuliah milik admin) ---- */
const menitJam = h => { const m = /^(\d{1,2}):(\d{2})/.exec(h || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const sekarangWita = () => {
  const n = new Date();
  return { ymd: ymdWita(n), menit: menitJam(n.toLocaleTimeString('en-GB', { timeZone: WITA, hour: '2-digit', minute: '2-digit', hour12: false })) };
};
/** Menit selesai sebuah item hari ini: jam selesai; ujian tanpa jam selesai = mulai + 2 jam (maks 23.59). */
function menitAkhirItem(it) {
  const a = menitJam(it.jamSelesai); if (a !== null) return a;
  const m = menitJam(it.jamMulai); return m === null ? null : Math.min(m + 120, 1439);
}
/** 'berlangsung' | 'selesai' | 'akan' | '' menurut jam WITA di perangkat. Batal/pindah tidak pernah menyala. */
function statusWaktu(it) {
  if (!it || it.status === 'batal' || it.status === 'pindah') return '';
  const k = sekarangWita();
  if (it.tanggal < k.ymd) return 'selesai';
  if (it.tanggal > k.ymd) return '';
  if (it.ujian && it.totalHari > 1) return 'berlangsung';
  const mu = menitJam(it.jamMulai), ak = menitAkhirItem(it);
  if (mu === null || ak === null) return 'akan';
  return k.menit < mu ? 'akan' : k.menit < ak ? 'berlangsung' : 'selesai';
}
function teksSisa(menit) {
  const j = Math.floor(menit / 60), m = menit % 60;
  return (j ? j + ' jam ' : '') + (m || !j ? m + ' menit' : '').trim();
}
function sisaItem(it) {
  const ak = menitAkhirItem(it), k = sekarangWita();
  return ak === null ? '' : 'selesai ' + teksSisa(Math.max(1, ak - k.menit)) + ' lagi';
}
function sigAgenda(d) { return d ? d.items.map(statusWaktu).join('|') + '@' + sekarangWita().ymd : ''; }
function agendaItemHtml(it, admin, hariIni) {
  const jam = it.jamMulai ? esc(it.jamMulai) + (it.jamSelesai ? '<span class="block text-xs font-medium text-slate-500">s.d. ' + esc(it.jamSelesai) + '</span>' : '') : 'Seharian';
  let chips = '', judul = '', info = '', redup = '';
  if (it.ujian) {
    chips = '<span class="chip bg-red-600 text-white">' + esc(it.jenis) + '</span>';
    judul = esc(it.judul);
    info = (it.mataKuliah ? esc(it.mataKuliah) : '') + (it.catatan ? (it.mataKuliah ? ' · ' : '') + esc(it.catatan) : '');
  } else {
    judul = esc(it.mataKuliah);
    info = [it.ruang, it.dosen].filter(Boolean).map(esc).join(' · ');
    if (it.status === 'batal') { chips = '<span class="chip anim-kedip bg-red-100 text-red-700">Dibatalkan</span>'; redup = ' opacity-70 agenda-batal'; }
    else if (it.status === 'pindah') { chips = '<span class="chip bg-amber-100 text-amber-800">Dipindah ke ' + esc(tglPendek(it.ke)) + '</span>'; redup = ' opacity-70'; }
    else if (it.status === 'pengganti') chips = '<span class="chip bg-sky-100 text-sky-700">Jadwal pengganti (semula ' + esc(tglPendek(it.dari)) + ')</span>';
    if (it.catatan) info += (info ? ' · ' : '') + esc(it.catatan);
  }
  const garis = (it.status === 'batal' || it.status === 'pindah') ? ' line-through' : '';
  let aksi = '';
  if (admin && !it.ujian && it.jadwalId) {
    const a = '\'' + it.jadwalId + '\',\'' + it.tglAsli + '\'';
    aksi = '<div class="flex flex-wrap gap-1">'
      + (it.status === 'normal'
        ? '<button type="button" class="btn btn-ghost !min-h-[36px] !px-3 !text-red-700" onclick="bukaBatalPertemuan(' + a + ')"><span class="material-symbols-outlined">event_busy</span>Batalkan</button>'
          + '<button type="button" class="btn btn-ghost !min-h-[36px] !px-3" onclick="bukaGeserPertemuan(' + a + ')"><span class="material-symbols-outlined">edit_calendar</span>Geser</button>'
        : '<button type="button" class="btn btn-ghost !min-h-[36px] !px-3" onclick="pulihPertemuan(' + a + ')"><span class="material-symbols-outlined">undo</span>Pulihkan</button>')
      + '</div>';
  }
  const sw = statusWaktu(it); let kelas = '';
  if (sw === 'berlangsung') {
    kelas = ' agenda-berlangsung';
    chips += '<span class="chip bg-primary text-white">Sedang berlangsung</span>';
    if (it.totalHari > 1) chips += '<span class="chip bg-primary-soft text-primary">Hari ke-' + it.hariKe + ' dari ' + it.totalHari + '</span>';
    else info += (info ? ' · ' : '') + '<span class="agenda-sisa font-semibold text-primary" data-id="' + esc(it.tanggal + '|' + it.jamMulai + '|' + it.jamSelesai + '|' + (it.mataKuliah || '')) + '">' + esc(sisaItem(it)) + '</span>';
    if (it.totalHari > 1) info += (info ? ' · ' : '') + 'berakhir ' + esc(tglPendek(it.berakhir));
  } else if (sw === 'selesai') {
    kelas = ' agenda-selesai';
    chips += '<span class="chip bg-slate-100 text-slate-600">Selesai</span>';
  }
  return '<article class="flex flex-wrap items-start gap-3 rounded-xl border border-slate-100 p-3' + redup + kelas + '" data-tgl="' + esc(it.tanggal) + '" data-jm="' + esc(it.jamMulai) + '" data-js="' + esc(it.jamSelesai || '') + '" data-uj="' + (it.ujian ? 1 : 0) + '">'
    + '<div class="w-20 shrink-0 text-sm font-bold text-primary">' + jam + '</div>'
    + '<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2">' + chips + '</div>'
    + '<h4 class="font-bold' + garis + '">' + judul + '</h4>'
    + (info ? '<p class="text-xs text-slate-600">' + info + '</p>' : '') + '</div>' + aksi + '</article>';
}

function agendaBodyHtml(d, admin) {
  if (!d.items.length) {
    return '<div class="card p-8 text-center text-sm text-slate-500"><span class="material-symbols-outlined !text-4xl text-slate-300">event_available</span>'
      + '<p class="mt-2">Tidak ada kuliah atau ujian pada pekan ini.</p></div>';
  }
  const per = {};
  d.items.forEach(it => { (per[it.tanggal] = per[it.tanggal] || []).push(it); });
  return Object.keys(per).sort().map(tgl => '<div class="card p-4"><h3 class="mb-2 flex flex-wrap items-center gap-2 text-sm font-bold">' + esc(tglYmd(tgl))
    + (tgl === d.hariIni ? '<span class="chip bg-primary text-white">Hari ini</span>' : '') + '</h3>'
    + '<div class="space-y-2">' + per[tgl].map(it => agendaItemHtml(it, admin, d.hariIni)).join('') + '</div></div>').join('');
}

function agendaBoxHtml(mode, d) {
  if (!d) return '<div class="card p-6 text-center text-sm text-slate-500">Agenda belum dapat dimuat. Muat ulang halaman sebentar lagi.</div>';
  const btn = (arah, ikon, label) => '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="gantiPekan(\'' + mode + '\',' + arah + ')" aria-label="' + label + '"><span class="material-symbols-outlined">' + ikon + '</span></button>';
  return '<div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-1">'
    + btn(-1, 'chevron_left', 'Pekan sebelumnya')
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="gantiPekan(\'' + mode + '\',0)">Pekan ini</button>'
    + btn(1, 'chevron_right', 'Pekan berikutnya') + '</div>'
    + '<div class="text-sm font-semibold text-slate-700">' + esc(labelPekan(d.weekStart, d.weekEnd)) + '</div></div>'
    + '<div class="space-y-3">' + agendaBodyHtml(d, mode === 'adm') + '</div>';
}
function agendaSectionHtml(d) {
  return '<section class="mt-6" aria-labelledby="hAgenda"><h2 id="hAgenda" class="mb-3 flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">calendar_month</span>Agenda</h2>'
    + '<div id="agenda_pub" data-sig="' + esc(sigAgenda(d)) + '">' + agendaBoxHtml('pub', d) + '</div></section>';
}
function paintAgenda(mode) {
  const box = $('agenda_' + mode); if (!box) return;
  box.innerHTML = agendaBoxHtml(mode, AppState.agenda[mode]); box.style.opacity = '';
  box.dataset.sig = sigAgenda(AppState.agenda[mode]);
}
/** Tiap 30 detik: gambar ulang agenda hanya bila status berubah (mulai/selesai), kalau tidak cukup segarkan teks sisa waktu. */
function tickAgenda() {
  document.querySelectorAll('#pgDaftar [data-tenggat]').forEach(el => { const t = el.getAttribute('data-tenggat'); if (t && Date.parse(t) < Date.now()) el.remove(); });
  ['pub', 'adm'].forEach(mode => {
    const box = $('agenda_' + mode); if (!box || !AppState.agenda[mode]) return;
    if (box.dataset.sig !== sigAgenda(AppState.agenda[mode])) { paintAgenda(mode); return; }
    box.querySelectorAll('.agenda-berlangsung').forEach(el => {
      const sisa = el.querySelector('.agenda-sisa'); if (!sisa) return;
      sisa.textContent = sisaItem({ jamMulai: el.dataset.jm, jamSelesai: el.dataset.js, ujian: el.dataset.uj === '1' });
    });
  });
}
setInterval(tickAgenda, 30000);
let _seqAgenda = 0;
async function gantiPekan(mode, arah) {
  const d = AppState.agenda[mode]; if (!d) return;
  const target = arah === 0 ? '' : ymdPlus(d.weekStart, 7 * arah);
  const seq = ++_seqAgenda, box = $('agenda_' + mode);
  if (box) box.style.opacity = '.5';
  try {
    const baru = mode === 'adm' ? await call('api_agendaAdmin', target) : await api('api_agenda', target);
    if (seq !== _seqAgenda) return;
    AppState.agenda[mode] = baru; paintAgenda(mode);
  } catch (e) { if (box) box.style.opacity = ''; fail(e); }
}

/* Beranda publik: hanya Pengumuman dan Agenda. Sambutan, Visi Misi, Struktur ada di halaman Tentang. */
pages.beranda = async () => {
  // Pengumuman dan agenda dimuat bersamaan; satu yang gagal tidak menghalangi yang lain.
  const [rAgenda, rPeng] = await Promise.allSettled([api('api_agenda', ''), api('api_pengumuman')]);
  AppState.agenda.pub = rAgenda.status === 'fulfilled' ? rAgenda.value : null;
  AppState.pengumuman = rPeng.status === 'fulfilled' ? rPeng.value : null;
  return pengumumanHtml(AppState.pengumuman) + agendaSectionHtml(AppState.agenda.pub);
};

/* ---------- Tentang: Sambutan Ketua, Visi dan Misi, Struktur Organisasi (satu halaman per bagian) ---------- */
const TENTANG_TABS = [['sambutan', 'campaign', 'Sambutan Ketua'], ['visimisi', 'visibility', 'Visi dan Misi'], ['struktur', 'account_tree', 'Struktur Organisasi']];
function tentangTabsHtml() {
  return '<div id="tentangTabs" class="mb-2 flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1" role="tablist" aria-label="Bagian Tentang">'
    + TENTANG_TABS.map(t => '<button type="button" role="tab" aria-selected="' + (AppState.tentangTab === t[0]) + '" class="nav-btn flex-1 justify-center' + (AppState.tentangTab === t[0] ? ' active' : '')
      + '" onclick="gantiTentangTab(\'' + t[0] + '\')"><span class="material-symbols-outlined">' + t[1] + '</span>' + t[2] + '</button>').join('') + '</div>';
}
function tentangIsiHtml() {
  const P = AppState.publik;
  if (!P) return '<div class="card mt-6 p-6 text-center text-sm text-slate-500">Data belum dapat dimuat. Muat ulang halaman sebentar lagi.</div>';
  return { sambutan: sambutanHtml, visimisi: visiMisiHtml, struktur: strukturHtml }[AppState.tentangTab](P);
}
function gantiTentangTab(t) {
  AppState.tentangTab = t;
  const tabs = $('tentangTabs'), isi = $('tentangIsi'); if (!tabs || !isi) return;
  tabs.outerHTML = tentangTabsHtml(); $('tentangIsi').innerHTML = tentangIsiHtml();
}
pages.tentang = async () => {
  try { AppState.publik = await api('api_publik'); } catch (e) { AppState.publik = null; }
  return '<div class="mb-1"><h1 class="text-2xl font-extrabold text-primary-dark">Tentang Kelas 84A MM</h1><p class="text-sm text-slate-500">Magister Manajemen · Unissula</p></div>'
    + tentangTabsHtml() + '<div id="tentangIsi">' + tentangIsiHtml() + '</div>';
};

/** Angka naik dari nol saat halaman pertama tampil (tanpa animasi bila pengguna mematikan gerak). */
function animasiAngka(root) {
  if (!root) return;
  const kurang = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-hitung]').forEach(el => {
    const n = Number(el.getAttribute('data-hitung'));
    if (!isFinite(n) || n <= 0 || kurang) return;
    const t0 = performance.now(), dur = 700;
    const langkah = t => {
      const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3);
      el.textContent = String(Math.round(n * e));
      if (f < 1) requestAnimationFrame(langkah); else el.textContent = String(n);
    };
    el.textContent = '0'; requestAnimationFrame(langkah);
  });
}
after.beranda = () => animasiAngka($('app-container'));

/* ---- Jendela Masuk (tombol di pojok kanan atas header) ---- */
function bukaLogin() {
  const wa = AppState.stats.waBantuan
    ? '<a class="btn btn-ghost mt-2 w-full !text-emerald-700" target="_blank" rel="noopener" href="https://wa.me/' + waNum(AppState.stats.waBantuan) + '?text=' + encodeURIComponent('Halo, saya butuh bantuan masuk ke ' + (AppState.stats.title || 'Portal Kelas 84A MM')) + '"><span class="material-symbols-outlined">support_agent</span>Lupa PIN? Hubungi Admin</a>' : '';
  openModal('<div class="p-5"><div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-lg font-bold">Masuk</h2>'
    + '<p class="text-sm text-slate-500">Gunakan email dan PIN yang Anda buat saat mendaftar.</p></div>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="closeModal()" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button></div>'
    + '<form onsubmit="doLogin(event)" class="space-y-3">'
    + '<div><label class="lbl" for="lgEmail">Username</label>'
    + '<input id="lgEmail" name="email" type="text" autocomplete="username" required class="inp" placeholder="nama@email.com atau admin" data-autofocus></div>'
    + '<div><label class="lbl" for="lgPin">PIN</label><input id="lgPin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required class="inp"></div>'
    + '<button class="btn btn-primary w-full" type="submit">Masuk</button></form>'
    + '<div class="my-4 flex items-center gap-3 text-xs text-slate-400"><span class="h-px flex-1 bg-slate-200"></span>belum terdaftar?<span class="h-px flex-1 bg-slate-200"></span></div>'
    + '<button class="btn btn-ghost w-full" onclick="closeModal();navigateTo(\'formulir\')">Isi Biodata Sekarang</button>' + wa + '</div>');
}

pages.formulir = async o => {
  const adminEdit = !!o.editId;
  const d = (adminEdit ? AppState.adminData.rows.find(r => r.ID === o.editId) : AppState.me) || {};
  const tamu = !AppState.token;
  AppState.fotoData = null;
  const kolom = FIELD_DEFS.map(f => '<div><label class="lbl" for="f_' + f[0] + '">' + f[1] + ' <span class="text-red-600">*</span></label>'
    + '<div class="relative"><span class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">' + f[2] + '</span>'
    + '<input class="inp pl-10" id="f_' + f[0] + '" name="' + f[0] + '" type="' + f[4] + '" required placeholder="' + f[3] + '" value="' + esc(d[f[0]] || '') + '" maxlength="120"></div></div>').join('');
  const akun = tamu
    ? '<div class="mb-5 rounded-xl bg-primary-soft p-4"><p class="mb-3 text-sm font-semibold text-primary-dark">Akun Anda</p><div class="grid gap-3 md:grid-cols-3">'
      + '<div class="md:col-span-3"><label class="lbl" for="f_email">Email <span class="text-red-600">*</span></label><input class="inp" id="f_email" name="email" type="email" required autocomplete="username" placeholder="nama@email.com"></div>'
      + '<div class="md:col-span-1"><label class="lbl" for="f_pin">Buat PIN (6–12 angka) <span class="text-red-600">*</span></label><input class="inp" id="f_pin" name="pin" type="password" inputmode="numeric" pattern="\\d{6,12}" required autocomplete="new-password"></div>'
      + '<div class="md:col-span-1"><label class="lbl" for="f_pin2">Ulangi PIN <span class="text-red-600">*</span></label><input class="inp" id="f_pin2" name="pin2" type="password" inputmode="numeric" required autocomplete="new-password"></div>'
      + '<p class="self-end text-xs text-slate-500 md:col-span-1">PIN dipakai untuk masuk kembali. Jangan bagikan ke siapa pun.</p></div></div>'
    : '<p class="mb-5 flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600"><span class="material-symbols-outlined">lock</span>Email: <strong>' + esc(d.Email || AppState.email) + '</strong></p>';
  return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">' + (adminEdit ? 'Ubah Biodata Teman' : d.ID ? 'Biodata Saya' : 'Formulir Biodata') + '</h1>'
    + '<p class="text-sm text-slate-500">Semua kolom bertanda <span class="text-red-600">*</span> wajib diisi.</p></div>'
    + '<form id="frm" class="grid gap-6 lg:grid-cols-12" onsubmit="submitForm(event)" data-has-foto="' + (d.FotoId ? '1' : '0') + '">'
    + '<aside class="lg:col-span-4"><div class="card p-6 text-center lg:sticky lg:top-24">'
    + '<p class="mb-4 text-sm font-semibold">Pasfoto formal <span class="text-red-600">*</span></p>'
    + '<div class="relative mx-auto grid h-40 w-40 place-items-center overflow-hidden rounded-2xl bg-primary-soft text-primary ring-4 ring-gold-soft">'
    + '<span class="material-symbols-outlined !text-5xl">account_circle</span>'
    + '<img id="fotoPrev" alt="Pratinjau foto" class="absolute inset-0 h-full w-full object-cover ' + (d.FotoUrl ? '' : 'hidden') + '" src="' + esc(d.FotoUrl || '') + '" onerror="this.classList.add(\'hidden\')"></div>'
    + '<input id="fotoInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onchange="pickPhoto(this)">'
    + '<label for="fotoInput" class="btn btn-ghost mt-4 w-full"><span class="material-symbols-outlined">add_a_photo</span>Pilih foto</label>'
    + '<p id="fotoInfo" class="mt-3 text-xs text-slate-500">JPG/PNG/WebP. Foto dikecilkan otomatis (&lt; 1 MB) sebelum diunggah.</p></div></aside>'
    + '<section class="card p-6 lg:col-span-8">' + akun + '<div class="grid gap-4 md:grid-cols-2">' + kolom + '</div>'
    + '<div class="mt-4"><div class="flex items-center justify-between"><label class="lbl" for="f_Perkenalan">Perkenalan singkat <span class="text-red-600">*</span></label><span id="cnt" class="text-xs text-slate-500">0/1000</span></div>'
    + '<textarea class="inp" id="f_Perkenalan" name="Perkenalan" rows="6" maxlength="1000" required oninput="$(\'cnt\').textContent=this.value.length+\'/1000\'" placeholder="Ceritakan latar belakang, minat kajian, atau harapan Anda di kelas ini.">' + esc(d.Perkenalan || '') + '</textarea></div>'
    + '<div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" class="btn btn-ghost" onclick="navigateTo(\'' + (adminEdit ? 'admin' : 'beranda') + '\')">Batal</button>'
    + '<button type="submit" class="btn btn-primary">' + (tamu ? 'Kirim Biodata &amp; Ajukan Persetujuan' : 'Simpan Perubahan') + '</button></div></section></form>';
};
after.formulir = () => { const t = $('f_Perkenalan'); if (t) $('cnt').textContent = t.value.length + '/1000'; };

function compressImage(file, maxSisi) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, (maxSisi || 640) / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('File bukan gambar yang valid.')); };
    img.src = url;
  });
}
async function pickPhoto(inp) {
  const f = inp.files[0]; if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Gunakan foto JPG, PNG, atau WebP.', 'error'); inp.value = ''; return; }
  if (f.size > 15 * 1024 * 1024) { toast('Ukuran foto maksimal 15 MB.', 'error'); inp.value = ''; return; }
  try {
    AppState.fotoData = await compressImage(f);
    const p = $('fotoPrev'); p.src = AppState.fotoData; p.classList.remove('hidden');
    $('fotoInfo').textContent = 'Siap diunggah (±' + Math.round(AppState.fotoData.length * 0.75 / 1024) + ' KB).';
  } catch (e) { toast(e.message, 'error'); }
}

async function submitForm(ev) {
  ev.preventDefault();
  const f = ev.target, btn = f.querySelector('[type=submit]');
  const p = { id: AppState.editId, foto: AppState.fotoData };
  FIELD_DEFS.forEach(d => { p[d[0]] = f[d[0]].value.trim(); });
  p.Perkenalan = f.Perkenalan.value.trim();
  const tamu = !AppState.token;
  if (tamu) {
    p.email = f.email.value.trim(); p.pin = f.pin.value;
    if (p.pin !== f.pin2.value) return toast('PIN dan ulangi PIN tidak sama.', 'error');
  }
  if (!p.foto && f.dataset.hasFoto !== '1') return toast('Foto wajib diunggah.', 'error');
  setBusy(btn, true, 'Menyimpan…');
  try {
    const r = await api('api_save', AppState.token, p);
    const ubahOrangLain = !!AppState.editId;
    applySession(r); AppState.members = null;
    if (ubahOrangLain) { toast('Data teman diperbarui.'); return navigateTo('admin'); }
    toast(tamu ? 'Biodata terkirim. Menunggu persetujuan admin.' : 'Biodata disimpan.');
    navigateTo('status');
  } catch (e) { fail(e); setBusy(btn, false); }
}

pages.status = async () => {
  if (AppState.token) applySession(await call('api_me'));
  const m = AppState.me;
  if (!m) return lockedHtml('Anda belum mengisi biodata.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'formulir\')">Isi Biodata</button>');
  const v = {
    Menunggu: ['hourglass_top', 'bg-amber-100 text-amber-700', 'Menunggu persetujuan admin', 'Biodata Anda sedang diperiksa. Setelah disetujui, Anda dapat melihat daftar teman sekelas.'],
    Disetujui: ['verified', 'bg-emerald-100 text-emerald-700', 'Biodata disetujui', 'Anda kini dapat melihat dan mencari biodata teman sekelas.'],
    Ditolak: ['error', 'bg-red-100 text-red-700', 'Biodata perlu diperbaiki', 'Silakan perbaiki sesuai catatan admin, lalu kirim ulang.']
  }[m.Status];
  return '<div class="mx-auto max-w-2xl"><div class="card overflow-hidden"><div class="h-1.5 bg-gradient-to-r from-primary to-gold"></div><div class="p-6">'
    + '<div class="flex items-start gap-4"><span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl ' + v[1] + '"><span class="material-symbols-outlined !text-3xl">' + v[0] + '</span></span>'
    + '<div><h1 class="text-xl font-bold">' + v[2] + '</h1><p class="mt-1 text-sm text-slate-600">' + v[3] + '</p></div></div>'
    + (m.Status === 'Ditolak' && m.CatatanAdmin ? '<div class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"><strong>Catatan admin:</strong> ' + esc(m.CatatanAdmin) + '</div>' : '')
    + '<div class="mt-5 flex items-center gap-4 rounded-xl bg-slate-50 p-4">' + avatar(m, 'h-16 w-16 rounded-xl text-lg')
    + '<div class="min-w-0"><p class="truncate font-semibold">' + esc(m.NamaLengkap) + '</p><p class="truncate text-sm text-slate-500">' + esc(m.TempatKerja) + ' · ' + esc(m.Jabatan) + '</p></div></div>'
    + '<div class="mt-6 flex flex-wrap gap-3">'
    + (m.Status === 'Disetujui' ? '<button class="btn btn-primary" onclick="navigateTo(\'teman\')"><span class="material-symbols-outlined">groups</span>Buka Daftar Teman</button>' : '')
    + '<button class="btn ' + (m.Status === 'Ditolak' ? 'btn-primary' : 'btn-ghost') + '" onclick="navigateTo(\'formulir\')">' + (m.Status === 'Ditolak' ? 'Perbaiki Biodata' : 'Ubah Biodata') + '</button>'
    + '<button class="btn btn-ghost" onclick="navigateTo(\'status\')"><span class="material-symbols-outlined">refresh</span>Periksa Ulang</button></div></div></div></div>';
};

/* ---- Daftar teman ---- */
pages.teman = async () => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga daftar teman belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  if (!AppState.members) AppState.members = await call('api_members');
  AppState.q = '';
  return '<div class="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><h1 class="text-2xl font-extrabold text-primary-dark">Daftar Teman Sekelas</h1>'
    + '<p id="hitung" class="text-sm text-slate-500"></p></div>'
    + '<div class="flex w-full gap-2 md:w-auto"><div class="relative flex-1 md:w-80"><label class="sr-only" for="q">Cari teman</label>'
    + '<span class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>'
    + '<input id="q" class="inp pl-10" type="search" autocomplete="off" placeholder="Cari nama, kota, kantor, jabatan…" oninput="filterMembers(this.value)"></div>'
    + '<button class="btn btn-ghost" onclick="reloadMembers()" aria-label="Muat ulang daftar"><span class="material-symbols-outlined">refresh</span></button></div></div>'
    + '<div id="grid" class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"></div>';
};
after.teman = () => { const g = $('grid'); if (g) { g.classList.add('stagger'); paintGrid(); setTimeout(() => g.classList.remove('stagger'), 1400); } };
function filterMembers(q) { AppState.q = q; paintGrid(); }
async function reloadMembers() { AppState.members = null; navigateTo('teman'); }
function paintGrid() {
  const q = AppState.q.toLowerCase().trim();
  const list = (AppState.members || []).filter(r => !q
    || [r.NamaLengkap, r.NamaPanggilan, r.NIM, r.AsalKota, r.Provinsi, r.TempatKerja, r.Jabatan].join(' ').toLowerCase().includes(q));
  $('hitung').textContent = list.length + ' dari ' + (AppState.members || []).length + ' teman';
  $('grid').innerHTML = list.length ? list.map(r => '<article class="card card-hover flex flex-col p-5">'
    + '<div class="flex items-start gap-4">' + avatar(r, 'h-16 w-16 rounded-xl text-lg')
    + '<div class="min-w-0"><span class="chip bg-primary-soft text-primary">' + esc(r.NamaPanggilan) + '</span>'
    + '<h2 class="mt-1 truncate font-bold" title="' + esc(r.NamaLengkap) + '">' + esc(r.NamaLengkap) + '</h2>'
    + '<p class="truncate text-xs text-slate-500">NIM ' + esc(r.NIM) + '</p></div></div>'
    + '<div class="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">'
    + '<p class="flex items-center gap-2"><span class="material-symbols-outlined text-primary">apartment</span><span class="truncate">' + esc(r.TempatKerja) + ' — ' + esc(r.Jabatan) + '</span></p>'
    + '<p class="flex items-center gap-2 text-slate-600"><span class="material-symbols-outlined text-primary">location_on</span><span class="truncate">' + esc(r.AsalKota) + ', ' + esc(r.Provinsi) + '</span></p></div>'
    + '<p class="clamp-3 mt-3 flex-1 text-sm italic text-slate-600">“' + esc(r.Perkenalan) + '”</p>'
    + '<button class="btn btn-ghost mt-4 w-full" onclick="openMember(\'' + r.ID + '\')">Lihat Profil<span class="material-symbols-outlined">arrow_forward</span></button></article>').join('')
    : '<div class="card col-span-full p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">person_search</span><p class="mt-2">Teman tidak ditemukan. Coba kata kunci lain.</p></div>';
}
function openMember(id) {
  const r = (AppState.members || []).find(x => x.ID === id); if (!r) return;
  openModal('<div class="flex items-center justify-between bg-primary px-5 py-3 text-white"><h2 class="font-bold">Profil Teman</h2>'
    + '<button class="rounded-full p-1 hover:bg-white/10" onclick="closeModal()" aria-label="Tutup" data-autofocus><span class="material-symbols-outlined">close</span></button></div>'
    + '<div class="space-y-4 p-5"><div class="flex items-center gap-4">' + avatar(r, 'h-20 w-20 rounded-2xl text-xl')
    + '<div class="min-w-0"><h3 class="text-lg font-bold">' + esc(r.NamaLengkap) + '</h3><p class="text-sm text-slate-500">Panggilan: ' + esc(r.NamaPanggilan) + ' · NIM ' + esc(r.NIM) + '</p></div></div>'
    + '<dl class="grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-xs font-semibold uppercase text-slate-400">Tempat kerja</dt><dd>' + esc(r.TempatKerja) + '</dd></div>'
    + '<div><dt class="text-xs font-semibold uppercase text-slate-400">Jabatan</dt><dd>' + esc(r.Jabatan) + '</dd></div>'
    + '<div><dt class="text-xs font-semibold uppercase text-slate-400">Asal kota</dt><dd>' + esc(r.AsalKota) + '</dd></div>'
    + '<div><dt class="text-xs font-semibold uppercase text-slate-400">Provinsi</dt><dd>' + esc(r.Provinsi) + '</dd></div>'
    + '<div><dt class="text-xs font-semibold uppercase text-slate-400">Hobi</dt><dd>' + esc(r.Hobi) + '</dd></div></dl>'
    + '<div class="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">' + esc(r.Perkenalan) + '</div>'
    + '<div class="grid gap-2 sm:grid-cols-2"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/' + waNum(r.NomorHP) + '"><span class="material-symbols-outlined">chat</span>WhatsApp</a>'
    + '<a class="btn btn-ghost" target="_blank" rel="noopener" href="mailto:' + esc(r.Email) + '"><span class="material-symbols-outlined">mail</span>Email</a></div>'
    + '<p class="text-center text-xs text-slate-400">' + esc(r.NomorHP) + ' · ' + esc(r.Email) + '</p></div>');
}

/* ---- Tugas kuliah ---- */
let tugasFileData = null, tugasFileName = '';
const TUGAS_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,image/jpeg,image/png,image/webp';
const TUGAS_MIME_OK = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed', 'image/jpeg', 'image/png', 'image/webp'];
function fileToDataUrl(file) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => no(new Error('Gagal membaca file.'));
    r.readAsDataURL(file);
  });
}
function fmtUkuran(b) { b = Number(b) || 0; return b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
function iconTugas(nama) {
  const ext = String(nama || '').split('.').pop().toLowerCase();
  const m = { pdf: 'picture_as_pdf', doc: 'description', docx: 'description', ppt: 'slideshow', pptx: 'slideshow',
    xls: 'table_chart', xlsx: 'table_chart', zip: 'folder_zip', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image' };
  return m[ext] || 'draft';
}
async function pickTugasFile(inp) {
  const f = inp.files[0]; if (!f) return;
  if (TUGAS_MIME_OK.indexOf(f.type) === -1) { toast('Jenis file tidak didukung. Gunakan PDF, Word, Excel, PowerPoint, ZIP, atau gambar.', 'error'); inp.value = ''; return; }
  if (f.size > 10 * 1024 * 1024) { toast('Ukuran file maksimal 10 MB.', 'error'); inp.value = ''; return; }
  try {
    tugasFileData = await fileToDataUrl(f); tugasFileName = f.name;
    $('tugasFileInfo').textContent = 'Siap diunggah: ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
  } catch (e) { toast(e.message, 'error'); }
}

pages.tugas = async () => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga menu Tugas Kuliah belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  tugasFileData = null; tugasFileName = '';
  // Admin memakai tampilan anggota (unggah, tugas saya, tugas teman) lalu daftar semua tugas di bawahnya.
  const [matkul, saya, semua] = await Promise.all([
    call('api_matkul'), call('api_tugasSaya'),
    AppState.isAdmin ? call('api_tugasAdmin') : Promise.resolve(null)
  ]);
  AppState.matkul = matkul;
  AppState.tugasSaya = saya;
  if (AppState.isAdmin) { AppState.tugasAdmin = semua; return tugasMhsHtml() + tugasAdminHtml(); }
  return tugasMhsHtml();
};

function tugasKartu(t, opt) {
  opt = opt || {};
  return '<article class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">'
    + '<span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><span class="material-symbols-outlined">' + iconTugas(t.NamaFile) + '</span></span>'
    + '<div class="min-w-0 flex-1"><span class="chip bg-primary-soft text-primary">' + esc(t.MataKuliah) + '</span>'
    + '<h3 class="mt-1 truncate font-bold">' + esc(t.JudulTugas) + '</h3>'
    + (opt.showName ? '<p class="truncate text-sm text-slate-600">' + esc(t.NamaMahasiswa) + ' · ' + esc(t.Email) + '</p>' : '')
    + (t.Keterangan ? '<p class="truncate text-sm text-slate-600">' + esc(t.Keterangan) + '</p>' : '')
    + '<p class="text-xs text-slate-500">' + esc(t.NamaFile) + ' · ' + fmtUkuran(t.Ukuran) + ' · diunggah ' + tgl(t.Dibuat) + '</p></div>'
    + '<div class="flex shrink-0 gap-2"><a class="btn btn-ghost !min-h-[40px] !px-3" target="_blank" rel="noopener" href="' + esc(t.FileUrl) + '" aria-label="Buka file"><span class="material-symbols-outlined">open_in_new</span></a>'
    + (opt.showDelete ? '<button class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusTugas(\'' + t.ID + '\')" aria-label="Hapus tugas"><span class="material-symbols-outlined">delete</span></button>' : '')
    + '</div></article>';
}

function tugasMhsHtml() {
  const opsi = AppState.matkul.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
  const daftar = AppState.tugasSaya.length ? AppState.tugasSaya.map(t => tugasKartu(t, { showDelete: true })).join('')
    : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">upload_file</span><p class="mt-2">Belum ada tugas yang diunggah.</p></div>';
  return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">Tugas Kuliah</h1><p class="text-sm text-slate-500">Unggah tugas Anda per mata kuliah. Tugas teman hanya terlihat kalau Anda membuka mata kuliah yang sama.</p></div>'
    + '<div class="grid gap-6 lg:grid-cols-12"><section class="card p-6 lg:col-span-5"><h2 class="font-bold">Unggah Tugas Baru</h2>'
    + '<form class="mt-4 space-y-3" onsubmit="submitTugas(event)">'
    + (AppState.matkul.length
      ? '<div><label class="lbl" for="tkMatkul">Mata kuliah</label><select id="tkMatkul" class="inp" required><option value="">Pilih mata kuliah…</option>' + opsi + '</select></div>'
      : '<p class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Daftar mata kuliah belum diisi admin. Hubungi admin kelas.</p>')
    + '<div><label class="lbl" for="tkJudul">Judul tugas</label><input id="tkJudul" class="inp" type="text" maxlength="150" required placeholder="Contoh: Tugas 1 - Analisis Kasus"></div>'
    + '<div><label class="lbl" for="tkKet">Keterangan (opsional)</label><textarea id="tkKet" class="inp" rows="2" maxlength="500" placeholder="Catatan tambahan"></textarea></div>'
    + '<div><label class="lbl" for="tkFile">File tugas</label><input id="tkFile" type="file" accept="' + TUGAS_ACCEPT + '" class="inp" required onchange="pickTugasFile(this)">'
    + '<p id="tugasFileInfo" class="mt-1 text-xs text-slate-500">PDF, Word, Excel, PowerPoint, ZIP, atau gambar. Maks. 10 MB.</p></div>'
    + '<button type="submit" class="btn btn-primary w-full"' + (AppState.matkul.length ? '' : ' disabled') + '><span class="material-symbols-outlined">upload</span>Unggah Tugas</button></form></section>'
    + '<section class="lg:col-span-7"><h2 class="mb-3 font-bold">Tugas Saya</h2><div class="space-y-3">' + daftar + '</div>'
    + '<div class="mt-8"><h2 class="mb-3 font-bold">Tugas Teman Sekelas</h2>'
    + '<p class="mb-3 text-sm text-slate-500">Pilih mata kuliah untuk melihat tugas yang sudah dikumpulkan teman-teman di mata kuliah tersebut.</p>'
    + '<div class="flex gap-2"><label class="sr-only" for="tkLihatMatkul">Pilih mata kuliah</label>'
    + '<select id="tkLihatMatkul" class="inp flex-1"><option value="">Pilih mata kuliah…</option>' + opsi + '</select>'
    + '<button type="button" class="btn btn-primary shrink-0" onclick="lihatTugasMatkul()">Lihat</button></div>'
    + '<div id="tugasMatkulBody" class="mt-4 space-y-3"></div></div></section></div>';
}

async function lihatTugasMatkul() {
  const mk = $('tkLihatMatkul').value;
  const body = $('tugasMatkulBody');
  if (!mk) { body.innerHTML = ''; return; }
  body.innerHTML = loadingHtml();
  try {
    const rows = await call('api_tugasMatkul', mk);
    body.innerHTML = rows.length ? rows.map(t => tugasKartu(t, { showName: t.Email !== AppState.email, showDelete: t.Email === AppState.email })).join('')
      : '<div class="card p-6 text-center text-slate-500">Belum ada tugas yang diunggah untuk mata kuliah ini.</div>';
  } catch (e) { body.innerHTML = ''; fail(e); }
}

async function submitTugas(ev) {
  ev.preventDefault();
  if (!tugasFileData) return toast('Pilih file tugas terlebih dahulu.', 'error');
  const f = ev.target, btn = f.querySelector('[type=submit]');
  const p = { mataKuliah: $('tkMatkul').value, judul: $('tkJudul').value.trim(), keterangan: $('tkKet').value.trim(), file: tugasFileData, namaFile: tugasFileName };
  setBusy(btn, true, 'Mengunggah…');
  try {
    AppState.tugasSaya = await call('api_uploadTugas', p);
    tugasFileData = null; tugasFileName = '';
    toast('Tugas berhasil diunggah.');
    navigateTo('tugas');
  } catch (e) { setBusy(btn, false); fail(e); }
}

function konfirmasiHapusTugas(id) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus tugas?</h2><p class="text-sm text-slate-600">File di Google Drive juga akan dihapus. Tindakan ini tidak dapat dibatalkan.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="hapusTugas(\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapusTugas(id) {
  try {
    await call('api_hapusTugas', id); closeModal(); toast('Tugas dihapus.');
    navigateTo('tugas');
  } catch (e) { closeModal(); fail(e); }
}

/* ---- Tugas kuliah: panel admin ---- */
function tugasAdminRows_() {
  const c = AppState.tugasAdmin;
  const q = (AppState.tugasQ || '').toLowerCase().trim();
  return c.rows.filter(r => !q || [r.NamaMahasiswa, r.Email, r.MataKuliah, r.JudulTugas].join(' ').toLowerCase().includes(q));
}
function tugasAdminDaftarHtml() {
  const rows = tugasAdminRows_();
  return rows.length ? rows.map(t => tugasKartu(t, { showName: true, showDelete: true })).join('')
    : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">upload_file</span><p class="mt-2">Belum ada tugas yang diunggah.</p></div>';
}
function tugasAdminHitungText_() { return tugasAdminRows_().length + ' dari ' + AppState.tugasAdmin.rows.length + ' tugas terkumpul'; }
function tugasAdminHtml() {
  return '<div class="mt-10 mb-5 flex flex-col justify-between gap-4 border-t border-slate-200 pt-8 md:flex-row md:items-end"><div><h2 class="text-xl font-extrabold text-primary-dark">Semua Tugas Mahasiswa</h2>'
    + '<p id="tugasAdminHitung" class="text-sm text-slate-500">' + tugasAdminHitungText_() + '</p></div>'
    + '<div class="flex w-full gap-2 md:w-auto"><div class="relative flex-1 md:w-72"><label class="sr-only" for="tq">Cari</label>'
    + '<span class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>'
    + '<input id="tq" class="inp pl-10" type="search" placeholder="Cari nama / mata kuliah / judul…" value="' + esc(AppState.tugasQ || '') + '" oninput="AppState.tugasQ=this.value;renderAdminTugas()"></div>'
    + '<button class="btn btn-ghost" onclick="bukaKelolaMatkul()"><span class="material-symbols-outlined">tune</span>Mata Kuliah</button></div></div>'
    + '<div id="tugasAdminBody" class="space-y-3">' + tugasAdminDaftarHtml() + '</div>';
}
// Hanya daftar yang digambar ulang, supaya kolom cari tidak kehilangan fokus saat mengetik.
function renderAdminTugas() {
  $('tugasAdminBody').innerHTML = tugasAdminDaftarHtml();
  $('tugasAdminHitung').textContent = tugasAdminHitungText_();
}
function bukaKelolaMatkul() {
  const list = (AppState.tugasAdmin && AppState.tugasAdmin.matkul) || [];
  openModal('<form class="p-5" onsubmit="kirimKelolaMatkul(event)"><h2 class="text-lg font-bold">Kelola Daftar Mata Kuliah</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Satu baris untuk satu mata kuliah. Mahasiswa memilih dari daftar ini saat mengunggah tugas.</p>'
    + '<textarea id="matkulList" class="inp mt-3" rows="8" data-autofocus placeholder="Contoh:\nManajemen Strategik\nMetodologi Penelitian\nStatistik Bisnis">' + esc(list.join('\n')) + '</textarea>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div></form>');
}
async function kirimKelolaMatkul(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  const list = $('matkulList').value.split('\n').map(s => s.trim()).filter(Boolean);
  setBusy(btn, true, 'Menyimpan…');
  try {
    const baru = await call('api_aturMatkul', list);
    AppState.tugasAdmin.matkul = baru; AppState.matkul = baru; closeModal(); toast('Daftar mata kuliah disimpan.');
    navigateTo('tugas'); // muat ulang agar pilihan mata kuliah di form unggah ikut berubah
  } catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Absensi (self check-in + rekap) ---- */
const STATUS_ABSEN_FE = ['Hadir', 'Izin', 'Sakit', 'Alfa'];
pages.absensi = async () => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga menu Absensi belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  AppState.matkul = await call('api_matkul');
  AppState.absensiTab = AppState.absensiTab || 'checkin';
  AppState.absensiMatkul = AppState.matkul.indexOf(AppState.absensiMatkul) > -1 ? AppState.absensiMatkul : (AppState.matkul[0] || '');
  return absensiHtml();
};
after.absensi = () => { if (AppState.absensiMatkul) muatAbsensi(); };
function absensiHtml() {
  if (!AppState.matkul.length) return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">Absensi</h1></div><p class="card p-6 text-center text-slate-500">Daftar mata kuliah belum diisi admin.</p>';
  const opsi = AppState.matkul.map(m => '<option value="' + esc(m) + '"' + (m === AppState.absensiMatkul ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
  return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">Absensi</h1><p class="text-sm text-slate-500">Tandai kehadiran Anda dan lihat rekap kehadiran kelas per mata kuliah.</p></div>'
    + '<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">'
    + '<div class="sm:w-80"><label class="sr-only" for="absMatkul">Mata kuliah</label><select id="absMatkul" class="inp" onchange="gantiAbsensiMatkul(this.value)">' + opsi + '</select></div>'
    + '<div class="flex gap-1 rounded-xl bg-slate-200/70 p-1" role="tablist">'
    + ['checkin', 'rekap'].map(t => '<button role="tab" aria-selected="' + (AppState.absensiTab === t) + '" class="nav-btn ' + (AppState.absensiTab === t ? 'active' : '') + '" onclick="gantiAbsensiTab(\'' + t + '\')">' + (t === 'checkin' ? 'Absen Saya' : 'Rekap Kelas') + '</button>').join('') + '</div></div>'
    + '<div id="absensiBody">' + loadingHtml() + '</div>';
}
function gantiAbsensiMatkul(mk) { AppState.absensiMatkul = mk; muatAbsensi(); }
function gantiAbsensiTab(t) { AppState.absensiTab = t; $('kuliahBody').innerHTML = absensiHtml(); muatAbsensi(); }
async function muatAbsensi() {
  const body = $('absensiBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    if (AppState.absensiTab === 'checkin') { const d = await call('api_absensiMatkul', AppState.absensiMatkul); body.innerHTML = absensiCheckinHtml(d); }
    else { const d = await call('api_rekapAbsensi', AppState.absensiMatkul); body.innerHTML = absensiRekapHtml(d); }
  } catch (e) { body.innerHTML = ''; fail(e); }
}
function absensiCheckinHtml(d) {
  if (!d.pertemuanAktif) return '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">event_busy</span><p class="mt-2">Belum ada pertemuan yang dibuka untuk mata kuliah ini.</p>'
    + (d.riwayat.length ? '<p class="mt-1 text-xs text-slate-400">Sudah ' + d.riwayat.length + ' pertemuan berlangsung sebelumnya.</p>' : '') + '</div>';
  const sudah = !!d.statusSaya;
  return '<div class="card p-8 text-center"><span class="chip bg-primary-soft text-primary">Pertemuan ' + d.pertemuanAktif + '</span>'
    + (sudah
      ? '<div class="mt-4"><span class="material-symbols-outlined !text-5xl text-emerald-600">check_circle</span><p class="mt-2 text-lg font-bold">Anda tercatat "' + esc(d.statusSaya) + '"</p></div>'
      : '<div class="mt-4"><p class="mb-4 text-sm text-slate-600">Pertemuan sedang berlangsung. Tandai kehadiran Anda sekarang.</p>'
        + '<button class="btn btn-primary !min-h-[52px] !px-8 !text-base" onclick="absenSekarang()"><span class="material-symbols-outlined">how_to_reg</span>Hadir</button></div>') + '</div>';
}
async function absenSekarang() {
  try { await call('api_absenHadir', AppState.absensiMatkul); toast('Kehadiran tercatat.'); muatAbsensi(); } catch (e) { fail(e); }
}
function absensiRekapHtml(d) {
  if (!d.pertemuan.length) return '<div class="card p-10 text-center text-slate-500">Belum ada pertemuan untuk mata kuliah ini.</div>';
  const warna = { Hadir: 'bg-emerald-100 text-emerald-700', Izin: 'bg-amber-100 text-amber-700', Sakit: 'bg-sky-100 text-sky-700', Alfa: 'bg-red-100 text-red-700' };
  const head = '<th class="sticky left-0 z-10 min-w-[12rem] bg-slate-50 p-2 text-left">Nama</th>' + d.pertemuan.map(p => '<th class="p-2 text-center">P' + p + '</th>').join('') + '<th class="p-2 text-center">%</th>';
  const body = d.anggota.map(a => '<tr class="border-t border-slate-100">'
    + '<td class="sticky left-0 z-10 bg-white p-2 font-medium">' + esc(a.Nama) + '</td>'
    + d.pertemuan.map(p => '<td class="p-2 text-center">' + (a.status[p] ? '<span class="chip ' + (warna[a.status[p]] || '') + '">' + esc(a.status[p]) + '</span>' : '<span class="text-slate-300">-</span>') + '</td>').join('')
    + '<td class="p-2 text-center font-bold">' + a.persen + '%</td></tr>').join('');
  return '<div class="card overflow-x-auto p-2"><table class="w-full text-xs"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* ---- Menu Kuliah: Chat, Absen, Tugas, dan Materi dalam satu halaman bertab ---- */
const KULIAH_TABS = [['chat', 'forum', 'Chat'], ['absen', 'fact_check', 'Absen'], ['tugas', 'upload_file', 'Tugas'], ['materi', 'folder_open', 'Materi']];
const kuliahTabBoleh = () => KULIAH_TABS.filter(t => menuBoleh('kuliah_' + t[0]));
function kuliahTabsHtml() {
  return '<div id="kuliahTabs" class="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1" role="tablist" aria-label="Bagian Kuliah">'
    + kuliahTabBoleh().map(t => '<button type="button" role="tab" aria-selected="' + (AppState.kuliahTab === t[0]) + '" class="nav-btn relative flex-1 justify-center'
      + (AppState.kuliahTab === t[0] ? ' active' : '') + '" onclick="gantiKuliahTab(\'' + t[0] + '\')"><span class="material-symbols-outlined">' + t[1] + '</span>' + t[2]
      + (t[0] === 'chat' && AppState.chatUnread && AppState.kuliahTab !== 'chat' ? '<span class="chat-badge">' + (AppState.chatUnread > 99 ? '99+' : AppState.chatUnread) + '</span>' : '')
      + '</button>').join('') + '</div>';
}
function paintKuliahTabs() { const el = $('kuliahTabs'); if (el) el.outerHTML = kuliahTabsHtml(); }
function gantiKuliahTab(t) { AppState.kuliahTab = t; navigateTo('kuliah'); }

pages.kuliah = async o => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga menu Kuliah belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  const boleh = kuliahTabBoleh();
  if (!boleh.length) return tutupHtml('kuliah');
  if (!boleh.some(t => t[0] === AppState.kuliahTab)) AppState.kuliahTab = boleh[0][0];
  const isi = { chat: pages.chat, absen: pages.absensi, tugas: pages.tugas, materi: pages.materi }[AppState.kuliahTab] || pages.chat;
  const html = await isi(o);
  return kuliahTabsHtml() + '<div id="kuliahBody">' + html + '</div>';
};
after.kuliah = o => {
  const f = { chat: after.chat, absen: after.absensi, tugas: after.tugas, materi: after.materi }[AppState.kuliahTab];
  if (f) f(o);
};

/* ---- Materi kuliah (admin unggah file/tautan, semua anggota membaca) ---- */
let materiFileData = null, materiFileName = '';
pages.materi = async () => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga Materi belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  AppState.matkul = await call('api_matkul');
  AppState.materi = await call('api_materi');
  return materiHtml();
};
after.materi = () => paintMateri();
function materiHtml() {
  const opsi = AppState.matkul.map(m => '<option value="' + esc(m) + '"' + (m === AppState.materiFilter ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
  return '<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 class="text-2xl font-extrabold text-primary-dark">Materi Kuliah</h1>'
    + '<p class="text-sm text-slate-500">Bahan kuliah per mata kuliah, diunggah oleh admin.</p></div>'
    + '<div class="flex w-full gap-2 sm:w-auto"><div class="flex-1 sm:w-72"><label class="sr-only" for="mtFilter">Mata kuliah</label>'
    + '<select id="mtFilter" class="inp" onchange="AppState.materiFilter=this.value;paintMateri()"><option value="">Semua mata kuliah</option>' + opsi + '</select></div>'
    + (AppState.isAdmin ? '<button type="button" class="btn btn-primary shrink-0" onclick="bukaTambahMateri()"><span class="material-symbols-outlined">add</span>Tambah</button>' : '')
    + '</div></div><div id="materiList" class="space-y-3"></div>';
}
function paintMateri() {
  const box = $('materiList'); if (!box) return;
  const f = AppState.materiFilter;
  const list = (AppState.materi || []).filter(m => !f || m.MataKuliah === f);
  box.innerHTML = list.length ? list.map(materiKartu).join('')
    : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">folder_open</span><p class="mt-2">Belum ada materi' + (f ? ' untuk mata kuliah ini' : '') + '.</p></div>';
}
function hostTautan(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'tautan'; } }
function materiKartu(m) {
  const link = m.Tipe === 'link';
  return '<article class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">'
    + '<span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><span class="material-symbols-outlined">' + (link ? 'link' : iconTugas(m.NamaFile)) + '</span></span>'
    + '<div class="min-w-0 flex-1"><span class="chip bg-primary-soft text-primary">' + esc(m.MataKuliah) + '</span>'
    + '<h3 class="mt-1 truncate font-bold">' + esc(m.Judul) + '</h3>'
    + (m.Keterangan ? '<p class="text-sm text-slate-600">' + esc(m.Keterangan) + '</p>' : '')
    + '<p class="truncate text-xs text-slate-500">' + (link ? esc(hostTautan(m.Url)) : esc(m.NamaFile) + ' · ' + fmtUkuran(m.Ukuran)) + ' · ' + tgl(m.Dibuat) + '</p></div>'
    + '<div class="flex shrink-0 gap-2"><a class="btn btn-ghost !min-h-[40px] !px-3" target="_blank" rel="noopener" href="' + esc(m.Url) + '" aria-label="Buka materi"><span class="material-symbols-outlined">open_in_new</span></a>'
    + (AppState.isAdmin ? '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusMateri(\'' + m.ID + '\')" aria-label="Hapus materi"><span class="material-symbols-outlined">delete</span></button>' : '')
    + '</div></article>';
}
function bukaTambahMateri() {
  materiFileData = null; materiFileName = '';
  const opsi = AppState.matkul.map(m => '<option value="' + esc(m) + '"' + (m === AppState.materiFilter ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
  openModal('<form class="p-5" onsubmit="kirimMateri(event)"><h2 class="text-lg font-bold">Tambah Materi</h2>'
    + '<div class="mt-4 space-y-3">'
    + '<div><label class="lbl" for="mtMatkul">Mata kuliah</label><select id="mtMatkul" class="inp" required data-autofocus><option value="">Pilih mata kuliah…</option>' + opsi + '</select></div>'
    + '<div><label class="lbl" for="mtJudul">Judul materi</label><input id="mtJudul" class="inp" type="text" maxlength="150" required placeholder="Contoh: Slide Pertemuan 3"></div>'
    + '<div><label class="lbl" for="mtKet">Keterangan (opsional)</label><textarea id="mtKet" class="inp" rows="2" maxlength="500"></textarea></div>'
    + '<div><label class="lbl" for="mtTipe">Bentuk materi</label><select id="mtTipe" class="inp" onchange="gantiTipeMateri(this.value)"><option value="file">File (diunggah)</option><option value="link">Tautan (Drive, YouTube, dll.)</option></select></div>'
    + '<div id="mtFileBox"><label class="lbl" for="mtFile">File</label><input id="mtFile" type="file" accept="' + TUGAS_ACCEPT + '" class="inp" onchange="pickMateriFile(this)">'
    + '<p id="mtFileInfo" class="mt-1 text-xs text-slate-500">PDF, Word, Excel, PowerPoint, ZIP, atau gambar. Maks. 10 MB. Untuk file besar atau video, gunakan tautan.</p></div>'
    + '<div id="mtLinkBox" class="hidden"><label class="lbl" for="mtUrl">Tautan</label><input id="mtUrl" class="inp" type="url" maxlength="500" placeholder="https://drive.google.com/…"></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div></form>');
}
function gantiTipeMateri(t) {
  $('mtFileBox').classList.toggle('hidden', t === 'link');
  $('mtLinkBox').classList.toggle('hidden', t !== 'link');
}
async function pickMateriFile(inp) {
  const f = inp.files[0]; if (!f) return;
  if (TUGAS_MIME_OK.indexOf(f.type) === -1) { toast('Jenis file tidak didukung. Gunakan PDF, Word, Excel, PowerPoint, ZIP, atau gambar.', 'error'); inp.value = ''; materiFileData = null; return; }
  if (f.size > 10 * 1024 * 1024) { toast('Ukuran file maksimal 10 MB. Untuk file besar, gunakan tautan.', 'error'); inp.value = ''; materiFileData = null; return; }
  try {
    materiFileData = await fileToDataUrl(f); materiFileName = f.name;
    $('mtFileInfo').textContent = 'Siap diunggah: ' + f.name + ' (' + fmtUkuran(f.size) + ')';
  } catch (e) { toast(e.message, 'error'); }
}
async function kirimMateri(ev) {
  ev.preventDefault();
  const tipe = $('mtTipe').value;
  const p = { mataKuliah: $('mtMatkul').value, judul: $('mtJudul').value.trim(), keterangan: $('mtKet').value.trim(), tipe: tipe };
  if (tipe === 'link') {
    p.url = $('mtUrl').value.trim();
    if (!p.url) return toast('Tautan wajib diisi.', 'error');
  } else {
    if (!materiFileData) return toast('Pilih file materi terlebih dahulu.', 'error');
    p.file = materiFileData; p.namaFile = materiFileName;
  }
  const btn = ev.target.querySelector('[type=submit]');
  setBusy(btn, true, tipe === 'link' ? 'Menyimpan…' : 'Mengunggah…');
  try {
    AppState.materi = await call('api_tambahMateri', p);
    materiFileData = null; materiFileName = '';
    closeModal(); toast('Materi ditambahkan.'); paintMateri();
  } catch (e) { setBusy(btn, false); fail(e); }
}
function konfirmasiHapusMateri(id) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus materi?</h2><p class="text-sm text-slate-600">Bila berupa file, file di Google Drive juga dihapus. Tindakan ini tidak dapat dibatalkan.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="hapusMateri(\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapusMateri(id) {
  try { AppState.materi = await call('api_hapusMateri', id); closeModal(); toast('Materi dihapus.'); paintMateri(); }
  catch (e) { closeModal(); fail(e); }
}

/* ---- Waktu (WITA) ---- */
const WITA = 'Asia/Makassar';
const ymdWita = d => d.toLocaleDateString('en-CA', { timeZone: WITA });
function fmtWaktu(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleString('id-ID', { timeZone: WITA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' WITA';
}
function hitungMundur(iso) {
  const t = new Date(iso), kini = new Date();
  if (isNaN(t)) return { teks: '', urgent: false };
  const selisih = t - kini;
  if (selisih <= 0) return { teks: 'Sudah lewat', urgent: false };
  const hari = Math.round((Date.parse(ymdWita(t) + 'T00:00:00Z') - Date.parse(ymdWita(kini) + 'T00:00:00Z')) / 86400000);
  const jam = Math.floor(selisih / 3600000), menit = Math.max(1, Math.floor(selisih / 60000));
  const teks = hari <= 0 ? 'Hari ini, ' + (jam >= 1 ? jam + ' jam lagi' : menit + ' menit lagi') : hari === 1 ? 'Besok' : hari + ' hari lagi';
  return { teks: teks, urgent: selisih < 3 * 86400000, jam24: selisih < 86400000 };
}
const jenisUjian = j => j === 'UTS' || j === 'UAS';

async function paintProfilAdmin() {
  const body = $('adminBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    if (!AppState.profilAdmin) AppState.profilAdmin = await call('api_profilAdmin');
    if (AppState.tab === 'Profil') renderProfilAdmin();
  } catch (e) { if ($('adminBody')) $('adminBody').innerHTML = ''; fail(e); }
}
function renderProfilAdmin() {
  const body = $('adminBody'); if (!body || !AppState.profilAdmin) return;
  const d = AppState.profilAdmin, p = d.profil;
  const pilih = (id, nilai) => '<select id="' + id + '" class="inp"><option value="">Belum ditetapkan</option>'
    + d.anggota.map(a => '<option value="' + esc(a.ID) + '"' + (a.ID === nilai ? ' selected' : '') + '>' + esc(a.Nama) + '</option>').join('') + '</select>';
  body.innerHTML = '<form class="card grid gap-4 p-5" onsubmit="kirimProfil(event)"><h2 class="font-bold">Profil Kelas (tampil di Beranda untuk semua pengunjung)</h2>'
    + '<div class="grid gap-3 md:grid-cols-3">'
    + '<div><label class="lbl" for="prKetua">Ketua Kelas</label>' + pilih('prKetua', p.ketua) + '</div>'
    + '<div><label class="lbl" for="prWakil1">Wakil Ketua Kelas I</label>' + pilih('prWakil1', p.wakil1) + '</div>'
    + '<div><label class="lbl" for="prWakil2">Wakil Ketua Kelas II</label>' + pilih('prWakil2', p.wakil2) + '</div></div>'
    + '<p class="-mt-2 text-xs text-slate-500">Pilihan diambil dari anggota yang sudah disetujui. Nama dan foto pengurus akan terlihat oleh siapa saja yang membuka tautan.</p>'
    + '<div><div class="flex items-center justify-between"><label class="lbl" for="prSambutan">Sambutan Ketua Kelas</label><span class="text-xs text-slate-500">pisahkan paragraf dengan baris baru</span></div>'
    + '<textarea id="prSambutan" class="inp" rows="9" maxlength="3000" required>' + esc(p.sambutan) + '</textarea></div>'
    + '<div><label class="lbl" for="prVisi">Visi</label><textarea id="prVisi" class="inp" rows="3" maxlength="600" required>' + esc(p.visi) + '</textarea></div>'
    + '<div><div class="flex items-center justify-between"><label class="lbl" for="prMisi">Misi</label><span class="text-xs text-slate-500">satu poin per baris</span></div>'
    + '<textarea id="prMisi" class="inp" rows="7" maxlength="3000" required>' + esc(p.misi) + '</textarea></div>'
    + '<div><button type="submit" class="btn btn-primary w-full sm:w-auto"><span class="material-symbols-outlined">save</span>Simpan Profil</button></div></form>';
}
async function kirimProfil(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  const p = { sambutan: $('prSambutan').value, visi: $('prVisi').value, misi: $('prMisi').value,
    ketua: $('prKetua').value, wakil1: $('prWakil1').value, wakil2: $('prWakil2').value };
  setBusy(btn, true, 'Menyimpan…');
  try { AppState.profilAdmin.profil = await call('api_simpanProfil', p); toast('Profil kelas disimpan.'); renderProfilAdmin(); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Jadwal Kuliah: tab di Panel Admin (jadwal tetap mingguan + atur satu pertemuan) ---- */
async function paintJadwalAdmin() {
  const body = $('adminBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    const [j, a] = await Promise.all([AppState.jadwalAdmin ? Promise.resolve(AppState.jadwalAdmin) : call('api_jadwalAdmin'), call('api_agendaAdmin', '')]);
    AppState.jadwalAdmin = j; AppState.agenda.adm = a;
    if (AppState.tab === 'Jadwal') renderJadwalAdmin();
  } catch (e) { if ($('adminBody')) $('adminBody').innerHTML = ''; fail(e); }
}
function renderJadwalAdmin() {
  const body = $('adminBody'); if (!body || !AppState.jadwalAdmin) return;
  const d = AppState.jadwalAdmin;
  const opsiMk = d.matkul.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
  const opsiHari = HARI_ID.slice(1).map((h, i) => '<option value="' + (i + 1) + '">' + h + '</option>').join('');
  const form = '<form id="frmJadwal" class="card mb-4 grid gap-3 p-5 md:grid-cols-2" onsubmit="kirimJadwal(event)"><input type="hidden" id="jwId" value="">'
    + '<h2 id="jwJudul" class="font-bold md:col-span-2">Tambah Jadwal Kuliah (berulang tiap minggu)</h2>'
    + '<div><label class="lbl" for="jwMatkul">Mata kuliah</label><select id="jwMatkul" class="inp" required>' + opsiMk + '</select></div>'
    + '<div><label class="lbl" for="jwHari">Hari</label><select id="jwHari" class="inp" required>' + opsiHari + '</select></div>'
    + '<div><label class="lbl" for="jwJm">Jam mulai (WITA)</label><input id="jwJm" class="inp" type="time" required></div>'
    + '<div><label class="lbl" for="jwJs">Jam selesai (WITA)</label><input id="jwJs" class="inp" type="time" required></div>'
    + '<div><label class="lbl" for="jwRuang">Ruang (opsional)</label><input id="jwRuang" class="inp" type="text" maxlength="80" placeholder="Contoh: R. 3.2 atau Daring"></div>'
    + '<div><label class="lbl" for="jwDosen">Dosen (opsional)</label><input id="jwDosen" class="inp" type="text" maxlength="120" placeholder="Nama dosen pengampu"></div>'
    + '<div><label class="lbl" for="jwMulai">Semester mulai</label><input id="jwMulai" class="inp" type="date" required></div>'
    + '<div><label class="lbl" for="jwSelesai">Semester selesai</label><input id="jwSelesai" class="inp" type="date" required></div>'
    + '<div class="flex flex-wrap gap-2 md:col-span-2"><button type="submit" class="btn btn-primary"><span class="material-symbols-outlined">save</span><span id="jwTombol">Simpan Jadwal</span></button>'
    + '<button type="button" id="jwBatal" class="btn btn-ghost hidden" onclick="batalUbahJadwal()">Batal ubah</button></div></form>';
  const daftar = d.jadwal.length ? d.jadwal.map(j => '<article class="card flex items-center gap-3 p-4">'
    + '<span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><span class="material-symbols-outlined">event_repeat</span></span>'
    + '<div class="min-w-0 flex-1"><h3 class="truncate font-bold">' + esc(j.MataKuliah) + '</h3>'
    + '<p class="truncate text-xs text-slate-600">Tiap ' + esc(HARI_ID[j.Hari]) + ' · ' + esc(j.JamMulai) + '–' + esc(j.JamSelesai) + (j.Ruang ? ' · ' + esc(j.Ruang) : '') + (j.Dosen ? ' · ' + esc(j.Dosen) : '') + '</p>'
    + '<p class="truncate text-xs text-slate-500">' + esc(tglSingkat(j.Mulai)) + ' s.d. ' + esc(tglSingkat(j.Selesai)) + '</p></div>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="ubahJadwal(\'' + j.ID + '\')" aria-label="Ubah jadwal"><span class="material-symbols-outlined">edit</span></button>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusJadwal(\'' + j.ID + '\')" aria-label="Hapus jadwal"><span class="material-symbols-outlined">delete</span></button></article>').join('')
    : '<div class="card p-8 text-center text-sm text-slate-500"><span class="material-symbols-outlined !text-4xl text-slate-300">event_repeat</span><p class="mt-2">Belum ada jadwal. Isi sekali, lalu Agenda terbentuk otomatis tiap minggu.</p></div>';
  body.innerHTML = form + '<div class="space-y-3">' + daftar + '</div>'
    + '<h2 class="mb-1 mt-8 flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined text-gold">calendar_month</span>Atur Pertemuan per Pekan</h2>'
    + '<p class="mb-3 text-xs text-slate-500">Batalkan atau geser satu pertemuan tanpa mengubah jadwal tetapnya. UTS dan UAS diisi lewat tab Pengumuman (jenis UTS/UAS) dan otomatis tampil di Agenda.</p>'
    + '<div id="agenda_adm" data-sig="' + esc(sigAgenda(AppState.agenda.adm)) + '">' + agendaBoxHtml('adm', AppState.agenda.adm) + '</div>';
}
async function kirimJadwal(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  const p = { id: $('jwId').value, mataKuliah: $('jwMatkul').value, hari: Number($('jwHari').value), jamMulai: $('jwJm').value, jamSelesai: $('jwJs').value,
    ruang: $('jwRuang').value.trim(), dosen: $('jwDosen').value.trim(), mulai: $('jwMulai').value, selesai: $('jwSelesai').value };
  setBusy(btn, true, 'Menyimpan…');
  try {
    AppState.jadwalAdmin = await call('api_simpanJadwal', p);
    AppState.agenda.adm = await call('api_agendaAdmin', AppState.agenda.adm ? AppState.agenda.adm.weekStart : '');
    toast(p.id ? 'Jadwal diperbarui.' : 'Jadwal ditambahkan.'); renderJadwalAdmin();
  } catch (e) { setBusy(btn, false); fail(e); }
}
function ubahJadwal(id) {
  const j = AppState.jadwalAdmin.jadwal.find(x => x.ID === id); if (!j) return;
  $('jwId').value = j.ID; $('jwMatkul').value = j.MataKuliah; $('jwHari').value = String(j.Hari);
  $('jwJm').value = j.JamMulai; $('jwJs').value = j.JamSelesai; $('jwRuang').value = j.Ruang || ''; $('jwDosen').value = j.Dosen || '';
  $('jwMulai').value = j.Mulai; $('jwSelesai').value = j.Selesai;
  $('jwJudul').textContent = 'Ubah Jadwal Kuliah'; $('jwTombol').textContent = 'Simpan Perubahan'; $('jwBatal').classList.remove('hidden');
  $('frmJadwal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function batalUbahJadwal() { renderJadwalAdmin(); }
function konfirmasiHapusJadwal(id) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus jadwal?</h2><p class="text-sm text-slate-600">Semua pertemuan dari jadwal ini hilang dari Agenda, termasuk yang pernah dibatalkan atau digeser.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="hapusJadwal(\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapusJadwal(id) {
  try {
    AppState.jadwalAdmin = await call('api_hapusJadwal', id);
    AppState.agenda.adm = await call('api_agendaAdmin', AppState.agenda.adm ? AppState.agenda.adm.weekStart : '');
    closeModal(); toast('Jadwal dihapus.'); renderJadwalAdmin();
  } catch (e) { closeModal(); fail(e); }
}

/* ---- Batalkan / geser / pulihkan satu pertemuan ---- */
async function kirimAturPertemuan(p, btn) {
  if (btn) setBusy(btn, true, 'Menyimpan…');
  try { AppState.agenda.adm = await call('api_aturPertemuan', p); closeModal(); toast('Agenda diperbarui.'); paintAgenda('adm'); }
  catch (e) { if (btn) setBusy(btn, false); fail(e); }
}
function bukaBatalPertemuan(jid, tgl) {
  openModal('<form class="p-5" onsubmit="event.preventDefault();kirimAturPertemuan({jadwalId:\'' + jid + '\',tanggal:\'' + tgl + '\',aksi:\'batal\',catatan:$(\'bpCatatan\').value.trim()},this.querySelector(\'[type=submit]\'))">'
    + '<h2 class="text-lg font-bold">Batalkan pertemuan?</h2><p class="mt-1 text-sm text-slate-600">' + esc(tglYmd(tgl)) + '. Di Agenda akan tampil "Dibatalkan"; jadwal tetapnya tidak berubah.</p>'
    + '<div class="mt-3"><label class="lbl" for="bpCatatan">Alasan (opsional)</label><input id="bpCatatan" class="inp" type="text" maxlength="200" placeholder="Contoh: Dosen dinas luar" data-autofocus></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button type="submit" class="btn btn-danger">Ya, batalkan</button></div></form>');
}
function bukaGeserPertemuan(jid, tgl) {
  openModal('<form class="p-5" onsubmit="event.preventDefault();kirimGeserPertemuan(\'' + jid + '\',\'' + tgl + '\',this)">'
    + '<h2 class="text-lg font-bold">Geser pertemuan</h2><p class="mt-1 text-sm text-slate-600">Pertemuan ' + esc(tglYmd(tgl)) + '. Kosongkan jam dan ruang bila tidak berubah.</p>'
    + '<div class="mt-3 grid gap-3 sm:grid-cols-2"><div class="sm:col-span-2"><label class="lbl" for="gsTgl">Tanggal pengganti</label><input id="gsTgl" class="inp" type="date" required value="' + tgl + '" data-autofocus></div>'
    + '<div><label class="lbl" for="gsJm">Jam mulai</label><input id="gsJm" class="inp" type="time"></div>'
    + '<div><label class="lbl" for="gsJs">Jam selesai</label><input id="gsJs" class="inp" type="time"></div>'
    + '<div class="sm:col-span-2"><label class="lbl" for="gsRuang">Ruang</label><input id="gsRuang" class="inp" type="text" maxlength="80" placeholder="Contoh: Daring"></div>'
    + '<div class="sm:col-span-2"><label class="lbl" for="gsCatatan">Catatan (opsional)</label><input id="gsCatatan" class="inp" type="text" maxlength="200" placeholder="Contoh: Diganti karena libur nasional"></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>'
    + '<button type="submit" class="btn btn-primary">Simpan</button></div></form>');
}
function kirimGeserPertemuan(jid, tgl, form) {
  kirimAturPertemuan({ jadwalId: jid, tanggal: tgl, aksi: 'geser', tanggalBaru: $('gsTgl').value, jamMulai: $('gsJm').value, jamSelesai: $('gsJs').value,
    ruang: $('gsRuang').value.trim(), catatan: $('gsCatatan').value.trim() }, form.querySelector('[type=submit]'));
}
function pulihPertemuan(jid, tgl) { kirimAturPertemuan({ jadwalId: jid, tanggal: tgl, aksi: 'pulih' }); }

/* ---- Pengumuman kelas: kartu di Beranda (anggota) dan tab di Panel Admin ---- */
/* ---- Pengumuman: satu data untuk Beranda, Instruksi Dosen, dan jadwal UTS/UAS di Agenda ---- */
const JENIS_PG = { Umum: 'bg-emerald-100 text-emerald-800', Tugas: 'bg-amber-100 text-amber-800', UTS: 'bg-red-600 text-white', UAS: 'bg-red-600 text-white' };
const pgAktif = p => !p.Tenggat || Date.parse(p.Tenggat) >= Date.now();
function berkasHtml(list) {
  if (!list || !list.length) return '';
  return '<ul class="mt-2 space-y-1">' + list.map(f => '<li class="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 text-sm ring-1 ring-slate-200">'
    + '<span class="material-symbols-outlined text-primary">' + iconTugas(f.nama) + '</span>'
    + '<a class="min-w-0 flex-1 truncate font-semibold text-primary hover:underline" target="_blank" rel="noopener" href="' + esc(f.url) + '" title="' + esc(f.nama) + '">' + esc(f.nama) + '</a>'
    + '<span class="shrink-0 text-xs text-slate-500">' + fmtUkuran(f.ukuran) + '</span>'
    + '<a class="shrink-0 text-slate-500 hover:text-primary" href="' + esc(f.unduh) + '" aria-label="Unduh ' + esc(f.nama) + '"><span class="material-symbols-outlined !text-xl">download</span></a></li>').join('') + '</ul>';
}
function waktuPgHtml(p) {
  const baris = [];
  if (jenisUjian(p.Jenis) && p.Mulai) baris.push('Mulai: ' + fmtWaktu(p.Mulai));
  if (p.Tenggat) {
    const m = hitungMundur(p.Tenggat);
    baris.push((p.Jenis === 'Tugas' ? 'Tenggat: ' : jenisUjian(p.Jenis) ? 'Berakhir: ' : 'Sampai: ') + fmtWaktu(p.Tenggat) + (m.teks && m.teks !== 'Sudah lewat' ? ' · ' + m.teks : ''));
  }
  return baris.length ? '<p class="mt-2 text-xs font-semibold text-slate-700">' + baris.map(esc).join('<br>') + '</p>' : '';
}
function instruksiBoxHtml(p) {
  if (!p.Instruksi && !(p.LampiranInstruksi && p.LampiranInstruksi.length)) return '';
  return '<div class="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><div class="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-amber-800"><span class="material-symbols-outlined !text-base">assignment</span>Instruksi Dosen</div>'
    + (p.Instruksi ? '<p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">' + esc(p.Instruksi) + '</p>' : '') + berkasHtml(p.LampiranInstruksi) + '</div>';
}
function pengumumanHtml(list) {
  const aktif = (list || []).filter(pgAktif);
  if (!list || (!aktif.length && !AppState.isAdmin)) return ''; // tamu dan anggota tidak perlu melihat bagian kosong
  const kartu = aktif.map(p => '<article tabindex="0" data-tenggat="' + esc(p.Tenggat || '') + '" class="card pg-kartu p-4 ' + (p.Penting ? 'pg-penting' : 'pg-biasa') + '">'
    + '<div class="pg-pita"><span class="material-symbols-outlined !text-base">' + (p.Penting ? 'priority_high' : 'campaign') + '</span>' + (p.Penting ? 'Penting' : 'Pengumuman') + '</div>'
    + '<div class="flex flex-wrap items-center gap-2">'
    + (p.Jenis !== 'Umum' ? '<span class="chip ' + (JENIS_PG[p.Jenis] || JENIS_PG.Umum) + '">' + esc(p.Jenis) + '</span>' : '')
    + (p.MataKuliah ? '<span class="chip bg-primary-soft text-primary">' + esc(p.MataKuliah) + '</span>' : '')
    + '<span class="text-xs text-slate-500">' + esc(tgl(p.Dibuat)) + '</span></div>'
    + '<h3 class="mt-2 text-lg font-extrabold leading-snug">' + esc(p.Judul) + '</h3>'
    + '<p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">' + esc(p.Isi) + '</p>'
    + waktuPgHtml(p) + berkasHtml(p.Lampiran) + instruksiBoxHtml(p) + '</article>').join('');
  return '<section class="mt-6" aria-label="Pengumuman"><div class="mb-3 flex items-center justify-between gap-3">'
    + '<h2 class="flex items-center gap-2 text-lg font-bold text-primary-dark"><span class="material-symbols-outlined">campaign</span>Pengumuman</h2>'
    + (AppState.isAdmin ? '<button type="button" class="btn btn-ghost !min-h-[36px]" onclick="bukaPengumumanAdmin()"><span class="material-symbols-outlined">edit_note</span>Kelola</button>' : '') + '</div>'
    + (aktif.length ? '<div id="pgDaftar" class="grid gap-4 md:grid-cols-2">' + kartu + '</div>'
      : '<div class="card p-6 text-center text-sm text-slate-500">Belum ada pengumuman. Tekan Kelola untuk menulis pengumuman pertama.</div>') + '</section>';
}
function bukaPengumumanAdmin() { AppState.tab = 'Pengumuman'; AppState.pengumumanAdm = null; navigateTo('admin'); }

async function paintPengumumanAdmin() {
  const body = $('adminBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    if (!AppState.pengumumanAdm) AppState.pengumumanAdm = await call('api_pengumumanAdmin');
    if (AppState.tab === 'Pengumuman') renderPengumumanAdmin();
  } catch (e) { if ($('adminBody')) $('adminBody').innerHTML = ''; fail(e); }
}
function daftarBerkasAdminHtml(bagian) {
  const list = AppState.pgFiles[bagian] || [];
  return list.map((f, i) => '<li class="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm ring-1 ring-slate-200"><span class="material-symbols-outlined text-primary">' + iconTugas(f.nama) + '</span>'
    + '<span class="min-w-0 flex-1 truncate">' + esc(f.nama) + '</span><span class="shrink-0 text-xs text-slate-500">' + fmtUkuran(f.ukuran) + '</span>'
    + '<button type="button" class="btn btn-ghost !min-h-[32px] !px-2 !text-red-700" onclick="lepasBerkasPg(\'' + bagian + '\',' + i + ')" aria-label="Lepas ' + esc(f.nama) + '"><span class="material-symbols-outlined !text-xl">close</span></button></li>').join('');
}
function paintBerkasPg() {
  ['lampiran', 'instruksi'].forEach(b => { const el = $('pgBerkas_' + b); if (el) el.innerHTML = daftarBerkasAdminHtml(b); });
}
function lepasBerkasPg(bagian, i) { AppState.pgFiles[bagian].splice(i, 1); paintBerkasPg(); }
/** Unggah file satu per satu (maks. 15 MB per file); tiap file langsung masuk ke Drive dan muncul di daftar. */
async function pilihBerkasPg(inp, bagian) {
  const files = Array.from(inp.files || []); inp.value = '';
  const info = $('pgInfo_' + bagian);
  for (const f of files) {
    if (AppState.pgFiles[bagian].length >= 30) { toast('Maksimal 30 file per bagian.', 'error'); break; }
    if (f.size > 15 * 1024 * 1024) { toast(f.name + ': ukuran melebihi 15 MB.', 'error'); continue; }
    AppState.pgUnggah++;
    if (info) info.textContent = 'Mengunggah ' + f.name + ' (' + fmtUkuran(f.size) + ')…';
    try {
      const d = await fileToDataUrl(f);
      const r = await call('api_unggahLampiran', d, f.name);
      AppState.pgFiles[bagian].push(r); paintBerkasPg();
    } catch (e) { toast(f.name + ': ' + (e.message || 'gagal diunggah'), 'error'); }
    AppState.pgUnggah--;
  }
  if ($('pgInfo_' + bagian)) $('pgInfo_' + bagian).textContent = '';
}
function renderPengumumanAdmin() {
  const body = $('adminBody'); if (!body || !AppState.pengumumanAdm) return;
  const rows = AppState.pengumumanAdm.rows, matkul = AppState.pengumumanAdm.matkul || [];
  AppState.pgFiles = { lampiran: [], instruksi: [] };
  const opsiMk = '<option value="">Umum (tanpa mata kuliah)</option>' + matkul.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
  const opsiJenis = [['Umum', 'Umum'], ['Tugas', 'Tugas'], ['UTS', 'UTS'], ['UAS', 'UAS']].map(j => '<option value="' + j[0] + '">' + j[1] + '</option>').join('');
  const berkas = (b, label) => '<div><label class="lbl">' + label + '</label>'
    + '<input type="file" multiple class="inp" onchange="pilihBerkasPg(this,\'' + b + '\')" aria-label="' + label + '">'
    + '<p class="mt-1 text-xs text-slate-500">Semua format, maks. 15 MB per file, boleh banyak file sekaligus.</p>'
    + '<p id="pgInfo_' + b + '" class="text-xs font-semibold text-primary"></p><ul id="pgBerkas_' + b + '" class="mt-1 space-y-1"></ul></div>';
  const form = '<form id="frmPengumuman" class="card mb-4 grid gap-3 p-5 md:grid-cols-2" onsubmit="kirimPengumuman(event)"><input type="hidden" id="pgId" value="">'
    + '<h2 id="pgJudulForm" class="font-bold md:col-span-2">Tulis Pengumuman</h2>'
    + '<div><label class="lbl" for="pgJenis">Jenis</label><select id="pgJenis" class="inp" onchange="aturFormPengumuman()">' + opsiJenis + '</select></div>'
    + '<div id="pgMkBox" class="hidden"><label class="lbl" for="pgMatkul">Mata kuliah</label><select id="pgMatkul" class="inp">' + opsiMk + '</select></div>'
    + '<div class="md:col-span-2"><label class="lbl" for="pgJudul">Judul</label><input id="pgJudul" class="inp" type="text" maxlength="120" required placeholder="Contoh: Kumpul kelompok Sabtu"></div>'
    + '<div class="md:col-span-2"><label class="lbl" for="pgIsi">Isi pengumuman</label><textarea id="pgIsi" class="inp" rows="4" maxlength="1500" required placeholder="Tulis info yang perlu diketahui teman sekelas"></textarea></div>'
    + '<div id="pgMulaiBox" class="hidden md:col-span-2"><label class="lbl" for="pgMulai">Tanggal dan jam mulai ujian (WITA)</label><input id="pgMulai" class="inp" type="datetime-local">'
    + '<p class="mt-1 text-xs text-slate-500">Jadwal ini otomatis tampil di Agenda.</p></div>'
    + '<div><label class="lbl" for="pgBerakhir" id="pgBerakhirLbl">Tanggal berakhir (opsional)</label><input id="pgBerakhir" class="inp" type="date">'
    + '<p id="pgBerakhirInfo" class="mt-1 text-xs text-slate-500"></p></div>'
    + '<div><label class="lbl" for="pgBerakhirJam" id="pgJamLbl">Jam berakhir (opsional)</label><input id="pgBerakhirJam" class="inp" type="time">'
    + '<p id="pgJamInfo" class="mt-1 text-xs text-slate-500"></p></div>'
    + '<div class="md:col-span-2">' + berkas('lampiran', 'Lampiran pengumuman (opsional)') + '</div>'
    + '<div id="pgInstruksiBox" class="hidden space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 md:col-span-2">'
    + '<div><label class="lbl" for="pgInstruksi">Instruksi dosen (opsional)</label><textarea id="pgInstruksi" class="inp" rows="4" maxlength="3000" placeholder="Salin instruksi dari dosen."></textarea></div>'
    + berkas('instruksi', 'File instruksi dosen (opsional)') + '</div>'
    + '<label class="flex cursor-pointer items-center gap-3 md:col-span-2"><input id="pgPenting" type="checkbox" class="h-5 w-5 accent-[#0d5c3a]"><span class="font-semibold">Tandai penting (tampil merah menyala)</span></label>'
    + '<div class="flex flex-wrap gap-2 md:col-span-2"><button type="submit" class="btn btn-primary"><span class="material-symbols-outlined">campaign</span><span id="pgTombol">Terbitkan</span></button>'
    + '<button type="button" id="pgBatalUbah" class="btn btn-ghost hidden" onclick="batalUbahPengumuman()">Batal ubah</button></div>'
    + '<p class="text-xs text-slate-500 md:col-span-2">Pengumuman, lampiran, dan instruksi dosen tampil untuk umum di Beranda tanpa login. Jangan menulis info rahasia (nomor HP, kata sandi, tautan grup). Pengumuman baru dikabarkan ke anggota lewat WhatsApp bila notifikasi aktif.</p></form>';
  const daftar = rows.length ? rows.map(p => '<article class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start' + (p.Aktif ? '' : ' opacity-70') + '">'
    + '<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2">'
    + (p.Penting ? '<span class="chip bg-red-100 text-red-700">Penting</span>' : '')
    + '<span class="chip ' + (JENIS_PG[p.Jenis] || JENIS_PG.Umum) + '">' + esc(p.Jenis) + '</span>'
    + (p.MataKuliah ? '<span class="chip bg-primary-soft text-primary">' + esc(p.MataKuliah) + '</span>' : '')
    + (p.Aktif ? '<span class="chip bg-emerald-100 text-emerald-800">Tampil</span>' : '<span class="chip bg-slate-200 text-slate-700">Sudah berakhir</span>')
    + '<span class="text-xs text-slate-500">' + esc(tgl(p.Dibuat)) + (p.Tenggat ? ' · berakhir ' + esc(fmtWaktu(p.Tenggat)) : ' · tanpa batas') + '</span></div>'
    + '<h3 class="mt-1 font-bold">' + esc(p.Judul) + '</h3>'
    + '<p class="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-600">' + esc(p.Isi) + '</p>'
    + (p.Lampiran.length || p.LampiranInstruksi.length || p.Instruksi ? '<p class="mt-1 text-xs text-slate-500">' + (p.Lampiran.length ? p.Lampiran.length + ' lampiran' : '') + (p.Instruksi || p.LampiranInstruksi.length ? ((p.Lampiran.length ? ' · ' : '') + 'ada instruksi dosen' + (p.LampiranInstruksi.length ? ' (' + p.LampiranInstruksi.length + ' file)' : '')) : '') + '</p>' : '')
    + '</div>'
    + '<div class="flex shrink-0 gap-2"><button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="ubahPengumuman(\'' + p.ID + '\')" aria-label="Ubah ' + esc(p.Judul) + '"><span class="material-symbols-outlined">edit</span></button>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusPengumuman(\'' + p.ID + '\')" aria-label="Hapus ' + esc(p.Judul) + '"><span class="material-symbols-outlined">delete</span></button></div></article>').join('')
    : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">campaign</span><p class="mt-2">Belum ada pengumuman.</p></div>';
  body.innerHTML = form + '<div class="space-y-3">' + daftar + '</div>';
  aturFormPengumuman();
}
/** Isian menyesuaikan jenis: ujian punya jam mulai; Tugas/UTS/UAS punya mata kuliah dan instruksi dosen; Tugas wajib bertenggat. */
function aturFormPengumuman() {
  const j = $('pgJenis') ? $('pgJenis').value : 'Umum', khusus = j !== 'Umum', ujian = jenisUjian(j);
  $('pgMkBox').classList.toggle('hidden', !khusus);
  $('pgInstruksiBox').classList.toggle('hidden', !khusus);
  $('pgMulaiBox').classList.toggle('hidden', !ujian);
  $('pgMulai').required = ujian;
  $('pgBerakhir').required = j === 'Tugas';
  $('pgBerakhirLbl').textContent = j === 'Tugas' ? 'Tenggat tugas (tanggal)' : ujian ? 'Tanggal berakhir ujian' : 'Tanggal berakhir (opsional)';
  $('pgJamLbl').textContent = j === 'Tugas' ? 'Jam tenggat (kosong = akhir hari)' : ujian ? 'Jam selesai ujian (opsional)' : 'Jam berakhir (opsional)';
  $('pgBerakhirInfo').textContent = ujian ? 'Isi bila ujian berlangsung beberapa hari (misal 9–13 November). Kosongkan untuk ujian satu hari.'
    : 'Pengumuman hilang dari Beranda setelah tanggal dan jam ini lewat. ' + (j === 'Tugas' ? '' : 'Kosongkan bila tanpa batas.');
  $('pgJamInfo').textContent = ujian ? 'Kosong = 2 jam dari jam mulai. Ujian berperiode menyala seharian di Agenda.' : 'Kosong = sampai akhir hari tanggal berakhir.';
}
function ubahPengumuman(id) {
  const p = AppState.pengumumanAdm.rows.find(x => x.ID === id); if (!p) return;
  $('pgId').value = p.ID; $('pgJenis').value = p.Jenis; aturFormPengumuman();
  $('pgMatkul').value = p.MataKuliah || ''; $('pgJudul').value = p.Judul; $('pgIsi').value = p.Isi;
  $('pgMulai').value = p.Mulai ? p.Mulai.slice(0, 16) : ''; $('pgBerakhir').value = p.Berakhir || ''; $('pgBerakhirJam').value = p.BerakhirJam || '';
  $('pgInstruksi').value = p.Instruksi || ''; $('pgPenting').checked = !!p.Penting;
  AppState.pgFiles = { lampiran: p.Lampiran.map(f => ({ id: f.id, nama: f.nama, ukuran: f.ukuran })), instruksi: p.LampiranInstruksi.map(f => ({ id: f.id, nama: f.nama, ukuran: f.ukuran })) };
  paintBerkasPg();
  $('pgJudulForm').textContent = 'Ubah Pengumuman'; $('pgTombol').textContent = 'Simpan Perubahan'; $('pgBatalUbah').classList.remove('hidden');
  $('frmPengumuman').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('pgJudul').focus();
}
function batalUbahPengumuman() { renderPengumumanAdmin(); }
async function kirimPengumuman(ev) {
  ev.preventDefault();
  if (AppState.pgUnggah > 0) return toast('Tunggu, file masih diunggah.', 'error');
  const btn = ev.target.querySelector('[type=submit]');
  const j = $('pgJenis').value, mulai = $('pgMulai').value;
  const p = { id: $('pgId').value, jenis: j, mataKuliah: $('pgMatkul').value, judul: $('pgJudul').value.trim(), isi: $('pgIsi').value.trim(), penting: $('pgPenting').checked,
    mulai: jenisUjian(j) && mulai ? mulai + ':00+08:00' : '', berakhir: $('pgBerakhir').value, berakhirJam: $('pgBerakhirJam').value,
    instruksi: $('pgInstruksi').value.trim(), lampiran: AppState.pgFiles.lampiran, lampiranInstruksi: AppState.pgFiles.instruksi };
  const ubah = !!p.id;
  setBusy(btn, true, 'Menyimpan…');
  try { AppState.pengumumanAdm = await call('api_simpanPengumuman', p); toast(ubah ? 'Pengumuman diperbarui.' : 'Pengumuman diterbitkan.'); renderPengumumanAdmin(); }
  catch (e) { setBusy(btn, false); fail(e); }
}
function konfirmasiHapusPengumuman(id) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus pengumuman?</h2><p class="text-sm text-slate-600">Pengumuman, lampiran, dan instruksi dosen akan hilang (file di Drive ikut dihapus). Bila berupa jadwal UTS/UAS, jadwalnya juga hilang dari Agenda. Tindakan ini tidak dapat dibatalkan.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="hapusPengumuman(\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapusPengumuman(id) {
  try { AppState.pengumumanAdm = await call('api_hapusPengumuman', id); closeModal(); toast('Pengumuman dihapus.'); renderPengumumanAdmin(); }
  catch (e) { closeModal(); fail(e); }
}

/* ---- Notifikasi WhatsApp & email: tab di Panel Admin (konfigurasi, blast WhatsApp, antrean) ---- */
const NOTIF_SUB = [['konfig', 'Konfigurasi', 'settings'], ['blast', 'Blast WhatsApp', 'campaign'], ['antrean', 'Antrean', 'inbox']];
const waktuNotif = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('id-ID', { timeZone: 'Asia/Makassar', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const notifChip = s => {
  const m = { Antri: 'bg-amber-100 text-amber-800', Terkirim: 'bg-emerald-100 text-emerald-800', Gagal: 'bg-red-100 text-red-800', Batal: 'bg-slate-200 text-slate-700',
    Berjalan: 'bg-amber-100 text-amber-800', Selesai: 'bg-emerald-100 text-emerald-800', Dihentikan: 'bg-slate-200 text-slate-700' };
  return '<span class="chip ' + (m[s] || 'bg-slate-100 text-slate-700') + '">' + esc(s) + '</span>';
};

async function paintNotifAdmin() {
  const body = $('adminBody'); if (!body) return;
  const sub = AppState.notifSub || 'konfig';
  body.innerHTML = '<div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Bagian notifikasi">'
    + NOTIF_SUB.map(s => '<button type="button" class="btn ' + (s[0] === sub ? 'btn-primary' : 'btn-ghost') + ' !min-h-[40px]" aria-pressed="' + (s[0] === sub) + '" onclick="setNotifSub(\'' + s[0] + '\')">'
      + '<span class="material-symbols-outlined">' + s[2] + '</span>' + s[1] + '</button>').join('') + '</div><div id="notifBody">' + loadingHtml() + '</div>';
  const masihDi = () => AppState.tab === 'Notifikasi' && (AppState.notifSub || 'konfig') === sub && $('notifBody');
  try {
    if (sub === 'konfig') { AppState.notifCfg = await call('api_notifKonfig'); if (masihDi()) renderNotifKonfig(); }
    else if (sub === 'blast') {
      const [aud, daftar] = await Promise.all([call('api_notifAudience'), call('api_blastDaftar')]);
      AppState.notifAud = aud; AppState.blastList = daftar;
      if (!AppState.blastPilih) AppState.blastPilih = new Set(aud.filter(a => a.valid).map(a => a.id));
      if (masihDi()) renderNotifBlast();
    } else { AppState.notifAnt = await call('api_notifAntrean'); if (masihDi()) renderNotifAntrean(); }
  } catch (e) { if ($('notifBody')) $('notifBody').innerHTML = ''; fail(e); }
}
function setNotifSub(s) { AppState.notifSub = s; paintNotifAdmin(); }

/* -- Konfigurasi -- */
function renderNotifKonfig() {
  const box = $('notifBody'); if (!box || !AppState.notifCfg) return;
  const c = AppState.notifCfg, boleh = AppState.isUtama, dis = boleh ? '' : ' disabled';
  const switchHtml = (id, on, teks) => '<label class="flex cursor-pointer items-center gap-3"><input id="' + id + '" type="checkbox" class="h-5 w-5 accent-[#0d5c3a]"' + (on ? ' checked' : '') + dis + '><span class="font-semibold">' + teks + '</span></label>';
  const baris = c.matriks.map(m => '<div class="flex flex-col gap-3 border-t border-slate-200 py-3 sm:flex-row sm:items-center">'
    + '<div class="min-w-0 flex-1"><div class="font-semibold">' + esc(m.label) + '</div><div class="text-xs text-slate-500">Dikirim ke: ' + esc(m.untuk) + '</div></div>'
    + '<div class="flex items-center gap-5">'
    + '<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-[#0d5c3a]"' + (m.wa ? ' checked' : '') + dis + ' onchange="setMatriksKanal(\'' + m.kode + '\',\'wa\',this.checked)" aria-label="WhatsApp ' + esc(m.label) + '">WhatsApp</label>'
    + '<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-[#0d5c3a]"' + (m.email ? ' checked' : '') + dis + ' onchange="setMatriksKanal(\'' + m.kode + '\',\'email\',this.checked)" aria-label="Email ' + esc(m.label) + '">Email</label>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3"' + dis + ' onclick="bukaEditPesan(\'' + m.kode + '\')" aria-label="Ubah isi pesan ' + esc(m.label) + '"><span class="material-symbols-outlined">edit_note</span>Isi pesan</button>'
    + '</div></div>').join('');
  box.innerHTML = (boleh ? '' : '<p class="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Konfigurasi hanya dapat diubah oleh admin utama. Anda tetap bisa melihat antrean dan mengirim blast.</p>')
    + '<div class="mb-4 rounded-xl p-3 text-sm ' + (c.triggerAktif ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800') + '">'
    + (c.triggerAktif ? 'Pemicu pengiriman aktif (memeriksa antrean tiap 1 menit).' : 'Pemicu pengiriman belum terpasang. Jalankan fungsi pasangTriggerNotif sekali dari editor Apps Script, lihat panduan.') + '</div>'
    + (c.linkAda ? '' : '<p class="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">SITE_URL belum diisi, sehingga tautan di pesan akan kosong. Jalankan aturAlamatSitus dari editor.</p>')
    + '<form onsubmit="simpanNotif(event)" class="space-y-4">'
    + '<section class="card grid gap-4 p-5 md:grid-cols-2"><h2 class="font-bold md:col-span-2">WhatsApp (Fonnte)</h2>'
    + '<div class="md:col-span-2">' + switchHtml('ntWa', c.waAktif, 'Aktifkan notifikasi WhatsApp') + '</div>'
    + '<div class="md:col-span-2"><label class="lbl" for="ntToken">Token Fonnte</label><input id="ntToken" class="inp" type="password" autocomplete="off"' + dis
    + ' placeholder="' + esc(c.tokenAda ? c.tokenMask + ' (tersimpan, kosongkan bila tidak diganti)' : 'Tempel token dari fonnte.com') + '">'
    + '<p class="mt-1 text-xs text-slate-500">Token disimpan di server (Script Properties) dan tidak pernah ditampilkan lagi.</p>'
    + (c.tokenAda && boleh ? '<button type="button" class="btn btn-ghost mt-2 !min-h-[40px] !text-red-700" onclick="simpanNotif(null,true)">Hapus token</button>' : '') + '</div>'
    + '<div><label class="lbl" for="ntBatch">Ukuran batch blast</label><select id="ntBatch" class="inp"' + dis + '>'
    + [10, 20, 50].map(b => '<option value="' + b + '"' + (b === c.batch ? ' selected' : '') + '>' + b + ' pesan per putaran</option>').join('') + '</select></div>'
    + '<div><label class="lbl" for="ntJeda">Jeda antarpesan (detik)</label><input id="ntJeda" class="inp" type="text" inputmode="numeric" value="' + esc(c.jeda) + '"' + dis + ' placeholder="5 atau 3-8">'
    + '<p class="mt-1 text-xs text-slate-500">Isi satu angka, atau rentang acak seperti 3-8. Jeda yang lebih lama lebih aman dari pemblokiran.</p></div>'
    + '<div class="flex flex-wrap items-center gap-2 md:col-span-2"><button type="button" class="btn btn-ghost" onclick="cekPerangkatNotif(this)"><span class="material-symbols-outlined">sensors</span>Cek Perangkat</button>'
    + '<span id="ntDevice" class="text-sm text-slate-600"></span></div>'
    + '<div class="md:col-span-2"><label class="lbl" for="ntTesWa">Kirim pesan tes</label><div class="flex gap-2"><input id="ntTesWa" class="inp flex-1" type="tel" inputmode="tel" placeholder="Nomor tujuan, contoh 081234567890">'
    + '<button type="button" class="btn btn-ghost shrink-0" onclick="tesNotif(\'WA\',\'ntTesWa\',this)">Kirim Tes</button></div>'
    + '<p class="mt-1 text-xs text-slate-500">Tes memakai token yang sudah tersimpan. Simpan konfigurasi dulu bila baru mengganti token.</p></div></section>'
    + '<section class="card grid gap-4 p-5"><h2 class="font-bold">Email</h2>' + switchHtml('ntEmail', c.emailAktif, 'Aktifkan notifikasi email')
    + '<p class="text-sm text-slate-600">Sisa kuota email hari ini: <b>' + c.kuotaEmail + '</b> (akun Gmail biasa sekitar 100 per hari).</p>'
    + '<div><label class="lbl" for="ntTesEmail">Kirim email tes</label><div class="flex gap-2"><input id="ntTesEmail" class="inp flex-1" type="email" placeholder="Alamat email tujuan">'
    + '<button type="button" class="btn btn-ghost shrink-0" onclick="tesNotif(\'EMAIL\',\'ntTesEmail\',this)">Kirim Tes</button></div></div></section>'
    + '<section class="card p-5"><h2 class="font-bold">Kejadian yang memicu notifikasi</h2><p class="mb-2 text-sm text-slate-500">Pilih kanal untuk tiap kejadian. Kanal yang saklar utamanya mati tidak akan mengirim.</p>' + baris + '</section>'
    + (boleh ? '<div><button type="submit" class="btn btn-primary w-full sm:w-auto"><span class="material-symbols-outlined">save</span>Simpan Konfigurasi</button></div>' : '')
    + '</form>';
}
function setMatriksKanal(kode, kanal, nilai) {
  const m = AppState.notifCfg.matriks.find(x => x.kode === kode); if (m) m[kanal] = !!nilai;
}
function bukaEditPesan(kode) {
  const m = AppState.notifCfg.matriks.find(x => x.kode === kode); if (!m) return;
  openModal('<form class="p-5" onsubmit="event.preventDefault();simpanEditPesan(\'' + kode + '\')"><h2 class="text-lg font-bold">' + esc(m.label) + '</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Variabel yang bisa dipakai: <code class="break-all text-xs">' + esc(m.vars) + '</code>. Gunakan *teks* untuk huruf tebal.</p>'
    + '<div class="mt-3"><label class="lbl" for="epSubjek">Subjek email</label><input id="epSubjek" class="inp" type="text" maxlength="150" value="' + esc(m.subjek) + '"></div>'
    + '<div class="mt-3"><label class="lbl" for="epPesan">Isi pesan (WhatsApp dan email)</label><textarea id="epPesan" class="inp" rows="8" maxlength="1000" required data-autofocus>' + esc(m.pesan) + '</textarea></div>'
    + '<div class="mt-5 flex flex-wrap justify-between gap-2"><button type="button" class="btn btn-ghost" onclick="pulihkanPesanBawaan(\'' + kode + '\')">Kembalikan bawaan</button>'
    + '<div class="flex gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div></div></form>');
}
function pulihkanPesanBawaan(kode) {
  const m = AppState.notifCfg.matriks.find(x => x.kode === kode); if (!m) return;
  $('epSubjek').value = m.subjekDefault; $('epPesan').value = m.pesanDefault;
}
function simpanEditPesan(kode) {
  const m = AppState.notifCfg.matriks.find(x => x.kode === kode); if (!m) return;
  m.subjek = $('epSubjek').value.trim() || m.subjekDefault; m.pesan = $('epPesan').value.trim() || m.pesanDefault;
  closeModal(); toast('Isi pesan diubah. Tekan Simpan Konfigurasi agar berlaku.');
}
async function simpanNotif(ev, hapusToken) {
  if (ev) ev.preventDefault();
  const c = AppState.notifCfg, matriks = {};
  c.matriks.forEach(m => { matriks[m.kode] = { wa: m.wa, email: m.email, subjek: m.subjek, pesan: m.pesan }; });
  const p = { token: hapusToken ? '__HAPUS__' : $('ntToken').value.trim(), waAktif: $('ntWa').checked, emailAktif: $('ntEmail').checked,
    batch: Number($('ntBatch').value), jeda: $('ntJeda').value.trim(), matriks: matriks };
  if (hapusToken) p.waAktif = false;
  const btn = ev ? ev.target.querySelector('[type=submit]') : null;
  if (btn) setBusy(btn, true, 'Menyimpan…');
  try { AppState.notifCfg = await call('api_notifSimpan', p); toast(hapusToken ? 'Token dihapus.' : 'Konfigurasi disimpan.'); renderNotifKonfig(); }
  catch (e) { if (btn) setBusy(btn, false); fail(e); }
}
async function cekPerangkatNotif(btn) {
  const out = $('ntDevice'); setBusy(btn, true, 'Memeriksa…'); out.textContent = '';
  try {
    const d = await call('api_notifDevice');
    out.textContent = 'Nomor ' + d.nomor + ' · ' + (d.status === 'connect' ? 'terhubung' : d.status || 'tidak diketahui') + (d.paket ? ' · paket ' + d.paket : '') + (d.kuota ? ' · kuota ' + d.kuota : '');
    out.className = 'text-sm ' + (d.status === 'connect' ? 'text-emerald-700' : 'text-amber-700');
  } catch (e) { out.textContent = ''; fail(e); }
  setBusy(btn, false);
}
async function tesNotif(kanal, inputId, btn) {
  setBusy(btn, true, 'Mengirim…');
  try { toast(await call('api_notifUji', { kanal: kanal, tujuan: $(inputId).value.trim() })); }
  catch (e) { fail(e); }
  setBusy(btn, false);
}

/* -- Blast WhatsApp -- */
function ringkasBlastPilih() {
  const n = AppState.blastPilih ? AppState.blastPilih.size : 0;
  return n + ' penerima dipilih';
}
function renderNotifBlast() {
  const box = $('notifBody'); if (!box) return;
  const aud = AppState.notifAud || [], pilih = AppState.blastPilih || new Set();
  const cfg = AppState.notifCfg;
  const daftarAud = aud.length ? aud.map(a => '<label class="flex items-center gap-3 border-t border-slate-200 py-2' + (a.valid ? ' cursor-pointer' : ' opacity-60') + '">'
    + '<input type="checkbox" class="h-5 w-5 accent-[#0d5c3a]"' + (pilih.has(a.id) ? ' checked' : '') + (a.valid ? '' : ' disabled') + ' onchange="togglePenerima(\'' + a.id + '\',this.checked)">'
    + '<span class="min-w-0 flex-1 truncate font-medium">' + esc(a.nama) + '</span><span class="text-xs ' + (a.valid ? 'text-slate-500' : 'text-red-700') + '">' + (a.valid ? esc(a.hp) : 'nomor tidak valid') + '</span></label>').join('')
    : '<p class="py-6 text-center text-slate-500">Belum ada anggota yang disetujui.</p>';
  const blast = (AppState.blastList || []).length ? AppState.blastList.map(b => '<article class="card p-4"><div class="flex flex-wrap items-center justify-between gap-2">'
    + '<h3 class="font-bold">' + esc(b.Judul) + '</h3>' + notifChip(b.Status) + '</div>'
    + '<div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div class="h-2 rounded-full bg-primary" style="width:' + b.Persen + '%"></div></div>'
    + '<p class="mt-2 text-sm text-slate-600">Terkirim ' + b.Terkirim + (b.Gagal ? ' · gagal ' + b.Gagal : '') + (b.Status === 'Berjalan' ? ' · sisa ' + b.Sisa : '') + ' dari ' + b.Total
    + ' · batch ' + b.UkuranBatch + ' · jeda ' + esc(b.JedaDetik) + ' dtk · ' + waktuNotif(b.Dibuat) + '</p>'
    + (b.Status === 'Berjalan' ? '<div class="mt-3 flex flex-wrap gap-2"><button type="button" class="btn btn-primary !min-h-[40px]" onclick="prosesBlast(\'' + b.ID + '\',this)"><span class="material-symbols-outlined">send</span>Kirim batch berikutnya sekarang</button>'
      + '<button type="button" class="btn btn-ghost !min-h-[40px] !text-red-700" onclick="hentiBlast(\'' + b.ID + '\')"><span class="material-symbols-outlined">stop_circle</span>Hentikan</button></div>'
      + '<p class="mt-2 text-xs text-slate-500">Server tetap mengirim satu batch tiap menit walau halaman ini ditutup.</p>' : '') + '</article>').join('')
    : '<p class="rounded-xl bg-white p-6 text-center text-slate-500">Belum ada blast.</p>';
  box.innerHTML = '<div class="grid gap-6 lg:grid-cols-12"><form class="card space-y-3 p-5 lg:col-span-5" onsubmit="mulaiBlast(event)"><h2 class="font-bold">Tulis Pesan</h2>'
    + '<div><label class="lbl" for="blJudul">Judul (hanya untuk catatan admin)</label><input id="blJudul" class="inp" type="text" maxlength="80" required placeholder="Contoh: Info kumpul kelompok"></div>'
    + '<div><label class="lbl" for="blPesan">Isi pesan</label><textarea id="blPesan" class="inp" rows="7" maxlength="1000" required placeholder="Assalamu\'alaikum {nama}, ..."></textarea>'
    + '<p class="mt-1 text-xs text-slate-500">{nama} diganti nama panggilan tiap penerima. Gunakan *teks* untuk huruf tebal.</p></div>'
    + '<div class="grid grid-cols-2 gap-3"><div><label class="lbl" for="blBatch">Ukuran batch</label><select id="blBatch" class="inp">'
    + [10, 20, 50].map(b => '<option value="' + b + '"' + (cfg && cfg.batch === b ? ' selected' : (!cfg && b === 20 ? ' selected' : '')) + '>' + b + '</option>').join('') + '</select></div>'
    + '<div><label class="lbl" for="blJeda">Jeda (detik)</label><input id="blJeda" class="inp" type="text" inputmode="numeric" value="' + esc(cfg ? cfg.jeda : '5') + '" placeholder="5 atau 3-8"></div></div>'
    + '<p id="blRingkas" class="text-sm text-slate-600">' + ringkasBlastPilih() + '</p>'
    + '<button type="submit" class="btn btn-primary w-full"><span class="material-symbols-outlined">campaign</span>Mulai Blast</button>'
    + '<p class="text-xs text-slate-500">Tips: mulai dari batch 10 dengan jeda acak 5-10 detik, dan jangan mengirim tautan yang sama ke banyak orang dalam waktu singkat.</p></form>'
    + '<section class="card p-5 lg:col-span-7"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-bold">Pilih Penerima</h2>'
    + '<div class="flex gap-2"><button type="button" class="btn btn-ghost !min-h-[40px]" onclick="pilihSemuaPenerima(true)">Pilih semua</button><button type="button" class="btn btn-ghost !min-h-[40px]" onclick="pilihSemuaPenerima(false)">Kosongkan</button></div></div>'
    + '<div id="blAud" class="mt-2 max-h-96 overflow-y-auto">' + daftarAud + '</div></section></div>'
    + '<h2 class="mb-3 mt-8 font-bold">Riwayat Blast</h2><div class="space-y-3">' + blast + '</div>';
}
function togglePenerima(id, on) {
  if (!AppState.blastPilih) AppState.blastPilih = new Set();
  if (on) AppState.blastPilih.add(id); else AppState.blastPilih.delete(id);
  if ($('blRingkas')) $('blRingkas').textContent = ringkasBlastPilih();
}
function pilihSemuaPenerima(on) {
  AppState.blastPilih = new Set(on ? (AppState.notifAud || []).filter(a => a.valid).map(a => a.id) : []);
  document.querySelectorAll('#blAud input[type=checkbox]:not(:disabled)').forEach(c => { c.checked = on; });
  if ($('blRingkas')) $('blRingkas').textContent = ringkasBlastPilih();
}
async function mulaiBlast(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]');
  const p = { judul: $('blJudul').value.trim(), pesan: $('blPesan').value.trim(), ukuranBatch: Number($('blBatch').value), jeda: $('blJeda').value.trim(), ids: Array.from(AppState.blastPilih || []) };
  setBusy(btn, true, 'Menyiapkan…');
  try { AppState.blastList = await call('api_blastBuat', p); toast('Blast dimulai. Batch pertama dikirim dalam satu menit.'); renderNotifBlast(); }
  catch (e) { setBusy(btn, false); fail(e); }
}
async function prosesBlast(id, btn) {
  setBusy(btn, true, 'Mengirim…');
  try { AppState.blastList = await call('api_blastProses', id); renderNotifBlast(); toast('Satu batch diproses.'); }
  catch (e) { setBusy(btn, false); fail(e); }
}
async function hentiBlast(id) {
  try { AppState.blastList = await call('api_blastHenti', id); renderNotifBlast(); toast('Blast dihentikan.'); } catch (e) { fail(e); }
}

/* -- Antrean -- */
function renderNotifAntrean() {
  const box = $('notifBody'); if (!box || !AppState.notifAnt) return;
  const d = AppState.notifAnt, f = AppState.antreanFilter || '';
  const rows = d.rows.filter(r => !f || r.Status === f);
  const kpi = ['Antri', 'Terkirim', 'Gagal', 'Batal'].map(s => '<div class="card p-3 text-center"><div class="text-2xl font-extrabold leading-none">' + d.ringkas[s] + '</div><div class="mt-1 text-xs text-slate-500">' + s + '</div></div>').join('');
  const daftar = rows.length ? rows.map(r => '<article class="card flex items-start gap-3 p-3"><span class="material-symbols-outlined mt-0.5 text-primary">' + (r.Kanal === 'EMAIL' ? 'mail' : 'chat') + '</span>'
    + '<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="truncate font-semibold">' + esc(r.Nama || r.Tujuan) + '</span>' + notifChip(r.Status)
    + '<span class="text-xs text-slate-500">' + esc(r.Event || '') + ' · ' + waktuNotif(r.Dibuat) + '</span></div>'
    + '<p class="truncate text-sm text-slate-600">' + esc(r.Tujuan) + ' · ' + esc(String(r.Pesan).replace(/\n/g, ' ')) + '</p>'
    + (r.Status === 'Gagal' || r.Status === 'Batal' ? '<p class="text-xs text-red-700">' + esc(r.Respon) + '</p>' : '') + '</div></article>').join('')
    : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">inbox</span><p class="mt-2">Tidak ada pesan pada daftar ini.</p></div>';
  box.innerHTML = '<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">' + kpi + '</div>'
    + '<div class="mb-4 flex flex-wrap items-center gap-2"><label class="sr-only" for="antFilter">Saring status</label>'
    + '<select id="antFilter" class="inp !w-auto" onchange="AppState.antreanFilter=this.value;renderNotifAntrean()">'
    + [['', 'Semua status'], ['Antri', 'Antri'], ['Terkirim', 'Terkirim'], ['Gagal', 'Gagal'], ['Batal', 'Batal']].map(o => '<option value="' + o[0] + '"' + (o[0] === f ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>'
    + '<button type="button" class="btn btn-primary !min-h-[44px]" onclick="prosesAntreanSekarang(this)"><span class="material-symbols-outlined">send</span>Proses Sekarang</button>'
    + '<button type="button" class="btn btn-ghost !min-h-[44px]" onclick="ulangiGagal(this)"><span class="material-symbols-outlined">replay</span>Ulangi yang Gagal</button>'
    + '<button type="button" class="btn btn-ghost !min-h-[44px]" onclick="paintNotifAdmin()"><span class="material-symbols-outlined">refresh</span>Muat ulang</button></div>'
    + '<p class="mb-3 text-xs text-slate-500">Menampilkan 200 pesan terakhir · sisa kuota email hari ini ' + d.kuotaEmail + '.</p>'
    + '<div class="space-y-2">' + daftar + '</div>';
}
async function prosesAntreanSekarang(btn) {
  setBusy(btn, true, 'Memproses…');
  try { const r = await call('api_notifProses'); toast('Terkirim ' + r.terkirim + ', gagal ' + r.gagal + (r.sisa > 0 ? ', sisa ' + r.sisa : '') + '.'); await paintNotifAdmin(); }
  catch (e) { setBusy(btn, false); fail(e); }
}
async function ulangiGagal(btn) {
  setBusy(btn, true, 'Menyiapkan…');
  try { const n = await call('api_notifUlang'); toast(n ? n + ' pesan diantre ulang.' : 'Tidak ada pesan gagal.'); await paintNotifAdmin(); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Pasar Kelas (etalase produk & jasa anggota; daftar terbuka untuk umum) ---- */
const hargaPasar = h => {
  h = String(h || '').trim();
  if (!h) return 'Hubungi penjual';
  return /^\d+$/.test(h) ? 'Rp ' + Number(h).toLocaleString('id-ID') : h;
};
const hariLaluPasar = iso => {
  const d = new Date(iso); if (isNaN(d)) return '';
  const n = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  if (n === 0) return 'Diperbarui hari ini';
  if (n === 1) return 'Diperbarui kemarin';
  if (n < 30) return 'Diperbarui ' + n + ' hari lalu';
  return 'Diperbarui ' + Math.floor(n / 30) + ' bulan lalu';
};
const fotoPasarHtml = (it, cls) => it.Foto && it.Foto.length
  ? '<img src="' + esc(it.Foto[0]) + '" alt="' + esc(it.Judul) + '" loading="lazy" referrerpolicy="no-referrer" class="' + cls + ' w-full object-cover">'
  : '<div class="' + cls + ' grid w-full place-items-center bg-primary-soft text-3xl font-extrabold text-primary" aria-hidden="true">' + esc(initials(it.Judul)) + '</div>';

pages.pasar = async () => {
  const ambilKontak = AppState.token && isApproved() ? call('api_pasarKontak').catch(() => ({})) : Promise.resolve(null);
  const [d, k] = await Promise.all([api('api_pasar'), ambilKontak]);
  AppState.pasar = d; AppState.pasarKontak = k;
  return pasarHtml();
};
function pasarFiltered() {
  const f = AppState.pasarF, q = (f.q || '').toLowerCase().trim();
  return AppState.pasar.items.filter(i => (!f.jenis || i.Jenis === f.jenis) && (!f.kat || i.Kategori === f.kat)
    && (!q || [i.Judul, i.Deskripsi, i.Nama, i.Kategori].join(' ').toLowerCase().includes(q)));
}
function pasarHtml() {
  const P = AppState.pasar, f = AppState.pasarF;
  const pil = (v, label) => '<button type="button" class="nav-btn ' + (f.jenis === v ? 'active' : '') + '" aria-pressed="' + (f.jenis === v) + '" onclick="setFilterPasar(\'' + v + '\')">' + label + '</button>';
  return '<div class="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-2xl font-extrabold text-primary-dark">Pasar Kelas</h1>'
    + '<p class="text-sm text-slate-500">Produk dan jasa buatan teman sekelas. Dagang antar teman, saling dukung.</p></div>'
    + (AppState.token && isApproved() ? '<button type="button" class="btn btn-primary" onclick="navigateTo(\'pasarSaya\')"><span class="material-symbols-outlined">storefront</span>Etalase Saya</button>'
      : '<button type="button" class="btn btn-ghost" onclick="' + (AppState.token ? 'navigateTo(\'formulir\')' : 'bukaLogin()') + '"><span class="material-symbols-outlined">add_business</span>Ingin berjualan? ' + (AppState.token ? 'Lengkapi biodata' : 'Masuk') + '</button>') + '</div>'
    + '<div class="mb-4 grid gap-3 md:grid-cols-12"><div class="flex flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1 md:col-span-4" role="group">' + pil('', 'Semua') + pil('Produk', 'Produk') + pil('Jasa', 'Jasa') + '</div>'
    + '<div class="md:col-span-4"><label class="sr-only" for="pasarKat">Kategori</label><select id="pasarKat" class="inp" onchange="AppState.pasarF.kat=this.value;paintPasar()"><option value="">Semua kategori</option>'
    + P.kategori.map(k => '<option value="' + esc(k) + '"' + (f.kat === k ? ' selected' : '') + '>' + esc(k) + '</option>').join('') + '</select></div>'
    + '<div class="relative md:col-span-4"><label class="sr-only" for="pasarQ">Cari</label><span class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>'
    + '<input id="pasarQ" class="inp pl-10" type="search" placeholder="Cari produk, jasa, atau penjual…" value="' + esc(f.q) + '" oninput="AppState.pasarF.q=this.value;paintPasar()"></div></div>'
    + '<div id="pasarBody"></div>'
    + '<p class="mt-6 text-xs text-slate-500">Transaksi menjadi tanggung jawab penjual dan pembeli. Tidak ada pembayaran lewat aplikasi ini. Lihat sesuatu yang tidak pantas? Tekan Laporkan (khusus anggota yang sudah masuk).</p>';
}
after.pasar = () => { const g = $('pasarBody'); if (g) { g.classList.add('stagger'); paintPasar(); setTimeout(() => g.classList.remove('stagger'), 1400); } };
function setFilterPasar(v) { AppState.pasarF.jenis = v; $('app-container').innerHTML = pasarHtml(); paintPasar(); }
function kontakPasar(it) {
  const nomor = it.Wa || (AppState.pasarKontak && AppState.pasarKontak[it.ID]) || '';
  if (nomor) {
    const pesan = 'Halo ' + it.Nama + ', saya lihat "' + it.Judul + '" di Pasar ' + (AppState.stats.title || 'Portal Kelas') + '. Apakah masih tersedia?';
    return '<a class="btn btn-primary w-full" target="_blank" rel="noopener" href="https://wa.me/' + esc(nomor) + '?text=' + encodeURIComponent(pesan) + '"><span class="material-symbols-outlined">chat</span>Hubungi via WhatsApp</a>';
  }
  if (!AppState.token) return '<button type="button" class="btn btn-ghost w-full" onclick="closeModal();bukaLogin()"><span class="material-symbols-outlined">login</span>Masuk untuk menghubungi penjual</button>';
  if (!isApproved()) return '<p class="text-center text-xs text-slate-500">Kontak penjual tersedia setelah biodata Anda disetujui admin.</p>';
  return '<p class="text-center text-xs text-slate-500">Penjual belum mencantumkan kontak.</p>';
}
function paintPasar() {
  const body = $('pasarBody'); if (!body || !AppState.pasar) return;
  const list = pasarFiltered();
  if (!list.length) { body.innerHTML = '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">storefront</span><p class="mt-2">'
    + (AppState.pasar.items.length ? 'Tidak ada etalase yang cocok dengan pencarian.' : 'Belum ada etalase. Jadilah yang pertama berjualan di sini.') + '</p></div>'; return; }
  body.innerHTML = '<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">' + list.map(it => '<article class="card flex flex-col overflow-hidden' + (it.Status === 'Tersedia' ? '' : ' opacity-70') + '">'
    + '<button type="button" class="block text-left" onclick="bukaDetailPasar(\'' + it.ID + '\')" aria-label="Lihat ' + esc(it.Judul) + '">' + fotoPasarHtml(it, 'h-40') + '</button>'
    + '<div class="flex flex-1 flex-col gap-2 p-4"><div class="flex flex-wrap items-center gap-2"><span class="chip bg-primary-soft text-primary">' + esc(it.Jenis) + '</span>'
    + (it.Status === 'Tersedia' ? '' : '<span class="chip bg-slate-200 text-slate-700">Tidak tersedia</span>') + '<span class="truncate text-xs text-slate-500">' + esc(it.Kategori) + '</span></div>'
    + '<h2 class="font-bold leading-tight">' + esc(it.Judul) + '</h2>'
    + '<p class="font-extrabold text-primary">' + esc(hargaPasar(it.Harga)) + '</p>'
    + '<p class="line-clamp-3 whitespace-pre-line text-sm text-slate-600">' + esc(it.Deskripsi) + '</p>'
    + '<p class="mt-auto pt-1 text-xs text-slate-500">oleh <strong>' + esc(it.Nama) + '</strong> · ' + esc(hariLaluPasar(it.Diperbarui)) + '</p>'
    + kontakPasar(it)
    + '<div class="flex gap-2"><button type="button" class="btn btn-ghost !min-h-[40px] flex-1" onclick="bukaDetailPasar(\'' + it.ID + '\')">Detail</button>'
    + (AppState.token && isApproved() ? '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaLaporPasar(\'' + it.ID + '\')" aria-label="Laporkan ' + esc(it.Judul) + '" title="Laporkan"><span class="material-symbols-outlined">flag</span></button>' : '')
    + '</div></div></article>').join('') + '</div>';
}
function bukaDetailPasar(id) {
  const it = AppState.pasar.items.find(x => x.ID === id); if (!it) return;
  const foto = it.Foto.length ? '<div class="grid gap-2">' + it.Foto.map(u => '<img src="' + esc(u) + '" alt="' + esc(it.Judul) + '" loading="lazy" referrerpolicy="no-referrer" class="max-h-96 w-full rounded-xl object-cover">').join('') + '</div>' : fotoPasarHtml(it, 'h-40 rounded-xl');
  openModal('<div class="p-5"><div class="mb-3 flex items-start justify-between gap-3"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><span class="chip bg-primary-soft text-primary">' + esc(it.Jenis) + '</span>'
    + (it.Status === 'Tersedia' ? '' : '<span class="chip bg-slate-200 text-slate-700">Tidak tersedia</span>') + '<span class="text-xs text-slate-500">' + esc(it.Kategori) + '</span></div>'
    + '<h2 class="mt-1 text-lg font-bold">' + esc(it.Judul) + '</h2></div><button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="closeModal()" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button></div>'
    + foto + '<p class="mt-3 text-xl font-extrabold text-primary">' + esc(hargaPasar(it.Harga)) + '</p>'
    + '<p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">' + esc(it.Deskripsi) + '</p>'
    + '<p class="mt-3 text-xs text-slate-500">oleh <strong>' + esc(it.Nama) + '</strong> · ' + esc(hariLaluPasar(it.Diperbarui)) + '</p><div class="mt-4">' + kontakPasar(it) + '</div></div>');
}
function bukaLaporPasar(id) {
  const it = AppState.pasar.items.find(x => x.ID === id); if (!it) return;
  openModal('<form class="p-5" onsubmit="kirimLaporPasar(event,\'' + id + '\')"><h2 class="text-lg font-bold">Laporkan etalase</h2>'
    + '<p class="mt-1 text-sm text-slate-600">“' + esc(it.Judul) + '”. Admin akan memeriksa laporan Anda. Etalase tidak langsung disembunyikan.</p>'
    + '<label class="lbl mt-4" for="alasanLapor">Alasan laporan</label><textarea id="alasanLapor" class="inp" rows="3" minlength="5" maxlength="200" required data-autofocus placeholder="Contoh: barang terlarang / penipuan / konten tidak pantas."></textarea>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-danger">Kirim Laporan</button></div></form>');
}
async function kirimLaporPasar(ev, id) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]'); setBusy(btn, true, 'Mengirim…');
  try { await call('api_laporEtalase', id, $('alasanLapor').value.trim()); closeModal(); toast('Laporan terkirim. Terima kasih.'); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Etalase Saya ---- */
pages.pasarSaya = async () => {
  if (!AppState.token || !isApproved()) return lockedHtml('Etalase hanya untuk anggota yang biodatanya sudah disetujui.');
  AppState.pasarSaya = await call('api_pasarSaya');
  return pasarSayaHtml();
};
function barisEtalaseHtml(it, ctx) {
  const adm = ctx === 'admin';
  return '<article class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center' + (it.Disembunyikan ? ' ring-2 ring-red-300' : '') + '">'
    + '<div class="w-full shrink-0 overflow-hidden rounded-xl sm:w-24">' + fotoPasarHtml(it, 'h-20') + '</div>'
    + '<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="chip bg-primary-soft text-primary">' + esc(it.Jenis) + '</span>'
    + '<span class="chip ' + (it.Status === 'Tersedia' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700') + '">' + esc(it.Status) + '</span>'
    + (it.Disembunyikan ? '<span class="chip bg-red-100 text-red-700">Disembunyikan admin</span>' : '')
    + (adm && it.Laporan ? '<span class="chip bg-amber-100 text-amber-800">' + it.Laporan + ' laporan</span>' : '') + '</div>'
    + '<h2 class="mt-1 truncate font-bold">' + esc(it.Judul) + '</h2>'
    + '<p class="truncate text-sm text-slate-600">' + esc(hargaPasar(it.Harga)) + ' · ' + esc(it.Kategori) + (adm ? ' · penjual: ' + esc(it.NamaTampil) + ' (' + esc(it.PemilikNama) + ')' : '') + '</p>'
    + '<p class="text-xs text-slate-500">' + esc(hariLaluPasar(it.Diperbarui)) + '</p></div>'
    + '<div class="flex flex-wrap gap-1 sm:justify-end">'
    + (adm ? '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="sembunyikanEtalase(\'' + it.ID + '\',' + (it.Disembunyikan ? 'false' : 'true') + ')" title="' + (it.Disembunyikan ? 'Tampilkan lagi' : 'Sembunyikan') + '"><span class="material-symbols-outlined">' + (it.Disembunyikan ? 'visibility' : 'visibility_off') + '</span></button>'
      : '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="ubahStatusEtalase(\'' + it.ID + '\',\'' + (it.Status === 'Tersedia' ? 'Tidak tersedia' : 'Tersedia') + '\')" title="Ubah status"><span class="material-symbols-outlined">' + (it.Status === 'Tersedia' ? 'toggle_on' : 'toggle_off') + '</span>' + (it.Status === 'Tersedia' ? 'Tersedia' : 'Habis') + '</button>')
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaEditorEtalase(\'' + ctx + '\',\'' + it.ID + '\')" aria-label="Ubah ' + esc(it.Judul) + '"><span class="material-symbols-outlined">edit</span></button>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusEtalase(\'' + ctx + '\',\'' + it.ID + '\')" aria-label="Hapus ' + esc(it.Judul) + '"><span class="material-symbols-outlined">delete</span></button></div></article>';
}
function pasarSayaHtml() {
  const S = AppState.pasarSaya;
  return '<div class="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-2xl font-extrabold text-primary-dark">Etalase Saya</h1>'
    + '<p class="text-sm text-slate-500">' + S.items.length + ' dari ' + S.batas + ' etalase. Perubahan langsung tampil di Pasar.</p></div>'
    + '<div class="flex gap-2"><button type="button" class="btn btn-ghost" onclick="navigateTo(\'pasar\')"><span class="material-symbols-outlined">storefront</span>Lihat Pasar</button>'
    + '<button type="button" class="btn btn-primary" onclick="bukaEditorEtalase(\'saya\')"' + (S.items.length >= S.batas ? ' disabled' : '') + '><span class="material-symbols-outlined">add</span>Tambah Etalase</button></div></div>'
    + (S.items.length ? '<div class="space-y-3">' + S.items.map(i => barisEtalaseHtml(i, 'saya')).join('') + '</div>'
      : '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl">add_business</span><p class="mt-2">Belum ada etalase. Tekan Tambah Etalase untuk mulai berjualan.</p></div>');
}
async function segarkanEtalase(ctx) {
  AppState.pasar = null;
  if (ctx === 'admin') { AppState.pasarAdm = await call('api_pasarAdmin'); renderPasarAdmin(); }
  else { AppState.pasarSaya = await call('api_pasarSaya'); $('app-container').innerHTML = pasarSayaHtml(); }
}
async function ubahStatusEtalase(id, status) {
  try { await call('api_statusEtalase', id, status); toast('Status diperbarui.'); await segarkanEtalase('saya'); } catch (e) { fail(e); }
}
function konfirmasiHapusEtalase(ctx, id) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus etalase?</h2><p class="text-sm text-slate-600">Etalase dan fotonya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button><button class="btn btn-danger" onclick="hapusEtalase(\'' + ctx + '\',\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapusEtalase(ctx, id) {
  try { await call('api_hapusEtalase', id); closeModal(); toast('Etalase dihapus.'); await segarkanEtalase(ctx); } catch (e) { closeModal(); fail(e); }
}

/* ---- Editor etalase (dipakai anggota dan admin) ---- */
function bukaEditorEtalase(ctx, id) {
  const src = ctx === 'admin' ? AppState.pasarAdm : AppState.pasarSaya;
  const it = id ? src.items.find(x => x.ID === id) : null;
  if (id && !it) return;
  AppState.etCtx = ctx;
  AppState.etFoto = { lama: it ? it.FotoIds.map((fid, i) => ({ id: fid, url: it.Foto[i] })) : [], baru: [] };
  const opt = (list, v) => list.map(k => '<option value="' + esc(k) + '"' + (k === v ? ' selected' : '') + '>' + esc(k) + '</option>').join('');
  const kat = src.kategori.slice(); if (it && kat.indexOf(it.Kategori) === -1) kat.push(it.Kategori);
  const pemilik = ctx === 'admin' && !it
    ? '<div class="sm:col-span-2"><label class="lbl" for="etPemilik">Atas nama anggota</label><select id="etPemilik" class="inp" required><option value="">Pilih anggota…</option>'
      + src.anggota.map(a => '<option value="' + esc(a.Email) + '">' + esc(a.Nama) + ' (' + esc(a.Panggilan) + ')</option>').join('') + '</select>'
      + '<p class="mt-1 text-xs text-slate-500">Etalase ini menjadi milik anggota tersebut, dihitung dalam batas ' + src.batas + ' etalasenya, dan bisa ia ubah atau hapus sendiri.</p></div>' : '';
  openModal('<form class="p-5" onsubmit="simpanEtalase(event,\'' + (id || '') + '\')"><div class="mb-4 flex items-start justify-between gap-3"><h2 class="text-lg font-bold">' + (it ? 'Ubah Etalase' : 'Tambah Etalase') + '</h2>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="closeModal()" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button></div>'
    + '<div class="grid gap-3 sm:grid-cols-2">' + pemilik
    + '<div><label class="lbl" for="etJenis">Jenis</label><select id="etJenis" class="inp">' + opt(['Produk', 'Jasa'], it ? it.Jenis : 'Produk') + '</select></div>'
    + '<div><label class="lbl" for="etKat">Kategori</label><select id="etKat" class="inp">' + opt(kat, it ? it.Kategori : '') + '</select></div>'
    + '<div class="sm:col-span-2"><label class="lbl" for="etJudul">Judul</label><input id="etJudul" class="inp" type="text" maxlength="100" required data-autofocus value="' + esc(it ? it.Judul : '') + '" placeholder="Contoh: Kue kering lebaran"></div>'
    + '<div class="sm:col-span-2"><label class="lbl" for="etDesk">Deskripsi</label><textarea id="etDesk" class="inp" rows="4" maxlength="600" required placeholder="Jelaskan produk atau jasa Anda, ukuran, bahan, area layanan, cara pesan.">' + esc(it ? it.Deskripsi : '') + '</textarea></div>'
    + '<div><label class="lbl" for="etHarga">Harga (opsional)</label><input id="etHarga" class="inp" type="text" maxlength="40" value="' + esc(it ? it.Harga : '') + '" placeholder="25000 atau Mulai dari 50000">'
    + '<p class="mt-1 text-xs text-slate-500">Kosong = tampil “Hubungi penjual”.</p></div>'
    + '<div><label class="lbl" for="etStatus">Status</label><select id="etStatus" class="inp">' + opt(['Tersedia', 'Tidak tersedia'], it ? it.Status : 'Tersedia') + '</select></div>'
    + '<div><label class="lbl" for="etNama">Nama tampil</label><input id="etNama" class="inp" type="text" maxlength="40" value="' + esc(it ? it.NamaTampil : '') + '" placeholder="' + esc(ctx === 'admin' ? 'Kosong = nama panggilan pemilik' : 'Kosong = ' + src.namaBawaan) + '">'
    + '<p class="mt-1 text-xs text-slate-500">Boleh nama toko atau nama buatan sendiri.</p></div>'
    + '<div><label class="lbl" for="etWa">Nomor WhatsApp etalase (opsional)</label><input id="etWa" class="inp" type="tel" inputmode="tel" value="' + esc(it ? it.WaEtalase : '') + '" placeholder="081234567890">'
    + '<p class="mt-1 text-xs text-slate-500">Bila diisi, tombol WhatsApp tampil untuk siapa saja tanpa login. Bila kosong, hanya anggota yang login yang dapat menghubungi lewat nomor biodata.</p></div>'
    + '<div class="sm:col-span-2"><span class="lbl">Foto (opsional, maksimal 3)</span><div id="etFotoGrid" class="grid grid-cols-3 gap-2"></div>'
    + '<input id="etFotoInp" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onchange="pilihFotoEtalase(this)">'
    + '<button type="button" id="etFotoTambah" class="btn btn-ghost mt-2" onclick="$(\'etFotoInp\').click()"><span class="material-symbols-outlined">add_photo_alternate</span>Tambah foto</button></div></div>'
    + '<div class="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"><strong>Perhatian:</strong> foto dan nomor WhatsApp etalase tampil untuk umum. Dilarang menjual barang atau jasa ilegal, penipuan, atau konten tidak pantas. Transaksi menjadi tanggung jawab penjual dan pembeli. Admin dapat menyembunyikan atau menghapus etalase yang melanggar.</div>'
    + '<div class="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-primary">' + (it ? 'Simpan Perubahan' : 'Pasang Etalase') + '</button></div></form>');
  gambarFotoEtalase();
}
function gambarFotoEtalase() {
  const g = $('etFotoGrid'); if (!g) return;
  const F = AppState.etFoto, tot = F.lama.length + F.baru.length;
  const sel = (src, tipe, i) => '<div class="relative overflow-hidden rounded-xl bg-slate-100"><img src="' + esc(src) + '" alt="Foto ' + (i + 1) + '" referrerpolicy="no-referrer" class="h-24 w-full object-cover">'
    + '<button type="button" class="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-red-700 shadow-sm" onclick="buangFotoEtalase(\'' + tipe + '\',' + i + ')" aria-label="Hapus foto"><span class="material-symbols-outlined !text-base">close</span></button></div>';
  g.innerHTML = F.lama.map((f, i) => sel(f.url, 'lama', i)).join('') + F.baru.map((d, i) => sel(d, 'baru', i)).join('');
  const b = $('etFotoTambah'); if (b) b.style.display = tot >= 3 ? 'none' : '';
}
function buangFotoEtalase(tipe, i) { AppState.etFoto[tipe].splice(i, 1); gambarFotoEtalase(); }
async function pilihFotoEtalase(inp) {
  const f = inp.files[0]; inp.value = ''; if (!f) return;
  const F = AppState.etFoto;
  if (F.lama.length + F.baru.length >= 3) { toast('Foto maksimal 3.', 'error'); return; }
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Gunakan foto JPG, PNG, atau WebP.', 'error'); return; }
  if (f.size > 15 * 1024 * 1024) { toast('Ukuran foto maksimal 15 MB.', 'error'); return; }
  try { F.baru.push(await compressImage(f, 960)); gambarFotoEtalase(); } catch (e) { toast(e.message, 'error'); }
}
async function simpanEtalase(ev, id) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]'), ctx = AppState.etCtx, F = AppState.etFoto;
  const p = { id: id || '', jenis: $('etJenis').value, kategori: $('etKat').value, judul: $('etJudul').value.trim(), deskripsi: $('etDesk').value.trim(), harga: $('etHarga').value.trim(),
    namaTampil: $('etNama').value.trim(), waEtalase: $('etWa').value.trim(), status: $('etStatus').value, fotoLama: F.lama.map(x => x.id), fotoBaru: F.baru };
  if ($('etPemilik')) p.pemilik = $('etPemilik').value;
  setBusy(btn, true, 'Menyimpan…');
  try { await call('api_simpanEtalase', p); closeModal(); toast(id ? 'Etalase diperbarui.' : 'Etalase dipasang.'); await segarkanEtalase(ctx); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Tab Pasar di Panel Admin ---- */
async function paintPasarAdmin() {
  const body = $('adminBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    if (!AppState.pasarAdm) AppState.pasarAdm = await call('api_pasarAdmin');
    if (AppState.tab === 'Pasar') renderPasarAdmin();
  } catch (e) { if ($('adminBody')) $('adminBody').innerHTML = ''; fail(e); }
}
function renderPasarAdmin() {
  const body = $('adminBody'); if (!body || !AppState.pasarAdm) return;
  const A = AppState.pasarAdm;
  const lap = A.laporan.length ? A.laporan.map(l => '<article class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div class="min-w-0 flex-1">'
    + '<div class="flex flex-wrap items-center gap-2"><span class="chip bg-amber-100 text-amber-800">Laporan</span>' + (l.Disembunyikan ? '<span class="chip bg-red-100 text-red-700">Sudah disembunyikan</span>' : '')
    + '<span class="text-xs text-slate-500">' + esc(tgl(l.Dibuat)) + ' · dari ' + esc(l.Pelapor) + '</span></div>'
    + '<h3 class="mt-1 font-bold">' + esc(l.Judul) + ' <span class="font-normal text-slate-500">· ' + esc(l.Penjual) + '</span></h3>'
    + '<p class="text-sm text-slate-700">' + esc(l.Alasan) + '</p></div>'
    + '<div class="flex flex-wrap gap-1"><button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="sembunyikanEtalase(\'' + l.EtalaseID + '\',true)"><span class="material-symbols-outlined">visibility_off</span>Sembunyikan</button>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapusEtalase(\'admin\',\'' + l.EtalaseID + '\')"><span class="material-symbols-outlined">delete</span>Hapus</button>'
    + '<button type="button" class="btn btn-ghost !min-h-[40px] !px-3" onclick="abaikanLaporan(\'' + l.ID + '\')"><span class="material-symbols-outlined">done</span>Abaikan</button></div></article>').join('')
    : '<div class="card p-6 text-center text-sm text-slate-500">Tidak ada laporan yang menunggu.</div>';
  body.innerHTML = '<h2 class="mb-2 font-bold">Laporan (' + A.laporan.length + ')</h2><div class="mb-6 space-y-3">' + lap + '</div>'
    + '<div class="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 class="font-bold">Semua etalase (' + A.items.length + ')</h2>'
    + '<button type="button" class="btn btn-primary" onclick="bukaEditorEtalase(\'admin\')"><span class="material-symbols-outlined">add_business</span>Tambah untuk anggota</button></div>'
    + (A.items.length ? '<div class="mb-6 space-y-3">' + A.items.map(i => barisEtalaseHtml(i, 'admin')).join('') + '</div>' : '<div class="card mb-6 p-6 text-center text-sm text-slate-500">Belum ada etalase.</div>')
    + '<form class="card grid gap-3 p-5" onsubmit="simpanKategoriPasar(event)"><h2 class="font-bold">Daftar kategori</h2>'
    + '<label class="lbl" for="katPasar">Satu kategori per baris (2 sampai 30 kategori)</label><textarea id="katPasar" class="inp" rows="8">' + esc(A.kategori.join('\n')) + '</textarea>'
    + '<p class="text-xs text-slate-500">Etalase yang sudah memakai kategori lama tetap tampil. Kategori baru muncul di pilihan form dan filter.</p>'
    + '<div><button type="submit" class="btn btn-primary"><span class="material-symbols-outlined">save</span>Simpan Kategori</button></div></form>';
}
async function sembunyikanEtalase(id, sembunyi) {
  try { AppState.pasarAdm = await call('api_sembunyikanEtalase', id, !!sembunyi); AppState.pasar = null; toast(sembunyi ? 'Etalase disembunyikan.' : 'Etalase ditampilkan lagi.'); renderPasarAdmin(); } catch (e) { fail(e); }
}
async function abaikanLaporan(id) {
  try { AppState.pasarAdm = await call('api_abaikanLaporan', id); toast('Laporan diabaikan.'); renderPasarAdmin(); } catch (e) { fail(e); }
}
async function simpanKategoriPasar(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]'); setBusy(btn, true, 'Menyimpan…');
  try { AppState.pasarAdm = await call('api_simpanKategori', $('katPasar').value.split('\n')); AppState.pasar = null; toast('Kategori disimpan.'); renderPasarAdmin(); }
  catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Tab Menu di Panel Admin ---- */
async function paintMenuAdmin() {
  const body = $('adminBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try {
    if (!AppState.menuAdm) AppState.menuAdm = await call('api_menuAdmin');
    if (AppState.tab === 'Menu') renderMenuAdmin();
  } catch (e) { if ($('adminBody')) $('adminBody').innerHTML = ''; fail(e); }
}
function renderMenuAdmin() {
  const body = $('adminBody'); if (!body || !AppState.menuAdm) return;
  const M = AppState.menuAdm;
  const baris = k => '<div class="grid gap-2 border-b border-slate-100 py-3 last:border-0 md:grid-cols-12 md:items-start">'
    + '<div class="md:col-span-3"><label class="font-semibold' + (k.indexOf('kuliah_') === 0 ? ' pl-4' : '') + '" for="mn_' + k + '">' + esc(MENU_NAMA[k]) + '</label></div>'
    + '<div class="md:col-span-4"><select id="mn_' + k + '" class="inp">'
    + [['semua', 'Tampil untuk semua'], ['anggota', 'Hanya anggota yang masuk'], ['tutup', 'Disembunyikan (ditutup)']].map(o => '<option value="' + o[0] + '"' + (M.akses[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>'
    + '<div class="md:col-span-5"><label class="sr-only" for="mp_' + k + '">Pesan saat ditutup untuk ' + esc(MENU_NAMA[k]) + '</label>'
    + '<input id="mp_' + k + '" class="inp" type="text" maxlength="200" value="' + esc(M.pesan[k] || '') + '" placeholder="Pesan saat ditutup (opsional)"></div></div>';
  body.innerHTML = '<form class="card p-5" onsubmit="simpanMenuAdmin(event)"><h2 class="font-bold">Pengaturan Menu</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Atur siapa yang dapat melihat tiap menu. Beranda dan Panel Admin selalu tampil. Admin tetap dapat membuka semua menu, yang disembunyikan ditandai ikon mata tercoret.</p>'
    + '<div class="mt-3">' + ['tentang', 'pasar', 'teman', 'kuliah', 'kuliah_chat', 'kuliah_absen', 'kuliah_tugas', 'kuliah_materi', 'formulir', 'status'].map(baris).join('') + '</div>'
    + '<p class="mt-3 text-xs text-slate-500">Menu yang ditutup hilang dari navigasi dan, bila dibuka lewat tautan, menampilkan pesan di atas. Ini pengaturan tampilan, bukan pengamanan data. Pengguna yang sedang membuka aplikasi melihat perubahan setelah memuat ulang halaman.</p>'
    + '<div class="mt-4"><button type="submit" class="btn btn-primary"><span class="material-symbols-outlined">save</span>Simpan Pengaturan Menu</button></div></form>';
}
async function simpanMenuAdmin(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]'), akses = {}, pesan = {};
  Object.keys(MENU_NAMA).forEach(k => { akses[k] = $('mn_' + k).value; pesan[k] = $('mp_' + k).value.trim(); });
  setBusy(btn, true, 'Menyimpan…');
  try {
    const r = await call('api_simpanMenu', { akses: akses, pesan: pesan });
    AppState.menuAdm = r; AppState.menu = r; renderShell(); toast('Pengaturan menu disimpan.'); renderMenuAdmin();
  } catch (e) { setBusy(btn, false); fail(e); }
}

/* ---- Panel admin ---- */
pages.admin = async () => {
  if (!AppState.isAdmin) return lockedHtml('Halaman ini khusus admin.');
  AppState.adminData = await call('api_admin');
  return adminHtml();
};
after.admin = () => { paintAdmin(); animasiAngka($('app-container')); };
function adminHtml() {
  const c = AppState.adminData.counts;
  const kpi = [['Total', c.total, 'groups', 'text-primary'], ['Menunggu', c.Menunggu, 'pending_actions', 'text-amber-700'],
    ['Disetujui', c.Disetujui, 'verified', 'text-emerald-700'], ['Ditolak', c.Ditolak, 'cancel', 'text-red-700']];
  const tabs = ['Menunggu', 'Semua', 'Pengumuman', 'Pasar', 'Menu', 'Profil', 'Jadwal', 'Notifikasi'];
  const labelTab = { Menunggu: 'Menunggu Persetujuan (' + c.Menunggu + ')', Semua: 'Semua Data (' + c.total + ')', Pengumuman: 'Pengumuman', Pasar: 'Pasar', Menu: 'Menu', Profil: 'Profil Kelas', Jadwal: 'Jadwal Kuliah', Notifikasi: 'Notifikasi' };
  return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">Panel Admin</h1><p class="text-sm text-slate-500">Setujui pendaftar dan kelola data biodata.</p></div>'
    + '<div class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">' + kpi.map(k => '<div class="card flex items-center gap-3 p-4"><span class="material-symbols-outlined !text-3xl ' + k[3] + '">' + k[2] + '</span>'
      + '<div><div class="text-2xl font-extrabold leading-none" data-hitung="' + k[1] + '">' + k[1] + '</div><div class="text-xs text-slate-500">' + k[0] + '</div></div></div>').join('') + '</div>'
    + '<div class="mb-4 flex flex-wrap items-center justify-between gap-3"><div class="flex flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1" role="tablist">'
    + tabs.map(t => '<button role="tab" aria-selected="' + (AppState.tab === t) + '" class="nav-btn ' + (AppState.tab === t ? 'active' : '') + '" onclick="setTab(\'' + t + '\')">' + labelTab[t] + '</button>').join('') + '</div>'
    + '<div class="relative w-full sm:w-72' + (['Pengumuman', 'Pasar', 'Menu', 'Profil', 'Jadwal', 'Notifikasi'].indexOf(AppState.tab) > -1 ? ' hidden' : '') + '"><label class="sr-only" for="aq">Cari</label><span class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>'
    + '<input id="aq" class="inp pl-10" type="search" placeholder="Cari nama / email / kantor…" oninput="AppState.q=this.value;paintAdmin()"></div></div>'
    + '<div id="adminBody"></div>';
}
function setTab(t) { AppState.tab = t; AppState.q = ''; $('app-container').innerHTML = adminHtml(); paintAdmin(); }
function paintAdmin() {
  if (AppState.tab === 'Pengumuman') { paintPengumumanAdmin(); return; }
  if (AppState.tab === 'Pasar') { paintPasarAdmin(); return; }
  if (AppState.tab === 'Menu') { paintMenuAdmin(); return; }
  if (AppState.tab === 'Profil') { paintProfilAdmin(); return; }
  if (AppState.tab === 'Jadwal') { paintJadwalAdmin(); return; }
  if (AppState.tab === 'Notifikasi') { paintNotifAdmin(); return; }
  const q = (AppState.q || '').toLowerCase().trim();
  let rows = AppState.adminData.rows.filter(r => (AppState.tab === 'Semua' || r.Status === 'Menunggu')
    && (!q || [r.NamaLengkap, r.NamaPanggilan, r.NIM, r.Email, r.TempatKerja].join(' ').toLowerCase().includes(q)));
  const body = $('adminBody');
  if (!rows.length) { body.innerHTML = '<div class="card p-10 text-center text-slate-500"><span class="material-symbols-outlined !text-4xl text-emerald-600">task_alt</span><p class="mt-2">' + (AppState.tab === 'Menunggu' ? 'Tidak ada pendaftar yang menunggu.' : 'Data tidak ditemukan.') + '</p></div>'; return; }
  const aksi = r => '<div class="flex flex-wrap justify-end gap-1">'
    + (r.Status !== 'Disetujui' ? '<button class="btn btn-primary !min-h-[40px] !px-3" onclick="setujui(\'' + r.ID + '\')"><span class="material-symbols-outlined">check_circle</span>Setujui</button>' : '')
    + (r.Status !== 'Ditolak' ? '<button class="btn btn-ghost !min-h-[40px] !px-3" onclick="bukaTolak(\'' + r.ID + '\')" aria-label="Tolak ' + esc(r.NamaPanggilan) + '"><span class="material-symbols-outlined">block</span>Tolak</button>' : '')
    + (AppState.isUtama && !r.IsUtama && (r.IsAdmin || r.Status === 'Disetujui')
      ? '<button class="btn btn-ghost !min-h-[40px] !px-3" onclick="konfirmasiSetAdmin(\'' + r.ID + '\',' + (r.IsAdmin ? 'false' : 'true') + ')" aria-label="' + (r.IsAdmin ? 'Cabut admin ' : 'Jadikan admin ') + esc(r.NamaPanggilan) + '" title="' + (r.IsAdmin ? 'Cabut hak admin' : 'Jadikan admin') + '"><span class="material-symbols-outlined">' + (r.IsAdmin ? 'remove_moderator' : 'add_moderator') + '</span></button>' : '')
    + '<button class="btn btn-ghost !min-h-[40px] !px-3" onclick="konfirmasiResetPin(\'' + r.ID + '\')" aria-label="Reset PIN ' + esc(r.NamaPanggilan) + '" title="Reset PIN"><span class="material-symbols-outlined">lock_reset</span></button>'
    + '<button class="btn btn-ghost !min-h-[40px] !px-3" onclick="navigateTo(\'formulir\',{editId:\'' + r.ID + '\'})" aria-label="Ubah ' + esc(r.NamaPanggilan) + '"><span class="material-symbols-outlined">edit</span></button>'
    + '<button class="btn btn-ghost !min-h-[40px] !px-3 !text-red-700" onclick="konfirmasiHapus(\'' + r.ID + '\')" aria-label="Hapus ' + esc(r.NamaPanggilan) + '"><span class="material-symbols-outlined">delete</span></button></div>';
  body.innerHTML = '<div class="space-y-3">' + rows.map(r => '<article class="card flex flex-col gap-4 p-4 lg:flex-row lg:items-center">'
    + '<div class="flex min-w-0 flex-1 items-center gap-4">' + avatar(r, 'h-14 w-14 rounded-xl')
    + '<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="truncate font-bold">' + esc(r.NamaLengkap) + '</h2>' + chip(r.Status)
    + (r.IsAdmin ? '<span class="chip bg-gold-soft text-amber-800"><span class="material-symbols-outlined !text-sm">shield_person</span>' + (r.IsUtama ? 'Admin Utama' : 'Admin') + '</span>' : '') + '</div>'
    + '<p class="truncate text-sm text-slate-600">NIM ' + esc(r.NIM) + ' · ' + esc(r.TempatKerja) + ' · ' + esc(r.Jabatan) + ' · ' + esc(r.AsalKota) + ', ' + esc(r.Provinsi) + '</p>'
    + '<p class="truncate text-xs text-slate-500">' + esc(r.Email) + ' · ' + esc(r.NomorHP) + ' · daftar ' + tgl(r.Dibuat) + '</p></div></div>' + aksi(r) + '</article>').join('') + '</div>';
}
async function refreshAdmin() {
  AppState.members = null; AppState.adminData = await call('api_admin');
  $('app-container').innerHTML = adminHtml(); paintAdmin();
}
async function setujui(id) {
  try { await call('api_setStatus', id, 'Disetujui', ''); toast('Biodata disetujui.'); await refreshAdmin(); } catch (e) { fail(e); }
}
function bukaTolak(id) {
  openModal('<form class="p-5" onsubmit="kirimTolak(event,\'' + id + '\')"><h2 class="text-lg font-bold">Tolak pendaftaran</h2>'
    + '<p class="mt-1 text-sm text-slate-600">Tulis alasan agar pendaftar tahu apa yang perlu diperbaiki.</p>'
    + '<label class="lbl mt-4" for="alasan">Alasan penolakan</label><textarea id="alasan" class="inp" rows="3" maxlength="300" required data-autofocus placeholder="Contoh: Foto kurang formal / data belum sesuai."></textarea>'
    + '<div class="mt-5 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button><button type="submit" class="btn btn-danger">Tolak</button></div></form>');
}
async function kirimTolak(ev, id) {
  ev.preventDefault();
  const btn = ev.target.querySelector('[type=submit]'); setBusy(btn, true);
  try { await call('api_setStatus', id, 'Ditolak', $('alasan').value); closeModal(); toast('Pendaftaran ditolak.'); await refreshAdmin(); }
  catch (e) { closeModal(); fail(e); }
}
function konfirmasiSetAdmin(id, jadi) {
  const r = AppState.adminData.rows.find(x => x.ID === id); if (!r) return;
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><span class="material-symbols-outlined">' + (jadi ? 'add_moderator' : 'remove_moderator') + '</span></span>'
    + '<div><h2 class="text-lg font-bold">' + (jadi ? 'Jadikan admin?' : 'Cabut hak admin?') + '</h2><p class="text-sm text-slate-600">'
    + (jadi ? '<strong>' + esc(r.NamaLengkap) + '</strong> akan bisa menyetujui/menolak pendaftar, mengubah dan menghapus data, mereset PIN, serta mengelola absensi dan tugas. Ia masuk dengan email dan PIN miliknya sendiri.'
      : '<strong>' + esc(r.NamaLengkap) + '</strong> kembali menjadi anggota biasa. Berlaku seketika, termasuk bila sedang masuk.') + '</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-primary" onclick="setAdmin(\'' + id + '\',' + (jadi ? 'true' : 'false') + ', this)">' + (jadi ? 'Ya, jadikan admin' : 'Ya, cabut') + '</button></div></div>');
}
async function setAdmin(id, jadi, btn) {
  setBusy(btn, true, 'Memproses…');
  try { await call('api_setAdmin', id, jadi); closeModal(); toast(jadi ? 'Admin baru ditambahkan.' : 'Hak admin dicabut.'); await refreshAdmin(); }
  catch (e) { closeModal(); fail(e); }
}
function konfirmasiResetPin(id) {
  const r = AppState.adminData.rows.find(x => x.ID === id); if (!r) return;
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><span class="material-symbols-outlined">lock_reset</span></span>'
    + '<div><h2 class="text-lg font-bold">Reset PIN?</h2><p class="text-sm text-slate-600">PIN lama <strong>' + esc(r.NamaLengkap) + '</strong> tidak berlaku lagi. Sistem membuat PIN sementara untuk Anda sampaikan ke yang bersangkutan.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-primary" onclick="resetPin(\'' + id + '\', this)">Ya, reset PIN</button></div></div>');
}
async function resetPin(id, btn) {
  setBusy(btn, true, 'Memproses…');
  try {
    const h = await call('api_resetPin', id);
    const pesan = 'Halo ' + h.nama + ', PIN sementara Anda di ' + (AppState.stats.title || 'Portal Kelas 84A MM') + ' adalah ' + h.pin
      + '. Silakan masuk dengan email ' + h.email + ' lalu segera ganti PIN lewat tombol PIN di pojok kanan atas.';
    openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><span class="material-symbols-outlined">key</span></span>'
      + '<div><h2 class="text-lg font-bold">PIN sementara siap</h2><p class="text-sm text-slate-600">Untuk ' + esc(h.nama) + '. PIN ini hanya tampil sekarang, catat atau kirim sebelum menutup.</p></div></div>'
      + '<p id="pinSementara" class="mt-4 select-all rounded-xl bg-slate-50 p-4 text-center text-3xl font-extrabold tracking-[.3em] text-primary-dark">' + esc(h.pin) + '</p>'
      + '<div class="mt-4 grid gap-2 sm:grid-cols-2">'
      + '<button class="btn btn-ghost" onclick="salinPinSementara(\'' + esc(h.pin) + '\')"><span class="material-symbols-outlined">content_copy</span>Salin PIN</button>'
      + '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/' + waNum(h.nomorHP) + '?text=' + encodeURIComponent(pesan) + '"><span class="material-symbols-outlined">chat</span>Kirim via WhatsApp</a></div>'
      + '<div class="mt-4 flex justify-end"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Selesai</button></div></div>');
  } catch (e) { closeModal(); fail(e); }
}
function salinPinSementara(pin) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pin).then(() => toast('PIN disalin.'), () => toast('Gagal menyalin, salin manual.', 'error'));
  else toast('Salin manual dari kotak PIN.', 'error');
}
function konfirmasiHapus(id) {
  const r = AppState.adminData.rows.find(x => x.ID === id); if (!r) return;
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-700"><span class="material-symbols-outlined">delete_forever</span></span>'
    + '<div><h2 class="text-lg font-bold">Hapus biodata?</h2><p class="text-sm text-slate-600">Tindakan ini tidak dapat dibatalkan.</p></div></div>'
    + '<p class="mt-4 rounded-xl bg-slate-50 p-3 text-sm">Data <strong>' + esc(r.NamaLengkap) + '</strong> dan fotonya di Google Drive akan dihapus.</p>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="hapus(\'' + id + '\')">Ya, hapus</button></div></div>');
}
async function hapus(id) {
  try { await call('api_delete', id); closeModal(); toast('Data dihapus.'); await refreshAdmin(); } catch (e) { closeModal(); fail(e); }
}

/* ---- Kelola Absensi (khusus admin): buka/tutup pertemuan ---- */
pages.kelolaAbsensi = async () => {
  if (!AppState.isAdmin) return lockedHtml('Halaman ini khusus admin.');
  AppState.kelolaAbsensi = await call('api_kelolaAbsensi');
  return kelolaAbsensiHtml();
};
function kelolaAbsensiHtml() {
  const list = AppState.kelolaAbsensi;
  return '<div class="mb-5"><h1 class="text-2xl font-extrabold text-primary-dark">Kelola Absensi</h1><p class="text-sm text-slate-500">Buka/tutup pertemuan, koreksi kehadiran, dan cetak daftar hadir per mata kuliah.</p></div>'
    + (list.length ? '<div class="grid gap-4 md:grid-cols-2">' + list.map(mk => '<article class="card p-5">'
      + '<h2 class="font-bold">' + esc(mk.mataKuliah) + '</h2>'
      + '<p class="mt-1 text-sm text-slate-500">' + (mk.pertemuanAktif ? 'Pertemuan ' + mk.pertemuanAktif + ' sedang dibuka' : 'Tidak ada pertemuan aktif') + ' · total ' + mk.totalPertemuan + ' pertemuan</p>'
      + '<div class="mt-4 flex flex-wrap gap-2">'
      + (mk.pertemuanAktif
        ? '<button class="btn btn-danger !min-h-[40px]" onclick="tutupPertemuan(\'' + esc(mk.mataKuliah) + '\')"><span class="material-symbols-outlined">lock</span>Tutup Pertemuan</button>'
        : '<button class="btn btn-primary !min-h-[40px]" onclick="bukaPertemuan(\'' + esc(mk.mataKuliah) + '\')"><span class="material-symbols-outlined">add_circle</span>Buka Pertemuan Baru</button>')
      + (mk.totalPertemuan ? '<button class="btn btn-ghost !min-h-[40px]" onclick="bukaDetailAbsensi(\'' + esc(mk.mataKuliah) + '\')"><span class="material-symbols-outlined">fact_check</span>Detail &amp; Cetak</button>' : '')
      + '</div></article>').join('') + '</div>' : '<p class="card p-6 text-center text-slate-500">Daftar mata kuliah belum diisi. Kelola lewat Panel Admin &gt; Tugas Kuliah &gt; Mata Kuliah.</p>');
}
async function muatKelolaAbsensi() { AppState.kelolaAbsensi = await call('api_kelolaAbsensi'); $('app-container').innerHTML = kelolaAbsensiHtml(); }
async function bukaPertemuan(mk) {
  try { const r = await call('api_bukaPertemuan', mk); toast('Pertemuan ' + r.pertemuan + ' dibuka.'); await muatKelolaAbsensi(); } catch (e) { fail(e); }
}
function tutupPertemuan(mk) {
  openModal('<div class="p-5"><div class="flex items-center gap-3"><span class="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><span class="material-symbols-outlined">lock</span></span>'
    + '<div><h2 class="text-lg font-bold">Tutup pertemuan?</h2><p class="text-sm text-slate-600">Mahasiswa yang belum absen otomatis tercatat <strong>Alfa</strong>.</p></div></div>'
    + '<div class="mt-5 flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()" data-autofocus>Batal</button>'
    + '<button class="btn btn-danger" onclick="konfirmasiTutupPertemuan(\'' + esc(mk) + '\')">Ya, Tutup</button></div></div>');
}
async function konfirmasiTutupPertemuan(mk) {
  try { await call('api_tutupPertemuan', mk); closeModal(); toast('Pertemuan ditutup.'); await muatKelolaAbsensi(); } catch (e) { closeModal(); fail(e); }
}

/* ---- Kelola Absensi: detail satu mata kuliah (koreksi per pertemuan + cetak) ---- */
async function bukaDetailAbsensi(mk) {
  AppState.detailMatkul = mk; AppState.detailPertemuan = null;
  navigateTo('detailAbsensi');
}
pages.detailAbsensi = async () => {
  if (!AppState.isAdmin) return lockedHtml('Halaman ini khusus admin.');
  if (!AppState.detailMatkul) return lockedHtml('Pilih mata kuliah dari Kelola Absensi.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'kelolaAbsensi\')">Ke Kelola Absensi</button>');
  const rekap = await call('api_rekapAbsensi', AppState.detailMatkul);
  AppState.detailDaftarPertemuan = rekap.pertemuan;
  if (!AppState.detailPertemuan) AppState.detailPertemuan = rekap.pertemuan[rekap.pertemuan.length - 1];
  return detailAbsensiHtml();
};
after.detailAbsensi = () => muatDetailAbsensi();
function detailAbsensiHtml() {
  const opsi = AppState.detailDaftarPertemuan.map(p => '<option value="' + p + '"' + (p === AppState.detailPertemuan ? ' selected' : '') + '>Pertemuan ' + p + '</option>').join('');
  return '<div class="mb-3"><button class="btn btn-ghost" onclick="navigateTo(\'kelolaAbsensi\')"><span class="material-symbols-outlined">arrow_back</span>Kembali</button></div>'
    + '<div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 class="text-2xl font-extrabold text-primary-dark">' + esc(AppState.detailMatkul) + '</h1><p class="text-sm text-slate-500">Koreksi kehadiran dan cetak daftar hadir per pertemuan.</p></div>'
    + '<div class="flex gap-2"><select id="detailPertemuanSel" class="inp" onchange="gantiDetailPertemuan(this.value)">' + opsi + '</select>'
    + '<button class="btn btn-primary shrink-0" onclick="cetakAbsensi()"><span class="material-symbols-outlined">print</span>Cetak PDF</button></div></div>'
    + '<div id="detailAbsensiBody">' + loadingHtml() + '</div>';
}
function gantiDetailPertemuan(p) { AppState.detailPertemuan = Number(p); muatDetailAbsensi(); }
async function muatDetailAbsensi() {
  const body = $('detailAbsensiBody'); if (!body) return;
  body.innerHTML = loadingHtml();
  try { const d = await call('api_absenPertemuan', AppState.detailMatkul, AppState.detailPertemuan); AppState.detailData = d; body.innerHTML = detailAbsensiTabelHtml(d); }
  catch (e) { body.innerHTML = ''; fail(e); }
}
function detailAbsensiTabelHtml(d) {
  const opsiStatus = s => STATUS_ABSEN_FE.map(x => '<option value="' + x + '"' + (x === s ? ' selected' : '') + '>' + x + '</option>').join('');
  return '<div class="card overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">'
    + '<th class="p-3">Nama</th><th class="p-3">NIM</th><th class="p-3">Status</th></tr></thead><tbody>'
    + d.daftar.map(r => '<tr class="border-t border-slate-100"><td class="p-3 font-medium">' + esc(r.Nama) + '</td><td class="p-3 text-slate-500">' + esc(r.NIM) + '</td>'
      + '<td class="p-3"><select class="inp !min-h-[36px] !py-1" onchange="koreksiAbsen(\'' + esc(r.Email) + '\', this.value)">'
      + '<option value="" disabled' + (r.Status === '-' ? ' selected' : '') + '>' + (r.Status === '-' ? '- (belum absen)' : 'Ubah status…') + '</option>' + opsiStatus(r.Status === '-' ? '' : r.Status) + '</select></td></tr>').join('')
    + '</tbody></table></div>';
}
async function koreksiAbsen(email, status) {
  if (!status) return;
  try { await call('api_koreksiAbsen', AppState.detailMatkul, AppState.detailPertemuan, email, status); toast('Status diperbarui.'); muatDetailAbsensi(); } catch (e) { fail(e); }
}
function cetakAbsensi() {
  const d = AppState.detailData; if (!d) return;
  const tglCetak = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const rows = d.daftar.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.Nama) + '</td><td>' + esc(r.NIM) + '</td><td>' + esc(r.Status === '-' ? '' : r.Status) + '</td><td></td></tr>').join('');
  const area = document.createElement('div');
  area.id = 'printArea';
  area.innerHTML = '<h2>Daftar Hadir — ' + esc(d.mataKuliah) + ' — Pertemuan ' + d.pertemuan + '</h2>'
    + '<p>' + esc(d.judulAplikasi) + ' · dicetak ' + tglCetak + '</p>'
    + '<table><thead><tr><th>No</th><th>Nama</th><th>NIM</th><th>Status</th><th>Tanda Tangan</th></tr></thead><tbody>' + rows + '</tbody></table>';
  document.body.appendChild(area);
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
  area.remove();
}

/* ---- Chat Kelas ---- */
let chatFileData = null, chatFileName = '';
pages.chat = async () => {
  if (!AppState.token) return lockedHtml('Silakan masuk terlebih dahulu.');
  if (!isApproved()) return lockedHtml('Biodata Anda belum disetujui admin, sehingga Chat Kelas belum dapat dibuka.', '<button class="btn btn-primary mt-5" onclick="navigateTo(\'status\')">Lihat Status</button>');
  AppState.chatUnread = 0;
  AppState.chatMessages = await call('api_chatPesan');
  chatFileData = null; chatFileName = '';
  return chatHtml();
};
after.chat = () => { renderShell(); paintChat(true); };
function chatHtml() {
  return '<div class="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">'
    + '<div class="border-b border-slate-200 p-4"><h1 class="font-bold text-primary-dark">Chat Kelas 84A MM</h1><p class="text-xs text-slate-500">Pesan diperbarui otomatis setiap ±20 detik.</p></div>'
    + '<div id="chatList" class="flex-1 space-y-3 overflow-y-auto p-4"></div>'
    + '<form class="flex items-end gap-2 border-t border-slate-200 p-3" onsubmit="kirimChat(event)">'
    + '<input id="chatFileInput" type="file" accept="' + TUGAS_ACCEPT + '" class="sr-only" onchange="pickChatFile(this)">'
    + '<label for="chatFileInput" class="btn btn-ghost !min-h-[44px] !px-3" aria-label="Lampirkan file"><span class="material-symbols-outlined">attach_file</span></label>'
    + '<div class="flex-1"><textarea id="chatInput" class="inp" rows="1" maxlength="2000" placeholder="Tulis pesan…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();this.form.requestSubmit();}"></textarea>'
    + '<p id="chatFileInfo" class="mt-1 text-xs text-slate-500"></p></div>'
    + '<button type="submit" class="btn btn-primary !min-h-[44px] !px-4" aria-label="Kirim"><span class="material-symbols-outlined">send</span></button></form></div>';
}
function paintChat(scroll) {
  const box = $('chatList'); if (!box) return;
  box.innerHTML = AppState.chatMessages.length ? AppState.chatMessages.map(chatBubble).join('')
    : '<div class="py-10 text-center text-sm text-slate-400">Belum ada pesan. Mulai percakapan kelas di sini.</div>';
  if (scroll) box.scrollTop = box.scrollHeight;
}
function chatBubble(m) {
  const milik = m.Email === AppState.email;
  const lampiran = m.LampiranGambar
    ? '<img src="' + esc(m.LampiranGambar) + '" class="mt-2 max-h-48 rounded-lg" alt="Lampiran gambar" loading="lazy">'
    : (m.LampiranUrl ? '<a class="mt-2 flex items-center gap-1 text-xs underline" href="' + esc(m.LampiranUrl) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined !text-base">attach_file</span>' + esc(m.LampiranNama) + '</a>' : '');
  const waktu = new Date(m.Waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return '<div class="flex ' + (milik ? 'justify-end' : 'justify-start') + '">'
    + '<div class="chat-bubble ' + (milik ? 'chat-bubble-me' : 'chat-bubble-other') + '">'
    + (milik ? '' : '<p class="mb-0.5 text-xs font-bold text-primary">' + esc(m.NamaPengirim) + '</p>')
    + (m.Pesan ? '<p class="whitespace-pre-wrap">' + esc(m.Pesan) + '</p>' : '') + lampiran
    + '<div class="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-70"><span>' + waktu + '</span>'
    + (milik || AppState.isAdmin ? '<button type="button" class="underline" onclick="hapusChat(\'' + m.ID + '\')">hapus</button>' : '') + '</div></div></div>';
}
async function pickChatFile(inp) {
  const f = inp.files[0]; if (!f) return;
  if (TUGAS_MIME_OK.indexOf(f.type) === -1) { toast('Jenis lampiran tidak didukung.', 'error'); inp.value = ''; return; }
  if (f.size > 8 * 1024 * 1024) { toast('Ukuran lampiran maksimal 8 MB.', 'error'); inp.value = ''; return; }
  try { chatFileData = await fileToDataUrl(f); chatFileName = f.name; $('chatFileInfo').textContent = 'Lampiran: ' + f.name; }
  catch (e) { toast(e.message, 'error'); }
}
async function kirimChat(ev) {
  ev.preventDefault();
  const teks = $('chatInput').value.trim();
  if (!teks && !chatFileData) return;
  const btn = ev.target.querySelector('[type=submit]');
  setBusy(btn, true, '');
  try {
    AppState.chatMessages = await call('api_chatKirim', teks, chatFileData, chatFileName);
    $('chatInput').value = ''; chatFileData = null; chatFileName = ''; $('chatFileInput').value = ''; $('chatFileInfo').textContent = '';
    paintChat(true);
  } catch (e) { fail(e); } finally { setBusy(btn, false); }
}
async function hapusChat(id) {
  try { await call('api_chatHapus', id); AppState.chatMessages = AppState.chatMessages.filter(m => m.ID !== id); paintChat(false); toast('Pesan dihapus.'); }
  catch (e) { fail(e); }
}

/* ---------- Mulai ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  panaskanServer();
  try {
    const b = await api('api_boot');
    AppState.stats = b; AppState.menu = b.menu || { akses: {}, pesan: {} }; $('appTitle').textContent = b.title; document.title = b.title;
    setLogo(b.logoUrl);
  } catch (e) { /* tetap lanjut; halaman menampilkan pesan bila server bermasalah */ }
  navigateTo('beranda');
});
