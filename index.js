// index.js v3
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const notionUtil = require('./utils/notion');
const claudeAI = require('./utils/claude');
const ingredients = require('./modules/ingredients');
const recipes = require('./modules/recipes');
const reminder = require('./modules/reminder');

const app = express();
const lineConfig = { channelSecret: process.env.LINE_CHANNEL_SECRET, channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN };
const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });

async function sendPushMsg(userId, msg) {
  const arr = Array.isArray(msg) ? msg : [msg];
  const msgs = arr.map(m => typeof m === 'string' ? { type: 'text', text: m } : m);
  try {
    await client.pushMessage({ to: userId, messages: msgs });
  } catch(e) { console.error('Push 失敗:', e.message, JSON.stringify(msgs).substring(0,200)); }
}

async function replyMsg(replyToken, msg) {
  const arr = Array.isArray(msg) ? msg : [msg];
  const msgs = arr.map(m => typeof m === 'string' ? { type: 'text', text: m } : m);
  await client.replyMessage({ replyToken, messages: msgs });
}

app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  res.sendStatus(200);
  for (const event of req.body.events) {
    handleEvent(event).catch(err => console.error('handleEvent 失敗:', err.message, err.stack));
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const input = event.message.text.trim();
  console.log('📩 [' + userId + ']: ' + input);
  const state = recipes.getUserState(userId);
  console.log('📌 狀態：' + (state ? state.mode : '無'));

  let result;
  try {
    result = await processInput(userId, input, state);
  } catch(e) {
    console.error('processInput 失敗:', e.message, e.stack);
    result = { type: 'text', text: '發生錯誤：' + e.message };
  }

  if (result) {
    const msgs = Array.isArray(result) ? result : [result];
    const lineMessages = msgs.map(m => typeof m === 'string' ? { type: 'text', text: m } : m);
    console.log('📤 回傳訊息數:', lineMessages.length, '類型:', lineMessages.map(m=>m.type).join(','));
    try {
      await client.replyMessage({ replyToken, messages: lineMessages });
    } catch(e) {
      console.error('reply 失敗:', e.message);
      await sendPushMsg(userId, result);
    }
  }
}

async function processInput(userId, input, state) {
  // 狀態優先
  if (state) {
    if (state.mode === 'plan_meals_days') {
      const days = parseInt(input);
      if (!isNaN(days) && days >= 1 && days <= 14) {
        recipes.clearUserState(userId);
        setImmediate(async () => {
          try {
            const r = await handleMealPlanning(days);
            await sendPushMsg(userId, r);
          } catch(e) {
            console.error('規劃失敗:', e.message);
            await sendPushMsg(userId, '規劃餐點時發生問題：' + e.message);
          }
        });
        return { type: 'text', text: '好！正在為你規劃 ' + days + ' 天的餐點，請稍等幾秒⋯ 🍽️' };
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'select_category' || state.mode === 'random_category') {
      if (/^[1-6]$/.test(input)) {
        const isRandom = state.mode === 'random_category';
        recipes.clearUserState(userId);
        return await recipes.handleCategoryChoice(userId, input, isRandom);
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'browse_recipes' || state.mode === 'search_results') {
      if (/^\d+$/.test(input)) {
        const r = await recipes.handleRecipeSelection(userId, input);
        if (r) return r;
      }
      recipes.clearUserState(userId);
    }
  }

  // 固定指令
  if (/我要吃什麼|今天吃什麼|今晚吃什麼|吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'select_category' });
    return recipes.buildCategoryMenu(false);
  }
  if (/隨機推薦|隨便推薦|幫我選|隨機/.test(input)) {
    recipes.setUserState(userId, { mode: 'random_category' });
    return recipes.buildCategoryMenu(true);
  }
  if (/規劃餐點|幫我規劃|這週吃什麼|接下來吃什麼/.test(input)) {
    recipes.setUserState(userId, { mode: 'plan_meals_days' });
    return { type: 'text', text: '好！要規劃幾天的餐點？', quickReply: { items: [
      { type: 'action', action: { type: 'message', label: '3天', text: '3' } },
      { type: 'action', action: { type: 'message', label: '5天', text: '5' } },
      { type: 'action', action: { type: 'message', label: '7天', text: '7' } }
    ]} };
  }
  if (/查看食材|我有什麼食材|食材清單|目前食材/.test(input)) {
    return { type: 'text', text: await ingredients.getIngredientListText() };
  }

  // 食材更新
  if (/[+＋加]/.test(input) || (/[-－減]/.test(input) && /[\u4e00-\u9fa5]/.test(input))) {
    return { type: 'text', text: await ingredients.handleIngredientUpdate(input) };
  }

  // AI 判斷意圖
  const intent = await claudeAI.detectIntent(input);
  console.log('🤖 意圖：' + intent);

  if (intent === 'ingredient_update') {
    return { type: 'text', text: await ingredients.handleIngredientUpdate(input) };
  }
  if (intent === 'search_by_ingredient') {
    const result = await recipes.searchByIngredient(input);
    if (result && result.quickReply) {
      recipes.setUserState(userId, { mode: 'search_results', recipes: [] });
    }
    return result;
  }
  if (intent === 'what_to_eat') {
    recipes.setUserState(userId, { mode: 'select_category' });
    return recipes.buildCategoryMenu(false);
  }
  if (intent === 'random_recommend') {
    recipes.setUserState(userId, { mode: 'random_category' });
    return recipes.buildCategoryMenu(true);
  }
  if (intent === 'plan_meals') {
    recipes.setUserState(userId, { mode: 'plan_meals_days' });
    return { type: 'text', text: '好！要規劃幾天？', quickReply: { items: [
      { type: 'action', action: { type: 'message', label: '3天', text: '3' } },
      { type: 'action', action: { type: 'message', label: '5天', text: '5' } },
      { type: 'action', action: { type: 'message', label: '7天', text: '7' } }
    ]} };
  }

  // 嘗試食材搜尋
  if (/^[\u4e00-\u9fa5a-zA-Z\s]{1,8}$/.test(input.trim())) {
    return await recipes.searchByIngredient(input.trim());
  }

  return { type: 'text', text: getHelpText() };
}

async function handleMealPlanning(days) {
  console.log('🍽️ 規劃 ' + days + ' 天...');
  const [ings, recs] = await Promise.all([notionUtil.getAllIngredients(), notionUtil.getAllRecipes()]);
  console.log('食材 ' + ings.length + ' 筆，食譜 ' + recs.length + ' 筆');
  const plan = await claudeAI.generateMealPlan(days, ings, recs);
  if (!plan || !plan.plan || plan.plan.length === 0) {
    return { type: 'text', text: '規劃失敗，請先用「番茄 +6個」更新食材後再試 😅' };
  }
  let text = '📅 ' + days + ' 天餐點規劃\n─────────────\n';
  for (const d of plan.plan) {
    text += '\n【' + d.day + '】\n';
    text += '  🌅 早餐：' + (d.breakfast||'—') + '\n';
    text += '  ☀️ 午餐：' + (d.lunch||'—') + '\n';
    text += '  🌙 晚餐：' + (d.dinner||'—') + '\n';
  }
  if (plan.toBuy && plan.toBuy.length > 0) text += '\n🛒 需購買：' + plan.toBuy.join('、');
  if (plan.crossUsageTips) text += '\n\n💡 ' + plan.crossUsageTips;
  return { type: 'text', text };
}

function getHelpText() {
  return '嗨！我是「今晚煮什麼」助手 🍳\n\n📋 查詢食譜\n・「我要吃什麼」\n・「隨機推薦」\n・輸入食材名（如「番茄」）\n\n🥕 更新食材\n・「番茄 +6個」\n・「番茄 -2」\n・「豬五花 +300g 冷凍」\n\n📅 其他\n・「規劃餐點」\n・「查看食材」';
}

app.get('/', (req, res) => res.send('今晚煮什麼 Bot 🍳'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 port ' + PORT);
  const MY_LINE_USER_ID = process.env.MY_LINE_USER_ID || '';
  if (MY_LINE_USER_ID) reminder.startReminderSchedule(MY_LINE_USER_ID);
  else console.log('⚠️ 未設定 MY_LINE_USER_ID');
});
