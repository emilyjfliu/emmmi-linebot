// modules/reminder.js
// 模組 7：食材過期提醒，每天 08:00 自動推播到 LINE

const cron = require('node-cron');
const axios = require('axios');
const notion = require('../utils/notion');

/**
 * 啟動定時提醒排程（每天 08:00 台灣時間）
 * @param {string} lineUserId - 你的 LINE User ID（接收提醒的對象）
 */
function startReminderSchedule(lineUserId) {
  // cron 格式：秒 分 時 日 月 星期
  // 台灣是 UTC+8，所以 08:00 台灣 = 00:00 UTC
  cron.schedule('0 0 0 * * *', async () => {
    console.log('⏰ 執行每日食材提醒檢查...');
    try {
      const message = await generateReminderMessage();
      if (message) {
        await sendLineMessage(lineUserId, message);
        console.log('✅ 已發送食材提醒');
      } else {
        console.log('✅ 今天沒有快過期的食材，不發送提醒');
      }
    } catch (err) {
      console.error('❌ 發送提醒失敗：', err.message);
    }
  }, {
    timezone: 'Asia/Taipei'
  });

  console.log('✅ 食材提醒排程已啟動（每天 08:00 台灣時間）');
}

/**
 * 生成提醒訊息
 * @returns {string|null} - 有需要提醒則回傳訊息，否則回傳 null
 */
async function generateReminderMessage() {
  const expiringIngredients = await notion.getExpiringIngredients();

  if (expiringIngredients.length === 0) return null;

  // 分成「快過期」和「冷凍久放」兩類
  const fridge = expiringIngredients.filter(i => i.storage !== '冷凍');
  const frozen = expiringIngredients.filter(i => i.storage === '冷凍');

  let message = '🌅 早安！今天的食材提醒\n\n';

  if (fridge.length > 0) {
    message += '⚠️ 快過期（建議今明使用）：\n';
    for (const item of fridge) {
      message += `・${item.name}（${item.alertReason}）\n`;

      // 查詢這個食材能做什麼食譜
      const recipes = await notion.getRecipesByIngredientName(item.name);
      if (recipes.length > 0) {
        const recipeNames = recipes.slice(0, 3).map(r => r.name).join('、');
        message += `  可以做：${recipeNames}\n`;
      }
    }
    message += '\n';
  }

  if (frozen.length > 0) {
    message += '❄️ 冷凍庫（放超過30天）：\n';
    for (const item of frozen) {
      message += `・${item.name}（${item.alertReason}）\n`;

      const recipes = await notion.getRecipesByIngredientName(item.name);
      if (recipes.length > 0) {
        const recipeNames = recipes.slice(0, 2).map(r => r.name).join('、');
        message += `  可以做：${recipeNames}\n`;
      }
    }
    message += '\n';
  }

  message += '回覆「規劃餐點」來安排這幾天的菜單 🍽️';

  return message;
}

/**
 * 用 LINE Push API 主動發送訊息
 * @param {string} userId - 接收者的 LINE User ID
 * @param {string} text - 訊息內容
 */
async function sendLineMessage(userId, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    {
      to: userId,
      messages: [{ type: 'text', text }]
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

/**
 * 手動觸發提醒（測試用）
 */
async function triggerReminderNow(userId) {
  const message = await generateReminderMessage();
  if (message) {
    await sendLineMessage(userId, message);
    return '已發送食材提醒！';
  } else {
    return '目前沒有快過期的食材 🎉';
  }
}

module.exports = {
  startReminderSchedule,
  generateReminderMessage,
  sendLineMessage,
  triggerReminderNow
};
