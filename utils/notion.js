// utils/notion.js
// Notion API 所有讀寫操作的工具函式

const axios = require('axios');

const NOTION_API = 'https://api.notion.com/v1';
const HEADERS = {
  'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

// =====================
// 食材庫相關
// =====================

/**
 * 取得所有食材（已有 = true 的）
 */
async function getAllIngredients() {
  const response = await axios.post(
    `${NOTION_API}/databases/${process.env.NOTION_INGREDIENT_DB}/query`,
    {
      filter: {
        property: '已有',
        checkbox: { equals: true }
      },
      page_size: 100
    },
    { headers: HEADERS }
  );
  return response.data.results.map(parseIngredientPage);
}

/**
 * 用名稱搜尋食材（不管有沒有）
 */
async function findIngredientByName(name) {
  const response = await axios.post(
    `${NOTION_API}/databases/${process.env.NOTION_INGREDIENT_DB}/query`,
    {
      filter: {
        property: 'Name',
        title: { equals: name }
      }
    },
    { headers: HEADERS }
  );
  if (response.data.results.length > 0) {
    return response.data.results[0];
  }
  return null;
}

/**
 * 新增食材到食材庫
 */
async function createIngredient(data) {
  const { name, quantity, unit, storage, expiryDate, addedDate } = data;

  const properties = {
    'Name': { title: [{ text: { content: name } }] },
    '已有': { checkbox: true },
    '數量': { number: quantity || null },
    '單位': { rich_text: [{ text: { content: unit || '' } }] },
    '加入日期': addedDate
      ? { date: { start: addedDate } }
      : { date: { start: new Date().toISOString().split('T')[0] } }
  };

  // 有保存方式才加
  if (storage) {
    properties['保存方式'] = { select: { name: storage } };
  }

  // 有指定過期日才加
  if (expiryDate) {
    properties['預計過期日'] = { date: { start: expiryDate } };
  }

  const response = await axios.post(
    `${NOTION_API}/pages`,
    {
      parent: { database_id: process.env.NOTION_INGREDIENT_DB },
      properties
    },
    { headers: HEADERS }
  );
  return response.data;
}

/**
 * 更新食材（數量、狀態等）
 */
async function updateIngredient(pageId, updates) {
  const properties = {};

  if (updates.quantity !== undefined) {
    properties['數量'] = { number: updates.quantity };
  }
  if (updates.hasIt !== undefined) {
    properties['已有'] = { checkbox: updates.hasIt };
  }
  if (updates.unit !== undefined) {
    properties['單位'] = { rich_text: [{ text: { content: updates.unit } }] };
  }
  if (updates.storage !== undefined) {
    properties['保存方式'] = { select: { name: updates.storage } };
  }
  if (updates.expiryDate !== undefined) {
    properties['預計過期日'] = { date: { start: updates.expiryDate } };
  }
  if (updates.addedDate !== undefined) {
    properties['加入日期'] = { date: { start: updates.addedDate } };
  }

  const response = await axios.patch(
    `${NOTION_API}/pages/${pageId}`,
    { properties },
    { headers: HEADERS }
  );
  return response.data;
}

/**
 * 取得快過期的食材（用於每日提醒）
 */
async function getExpiringIngredients() {
  const today = new Date();
  const twoDaysLater = new Date(today);
  twoDaysLater.setDate(today.getDate() + 2);

  const response = await axios.post(
    `${NOTION_API}/databases/${process.env.NOTION_INGREDIENT_DB}/query`,
    {
      filter: {
        and: [
          { property: '已有', checkbox: { equals: true } },
          {
            or: [
              // 有指定過期日且在2天內
              {
                and: [
                  { property: '預計過期日', date: { is_not_empty: true } },
                  { property: '預計過期日', date: { on_or_before: twoDaysLater.toISOString().split('T')[0] } }
                ]
              },
              // 根據加入日期 + 保存方式推算（這裡用加入日期篩選）
              {
                and: [
                  { property: '加入日期', date: { is_not_empty: true } },
                  { property: '保存方式', select: { equals: '冷藏' } }
                ]
              }
            ]
          }
        ]
      },
      page_size: 50
    },
    { headers: HEADERS }
  );

  // 進一步在程式端過濾（保存方式 + 加入天數）
  const allIngredients = response.data.results.map(parseIngredientPage);
  return filterExpiringByStorageRules(allIngredients, today);
}

// =====================
// 食譜庫相關
// =====================

/**
 * 取得所有食譜
 */
async function getAllRecipes() {
  let allRecipes = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const response = await axios.post(
      `${NOTION_API}/databases/${process.env.NOTION_RECIPE_DB}/query`,
      body,
      { headers: HEADERS }
    );

    allRecipes = allRecipes.concat(response.data.results.map(parseRecipePage));
    hasMore = response.data.has_more;
    cursor = response.data.next_cursor;
  }

  return allRecipes;
}

/**
 * 依分類取得食譜
 */
async function getRecipesByCategory(category) {
  const response = await axios.post(
    `${NOTION_API}/databases/${process.env.NOTION_RECIPE_DB}/query`,
    {
      filter: {
        property: '分類',
        multi_select: { contains: category }
      },
      page_size: 50
    },
    { headers: HEADERS }
  );
  return response.data.results.map(parseRecipePage);
}

/**
 * 依食材名稱搜尋食譜（先查食材庫找到 page ID，再查食譜）
 */
async function getRecipesByIngredientName(ingredientName) {
  // 先找到食材的 page ID
  const ingredientPage = await findIngredientByName(ingredientName);
  if (!ingredientPage) return [];

  // 用 relation 反查含此食材的食譜
  const response = await axios.post(
    `${NOTION_API}/databases/${process.env.NOTION_RECIPE_DB}/query`,
    {
      filter: {
        property: '所需食材',
        relation: { contains: ingredientPage.id }
      },
      page_size: 50
    },
    { headers: HEADERS }
  );
  return response.data.results.map(parseRecipePage);
}

/**
 * 取得單一食譜的完整詳細資料（包含所需食材名稱）
 */
async function getRecipeDetail(recipePageId) {
  const response = await axios.get(
    `${NOTION_API}/pages/${recipePageId}`,
    { headers: HEADERS }
  );
  const recipe = parseRecipePage(response.data);

  // 取得所需食材的名稱
  if (recipe.ingredientIds && recipe.ingredientIds.length > 0) {
    recipe.ingredients = await getIngredientNames(recipe.ingredientIds);
  }

  return recipe;
}

/**
 * 更新食譜的「哪天吃」欄位
 */
async function updateRecipeDays(recipePageId, days) {
  const multiSelect = days.map(day => ({ name: day }));
  await axios.patch(
    `${NOTION_API}/pages/${recipePageId}`,
    {
      properties: {
        '哪天吃': { multi_select: multiSelect }
      }
    },
    { headers: HEADERS }
  );
}

// =====================
// 輔助函式
// =====================

/**
 * 解析食材頁面資料
 */
function parseIngredientPage(page) {
  const props = page.properties;
  return {
    id: page.id,
    name: props['Name']?.title?.[0]?.plain_text || '',
    hasIt: props['已有']?.checkbox || false,
    quantity: props['數量']?.number || null,
    unit: props['單位']?.rich_text?.[0]?.plain_text || '',
    tag: props['Tag']?.multi_select?.map(t => t.name) || [],
    storage: props['保存方式']?.select?.name || null,
    addedDate: props['加入日期']?.date?.start || null,
    expiryDate: props['預計過期日']?.date?.start || null,
  };
}

/**
 * 解析食譜頁面資料
 */
function parseRecipePage(page) {
  const props = page.properties;
  return {
    id: page.id,
    name: props['食譜名稱']?.title?.[0]?.plain_text || '',
    category: props['分類']?.multi_select?.map(c => c.name) || [],
    mealType: props['哪餐吃']?.multi_select?.map(m => m.name) || [],
    days: props['哪天吃']?.multi_select?.map(d => d.name) || [],
    inRecentList: props['加入近期食譜']?.checkbox || false,
    prepNote: props['提前備菜']?.rich_text?.[0]?.plain_text || '',
    tutorialUrl: props['教程連結']?.url || '',
    steps: props['料理步驟']?.rich_text?.[0]?.plain_text || '',
    source: props['貼文來源']?.select?.name || '',
    ingredientIds: props['所需食材']?.relation?.map(r => r.id) || [],
    notionUrl: page.url || ''
  };
}

/**
 * 批次取得食材名稱（by page IDs）
 */
async function getIngredientNames(ingredientIds) {
  const names = await Promise.all(
    ingredientIds.map(async (id) => {
      try {
        const res = await axios.get(`${NOTION_API}/pages/${id}`, { headers: HEADERS });
        const parsed = parseIngredientPage(res.data);
        return parsed;
      } catch {
        return { id, name: '未知食材', hasIt: false };
      }
    })
  );
  return names;
}

/**
 * 依保存規則過濾出快過期的食材
 */
function filterExpiringByStorageRules(ingredients, today) {
  const expiring = [];

  for (const item of ingredients) {
    if (!item.hasIt) continue;

    let shouldAlert = false;
    let daysStored = null;

    // 有指定過期日：到期前2天
    if (item.expiryDate) {
      const expiry = new Date(item.expiryDate);
      const diffDays = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
      if (diffDays <= 2 && diffDays >= 0) {
        shouldAlert = true;
        item.alertReason = `到期日 ${item.expiryDate}（還有 ${diffDays} 天）`;
      }
      if (diffDays < 0) {
        shouldAlert = true;
        item.alertReason = `已過期 ${Math.abs(diffDays)} 天！`;
      }
    } else if (item.addedDate) {
      const added = new Date(item.addedDate);
      daysStored = Math.floor((today - added) / (1000 * 60 * 60 * 24));

      // 依保存方式判斷
      const storage = item.storage || '冷藏';
      const tag = item.tag || [];

      if (storage === '冷藏') {
        let threshold = 5; // 預設冷藏5天
        if (tag.includes('肉類/蛋白質') || tag.includes('海鮮')) threshold = 2;
        else if (tag.includes('乳製品')) threshold = 4;
        else if (tag.includes('蔬菜')) threshold = 4;

        if (daysStored >= threshold) {
          shouldAlert = true;
          item.alertReason = `冷藏 ${daysStored} 天（建議 ${threshold} 天內使用）`;
        }
      } else if (storage === '冷凍' && daysStored >= 30) {
        shouldAlert = true;
        item.alertReason = `冷凍已 ${daysStored} 天`;
      }
    }

    if (shouldAlert) {
      expiring.push(item);
    }
  }

  return expiring;
}

module.exports = {
  getAllIngredients,
  findIngredientByName,
  createIngredient,
  updateIngredient,
  getExpiringIngredients,
  getAllRecipes,
  getRecipesByCategory,
  getRecipesByIngredientName,
  getRecipeDetail,
  updateRecipeDays,
  getIngredientNames
};
