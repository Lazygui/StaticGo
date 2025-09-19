const { app, BrowserWindow, ipcMain } = require('electron/main');
const express = require('express');
let activeConnections = 0;
let mainWindow;
let staticServer = null;
let staticServerInstance = null;
function setupConnectionTracking(server) {
       server.on('connection', (socket) => {
              activeConnections++;
              socket.on('close', () => {
                     activeConnections--;
              });
       });
}
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
       ipcMain.handle('start-server', async (event, dirPath, port = 10001) => {
              if (staticServer) {
                     event.sender.send('start-server-result', { success: false, message: '服务器已经在运行' });
                     return
              }

              try {
                     const expressApp = express();
                     // 自定义静态文件中间件，为 HTML 文件禁用缓存
                     expressApp.use((req, res, next) => {
                            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1
                            res.setHeader('Pragma', 'no-cache'); // HTTP 1.0
                            res.setHeader('Expires', '0'); // Proxies

                            next();
                     });
                     expressApp.use(express.static(dirPath));

                     const server = expressApp.listen(port, () => {
                            staticServerInstance = server;
                            setupConnectionTracking(server);
                            event.sender.send('start-server-result', {
                                   success: true,
                                   message: `✅ 服务已启动`,
                                   port: port
                            });
                     });

                     staticServerInstance = server;
              } catch (error) {
                     event.sender.send('start-server-result', {
                            success: false,
                            message: error.message || '启动服务失败'
                     });
              }
       });

       ipcMain.handle('stop-service', async (event) => {
              return new Promise((resolve) => {
                     const server = staticServerInstance;

                     if (!server) {
                            event.sender.send('stop-service-result', { success: false, message: '❌ 服务未在运行' });
                            resolve();
                            return;
                     }


                     if (activeConnections > 0) {
                            event.sender.send('stop-service-result', {
                                   success: true,
                                   message: '⏳ 服务正在等待浏览器连接关闭，请稍候...',
                            });

                            // 🕐 每隔 300ms 检查一次连接数是否变为 0
                            const checkInterval = setInterval(() => {
                                   if (activeConnections === 0) {
                                          clearInterval(checkInterval);

                                          event.sender.send('stop-service-result', {
                                                 success: true,
                                                 message: '⏳ 正在停止服务，请稍候...',
                                          });

                                          server.close((err) => {
                                                 if (err) {
                                                        event.sender.send('stop-service-result', {
                                                               success: false,
                                                               message: '❌ 停止服务失败: ' + err.message,
                                                        });
                                                 } else {
                                                        staticServerInstance = null;
                                                        expressApp = null; // 清理引用
                                                        event.sender.send('stop-service-result', {
                                                               success: true,
                                                               message: '✅ 服务已关闭',
                                                        });
                                                 }
                                                 resolve();
                                          });
                                   }
                            }, 300); // 每 300ms 检查一次，可根据需求调整

                     } else {

                            event.sender.send('stop-service-result', {
                                   success: true,
                                   message: '⏳ 正在停止服务，请稍候...',
                            });

                            server.close((err) => {
                                   if (err) {
                                          console.error('[STOP-SERVICE] 关闭服务出错:', err);
                                          event.sender.send('stop-service-result', {
                                                 success: false,
                                                 message: '❌ 停止服务失败: ' + err.message,
                                          });
                                   } else {
                                          staticServerInstance = null;
                                          expressApp = null;
                                          event.sender.send('stop-service-result', {
                                                 success: true,
                                                 message: '✅ 服务已关闭',
                                          });
                                   }
                                   resolve();
                            });
                     }
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