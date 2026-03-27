// utils/notion.js
const axios = require('axios');

const NOTION_API = 'https://api.notion.com/v1';
const HEADERS = {
  'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

// 取得食譜頁面的第一張圖片 URL
async function getRecipePageImage(pageId) {
  try {
    const response = await axios.get(
      NOTION_API + '/blocks/' + pageId + '/children?page_size=10',
      { headers: HEADERS, timeout: 5000 }
    );
    const blocks = response.data.results || [];
    for (const block of blocks) {
      if (block.type === 'image') {
        const img = block.image;
        if (img.type === 'file' && img.file && img.file.url) {
          return img.file.url;
        }
        if (img.type === 'external' && img.external && img.external.url) {
          return img.external.url;
        }
      }
    }
  } catch(e) {
    console.log('取圖片失敗:', e.message);
  }
  return null;
}

async function getAllIngredients() {
  const response = await axios.post(
    NOTION_API + '/databases/' + process.env.NOTION_INGREDIENT_DB + '/query',
    { filter: { property: '已有', checkbox: { equals: true } }, page_size: 100 },
    { headers: HEADERS }
  );
  return response.data.results.map(parseIngredientPage);
}

async function findIngredientByName(name) {
  const response = await axios.post(
    NOTION_API + '/databases/' + process.env.NOTION_INGREDIENT_DB + '/query',
    { filter: { property: 'Name', title: { equals: name } } },
    { headers: HEADERS }
  );
  if (response.data.results.length > 0) return response.data.results[0];
  return null;
}

async function createIngredient(data) {
  const { name, quantity, unit, storage, expiryDate, addedDate } = data;
  const properties = {
    'Name': { title: [{ text: { content: name } }] },
    '已有': { checkbox: true },
    '數量': { number: quantity || null },
    '單位': { rich_text: [{ text: { content: unit || '' } }] },
    '加入日期': addedDate ? { date: { start: addedDate } } : { date: { start: new Date().toISOString().split('T')[0] } }
  };
  if (storage) properties['保存方式'] = { select: { name: storage } };
  if (expiryDate) properties['預計過期日'] = { date: { start: expiryDate } };
  const response = await axios.post(
    NOTION_API + '/pages',
    { parent: { database_id: process.env.NOTION_INGREDIENT_DB }, properties },
    { headers: HEADERS }
  );
  return response.data;
}

async function updateIngredient(pageId, updates) {
  const properties = {};
  if (updates.quantity !== undefined) properties['數量'] = { number: updates.quantity };
  if (updates.hasIt !== undefined) properties['已有'] = { checkbox: updates.hasIt };
  if (updates.unit !== undefined) properties['單位'] = { rich_text: [{ text: { content: updates.unit } }] };
  if (updates.storage !== undefined) properties['保存方式'] = { select: { name: updates.storage } };
  if (updates.expiryDate !== undefined) properties['預計過期日'] = { date: { start: updates.expiryDate } };
  if (updates.addedDate !== undefined) properties['加入日期'] = { date: { start: updates.addedDate } };
  const response = await axios.patch(
    NOTION_API + '/pages/' + pageId,
    { properties },
    { headers: HEADERS }
  );
  return response.data;
}

async function getExpiringIngredients() {
  const today = new Date();
  const twoDaysLater = new Date(today);
  twoDaysLater.setDate(today.getDate() + 2);
  const response = await axios.post(
    NOTION_API + '/databases/' + process.env.NOTION_INGREDIENT_DB + '/query',
    {
      filter: {
        and: [
          { property: '已有', checkbox: { equals: true } },
          { or: [
            { and: [
              { property: '預計過期日', date: { is_not_empty: true } },
              { property: '預計過期日', date: { on_or_before: twoDaysLater.toISOString().split('T')[0] } }
            ]},
            { and: [
              { property: '加入日期', date: { is_not_empty: true } },
              { property: '保存方式', select: { equals: '冷藏' } }
            ]}
          ]}
        ]
      },
      page_size: 50
    },
    { headers: HEADERS }
  );
  const all = response.data.results.map(parseIngredientPage);
  return filterExpiringByStorageRules(all, today);
}

async function getAllRecipes() {
  let allRecipes = [];
  let hasMore = true;
  let cursor;
  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const response = await axios.post(
      NOTION_API + '/databases/' + process.env.NOTION_RECIPE_DB + '/query',
      body, { headers: HEADERS }
    );
    allRecipes = allRecipes.concat(response.data.results.map(parseRecipePage));
    hasMore = response.data.has_more;
    cursor = response.data.next_cursor;
  }
  return allRecipes;
}

async function getRecipesByCategory(category) {
  const response = await axios.post(
    NOTION_API + '/databases/' + process.env.NOTION_RECIPE_DB + '/query',
    { filter: { property: '分類', multi_select: { contains: category } }, page_size: 50 },
    { headers: HEADERS }
  );
  return response.data.results.map(parseRecipePage);
}

async function getRecipesByIngredientName(ingredientName) {
  const ingredientPage = await findIngredientByName(ingredientName);
  if (!ingredientPage) return [];
  const response = await axios.post(
    NOTION_API + '/databases/' + process.env.NOTION_RECIPE_DB + '/query',
    { filter: { property: '所需食材', relation: { contains: ingredientPage.id } }, page_size: 50 },
    { headers: HEADERS }
  );
  return response.data.results.map(parseRecipePage);
}

async function getRecipeDetail(recipePageId) {
  const response = await axios.get(
    NOTION_API + '/pages/' + recipePageId,
    { headers: HEADERS }
  );
  const recipe = parseRecipePage(response.data);

  // 取得食材名稱
  if (recipe.ingredientIds && recipe.ingredientIds.length > 0) {
    recipe.ingredients = await getIngredientNames(recipe.ingredientIds);
  }

  // 取得頁面圖片
  recipe.imageUrl = await getRecipePageImage(recipePageId);

  return recipe;
}

async function updateRecipeDays(recipePageId, days) {
  const multiSelect = days.map(function(day) { return { name: day }; });
  await axios.patch(
    NOTION_API + '/pages/' + recipePageId,
    { properties: { '哪天吃': { multi_select: multiSelect } } },
    { headers: HEADERS }
  );
}

function parseIngredientPage(page) {
  const props = page.properties;
  return {
    id: page.id,
    name: (props['Name'] && props['Name'].title && props['Name'].title[0]) ? props['Name'].title[0].plain_text : '',
    hasIt: (props['已有'] && props['已有'].checkbox) || false,
    quantity: (props['數量'] && props['數量'].number) || null,
    unit: (props['單位'] && props['單位'].rich_text && props['單位'].rich_text[0]) ? props['單位'].rich_text[0].plain_text : '',
    tag: (props['Tag'] && props['Tag'].multi_select) ? props['Tag'].multi_select.map(function(t) { return t.name; }) : [],
    storage: (props['保存方式'] && props['保存方式'].select) ? props['保存方式'].select.name : null,
    addedDate: (props['加入日期'] && props['加入日期'].date) ? props['加入日期'].date.start : null,
    expiryDate: (props['預計過期日'] && props['預計過期日'].date) ? props['預計過期日'].date.start : null
  };
}

function parseRecipePage(page) {
  const props = page.properties;
  return {
    id: page.id,
    name: (props['食譜名稱'] && props['食譜名稱'].title && props['食譜名稱'].title[0]) ? props['食譜名稱'].title[0].plain_text : '',
    category: (props['分類'] && props['分類'].multi_select) ? props['分類'].multi_select.map(function(c) { return c.name; }) : [],
    mealType: (props['哪餐吃'] && props['哪餐吃'].multi_select) ? props['哪餐吃'].multi_select.map(function(m) { return m.name; }) : [],
    days: (props['哪天吃'] && props['哪天吃'].multi_select) ? props['哪天吃'].multi_select.map(function(d) { return d.name; }) : [],
    inRecentList: (props['加入近期食譜'] && props['加入近期食譜'].checkbox) || false,
    prepNote: (props['提前備菜'] && props['提前備菜'].rich_text && props['提前備菜'].rich_text[0]) ? props['提前備菜'].rich_text[0].plain_text : '',
    tutorialUrl: (props['教程連結'] && props['教程連結'].url) || '',
    steps: (props['料理步驟'] && props['料理步驟'].rich_text && props['料理步驟'].rich_text[0]) ? props['料理步驟'].rich_text[0].plain_text : '',
    source: (props['貼文來源'] && props['貼文來源'].select) ? props['貼文來源'].select.name : '',
    ingredientIds: (props['所需食材'] && props['所需食材'].relation) ? props['所需食材'].relation.map(function(r) { return r.id; }) : [],
    notionUrl: page.url || ''
  };
}

async function getIngredientNames(ingredientIds) {
  const names = await Promise.all(
    ingredientIds.map(async function(id) {
      try {
        const res = await axios.get(NOTION_API + '/pages/' + id, { headers: HEADERS });
        return parseIngredientPage(res.data);
      } catch(e) {
        return { id: id, name: '未知食材', hasIt: false };
      }
    })
  );
  return names;
}

function filterExpiringByStorageRules(ingredients, today) {
  const expiring = [];
  for (const item of ingredients) {
    if (!item.hasIt) continue;
    let shouldAlert = false;
    if (item.expiryDate) {
      const expiry = new Date(item.expiryDate);
      const diffDays = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
      if (diffDays <= 2) {
        shouldAlert = true;
        item.alertReason = diffDays >= 0 ? '到期日 ' + item.expiryDate + '（還有 ' + diffDays + ' 天）' : '已過期 ' + Math.abs(diffDays) + ' 天！';
      }
    } else if (item.addedDate) {
      const added = new Date(item.addedDate);
      const daysStored = Math.floor((today - added) / (1000 * 60 * 60 * 24));
      const storage = item.storage || '冷藏';
      const tag = item.tag || [];
      if (storage === '冷藏') {
        let threshold = 5;
        if (tag.includes('肉類/蛋白質') || tag.includes('海鮮')) threshold = 2;
        else if (tag.includes('乳製品')) threshold = 4;
        else if (tag.includes('蔬菜')) threshold = 4;
        if (daysStored >= threshold) { shouldAlert = true; item.alertReason = '冷藏 ' + daysStored + ' 天'; }
      } else if (storage === '冷凍' && daysStored >= 30) {
        shouldAlert = true; item.alertReason = '冷凍已 ' + daysStored + ' 天';
      }
    }
    if (shouldAlert) expiring.push(item);
  }
  return expiring;
}

module.exports = {
  getAllIngredients, findIngredientByName, createIngredient, updateIngredient,
  getExpiringIngredients, getAllRecipes, getRecipesByCategory,
  getRecipesByIngredientName, getRecipeDetail, updateRecipeDays, getIngredientNames
};
