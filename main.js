const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { execFile } = require('child_process');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win;
const dataDir = () => app.getPath('userData');
const dbFile = () => path.join(dataDir(), 'salesdata.json');

// أماكن ملفات الترخيص المخفية (نسخ متعددة، تُقرأ كلها ويُدمج ما فيها)
const licFiles = () => {
  const pd = process.env.ProgramData || path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(dataDir(), '.lic'),
    path.join(pd, '.wscache', 'cfg.dat'),
    path.join(os.homedir(), '.syscache', 'lic.dat')
  ];
};

function write(p, s) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const t = p + '.tmp';
    fs.writeFileSync(t, s);
    fs.renameSync(t, p);
    return true;
  } catch (e) { return false; }
}
function hideDir(d) {
  if (process.platform === 'win32' && d !== dataDir()) execFile('attrib', ['+h', d], () => {});
}
function dailyBackup() {
  try {
    const d = path.join(dataDir(), 'backups');
    const n = path.join(d, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
    if (!fs.existsSync(n)) {
      fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(dbFile(), n);
      fs.readdirSync(d).sort().slice(0, -14).forEach(f => fs.unlinkSync(path.join(d, f)));
    }
  } catch (e) {}
}
function saveDb(s) { if (typeof s === 'string' && s.length) { write(dbFile(), s); dailyBackup(); } return true; }

ipcMain.handle('lic:read', () => licFiles().map(p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }).filter(Boolean));
ipcMain.handle('lic:write', (e, s) => {
  if (typeof s !== 'string') return false;
  licFiles().forEach(p => { const d = path.dirname(p), isNew = !fs.existsSync(d); write(p, s); if (isNew) hideDir(d); });
  return true;
});
ipcMain.handle('db:load', () => { try { return fs.readFileSync(dbFile(), 'utf8'); } catch (e) { return null; } });
ipcMain.handle('db:save', (e, s) => saveDb(s));
ipcMain.on('db:saveSync', (e, s) => { saveDb(s); e.returnValue = true; });
ipcMain.handle('db:wipe', () => { try { fs.unlinkSync(dbFile()); } catch (e) {} return true; });
ipcMain.handle('app:info', () => ({ dataPath: dataDir(), mirror: fs.existsSync(dbFile()) }));

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1000, minHeight: 640,
    autoHideMenuBar: true, title: 'منظومة المبيعات',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, devTools: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
