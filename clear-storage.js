/**
 * 清除 LocalStorage 脚本
 * 
 * 在浏览器控制台运行此脚本以清除所有 DeepRead 数据
 * 
 * 使用方法：
 * 1. 打开浏览器开发者工具 (F12)
 * 2. 切换到 Console 标签
 * 3. 复制粘贴此脚本并回车执行
 */

(function clearDeepReadStorage() {
  const keysToRemove = [
    'deepread_library',
    'deepread_category_meta',
    'deepread_user_preferences',
    'deepread_reading_history',
    'deepread_ai_cache'
  ];
  
  console.log('🧹 开始清理 DeepRead 存储数据...\n');
  
  let removedCount = 0;
  keysToRemove.forEach(key => {
    if (localStorage.getItem(key)) {
      localStorage.removeItem(key);
      console.log(`✓ 已删除: ${key}`);
      removedCount++;
    } else {
      console.log(`○ 不存在: ${key}`);
    }
  });
  
  console.log(`\n🎉 清理完成！共删除 ${removedCount} 项数据`);
  console.log('🔄 请刷新页面以查看效果');
})();
