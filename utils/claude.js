// utils/claude.js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function parseIngredientInput(userInput) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: 500,
    messages: [{ role: 'user', content: `請解析以下食材輸入，回傳 JSON 格式。格式非常寬鬆，用戶可能用各種方式表達。\n\n輸入：${userInput}\n\n規則：\n- 有「+」或「加」代表買入/增加\n- 有「-」或「減」或「用掉」代表使用掉/減少\n- 有「冷凍」代表冷凍，有「冷藏」代表冷藏\n- 有「到期」或「過期」後跟日期，轉 YYYY-MM-DD（今年是 ${new Date().getFullYear()}）\n- 數量不確定（一些、幾個）時 isUncertain=true\n- 單位從輸入提取，沒有就根據食材推斷\n\n只回傳 JSON：\n{"action":"add或remove","name":"食材名","quantity":數字或null,"unit":"單位","storage":"冷凍/冷藏/常溫/null","expiryDate":"YYYY-MM-DD或null","isUncertain":true或false}` }]
  });
  try {
    let t = message.content[0].text.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    return JSON.parse(t);
  } catch { return null; }
}

async function detectIntent(userInput) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: 100,
    messages: [{ role: 'user', content: `判斷意圖，只回傳JSON。輸入：「${userInput}」\n意圖：ingredient_update(食材+/-數量)/search_by_ingredient(食材名搜食譜)/what_to_eat/random_recommend/plan_meals/other\n只回傳：{"intent":"類型"}` }]
  });
  try {
    let t = message.content[0].text.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    return JSON.parse(t).intent;
  } catch { return 'other'; }
}

async function generateMealPlan(days, availableIngredients, recipes) {
  const ingList = availableIngredients.filter(i=>i.hasIt).slice(0,20).map(i=>`${i.name}${i.quantity?`(${i.quantity}${i.unit})`:''}`).join('、');
  const recList = recipes.slice(0,25).map(r=>r.name).join('、');
  const message = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: 2000,
    messages: [{ role: 'user', content: `為接下來${days}天規劃三餐。現有食材：${ingList||'(空)'}。可用食譜：${recList||'(空)'}。嚴格按JSON格式回傳（不要其他文字）：{"plan":[{"day":"第1天","breakfast":"菜名或—","lunch":"菜名或—","dinner":"菜名或—"}],"toBuy":["食材"],"crossUsageTips":"建議"}` }]
  });
  try {
    let t = message.content[0].text.trim();
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch(e) { console.error('plan parse fail:', e.message); return null; }
}

async function classifyIngredient(name) {
  const message = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: 50,
    messages: [{ role: 'user', content: `「${name}」屬於哪個分類？只選一個：肉類/蛋白質、蔬菜、調料、穀物、乳製品、水果、海鮮、零食。只回傳JSON：{"tag":"分類"}` }]
  });
  try {
    let t = message.content[0].text.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    return JSON.parse(t).tag;
  } catch { return '蔬菜'; }
}

async function suggestRecipesForMissingIngredient(missing, allRecipes) {
  if (!allRecipes || allRecipes.length === 0) return [];
  const names = allRecipes.slice(0,30).map(r=>r.name).join('、');
  const message = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: 150,
    messages: [{ role: 'user', content: `從食譜清單中找出需要「${missing}」的食譜（最多3個）：${names}。只回傳JSON：{"recipes":["食譜1"]}` }]
  });
  try {
    let t = message.content[0].text.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    return JSON.parse(t).recipes || [];
  } catch { return []; }
}

module.exports = { parseIngredientInput, detectIntent, generateMealPlan, classifyIngredient, suggestRecipesForMissingIngredient };
