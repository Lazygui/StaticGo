const { app, BrowserWindow, ipcMain } = require('electron/main');
const express = require('express');
const path = require('path');
const fs = require('fs');
let activeConnections = 0;
let mainWindow;
let staticServer = null;
let staticServerInstance = null;

// =============================================
// 🔧 新增：路径记忆功能 —— 开始
// =============================================

const getUserDataDir = () => app.getPath('userData');
const getLastUsedDirPath = () => {
       try {
              const userDataDir = getUserDataDir();
              const configPath = path.join(userDataDir, 'lastDir.json');
              if (fs.existsSync(configPath)) {
                     const data = fs.readFileSync(configPath, 'utf-8');
                     const config = JSON.parse(data);
                     return config.lastDirPath || ''; // 可能是空字符串
              }
       } catch (err) {
              console.error('[路径记忆] 读取 lastDir.json 失败:', err);
       }
       return ''; // 默认返回空
};

const saveLastUsedDirPath = (dirPath) => {
       try {
              const userDataDir = getUserDataDir();
              const configPath = path.join(userDataDir, 'lastDir.json');
              fs.writeFileSync(configPath, JSON.stringify({ lastDirPath: dirPath }, null, 2), 'utf-8');
       } catch (err) {
              console.error('[路径记忆] 保存 lastDir.json 失败:', err);
       }
};

// 提供给渲染进程调用的 IPC 接口：获取上一次的路径
ipcMain.handle('get-last-dir', () => {
       return getLastUsedDirPath();
});

ipcMain.handle('get-user-data-dir', () => {
       return app.getPath('userData');
});

// =============================================
// 🔧 新增：路径记忆功能 —— 结束
// =============================================

// 保持你原来的 setupConnectionTracking 函数不变
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
                     contextIsolation: false, // 注意：为了简化，保持为 false，生产环境建议隔离
              },
       });

       mainWindow.loadFile('index.html');

       // 处理窗口控制消息
       ipcMain.on('window-minimize', () => {
              if (mainWindow) mainWindow.minimize();
       });

       ipcMain.on('window-close', () => {
              if (mainWindow) mainWindow.close();
       });

       // 处理启动静态文件服务器的请求
       ipcMain.handle('start-server', async (event, dirPath, port = 10001) => {
              if (staticServer) {
                     event.sender.send('start-server-result', { success: false, message: '服务器已经在运行' });
                     return;
              }

              try {
                     const expressApp = express();

                     // 自定义静态文件中间件，为 HTML 文件禁用缓存
                     expressApp.use((req, res, next) => {
                            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                            res.setHeader('Pragma', 'no-cache');
                            res.setHeader('Expires', '0');
                            next();
                     });

                     expressApp.use(express.static(dirPath));

                     const server = expressApp.listen(port, () => {
                            staticServerInstance = server;
                            setupConnectionTracking(server);
                            event.sender.send('start-server-result', {
                                   success: true,
                                   message: `✅ 服务已启动`,
                                   port: port,
                            });

                            // 🔒 新增：服务启动成功后，保存用户这次输入的路径
                            saveLastUsedDirPath(dirPath);
                     });

                     staticServerInstance = server;
              } catch (error) {
                     event.sender.send('start-server-result', {
                            success: false,
                            message: error.message || '启动服务失败',
                     });
              }
       });

       // 处理停止服务的请求（保持你原来的逻辑不变）
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
                                                        event.sender.send('stop-service-result', {
                                                               success: true,
                                                               message: '✅ 服务已关闭',
                                                        });
                                                 }
                                                 resolve();
                                          });
                                   }
                            }, 300);
                     } else {
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

// 应用启动
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