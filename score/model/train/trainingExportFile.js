/* 原生写入必须等完成；能读回时逐字符核对。下载触发不能视为已落盘。 */
function deadline(promise, ms) {
 return new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('训练文件操作超时')), ms);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
 });
}
export async function writeTrainingSnapshot(game, download, dir, filename, content, timeoutMs = 8000) {
 let error = '';
 try {
  if (game && typeof game.writeFile === 'function') {
   await deadline(new Promise((resolve, reject) => {
    game.writeFile(content, dir, filename, result => {
     if (Object.prototype.toString.call(result) === '[object Error]' || typeof result === 'string' && result || result && (result.error || typeof result.code === 'number')) reject(new Error(String(result.message || result.error || result)));
     else resolve();
    });
   }), timeoutMs);
  } else if (game && game.promises && typeof game.promises.writeFile === 'function') {
   await deadline(game.promises.writeFile(content, dir, filename), timeoutMs);
  } else throw new Error('原生文件接口不可用');
  let read = null;
  if (game.promises && typeof game.promises.readFileAsText === 'function') read = game.promises.readFileAsText(dir + filename);
  else if (typeof game.readFileAsText === 'function') read = new Promise((resolve, reject) => game.readFileAsText(dir + filename, resolve, reject));
  if (read) {
   const saved = await deadline(read, timeoutMs);
   if (saved !== content) throw new Error('训练文件读回内容不一致');
   return { ok: true, via: 'file', verified: true };
  }
  return { ok: true, via: 'file', verified: false, note: '写入已返回，无法读回核验；保留样本' };
 } catch (e) { error = String(e.message || e); }
 try {
  if (download(filename, content)) return { ok: true, via: 'download', verified: false, note: '已触发下载，请确认文件保存完成；样本保留', nativeError: error };
 } catch (e) { error += '；' + String(e.message || e); }
 return { ok: false, via: 'none', verified: false, err: error + '；下载未触发，样本保留' };
}
