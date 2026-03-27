// modules/recipes.js
const notion = require('../utils/notion');
const claudeAI = require('../utils/claude');

const ORANGE = '#E8A84D';
const ORANGE_DARK = '#C88830';
const WHITE = '#FFFFFF';
const DARK = '#2D2D2D';
const GRAY = '#888888';

const CATEGORY_MAP = {
  '1': { label: '主食', notionValues: ['主食', '午晚餐'] },
  '2': { label: '配菜－蔬菜類', notionValues: ['菜'] },
  '3': { label: '配菜－肉類', notionValues: ['肉'] },
  '4': { label: '配菜－其他', notionValues: ['午晚餐'] },
  '5': { label: '湯品', notionValues: ['湯'] },
  '6': { label: '甜點', notionValues: ['早餐'] }
};

const userState = {};
function setUserState(u, s) { userState[u] = { ...s, updatedAt: Date.now() }; }
function getUserState(u) {
  const s = userState[u];
  if (s && Date.now() - s.updatedAt > 10 * 60 * 1000) { delete userState[u]; return null; }
  return s;
}
function clearUserState(u) { delete userState[u]; }

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

// 建立 DarChef 風格食譜卡片
function buildRecipeFlexCard(name, ingredientsList, stepsText, tutorialUrl, notionUrl) {
  // 食材列表項目
  const ingContents = ingredientsList.slice(0, 10).map(function(ing) {
    return {
      type: 'text',
      text: ing,
      size: 'sm',
      color: DARK,
      wrap: true
    };
  });

  // 步驟文字（截斷）
  const stepsDisplay = stepsText ? stepsText.substring(0, 400) + (stepsText.length > 400 ? '...' : '') : '';

  // footer 按鈕
  var footerAction;
  if (tutorialUrl) {
    footerAction = { type: 'uri', label: '查看完整食譜', uri: tutorialUrl };
  } else if (notionUrl) {
    footerAction = { type: 'uri', label: '查看完整食譜', uri: notionUrl };
  } else {
    footerAction = { type: 'message', label: '查看完整食譜', text: '查看 ' + name };
  }

  var bodyContents = [
    // 所需食材標題
    {
      type: 'text',
      text: '所需食材',
      weight: 'bold',
      size: 'sm',
      color: ORANGE_DARK,
      margin: 'none'
    }
  ];

  // 加入食材
  ingContents.forEach(function(c) { bodyContents.push(c); });

  // 分隔線
  bodyContents.push({
    type: 'separator',
    margin: 'md',
    color: ORANGE
  });

  // 製作方法標題
  bodyContents.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      {
        type: 'text',
        text: '🍳 製作方法',
        weight: 'bold',
        size: 'sm',
        color: ORANGE_DARK,
        flex: 1
      }
    ]
  });

  // 步驟內容
  if (stepsDisplay) {
    bodyContents.push({
      type: 'text',
      text: stepsDisplay,
      size: 'xs',
      color: DARK,
      wrap: true,
      margin: 'sm'
    });
  } else {
    bodyContents.push({
      type: 'text',
      text: '（請點擊下方按鈕查看完整步驟）',
      size: 'xs',
      color: GRAY,
      wrap: true,
      margin: 'sm'
    });
  }

  return {
    type: 'flex',
    altText: name,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ORANGE,
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: name,
            weight: 'bold',
            size: 'lg',
            color: WHITE,
            wrap: true
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: WHITE,
        paddingAll: 'lg',
        spacing: 'sm',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ORANGE,
        paddingAll: 'md',
        contents: [
          {
            type: 'button',
            action: footerAction,
            color: WHITE,
            style: 'link',
            height: 'sm'
          }
        ]
      }
    }
  };
}

// 建立食譜列表（多個小卡片 carousel）
function buildRecipeListCarousel(recipesWithStatus) {
  var bubbles = recipesWithStatus.slice(0, 10).map(function(r, i) {
    var icon = r.status === 'complete' ? '✅' : (r.missingCount > 0 ? '⚠️' : '❓');
    var label = (i + 1) + '. ' + r.name;
    if (label.length > 40) label = label.substring(0, 37) + '...';

    return {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: ORANGE,
        paddingAll: 'sm',
        contents: [
          {
            type: 'text',
            text: icon,
            size: 'xxs',
            color: WHITE,
            align: 'end'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        contents: [
          {
            type: 'text',
            text: (i + 1) + '. ' + r.name,
            weight: 'bold',
            size: 'sm',
            color: DARK,
            wrap: true
          },
          {
            type: 'text',
            text: (r.category || []).join('／') || '料理',
            size: 'xxs',
            color: GRAY,
            margin: 'xs'
          },
          {
            type: 'text',
            text: r.status === 'complete' ? '食材齊全 ✅' : ('缺 ' + r.missingCount + ' 樣'),
            size: 'xxs',
            color: r.status === 'complete' ? '#27AE60' : '#E74C3C',
            margin: 'xs'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'sm',
        backgroundColor: ORANGE,
        contents: [
          {
            type: 'button',
            action: { type: 'message', label: '選這道', text: String(i + 1) },
            color: WHITE,
            style: 'link',
            height: 'sm'
          }
        ]
      }
    };
  });

  return {
    type: 'flex',
    altText: '食譜列表',
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

async function handleCategoryChoice(userId, choice, isRandom) {
  const category = CATEGORY_MAP[choice];
  if (!category) return { type: 'text', text: '請輸入 1 到 6！' };

  let recipes = [];
  try {
    const results = await Promise.all(category.notionValues.map(function(v) { return notion.getRecipesByCategory(v); }));
    results.forEach(function(r) { recipes = recipes.concat(r); });
  } catch(e) {
    console.error('查食譜失敗:', e.message);
    return { type: 'text', text: '查詢食譜時發生問題：' + e.message };
  }

  const seen = new Set();
  recipes = recipes.filter(function(r) { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  if (recipes.length === 0) {
    return { type: 'text', text: '目前「' + category.label + '」分類還沒有食譜 😅' };
  }

  let availableIds = new Set();
  let availableIngredients = [];
  try {
    availableIngredients = await Promise.race([
      notion.getAllIngredients(),
      new Promise(function(_, r) { setTimeout(function() { r(new Error('timeout')); }, 4000); })
    ]);
    availableIds = new Set(availableIngredients.filter(function(i) { return i.hasIt; }).map(function(i) { return i.id; }));
  } catch(e) { console.log('食材查詢:', e.message); }

  const recipesWithStatus = recipes.map(function(r) {
    if (!r.ingredientIds || r.ingredientIds.length === 0 || availableIds.size === 0) {
      return Object.assign({}, r, { status: 'unknown', missingCount: 0 });
    }
    const miss = r.ingredientIds.filter(function(id) { return !availableIds.has(id); }).length;
    return Object.assign({}, r, { status: miss === 0 ? 'complete' : 'incomplete', missingCount: miss });
  });

  if (isRandom) {
    clearUserState(userId);
    return await handleRandomPick(recipesWithStatus, availableIngredients);
  }

  setUserState(userId, { mode: 'browse_recipes', recipes: recipesWithStatus, availableIngredients: availableIngredients });

  return [
    { type: 'text', text: category.label + '（共 ' + recipesWithStatus.length + ' 道）\n👇 滑動選擇食譜' },
    buildRecipeListCarousel(recipesWithStatus)
  ];
}

async function handleRandomPick(recipesWithStatus, availableIngredients) {
  let expiringIds = new Set();
  try {
    const e = await notion.getExpiringIngredients();
    expiringIds = new Set(e.map(function(i) { return i.id; }));
  } catch(e) {}

  const tier1 = recipesWithStatus.filter(function(r) { return r.status === 'complete'; });
  const tier2 = recipesWithStatus.filter(function(r) {
    return r.status !== 'complete' && (r.ingredientIds || []).some(function(id) { return expiringIds.has(id); });
  });
  const tier3 = recipesWithStatus.filter(function(r) {
    return r.status !== 'complete' && !(r.ingredientIds || []).some(function(id) { return expiringIds.has(id); });
  });

  const pool = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);
  if (!pool || pool.length === 0) return { type: 'text', text: '找不到合適的食譜 😅' };
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
  let detail;
  try {
    detail = await notion.getRecipeDetail(recipe.id);
  } catch(e) {
    return { type: 'text', text: '取得食譜詳情失敗：' + e.message };
  }

  const availableIds = new Set((availableIngredients || []).filter(function(i) { return i.hasIt; }).map(function(i) { return i.id; }));
  const ings = detail.ingredients || [];

  // 食材顯示（加上 ✅/❌ 標示）
  const ingDisplay = ings.map(function(ing) {
    return (availableIds.has(ing.id) ? '✅ ' : '❌ ') + ing.name;
  });

  const missing = ings.filter(function(ing) { return !availableIds.has(ing.id); }).map(function(ing) { return ing.name; });

  const prefix = isRandom ? [{ type: 'text', text: '🎲 為你隨機推薦：' }] : [];

  const card = buildRecipeFlexCard(
    detail.name,
    ingDisplay.length > 0 ? ingDisplay : ['（尚未設定食材）'],
    detail.steps || '',
    detail.tutorialUrl || '',
    detail.notionUrl || ''
  );

  const result = prefix.concat([card]);

  // 缺料提示（文字訊息）
  if (missing.length > 0) {
    let missText = '⚠️ 缺少：' + missing.join('、');
    try {
      const allR = await notion.getAllRecipes();
      const sug = await claudeAI.suggestRecipesForMissingIngredient(missing[0], allR);
      if (sug.length > 0) missText += '\n\n💡 買了「' + missing[0] + '」還能做：' + sug.join('、');
    } catch(e) {}
    result.push({ type: 'text', text: missText });
  }

  return result;
}

async function searchByIngredient(ingredientName) {
  const names = ingredientName.trim().split(/\s+/);
  let allRecipes = [];
  try {
    for (let i = 0; i < names.length; i++) {
      const found = await notion.getRecipesByIngredientName(names[i]);
      allRecipes = allRecipes.concat(found);
    }
  } catch(e) { return { type: 'text', text: '搜尋失敗：' + e.message }; }

  const seen = new Set();
  allRecipes = allRecipes.filter(function(r) { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  if (allRecipes.length === 0) {
    return { type: 'text', text: '食譜庫裡還沒有含「' + ingredientName + '」的料理 🤔\n\n可以從 IG 收藏相關料理貼文！' };
  }

  let availableIds = new Set();
  try {
    const ings = await Promise.race([
      notion.getAllIngredients(),
      new Promise(function(_, r) { setTimeout(function() { r(new Error('t')); }, 4000); })
    ]);
    availableIds = new Set(ings.filter(function(i) { return i.hasIt; }).map(function(i) { return i.id; }));
  } catch(e) {}

  const recipesWithStatus = allRecipes.map(function(r) {
    const miss = (r.ingredientIds || []).filter(function(id) { return !availableIds.has(id); }).length;
    return Object.assign({}, r, { status: miss === 0 ? 'complete' : 'incomplete', missingCount: miss });
  });

  // 存入狀態
  setUserState('_search_' + ingredientName, { mode: 'browse_recipes', recipes: recipesWithStatus, availableIngredients: [] });

  return [
    { type: 'text', text: '🔍 含「' + ingredientName + '」的食譜（' + recipesWithStatus.length + ' 道）\n👇 滑動選擇食譜' },
    buildRecipeListCarousel(recipesWithStatus)
  ];
}

function getWhatToEatMenu() { return buildCategoryMenu(false); }
function getRandomRecommendMenu() { return buildCategoryMenu(true); }

module.exports = {
  getWhatToEatMenu,
  getRandomRecommendMenu,
  handleCategoryChoice,
  handleRecipeSelection,
  searchByIngredient,
  setUserState,
  getUserState,
  clearUserState,
  buildCategoryMenu,
  CATEGORY_MAP
};
