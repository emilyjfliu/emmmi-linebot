// index.js v2 - 今晚煮什麼 LINE Bot
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const notionUtil = require('./utils/notion');
const claudeAI = require('./utils/claude');
const flex = require('./utils/flex');
const ingredients = require('./modules/ingredients');
const recipes = require('./modules/recipes');
const reminder = require('./modules/reminder');

const app = express();
const lineConfig = { channelSecret: process.env.LINE_CHANNEL_SECRET, channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN };
const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });

async function sendPushMessage(userId, messages) {
  const arr = Array.isArray(messages) ? messages : [messages];
  try {
    await client.pushMessage({ to: userId, messages: arr.map(m => typeof m === 'string' ? { type: 'text', text: m } : m) });
  } catch (err) { console.error('Push 失敗:', err.message); }
}

async function replyMessages(replyToken, messages) {
  const arr = Array.isArray(messages) ? messages : [messages];
  await client.replyMessage({ replyToken, messages: arr.map(m => typeof m === 'string' ? { type: 'text', text: m } : m) });
}

app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  res.sendStatus(200);
  for (const event of req.body.events) {
    handleEvent(event).catch(err => console.error('handleEvent 失敗:', err.message));
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const input = event.message.text.trim();
  console.log(`📩 [${userId}]: ${input}`);
  const state = recipes.getUserState(userId);
  console.log(`📌 狀態：${state ? state.mode : '無'}`);
  const result = await processInput(userId, input, state);
  if (result) {
    try { await replyMessages(replyToken, result); }
    catch (err) { console.log('reply 失敗，改 push'); await sendPushMessage(userId, result); }
  }
}

async function processInput(userId, input, state) {
  // STEP 1: 狀態優先
  if (state) {
    if (state.mode === 'plan_meals_days') {
      const days = parseInt(input);
      if (!isNaN(days) && days >= 1 && days <= 14) {
        recipes.clearUserState(userId);
        setImmediate(async () => {
          const result = await handleMealPlanning(days);
          await sendPushMessage(userId, result);
        });
        return `好！正在為你規劃 ${days} 天的餐點，請稍等幾秒⋯ 🍽️`;
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'select_category' || state.mode === 'random_category') {
      if (/^[1-6]$/.test(input)) {
        const isRandom = state.mode === 'random_category';
        recipes.clearUserState(userId);
        return await recipes.handleCategoryChoice(userId, input, isRandom);
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'browse_recipes') {
      if (/^\d+$/.test(input)) {
        const result = await recipes.handleRecipeSelection(userId, input);
        if (result) return result;
      }
      recipes.clearUserState(userId);
    }
  }

  // STEP 2: 固定指令
  if (/我要吃什麼|今天吃什麼|今晚吃什麼|吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'select_category' });
    return flex.buildCategoryQuickReply(false);
  }
  if (/隨機推薦|隨便推薦|幫我選|隨機/.test(input)) {
    recipes.setUserState(userId, { mode: 'random_category' });
    return flex.buildCategoryQuickReply(true);
  }
  if (/規劃餐點|幫我規劃|這週吃什麼|接下來吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'plan_meals_days' });
    return flex.buildDaysQuickReply();
  }
  if (/檢查食譜庫|食譜庫檢查/.test(input)) return '🔍 食譜庫品質檢查功能開發中！';
  if (/查看食材|我有什麼食材|食材清單|目前食材/.test(input)) return await ingredients.getIngredientListText();
  if (/說明|help|怎麼用|功能/.test(input)) return getHelpMessage();

  // STEP 3: 食材增減（寬鬆判斷）
  if (/[+＋加]/.test(input) || (/[-－減]/.test(input) && /[\u4e00-\u9fa5]/.test(input))) {
    return await ingredients.handleIngredientUpdate(input);
  }

  // STEP 4: AI 判斷
  const intent = await claudeAI.detectIntent(input);
  console.log(`🤖 意圖：${intent}`);
  if (intent === 'ingredient_update') return await ingredients.handleIngredientUpdate(input);
  if (intent === 'search_by_ingredient') return await recipes.searchByIngredient(input);
  if (intent === 'what_to_eat') { recipes.setUserState(userId, { mode: 'select_category' }); return flex.buildCategoryQuickReply(false); }
  if (intent === 'random_recommend') { recipes.setUserState(userId, { mode: 'random_category' }); return flex.buildCategoryQuickReply(true); }
  if (intent === 'plan_meals') { recipes.setUserState(userId, { mode: 'plan_meals_days' }); return flex.buildDaysQuickReply(); }

  // 最後嘗試食材搜尋
  if (/^[\u4e00-\u9fa5a-zA-Z\s]{1,10}$/.test(input.trim())) return await recipes.searchByIngredient(input.trim());
  return getHelpMessage();
}

async function handleMealPlanning(days) {
  try {
    console.log(`🍽️ 規劃 ${days} 天...`);
    const [availableIngredients, allRecipes] = await Promise.all([notionUtil.getAllIngredients(), notionUtil.getAllRecipes()]);
    console.log(`食材 ${availableIngredients.length} 筆，食譜 ${allRecipes.length} 筆`);
    const plan = await claudeAI.generateMealPlan(days, availableIngredients, allRecipes);
    if (!plan || !plan.plan || plan.plan.length === 0) {
      return `抱歉規劃失敗 😅\n\n建議先用「番茄 +6個」更新食材，再試一次「規劃餐點」`;
    }
    const msgs = [];
    let summary = `📅 ${days}天餐點規劃完成！`;
    if (plan.toBuy && plan.toBuy.length > 0) summary += `\n\n🛒 需購買：${plan.toBuy.join('、')}`;
    if (plan.crossUsageTips) summary += `\n\n💡 ${plan.crossUsageTips}`;
    msgs.push({ type: 'text', text: summary });
    msgs.push(flex.buildMealPlanFlex(plan, days));
    console.log('✅ 規劃完成');
    return msgs;
  } catch (err) {
    console.error('規劃失敗:', err.message, err.stack);
    return `規劃時發生問題：${err.message}`;
  }
}

function getHelpMessage() {
  return `嗨！我是「今晚煮什麼」助手 🍳\n\n📋 查詢食譜\n・「我要吃什麼」\n・「隨機推薦」\n・輸入食材名（如「番茄」）\n\n🥕 更新食材\n・「番茄 +6個」或「番茄+6」\n・「番茄 -2」\n・「豬五花 +300g 冷凍」\n・「牛奶 +1瓶 到期3/30」\n\n📅 其他\n・「規劃餐點」\n・「查看食材」`;
}

app.get('/', (req, res) => res.send('今晚煮什麼 Bot 運行中 🍳'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 伺服器啟動：port ${PORT}`);
  const MY_LINE_USER_ID = process.env.MY_LINE_USER_ID || '';
  if (MY_LINE_USER_ID) reminder.startReminderSchedule(MY_LINE_USER_ID);
  else console.log('⚠️ 未設定 MY_LINE_USER_ID');
});
