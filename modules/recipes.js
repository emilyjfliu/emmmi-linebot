// modules/recipes.js
// 模組 3 + 4 + 5：查詢食譜、用食材搜尋、缺料提醒

const notion = require('../utils/notion');
const claudeAI = require('../utils/claude');

// 類別選單對應的 Notion 分類值
const CATEGORY_MAP = {
  '1': { label: '主食', notionValues: ['主食', '午晚餐'] },
  '2': { label: '配菜－蔬菜類', notionValues: ['菜'] },
  '3': { label: '配菜－肉類', notionValues: ['肉'] },
  '4': { label: '配菜－其他', notionValues: ['午晚餐'] },
  '5': { label: '湯品', notionValues: ['湯'] },
  '6': { label: '甜點', notionValues: ['早餐'] }
};

// 用戶狀態暫存（記錄對話狀態）
const userState = {};

/**
 * 處理「我要吃什麼」
 * 回傳類別選單
 */
function getWhatToEatMenu() {
  return `今天想吃什麼呢？請選擇類型：

1️⃣ 主食（丼飯、咖哩、義大利麵…）
2️⃣ 配菜－蔬菜類
3️⃣ 配菜－肉類
4️⃣ 配菜－其他
5️⃣ 湯品
6️⃣ 甜點

請輸入數字 1～6`;
}

/**
 * 處理「隨機推薦」
 * 回傳類別選單（選完後直接隨機）
 */
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

/**
 * 設定用戶狀態
 */
function setUserState(userId, state) {
  userState[userId] = { ...state, updatedAt: Date.now() };
}

/**
 * 取得用戶狀態
 */
function getUserState(userId) {
  const state = userState[userId];
  // 狀態超過 10 分鐘自動清除
  if (state && Date.now() - state.updatedAt > 10 * 60 * 1000) {
    delete userState[userId];
    return null;
  }
  return state;
}

/**
 * 清除用戶狀態
 */
function clearUserState(userId) {
  delete userState[userId];
}

/**
 * 處理類別選擇（1-6）
 * @param {string} userId
 * @param {string} choice - 使用者選的數字
 * @param {boolean} isRandom - 是否為隨機推薦模式
 */
async function handleCategoryChoice(userId, choice, isRandom = false) {
  const category = CATEGORY_MAP[choice];
  if (!category) {
    return '請輸入 1 到 6 的數字來選擇類型喔！';
  }

  // 取得現有食材（用來比對齊全度）
  const availableIngredients = await notion.getAllIngredients();
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  // 取得該類別食譜
  let recipes = [];
  for (const notionVal of category.notionValues) {
    const found = await notion.getRecipesByCategory(notionVal);
    recipes = recipes.concat(found);
  }

  // 去重
  const seen = new Set();
  recipes = recipes.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  if (recipes.length === 0) {
    return `目前「${category.label}」分類還沒有食譜，\n可以從 IG 收藏料理貼文來自動新增喔！`;
  }

  // 計算每道食譜的食材齊全度
  const recipesWithStatus = recipes.map(recipe => {
    const totalIngredients = recipe.ingredientIds.length;
    if (totalIngredients === 0) {
      return { ...recipe, status: 'unknown', missingCount: 0 };
    }
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    const status = missingCount === 0 ? 'complete' : 'incomplete';
    return { ...recipe, status, missingCount };
  });

  // 隨機推薦模式：優先選食材齊全的
  if (isRandom) {
    clearUserState(userId);
    return await handleRandomPick(recipesWithStatus, availableIngredients);
  }

  // 瀏覽模式：列出食譜讓使用者選
  setUserState(userId, {
    mode: 'browse_recipes',
    recipes: recipesWithStatus,
    availableIngredients
  });

  return formatRecipeList(recipesWithStatus, category.label);
}

/**
 * 隨機挑選一道食譜（優先考慮食材齊全 or 有快過期食材）
 */
async function handleRandomPick(recipesWithStatus, availableIngredients) {
  // 找出快過期的食材 ID
  const expiringIngredients = await notion.getExpiringIngredients();
  const expiringIds = new Set(expiringIngredients.map(i => i.id));

  // 排序：① 齊全 → ② 用到快過期食材 → ③ 其他
  const tier1 = recipesWithStatus.filter(r => r.status === 'complete');
  const tier2 = recipesWithStatus.filter(r =>
    r.status !== 'complete' &&
    r.ingredientIds.some(id => expiringIds.has(id))
  );
  const tier3 = recipesWithStatus.filter(r =>
    r.status !== 'complete' &&
    !r.ingredientIds.some(id => expiringIds.has(id))
  );

  const pool = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);
  const picked = pool[Math.floor(Math.random() * pool.length)];

  return await formatRecipeCard(picked, availableIngredients, true);
}

/**
 * 處理使用者從列表選擇食譜
 */
async function handleRecipeSelection(userId, input) {
  const state = getUserState(userId);
  if (!state || state.mode !== 'browse_recipes') return null;

  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= state.recipes.length) {
    return null; // 不是有效選擇，交給外層處理
  }

  const selected = state.recipes[index];
  clearUserState(userId);

  return await formatRecipeCard(selected, state.availableIngredients, false);
}

/**
 * 用食材搜尋食譜（模組 4）
 */
async function searchByIngredient(ingredientName) {
  // 支援多食材（空格分隔）
  const names = ingredientName.trim().split(/\s+/);

  const availableIngredients = await notion.getAllIngredients();
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  // 搜尋每個食材名對應的食譜
  let allRecipes = [];
  for (const name of names) {
    const found = await notion.getRecipesByIngredientName(name);
    allRecipes = allRecipes.concat(found);
  }

  // 去重
  const seen = new Set();
  allRecipes = allRecipes.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  if (allRecipes.length === 0) {
    return `食譜庫裡還沒有含「${ingredientName}」的料理 🤔\n\n可以從 IG 收藏相關料理貼文來新增！`;
  }

  // 計算齊全度
  const recipesWithStatus = allRecipes.map(recipe => {
    const missingCount = recipe.ingredientIds.filter(id => !availableIds.has(id)).length;
    const status = missingCount === 0 ? 'complete' : 'incomplete';
    return { ...recipe, status, missingCount };
  });

  return formatRecipeList(recipesWithStatus, `含「${ingredientName}」的食譜`);
}

/**
 * 格式化食譜列表
 */
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

/**
 * 格式化單一食譜卡片（包含缺料提醒）
 */
async function formatRecipeCard(recipe, availableIngredients, isRandom) {
  // 取得食譜詳細（包含食材名稱）
  const detail = await notion.getRecipeDetail(recipe.id);
  const availableIds = new Set(availableIngredients.filter(i => i.hasIt).map(i => i.id));

  let text = '';
  if (isRandom) text += '🎲 為你隨機推薦：\n\n';

  text += `🍳 ${detail.name}\n`;
  text += `分類：${detail.category.join('／')}\n`;

  // 食材清單 + 齊全標示
  if (detail.ingredients && detail.ingredients.length > 0) {
    text += '\n所需食材：\n';
    const missingIngredients = [];

    for (const ing of detail.ingredients) {
      const hasIt = availableIds.has(ing.id);
      text += `  ${hasIt ? '✅' : '❌'} ${ing.name}\n`;
      if (!hasIt) missingIngredients.push(ing.name);
    }

    // 缺料提醒（模組 5）
    if (missingIngredients.length > 0) {
      text += `\n⚠️ 缺少：${missingIngredients.join('、')}\n`;

      // 買了缺的食材還能做什麼
      for (const missing of missingIngredients.slice(0, 2)) { // 最多顯示2個
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

  // 提前備菜
  if (detail.prepNote) {
    text += `\n📝 備菜提醒：${detail.prepNote}\n`;
  }

  // 料理步驟
  if (detail.steps) {
    text += `\n👨‍🍳 料理步驟：\n${detail.steps}\n`;
  }

  // 教程連結
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
