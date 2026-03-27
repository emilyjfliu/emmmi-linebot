// modules/recipes.js - 模組 3+4+5
const notion = require('../utils/notion');
const claudeAI = require('../utils/claude');
const flex = require('../utils/flex');

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

async function handleCategoryChoice(userId, choice, isRandom = false) {
  const category = CATEGORY_MAP[choice];
  if (!category) return '請輸入 1 到 6 的數字！';

  let recipes = [];
  const results = await Promise.all(category.notionValues.map(val => notion.getRecipesByCategory(val)));
  for (const found of results) recipes = recipes.concat(found);

  const seen = new Set();
  recipes = recipes.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  if (recipes.length === 0) return `目前「${category.label}」分類還沒有食譜 😅\n可以從 IG 收藏料理貼文來自動新增！`;

  let availableIngredients = [], availableIds = new Set();
  try {
    availableIngredients = await Promise.race([
      notion.getAllIngredients(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 4000))
    ]);
    availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));
  } catch { console.log('食材查詢超時'); }

  const recipesWithStatus = recipes.map(recipe => {
    if (recipe.ingredientIds.length === 0 || availableIds.size === 0) return { ...recipe, status: 'unknown', missingCount: 0 };
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    return { ...recipe, status: missingCount === 0 ? 'complete' : 'incomplete', missingCount };
  });

  if (isRandom) { clearUserState(userId); return await handleRandomPick(recipesWithStatus, availableIngredients); }

  setUserState(userId, { mode: 'browse_recipes', recipes: recipesWithStatus, availableIngredients });
  return [
    { type: 'text', text: `📋 ${category.label}（共 ${recipesWithStatus.length} 道）\n點選卡片下方按鈕選擇食譜 👇` },
    flex.buildRecipeList(recipesWithStatus, category.label)
  ];
}

async function handleRandomPick(recipesWithStatus, availableIngredients) {
  let expiringIds = new Set();
  try { const e = await notion.getExpiringIngredients(); expiringIds = new Set(e.map(i => i.id)); } catch {}
  const tier1 = recipesWithStatus.filter(r => r.status === 'complete');
  const tier2 = recipesWithStatus.filter(r => r.status !== 'complete' && r.ingredientIds.some(id => expiringIds.has(id)));
  const tier3 = recipesWithStatus.filter(r => r.status !== 'complete' && !r.ingredientIds.some(id => expiringIds.has(id)));
  const pool = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);
  if (!pool || pool.length === 0) return '找不到合適的食譜 😅';
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return await buildRecipeResponse(picked, availableIngredients, true);
}

async function handleRecipeSelection(userId, input) {
  const state = getUserState(userId);
  if (!state || state.mode !== 'browse_recipes') return null;
  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= state.recipes.length) return null;
  const selected = state.recipes[index];
  clearUserState(userId);
  return await buildRecipeResponse(selected, state.availableIngredients, false);
}

async function buildRecipeResponse(recipe, availableIngredients, isRandom) {
  const detail = await notion.getRecipeDetail(recipe.id);
  const availableIds = new Set((availableIngredients || []).filter(i => i.hasIt).map(i => i.id));
  const ings = detail.ingredients || [];
  const missingList = ings.filter(ing => !availableIds.has(ing.id)).map(ing => ing.name);

  let suggestions = [];
  if (missingList.length > 0) {
    try {
      const allRecipes = await notion.getAllRecipes();
      suggestions = await claudeAI.suggestRecipesForMissingIngredient(missingList[0], allRecipes);
    } catch {}
  }

  const recipeForCard = { name: detail.name, category: detail.category, prepNote: detail.prepNote, steps: detail.steps, tutorialUrl: detail.tutorialUrl, notionUrl: detail.notionUrl };
  const prefix = isRandom ? [{ type: 'text', text: '🎲 為你隨機推薦：' }] : [];
  return [...prefix, flex.buildRecipeCard(recipeForCard, ings, missingList, suggestions)];
}

async function searchByIngredient(ingredientName) {
  const names = ingredientName.trim().split(/\s+/);
  const availableIngredients = await notion.getAllIngredients();
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  let allRecipes = [];
  for (const name of names) { const found = await notion.getRecipesByIngredientName(name); allRecipes = allRecipes.concat(found); }

  const seen = new Set();
  allRecipes = allRecipes.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  if (allRecipes.length === 0) return `食譜庫裡還沒有含「${ingredientName}」的料理 🤔\n\n可以從 IG 收藏相關料理貼文！`;

  const recipesWithStatus = allRecipes.map(recipe => {
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    return { ...recipe, status: missingCount === 0 ? 'complete' : 'incomplete', missingCount };
  });

  return [
    { type: 'text', text: `🔍 含「${ingredientName}」的食譜（${recipesWithStatus.length} 道）\n點選卡片選擇食譜 👇` },
    flex.buildRecipeList(recipesWithStatus, `含「${ingredientName}」的食譜`)
  ];
}

function getWhatToEatMenu() { return require('../utils/flex').buildCategoryQuickReply(false); }
function getRandomRecommendMenu() { return require('../utils/flex').buildCategoryQuickReply(true); }

module.exports = { getWhatToEatMenu, getRandomRecommendMenu, handleCategoryChoice, handleRecipeSelection, searchByIngredient, setUserState, getUserState, clearUserState, CATEGORY_MAP };
