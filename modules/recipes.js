// modules/recipes.js
const notion = require('../utils/notion');
const claudeAI = require('../utils/claude');

const CATEGORY_MAP = {
  '1': { label: '主食', notionValues: ['主食', '午晚餐'] },
  '2': { label: '配菜－蔬菜類', notionValues: ['菜'] },
  '3': { label: '配菜－肉類', notionValues: ['肉'] },
  '4': { label: '配菜－其他', notionValues: ['午晚餐'] },
  '5': { label: '湯品', notionValues: ['湯'] },
  '6': { label: '甜點', notionValues: ['早餐'] }
};

const userState = {};

function setUserState(userId, state) { userState[userId] = { ...state, updatedAt: Date.now() }; }
function getUserState(userId) {
  const s = userState[userId];
  if (s && Date.now() - s.updatedAt > 10 * 60 * 1000) { delete userState[userId]; return null; }
  return s;
}
function clearUserState(userId) { delete userState[userId]; }

function buildCategoryMenu(isRandom) {
  return {
    type: 'text',
    text: isRandom ? '好！請選擇哪類料理（我直接幫你挑一道！）' : '今天想吃什麼？請選擇類型：',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '主食', text: '1' } },
        { type: 'action', action: { type: 'message', label: '配菜蔬菜', text: '2' } },
        { type: 'action', action: { type: 'message', label: '配菜肉類', text: '3' } },
        { type: 'action', action: { type: 'message', label: '配菜其他', text: '4' } },
        { type: 'action', action: { type: 'message', label: '湯品', text: '5' } },
        { type: 'action', action: { type: 'message', label: '甜點', text: '6' } }
      ]
    }
  };
}

async function handleCategoryChoice(userId, choice, isRandom) {
  const category = CATEGORY_MAP[choice];
  if (!category) return { type: 'text', text: '請輸入 1 到 6！' };

  // 查詢食譜
  let recipes = [];
  try {
    const results = await Promise.all(category.notionValues.map(v => notion.getRecipesByCategory(v)));
    for (const r of results) recipes = recipes.concat(r);
  } catch(e) {
    console.error('查食譜失敗:', e.message);
    return { type: 'text', text: '查詢食譜時發生問題：' + e.message };
  }

  // 去重
  const seen = new Set();
  recipes = recipes.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  if (recipes.length === 0) {
    return { type: 'text', text: '目前「' + category.label + '」分類還沒有食譜 😅' };
  }

  // 查現有食材（有 timeout）
  let availableIds = new Set();
  let availableIngredients = [];
  try {
    availableIngredients = await Promise.race([
      notion.getAllIngredients(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 4000))
    ]);
    availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));
  } catch(e) { console.log('食材查詢:', e.message); }

  // 計算齊全度
  const recipesWithStatus = recipes.map(r => {
    if (!r.ingredientIds || r.ingredientIds.length === 0 || availableIds.size === 0) return { ...r, status: 'unknown', missingCount: 0 };
    const miss = r.ingredientIds.filter(id => !availableIds.has(id)).length;
    return { ...r, status: miss === 0 ? 'complete' : 'incomplete', missingCount: miss };
  });

  if (isRandom) {
    clearUserState(userId);
    return await handleRandomPick(recipesWithStatus, availableIngredients);
  }

  setUserState(userId, { mode: 'browse_recipes', recipes: recipesWithStatus, availableIngredients });

  // 純文字列表 + Quick Reply 按鈕
  let listText = category.label + ' 共 ' + recipesWithStatus.length + ' 道：\n\n';
  recipesWithStatus.slice(0, 13).forEach((r, i) => {
    const icon = r.status === 'complete' ? '✅' : r.missingCount > 0 ? '⚠️' : '❓';
    listText += (i+1) + '. ' + r.name + ' ' + icon + '\n';
  });
  listText += '\n請輸入數字選擇食譜';

  // Quick Reply 按鈕（最多 13 個）
  const qrItems = recipesWithStatus.slice(0, 13).map((r, i) => ({
    type: 'action',
    action: { type: 'message', label: (i+1) + '. ' + r.name.slice(0, 18), text: String(i+1) }
  }));

  return { type: 'text', text: listText, quickReply: { items: qrItems } };
}

async function handleRandomPick(recipesWithStatus, availableIngredients) {
  let expiringIds = new Set();
  try { const e = await notion.getExpiringIngredients(); expiringIds = new Set(e.map(i => i.id)); } catch {}
  const tier1 = recipesWithStatus.filter(r => r.status === 'complete');
  const tier2 = recipesWithStatus.filter(r => r.status !== 'complete' && (r.ingredientIds||[]).some(id => expiringIds.has(id)));
  const tier3 = recipesWithStatus.filter(r => r.status !== 'complete' && !(r.ingredientIds||[]).some(id => expiringIds.has(id)));
  const pool = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);
  if (!pool || pool.length === 0) return { type: 'text', text: '找不到合適的食譜 😅' };
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return await buildRecipeText(picked, availableIngredients, true);
}

async function handleRecipeSelection(userId, input) {
  const state = getUserState(userId);
  if (!state || state.mode !== 'browse_recipes') return null;
  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= state.recipes.length) return null;
  const selected = state.recipes[index];
  clearUserState(userId);
  return await buildRecipeText(selected, state.availableIngredients, false);
}

async function buildRecipeText(recipe, availableIngredients, isRandom) {
  let detail;
  try { detail = await notion.getRecipeDetail(recipe.id); }
  catch(e) { return { type: 'text', text: '取得食譜詳情失敗：' + e.message }; }

  const availableIds = new Set((availableIngredients||[]).filter(i => i.hasIt).map(i => i.id));
  const ings = detail.ingredients || [];
  const missing = ings.filter(ing => !availableIds.has(ing.id)).map(ing => ing.name);

  let text = isRandom ? '🎲 為你隨機推薦：\n\n' : '';
  text += '🍳 ' + detail.name + '\n';
  text += '分類：' + (detail.category||[]).join('／') + '\n';

  if (ings.length > 0) {
    text += '\n所需食材：\n';
    ings.forEach(ing => { text += (availableIds.has(ing.id) ? '✅' : '❌') + ' ' + ing.name + '\n'; });
  }

  if (missing.length > 0) {
    text += '\n⚠️ 缺少：' + missing.join('、') + '\n';
    try {
      const all = await notion.getAllRecipes();
      const sug = await claudeAI.suggestRecipesForMissingIngredient(missing[0], all);
      if (sug.length > 0) text += '💡 買了「' + missing[0] + '」還能做：' + sug.join('、') + '\n';
    } catch {}
  } else if (ings.length > 0) {
    text += '\n✨ 食材全部齊全！\n';
  }

  if (detail.prepNote) text += '\n📝 備菜：' + detail.prepNote + '\n';
  if (detail.steps) text += '\n👨‍🍳 步驟：\n' + detail.steps.substring(0, 300) + (detail.steps.length > 300 ? '...' : '') + '\n';
  if (detail.tutorialUrl) text += '\n🔗 原始貼文：' + detail.tutorialUrl;
  else if (detail.notionUrl) text += '\n📖 Notion：' + detail.notionUrl;

  return { type: 'text', text };
}

async function searchByIngredient(ingredientName) {
  const names = ingredientName.trim().split(/\s+/);
  let allRecipes = [];
  try {
    for (const name of names) {
      const found = await notion.getRecipesByIngredientName(name);
      allRecipes = allRecipes.concat(found);
    }
  } catch(e) { return { type: 'text', text: '搜尋失敗：' + e.message }; }

  const seen = new Set();
  allRecipes = allRecipes.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  if (allRecipes.length === 0) return { type: 'text', text: '食譜庫裡還沒有含「' + ingredientName + '」的料理 🤔' };

  let availableIds = new Set();
  try {
    const ings = await Promise.race([notion.getAllIngredients(), new Promise((_,r)=>setTimeout(()=>r(new Error('t')),4000))]);
    availableIds = new Set(ings.filter(i=>i.hasIt).map(i=>i.id));
  } catch {}

  let text = '🔍 含「' + ingredientName + '」的食譜（' + allRecipes.length + ' 道）：\n\n';
  const items = allRecipes.slice(0, 13).map((r, i) => {
    const miss = (r.ingredientIds||[]).filter(id => !availableIds.has(id)).length;
    const icon = miss === 0 ? '✅' : '⚠️缺' + miss + '樣';
    text += (i+1) + '. ' + r.name + ' ' + icon + '\n';
    return { type: 'action', action: { type: 'message', label: (i+1) + '. ' + r.name.slice(0,18), text: String(i+1) } };
  });
  text += '\n請輸入數字選擇食譜';

  // 存入狀態讓用戶可以選擇
  return { type: 'text', text, quickReply: { items } };
}

function getWhatToEatMenu() { return buildCategoryMenu(false); }
function getRandomRecommendMenu() { return buildCategoryMenu(true); }

module.exports = { getWhatToEatMenu, getRandomRecommendMenu, handleCategoryChoice, handleRecipeSelection, searchByIngredient, setUserState, getUserState, clearUserState, CATEGORY_MAP, buildCategoryMenu };
