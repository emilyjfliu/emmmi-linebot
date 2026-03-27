// index.js
// 「今晚煮什麼」LINE Bot 主程式
// 接收 LINE Webhook 事件，分發到各功能模組

require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');

// 功能模組
const ingredients = require('./modules/ingredients');
const recipes = require('./modules/recipes');
const reminder = require('./modules/reminder');
const claudeAI = require('./utils/claude');

const app = express();

// LINE SDK 設定
const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// =====================
// Webhook 接收端點
// =====================
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.sendStatus(200); // 立刻回應 200，避免 LINE 超時重送

  const events = req.body.events;
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('❌ 處理事件失敗：', err.message, err.stack);
    }
  }
});

// =====================
// 主要事件處理
// =====================
async function handleEvent(event) {
  // 只處理文字訊息
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const input = event.message.text.trim();

  console.log(`📩 收到訊息 [${userId}]: ${input}`);

  const reply = await processInput(userId, input);

  if (reply) {
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: reply }]
    });
  }
}

// =====================
// 輸入分發邏輯
// =====================
async function processInput(userId, input) {

  // --- 1. 先檢查是否有進行中的對話狀態 ---
  const state = recipes.getUserState(userId);

  // 使用者正在瀏覽食譜列表，輸入數字代表選擇食譜
  if (state && state.mode === 'browse_recipes') {
    if (/^\d+$/.test(input)) {
      const result = await recipes.handleRecipeSelection(userId, input);
      if (result) return result;
      // 不是有效數字，繼續往下判斷
    } else {
      // 使用者輸入了非數字，清除狀態繼續正常判斷
      recipes.clearUserState(userId);
    }
  }

  // 使用者正在選擇類別（「我要吃什麼」或「隨機推薦」後）
  if (state && (state.mode === 'select_category' || state.mode === 'random_category')) {
    if (/^[1-6]$/.test(input)) {
      const isRandom = state.mode === 'random_category';
      recipes.clearUserState(userId);
      return await recipes.handleCategoryChoice(userId, input, isRandom);
    }
  }

  // --- 2. 系統指令判斷（直接字串比對，不需要 AI）---

  // 我要吃什麼
  if (/我要吃什麼|今天吃什麼|今晚吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'select_category' });
    return recipes.getWhatToEatMenu();
  }

  // 隨機推薦
  if (/隨機推薦|隨便推薦|幫我選/.test(input)) {
    recipes.setUserState(userId, { mode: 'random_category' });
    return recipes.getRandomRecommendMenu();
  }

  // 規劃餐點
  if (/規劃餐點|幫我規劃|這週吃什麼|接下來吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'plan_meals_days' });
    return `好！要規劃幾天的餐點？\n\n請選擇：\n3️⃣ 3天\n5️⃣ 5天\n7️⃣ 7天\n或直接輸入天數（例如「4」）`;
  }

  // 規劃餐點 - 選天數
  if (state && state.mode === 'plan_meals_days') {
    const days = parseInt(input);
    if (!isNaN(days) && days >= 1 && days <= 14) {
      recipes.clearUserState(userId);
      return await handleMealPlanning(days);
    }
  }

  // 檢查食譜庫
  if (/檢查食譜庫|食譜庫檢查/.test(input)) {
    return '🔍 食譜庫品質檢查功能開發中，敬請期待！\n\n目前如發現問題，可以直接到 Notion 修改。';
  }

  // 查看食材庫
  if (/查看食材|我有什麼食材|食材清單|目前食材/.test(input)) {
    return await ingredients.getIngredientListText();
  }

  // --- 3. 食材增減（有 + 或 - 符號）---
  if (/[+＋\-－]/.test(input) && !/^[1-9]$/.test(input)) {
    return await ingredients.handleIngredientUpdate(input);
  }

  // --- 4. 用 AI 判斷其他意圖 ---
  const intent = await claudeAI.detectIntent(input);
  console.log(`🤖 AI 判斷意圖：${intent}`);

  if (intent === 'ingredient_update') {
    return await ingredients.handleIngredientUpdate(input);
  }

  if (intent === 'search_by_ingredient') {
    return await recipes.searchByIngredient(input);
  }

  if (intent === 'what_to_eat') {
    recipes.setUserState(userId, { mode: 'select_category' });
    return recipes.getWhatToEatMenu();
  }

  if (intent === 'random_recommend') {
    recipes.setUserState(userId, { mode: 'random_category' });
    return recipes.getRandomRecommendMenu();
  }

  if (intent === 'plan_meals') {
    recipes.setUserState(userId, { mode: 'plan_meals_days' });
    return `好！要規劃幾天的餐點？\n\n3️⃣ 3天 / 5️⃣ 5天 / 7️⃣ 7天\n或直接輸入天數`;
  }

  // --- 5. 預設回應 ---
  return getHelpMessage();
}

// =====================
// 規劃餐點流程
// =====================
async function handleMealPlanning(days) {
  try {
    const [availableIngredients, allRecipes] = await Promise.all([
      require('./utils/notion').getAllIngredients(),
      require('./utils/notion').getAllRecipes()
    ]);

    const plan = await claudeAI.generateMealPlan(days, availableIngredients, allRecipes);

    if (!plan) {
      return '抱歉，規劃餐點時發生問題，請稍後再試 😅';
    }

    let text = `📅 未來 ${days} 天餐點草稿\n\n`;

    for (const day of plan.plan) {
      text += `【${day.day}】\n`;
      text += `  早餐：${day.breakfast || '—'}\n`;
      text += `  午餐：${day.lunch || '—'}\n`;
      text += `  晚餐：${day.dinner || '—'}\n\n`;
    }

    if (plan.toBuy && plan.toBuy.length > 0) {
      text += `🛒 需要購買：\n`;
      plan.toBuy.forEach(item => { text += `  ・${item}\n`; });
      text += '\n';
    }

    if (plan.crossUsageTips) {
      text += `💡 食材搭配建議：\n${plan.crossUsageTips}\n`;
    }

    text += '\n如要調整，直接到 Notion 食譜庫修改「哪天吃」欄位';

    return text;

  } catch (err) {
    console.error('規劃餐點失敗：', err);
    return '規劃餐點時發生問題，請稍後再試 😅';
  }
}

// =====================
// 說明訊息
// =====================
function getHelpMessage() {
  return `嗨！我是「今晚煮什麼」助手 🍳

你可以這樣使用我：

📋 查詢食譜
・「我要吃什麼」— 依類別選食譜
・「隨機推薦」— 幫你隨機挑一道
・輸入食材名（如「番茄」）— 查相關食譜

🥕 更新食材
・「番茄 +6個」— 買入食材
・「番茄 -2」— 使用食材
・「豬五花 +300g 冷凍」— 標記冷凍
・「牛奶 +1瓶 到期3/30」— 指定到期日

📅 規劃餐點
・「規劃餐點」— 規劃接下來幾天的菜單`;
}

// =====================
// 健康檢查端點
// =====================
app.get('/', (req, res) => {
  res.send('今晚煮什麼 LINE Bot 運行中 🍳');
});

// =====================
// 啟動伺服器
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 伺服器啟動：port ${PORT}`);

  // 啟動每日提醒排程
  // ⚠️ 重要：把下方的 YOUR_LINE_USER_ID 換成你自己的 LINE User ID
  // 取得方式：先把 bot 加好友，傳任何訊息，看 Railway log 裡的 userId
  const MY_LINE_USER_ID = process.env.MY_LINE_USER_ID || '';
  if (MY_LINE_USER_ID) {
    reminder.startReminderSchedule(MY_LINE_USER_ID);
  } else {
    console.log('⚠️ 尚未設定 MY_LINE_USER_ID，每日提醒功能未啟動');
    console.log('   先把 bot 加好友，傳一則訊息，從 log 找到你的 userId，');
    console.log('   然後加到 Railway 環境變數 MY_LINE_USER_ID');
  }
});
