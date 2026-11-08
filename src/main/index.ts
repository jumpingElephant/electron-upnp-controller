import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import icon from '../../resources/icon.png?asset';

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 460,
      height: 760,
      minWidth: 380,
      minHeight: 520,
      title: 'Raumfeld Controller',
      // Window/taskbar icon on Linux and Windows. macOS ignores it (uses the app bundle's .icns).
      icon,
      backgroundColor: '#1b1d22',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Debug aid: RAUMFELD_DEVTOOLS=1 npm run dev  -> renderer DevTools in a detached window.
    if (process.env['RAUMFELD_DEVTOOLS']) mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.setMenuBarVisibility(false);
    // Never navigate or open windows from renderer content.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    if (process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
    mainWindow.on('closed', () => (mainWindow = null));
  };

  // Windows: groups the taskbar button/pin under our icon; must match appId in electron-builder.yml.
  app.setAppUserModelId('org.example.raumfeld-controller');

  void app.whenReady().then(() => {
    // macOS dev runs show Electron's icon in the Dock; packaged builds use the bundle .icns.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon);
    const dispose = registerIpc(() => mainWindow);
    app.on('before-quit', dispose);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
