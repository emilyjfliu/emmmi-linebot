// modules/recipes.js
// 模組 3 + 4 + 5：查詢食譜、用食材搜尋、缺料提醒

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

function getWhatToEatMenu() {
  return `今天想吃什麼呢？請選擇類型：

1️⃣ 主食（丼飯、咖哩、義大利麵...）
2️⃣ 配菜－蔬菜類
3️⃣ 配菜－肉類
4️⃣ 配菜－其他
5️⃣ 湯品
6️⃣ 甜點

請輸入數字 1～6`;
}

function getRandomRecommendMenu() {
  return `好！請先選擇想要哪類料理：

1️⃣ 主食
2️⃣ 配菜－蔬菜類
3️⃣ 配菜－肉類
4️⃣ 配菜－其他
5️⃣ 湯品
6️⃣ 甜點

請輸入數字 1～6（我直接幫你挑一道！）`;
}

function setUserState(userId, state) {
  userState[userId] = { ...state, updatedAt: Date.now() };
}

function getUserState(userId) {
  const state = userState[userId];
  if (state && Date.now() - state.updatedAt > 10 * 60 * 1000) {
    delete userState[userId];
    return null;
  }
  return state;
}

function clearUserState(userId) {
  delete userState[userId];
}

async function handleCategoryChoice(userId, choice, isRandom = false) {
  const category = CATEGORY_MAP[choice];
  if (!category) {
    return '請輸入 1 到 6 的數字來選擇類型喔！';
  }

  let recipes = [];
  const results = await Promise.all(
    category.notionValues.map(val => notion.getRecipesByCategory(val))
  );
  for (const found of results) {
    recipes = recipes.concat(found);
  }

  const seen = new Set();
  recipes = recipes.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  if (recipes.length === 0) {
    return `目前「${category.label}」分類還沒有食譜，\n可以從 IG 收藏料理貼文來自動新增喔！`;
  }

  let availableIngredients = [];
  let availableIds = new Set();
  try {
    availableIngredients = await Promise.race([
      notion.getAllIngredients(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));
  } catch {
    console.log('⚠️ 食材查詢超時，跳過齊全度比對');
  }

  const recipesWithStatus = recipes.map(recipe => {
    if (recipe.ingredientIds.length === 0 || availableIds.size === 0) {
      return { ...recipe, status: 'unknown', missingCount: 0 };
    }
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    const status = missingCount === 0 ? 'complete' : 'incomplete';
    return { ...recipe, status, missingCount };
  });

  if (isRandom) {
    clearUserState(userId);
    return await handleRandomPick(recipesWithStatus, availableIngredients);
  }

  setUserState(userId, {
    mode: 'browse_recipes',
    recipes: recipesWithStatus,
    availableIngredients
  });

  return formatRecipeList(recipesWithStatus, category.label);
}

async function handleRandomPick(recipesWithStatus, availableIngredients) {
  const expiringIngredients = await notion.getExpiringIngredients();
  const expiringIds = new Set(expiringIngredients.map(i => i.id));

  const tier1 = recipesWithStatus.filter(r => r.status === 'complete');
  const tier2 = recipesWithStatus.filter(r =>
    r.status !== 'complete' && r.ingredientIds.some(id => expiringIds.has(id))
  );
  const tier3 = recipesWithStatus.filter(r =>
    r.status !== 'complete' && !r.ingredientIds.some(id => expiringIds.has(id))
  );

  const pool = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return await formatRecipeCard(picked, availableIngredients, true);
}

async function handleRecipeSelection(userId, input) {
  const state = getUserState(userId);
  if (!state || state.mode !== 'browse_recipes') return null;

  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= state.recipes.length) {
    return null;
  }

  const selected = state.recipes[index];
  clearUserState(userId);
  return await formatRecipeCard(selected, state.availableIngredients, false);
}

async function searchByIngredient(ingredientName) {
  const names = ingredientName.trim().split(/\s+/);
  const availableIngredients = await notion.getAllIngredients();
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  let allRecipes = [];
  for (const name of names) {
    const found = await notion.getRecipesByIngredientName(name);
    allRecipes = allRecipes.concat(found);
  }

  const seen = new Set();
  allRecipes = allRecipes.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  if (allRecipes.length === 0) {
    return `食譜庫裡還沒有含「${ingredientName}」的料理 🤔\n\n可以從 IG 收藏相關料理貼文來新增！`;
  }

  const recipesWithStatus = allRecipes.map(recipe => {
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    const status = missingCount === 0 ? 'complete' : 'incomplete';
    return { ...recipe, status, missingCount };
  });

  return formatRecipeList(recipesWithStatus, `含「${ingredientName}」的食譜`);
}

function formatRecipeList(recipes, title) {
  let text = `📋 ${title}（共 ${recipes.length} 道）\n\n`;
  recipes.forEach((recipe, index) => {
    const statusIcon = recipe.status === 'complete' ? '✅' :
      recipe.missingCount > 0 ? `⚠️缺${recipe.missingCount}樣` : '❓';
    text += `${index + 1}. ${recipe.name} ${statusIcon}\n`;
  });
  text += '\n輸入數字選擇食譜看詳細內容';
  return text;
}

async function formatRecipeCard(recipe, availableIngredients, isRandom) {
  const detail = await notion.getRecipeDetail(recipe.id);
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  let text = '';
  if (isRandom) text += '🎲 為你隨機推薦：\n\n';
  text += `🍳 ${detail.name}\n`;
  text += `分類：${detail.category.join('／')}\n`;

  if (detail.ingredients && detail.ingredients.length > 0) {
    text += '\n所需食材：\n';
    const missingIngredients = [];
    for (const ing of detail.ingredients) {
      const hasIt = availableIds.has(ing.id);
      text += `  ${hasIt ? '✅' : '❌'} ${ing.name}\n`;
      if (!hasIt) missingIngredients.push(ing.name);
    }
    if (missingIngredients.length > 0) {
      text += `\n⚠️ 缺少：${missingIngredients.join('、')}\n`;
      for (const missing of missingIngredients.slice(0, 2)) {
        const allRecipes = await notion.getAllRecipes();
        const suggestions = await claudeAI.suggestRecipesForMissingIngredient(missing, allRecipes);
        if (suggestions.length > 0) {
          text += `💡 買了「${missing}」還能做：${suggestions.join('、')}\n`;
        }
      }
    } else {
      text += '\n✨ 食材全部齊全，可以直接做！\n';
    }
  }

  if (detail.prepNote) text += `\n📝 備菜提醒：${detail.prepNote}\n`;
  if (detail.steps) text += `\n👨‍🍳 料理步驟：\n${detail.steps}\n`;
  if (detail.tutorialUrl) {
    text += `\n🔗 原始貼文：${detail.tutorialUrl}`;
  } else if (detail.notionUrl) {
    text += `\n📖 Notion 食譜：${detail.notionUrl}`;
  }
  return text;
}

module.exports = {
  getWhatToEatMenu,
  getRandomRecommendMenu,
  handleCategoryChoice,
  handleRecipeSelection,
  searchByIngredient,
  setUserState,
  getUserState,
  clearUserState,
  CATEGORY_MAP
};
