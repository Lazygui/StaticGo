const { app, BrowserWindow, ipcMain } = require('electron/main');
const express = require('express');
const path = require('path');

let mainWindow;
let staticServer = null;
let serverPort = 3000; // 你可以选择一个合适的端口
let staticServerInstance = null;

const createWindow = () => {
       mainWindow = new BrowserWindow({
              width: 520,
              height: 500,
              resizable: false,
              frame: false, // 隐藏默认边框
              webPreferences: {
                     nodeIntegration: true,
                     contextIsolation: false
              }
       });

       mainWindow.loadFile('index.html');

       // 处理窗口控制消息
       ipcMain.on('window-minimize', () => {
              if (mainWindow) {
                     mainWindow.minimize();
              }
       });

       ipcMain.on('window-close', () => {
              if (mainWindow) {
                     mainWindow.close();
              }
       });

       // 处理启动静态文件服务器的请求
       ipcMain.handle('start-server', async (event, dirPath) => {
              if (staticServer) {
                     event.sender.send('start-server-result', { success: false, message: '服务器已经在运行' });
                     return
              }

              try {
                     const app = express();
                     // 自定义静态文件中间件，为 HTML 文件禁用缓存
                     app.use((req, res, next) => {
                            // 如果请求的是 HTML 文件
                            if (req.path.endsWith('.html')) {
                                   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1
                                   res.setHeader('Pragma', 'no-cache'); // HTTP 1.0
                                   res.setHeader('Expires', '0'); // Proxies
                            }
                            next();
                     });
                     app.use(express.static(dirPath));
                     const server = app.listen(serverPort, () => {
                            event.sender.send('start-server-result', { success: true, message: serverPort });
                     });
                     staticServerInstance = server;
              } catch (error) {
                     event.sender.send('start-server-result', { success: false, message: error });
              }
       });

       ipcMain.handle('stop-service', async (event) => {
              return new Promise((resolve) => {
                     const server = staticServerInstance;

                     if (!server) {
                            console.log('[STOP-SERVICE] No running server instance found.');
                            event.sender.send('stop-service-result', { success: false, message: 'Service is not running.' });
                            resolve();
                            return;
                     }

                     console.log('[STOP-SERVICE] Attempting to stop the server...');
                     event.sender.send('stop-service-result', { success: true, message: '服务正在停止...' });
                     console.log('[STOP-SERVICE] Server _connections:', server._connections);
                     if (server._connections > 0) {
                            event.sender.send('stop-service-result', { success: false, message: '请先关闭浏览器连接' });
                            return
                     }

                     server.close((err) => {
                            if (err) {
                                   console.error('[STOP-SERVICE] Failed to stop the server:', err);
                                   event.sender.send('stop-service-result', { success: false, message: err.message });
                            } else {
                                   console.log('[STOP-SERVICE] Server has been successfully stopped.');
                                   staticServerInstance = null;
                                   event.sender.send('stop-service-result', { success: true, message: '服务已经停止' });
                            }
                            resolve();
                     });
              });
       });
};

app.whenReady().then(() => {
       createWindow();

       app.on('activate', () => {
              if (BrowserWindow.getAllWindows().length === 0) {
                     createWindow();
              }
       });
});

app.on('window-all-closed', () => {
       if (process.platform !== 'darwin') {
              app.quit();
       }
});