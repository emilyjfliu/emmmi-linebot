// index.js v4 - 今晚煮什麼 LINE Bot
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const notionUtil = require('./utils/notion');
const claudeAI = require('./utils/claude');
const ingredients = require('./modules/ingredients');
const recipes = require('./modules/recipes');
const reminder = require('./modules/reminder');

const app = express();
const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

async function sendPushMsg(userId, msg) {
  const arr = Array.isArray(msg) ? msg : [msg];
  const msgs = arr.map(function(m) { return typeof m === 'string' ? { type: 'text', text: m } : m; });
  try {
    await client.pushMessage({ to: userId, messages: msgs });
    console.log('✅ Push 成功:', msgs.length, '則訊息');
  } catch(e) {
    console.error('❌ Push 失敗:', e.message);
    // 嘗試只送文字版
    try {
      const textOnly = [{ type: 'text', text: msgs.map(function(m) { return m.altText || m.text || JSON.stringify(m).substring(0,50); }).join('\n') }];
      await client.pushMessage({ to: userId, messages: textOnly });
    } catch(e2) { console.error('❌ Push fallback 也失敗:', e2.message); }
  }
}

async function replyMsg(replyToken, msg) {
  const arr = Array.isArray(msg) ? msg : [msg];
  const msgs = arr.map(function(m) { return typeof m === 'string' ? { type: 'text', text: m } : m; });
  console.log('📤 Reply', msgs.length, '則, 類型:', msgs.map(function(m){return m.type;}).join(','));
  await client.replyMessage({ replyToken, messages: msgs });
}

app.post('/webhook', line.middleware(lineConfig), function(req, res) {
  res.sendStatus(200);
  var events = req.body.events;
  events.forEach(function(event) {
    handleEvent(event).catch(function(err) {
      console.error('❌ handleEvent 失敗:', err.message, err.stack);
    });
  });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  var userId = event.source.userId;
  var replyToken = event.replyToken;
  var input = event.message.text.trim();
  console.log('📩 [' + userId + ']: ' + input);
  var state = recipes.getUserState(userId);
  console.log('📌 狀態：' + (state ? state.mode : '無'));

  var result;
  try {
    result = await processInput(userId, input, state);
  } catch(e) {
    console.error('❌ processInput 失敗:', e.message, e.stack);
    result = { type: 'text', text: '發生錯誤：' + e.message };
  }

  if (!result) return;

  var arr = Array.isArray(result) ? result : [result];
  var msgs = arr.map(function(m) { return typeof m === 'string' ? { type: 'text', text: m } : m; });

  try {
    await client.replyMessage({ replyToken, messages: msgs });
    console.log('✅ Reply 成功');
  } catch(e) {
    console.error('❌ Reply 失敗:', e.message);
    await sendPushMsg(userId, result);
  }
}

async function processInput(userId, input, state) {
  // STEP 1: 狀態優先
  if (state) {
    if (state.mode === 'plan_meals_days') {
      var days = parseInt(input);
      if (!isNaN(days) && days >= 1 && days <= 14) {
        recipes.clearUserState(userId);
        var uid = userId;
        setImmediate(async function() {
          try {
            var r = await handleMealPlanning(days);
            await sendPushMsg(uid, r);
          } catch(e) {
            console.error('規劃失敗:', e.message, e.stack);
            await sendPushMsg(uid, '規劃餐點時發生問題：' + e.message);
          }
        });
        return { type: 'text', text: '好！正在為你規劃 ' + days + ' 天的餐點，請稍等幾秒⋯ 🍽️' };
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'select_category' || state.mode === 'random_category') {
      if (/^[1-6]$/.test(input)) {
        var isRandom = state.mode === 'random_category';
        recipes.clearUserState(userId);
        return await recipes.handleCategoryChoice(userId, input, isRandom);
      }
      recipes.clearUserState(userId);
    } else if (state.mode === 'browse_recipes') {
      if (/^\d+$/.test(input)) {
        var r = await recipes.handleRecipeSelection(userId, input);
        if (r) return r;
      }
      recipes.clearUserState(userId);
    }
  }

  // STEP 2: 固定指令
  if (/菜單|選單|幫助|說明|menu/i.test(input)) { return getHelpText(); }
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
    return {
      type: 'text',
      text: '好！要規劃幾天的餐點？',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '3天', text: '3' } },
          { type: 'action', action: { type: 'message', label: '5天', text: '5' } },
          { type: 'action', action: { type: 'message', label: '7天', text: '7' } }
        ]
      }
    };
  }
  if (/查看食材|我有什麼食材|食材清單|目前食材/.test(input)) {
    var listText = await ingredients.getIngredientListText();
    return { type: 'text', text: listText };
  }

  // STEP 3: 食材增減
  if (/[+＋加]/.test(input) || (/[-－減]/.test(input) && /[\u4e00-\u9fa5]/.test(input))) {
    var ingResult = await ingredients.handleIngredientUpdate(input);
    return { type: 'text', text: ingResult };
  }

  // STEP 4: AI 判斷意圖
  var intent = await claudeAI.detectIntent(input);
  console.log('🤖 意圖：' + intent);

  if (intent === 'ingredient_update') {
    var ur = await ingredients.handleIngredientUpdate(input);
    return { type: 'text', text: ur };
  }
  if (intent === 'search_by_ingredient') {
    // 搜尋後把狀態存到 userId
    var searchResult = await recipes.searchByIngredient(input);
    // 把搜尋結果的食譜存到用戶狀態
    recipes.setUserState(userId, { mode: 'browse_recipes', recipes: [], availableIngredients: [], searchQuery: input });
    return searchResult;
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

  // 最後：短文字嘗試食材搜尋
  if (/^[\u4e00-\u9fa5a-zA-Z\s]{1,8}$/.test(input.trim())) {
    var sr = await recipes.searchByIngredient(input.trim());
    recipes.setUserState(userId, { mode: 'browse_recipes', recipes: [], availableIngredients: [], searchQuery: input.trim() });
    return sr;
  }

  return { type: 'text', text: getHelpText() };
}

async function handleMealPlanning(days) {
  console.log('🍽️ 規劃 ' + days + ' 天...');
  try {
    var data = await Promise.all([notionUtil.getAllIngredients(), notionUtil.getAllRecipes()]);
    var ings = data[0];
    var recs = data[1];
    console.log('食材 ' + ings.length + ' 筆，食譜 ' + recs.length + ' 筆');
    var plan = await claudeAI.generateMealPlan(days, ings, recs);
    if (!plan || !plan.plan || plan.plan.length === 0) {
      return { type: 'text', text: '規劃失敗，請先用「番茄 +6個」更新食材後再試 😅' };
    }
    var text = '📅 ' + days + ' 天餐點規劃\n────────────\n';
    plan.plan.forEach(function(d) {
      text += '\n【' + d.day + '】\n';
      text += '  🌅 早餐：' + (d.breakfast || '—') + '\n';
      text += '  ☀️ 午餐：' + (d.lunch || '—') + '\n';
      text += '  🌙 晚餐：' + (d.dinner || '—') + '\n';
    });
    if (plan.toBuy && plan.toBuy.length > 0) text += '\n🛒 需購買：' + plan.toBuy.join('、');
    if (plan.crossUsageTips) text += '\n\n💡 ' + plan.crossUsageTips;
    return { type: 'text', text: text };
  } catch(e) {
    console.error('規劃失敗:', e.message, e.stack);
    return { type: 'text', text: '規劃時發生問題：' + e.message };
  }
}

function _menuRow(emoji, title, sub, msg) {
  return { type: 'box', layout: 'horizontal', paddingTop: '10px', paddingBottom: '10px',
    action: { type: 'message', label: title, text: msg },
    contents: [
      { type: 'text', text: emoji, size: 'lg', flex: 0 },
      { type: 'box', layout: 'vertical', flex: 1, margin: 'md', contents: [
        { type: 'text', text: title, size: 'sm', weight: 'bold', color: '#333333' },
        { type: 'text', text: sub, size: 'xs', color: '#8C8C8C' },
      ]},
      { type: 'text', text: '›', size: 'lg', color: '#CCCCCC', flex: 0, gravity: 'center' },
    ],
  };
}
function getHelpText() {
  return {
    type: 'flex', altText: '今天煮什麼！功能選單',
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#E8845A', paddingAll: '20px',
        contents: [
          { type: 'text', text: '🍳 今天煮什麼！', weight: 'bold', size: 'xl', color: '#FFFFFF' },
          { type: 'text', text: '你的智慧飲食小助手', size: 'sm', color: '#FFE8D6' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [
          _menuRow('🍽️', '我要吃什麼', '依類別瀏覽食譜', '我要吃什麼'),
          { type: 'separator', margin: 'none', color: '#EEEEEE' },
          _menuRow('🎲', '隨機推薦', '幫我隨機挑一道', '隨機推薦'),
          { type: 'separator', margin: 'none', color: '#EEEEEE' },
          _menuRow('🥕', '查看食材', '目前食材庫狀況', '查看食材'),
          { type: 'separator', margin: 'none', color: '#EEEEEE' },
          _menuRow('📅', '規劃餐點', '安排接下來幾天的餐', '規劃餐點'),
          { type: 'separator', margin: 'none', color: '#EEEEEE' },
          _menuRow('🔍', '食材搜尋', '輸入食材名稱直接搜尋', '番茄'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'text', text: '💡 輸入任意食材名稱可搜尋食譜', size: 'xs', color: '#8C8C8C', align: 'center' }],
      },
    },
  };
}

app.get('/', function(req, res) { res.send('今晚煮什麼 Bot 🍳'); });

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('🚀 port ' + PORT);
  var MY_LINE_USER_ID = process.env.MY_LINE_USER_ID || '';
  if (MY_LINE_USER_ID) {
    reminder.startReminderSchedule(MY_LINE_USER_ID);
  } else {
    console.log('⚠️ 未設定 MY_LINE_USER_ID');
  }
});
