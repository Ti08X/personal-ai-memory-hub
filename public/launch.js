// Local source files cannot host authenticated APIs. Open the deployed service.
if (location.protocol === 'file:') {
 location.replace('https://pw.zgatri.com/dashboard');
} else {
 setTimeout(() => {
  if (!document.documentElement.dataset.appReady) {
   const error = document.getElementById('login-error');
   if (error) error.textContent = '页面脚本没有成功加载。请刷新正式网址；若仍失败，请检查网络或代理连接。';
  }
 }, 8000);
}
