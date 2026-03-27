// utils/claude.js
// Claude API 呼叫工具函式

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * 解析使用者輸入的食材更新指令
 * 例如：「番茄 +6個」「豬五花 +300g 冷凍」「番茄 -2」「牛奶 +1瓶 到期3/30」
 */
async function parseIngredientInput(userInput) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `請解析以下食材輸入指令，回傳 JSON 格式。

輸入：${userInput}

規則：
- 有「+」代表買入/增加
- 有「-」代表使用掉/減少
- 有「冷凍」代表保存方式是冷凍
- 有「冷藏」代表保存方式是冷藏
- 有「到期X/X」或「到期X月X日」代表指定過期日，轉成 YYYY-MM-DD 格式（今年是 ${new Date().getFullYear()}）
- 數量不確定（「一些」「幾個」等）記為 null
- 沒說單位時，根據食材常識推斷（蛋用「顆」、肉用「g」、蔬菜葉菜用「把」或「顆」、液體/調料用「瓶」或「罐」）

回傳格式（只回傳 JSON，不要其他文字）：
{
  "action": "add" 或 "remove",
  "name": "食材名稱",
  "quantity": 數字或 null,
  "unit": "單位或空字串",
  "storage": "冷藏" 或 "冷凍" 或 "常溫" 或 null,
  "expiryDate": "YYYY-MM-DD" 或 null,
  "isUncertain": true/false （數量不確定時為 true）
}`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 判斷使用者輸入的意圖
 * 判斷是：食材操作 / 查詢食譜 / 系統指令 / 其他
 */
async function detectIntent(userInput) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `判斷以下輸入的意圖，只回傳一個 JSON 物件。

輸入：「${userInput}」

意圖類型：
- "ingredient_update"：食材增減，包含「+」或「-」的輸入
- "search_by_ingredient"：用食材搜尋食譜，輸入是食材名稱（沒有+/-）
- "what_to_eat"：輸入是「我要吃什麼」或類似詞
- "random_recommend"：輸入是「隨機推薦」或類似詞
- "plan_meals"：輸入是「規劃餐點」或類似詞
- "check_recipes"：輸入是「檢查食譜庫」或類似詞
- "other"：其他

只回傳 JSON：{"intent": "類型"}`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    const parsed = JSON.parse(text);
    return parsed.intent;
  } catch {
    return 'other';
  }
}

/**
 * 根據現有食材和食譜庫，生成餐點規劃草稿
 */
async function generateMealPlan(days, availableIngredients, recipes) {
  const ingredientList = availableIngredients
    .map(i => `${i.name}（${i.quantity || '適量'}${i.unit}，${i.storage || ''}）`)
    .join('、');

  const recipeList = recipes
    .slice(0, 30) // 只傳前30道避免 token 過多
    .map(r => `${r.name}（${r.category.join('/')}，需要：${r.ingredientIds.length}種食材）`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `請根據現有食材，為接下來 ${days} 天規劃三餐。

現有食材：${ingredientList}

可用食譜清單：
${recipeList}

規劃原則：
1. 優先使用現有食材，減少浪費
2. 同食材可連續出現，但建議換烹調方式
3. 可以留空（用「—」表示）
4. 一道菜可以跨多天（用「同上」表示）
5. 列出需要額外購買的食材

回傳格式（只回傳 JSON）：
{
  "plan": [
    {
      "day": "第1天",
      "breakfast": "菜名或—",
      "lunch": "菜名或—",
      "dinner": "菜名或—"
    }
  ],
  "toBuy": ["食材1", "食材2"],
  "crossUsageTips": "關於食材跨菜使用的建議"
}`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 自動分類食材
 */
async function classifyIngredient(name) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `「${name}」屬於哪個食材分類？
只能選一個：肉類/蛋白質、蔬菜、調料、穀物、乳製品、水果、海鮮、零食

只回傳 JSON：{"tag": "分類名稱"}`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    const parsed = JSON.parse(text);
    return parsed.tag;
  } catch {
    return '蔬菜'; // 預設
  }
}

/**
 * 找出「買了某食材還能做什麼」
 */
async function suggestRecipesForMissingIngredient(missingIngredient, allRecipes) {
  const recipeNames = allRecipes
    .filter(r => r.ingredientIds.length > 0)
    .slice(0, 40)
    .map(r => r.name)
    .join('、');

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `從以下食譜清單中，找出需要用到「${missingIngredient}」的食譜（最多3個）。

食譜清單：${recipeNames}

只回傳 JSON：{"recipes": ["食譜1", "食譜2"]}`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    const parsed = JSON.parse(text);
    return parsed.recipes || [];
  } catch {
    return [];
  }
}

module.exports = {
  parseIngredientInput,
  detectIntent,
  generateMealPlan,
  classifyIngredient,
  suggestRecipesForMissingIngredient
};
